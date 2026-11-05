use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_http::reqwest;
use tauri_plugin_http::reqwest::header::{ACCEPT, LOCATION, RETRY_AFTER};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};
use super::process::ProcessRegistry;

pub const RELEASE_REPOSITORY: &str = "rafalibano/clawdmeter";

const MANIFEST_ASSET: &str = "latest.json";
const USER_AGENT: &str = "ClawdMeter-updater";
const API_VERSION: &str = "2022-11-28";
const JSON_ACCEPT: &str = "application/vnd.github+json";
const BINARY_ACCEPT: &str = "application/octet-stream";
const CHECK_TIMEOUT_SECS: u64 = 20;
const DOWNLOAD_TIMEOUT_SECS: u64 = 900;
const MAX_RELEASE_BYTES: usize = 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_PACKAGE_BYTES: usize = 300 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const MAX_RETRY_AFTER_SECS: u64 = 3_600;

#[derive(Debug, Clone, Copy)]
pub struct Origins {
    pub api_host: &'static str,
    pub storage_hosts: &'static [&'static str],
    pub https_only: bool,
}

pub const GITHUB: Origins = Origins {
    api_host: "api.github.com",
    storage_hosts: &[
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
    ],
    https_only: true,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hop {
    Api,
    Storage,
}

impl Origins {
    fn api_base(&self) -> String {
        let scheme = if self.https_only { "https" } else { "http" };
        format!("{scheme}://{}", self.api_host)
    }

    fn latest_release_url(&self, repository: &str) -> String {
        format!("{}/repos/{repository}/releases/latest", self.api_base())
    }

    fn asset_url(&self, repository: &str, id: u64) -> String {
        format!(
            "{}/repos/{repository}/releases/assets/{id}",
            self.api_base()
        )
    }

    fn classify(&self, url: &Url) -> CommandResult<Hop> {
        if self.https_only && url.scheme() != "https" {
            return Err(policy("update download must use https"));
        }
        let host = url.host_str().unwrap_or_default();
        let authority = match url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_string(),
        };
        if authority == self.api_host {
            return Ok(Hop::Api);
        }
        if self.storage_hosts.contains(&authority.as_str()) {
            return Ok(Hop::Storage);
        }
        Err(policy(format!("update host not allowed: {host}")))
    }
}

#[derive(Debug, Clone, Deserialize)]
struct Release {
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Debug, Clone, Deserialize)]
struct Asset {
    id: u64,
    name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<i64>,
}

impl From<&Update> for AvailableUpdate {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|date| date.unix_timestamp()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum DownloadEvent {
    Progress { downloaded: u64, total: Option<u64> },
    Finished,
}

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

impl PendingUpdate {
    fn replace(&self, update: Option<Update>) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = update;
        }
    }

    fn current(&self) -> Option<Update> {
        self.0.lock().ok().and_then(|slot| slot.clone())
    }
}

fn policy(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorKind::Policy, message)
}

fn http_error(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorKind::Http, message)
}

fn updater_error(error: tauri_plugin_updater::Error) -> CommandError {
    CommandError::new(ErrorKind::ProviderError, error.to_string())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn header_u64(response: &reqwest::Response, name: &str) -> Option<u64> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse().ok())
}

fn rate_limit_wait(
    retry_after: Option<u64>,
    reset_at: Option<u64>,
    remaining: Option<u64>,
    now: u64,
) -> Option<Option<u64>> {
    if let Some(seconds) = retry_after {
        return Some(Some(seconds.min(MAX_RETRY_AFTER_SECS)));
    }
    if remaining == Some(0) {
        return Some(reset_at.map(|reset| reset.saturating_sub(now).min(MAX_RETRY_AFTER_SECS)));
    }
    None
}

fn check_status(response: &reqwest::Response) -> CommandResult<()> {
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status == reqwest::StatusCode::FORBIDDEN
    {
        let wait = rate_limit_wait(
            header_u64(response, RETRY_AFTER.as_str()),
            header_u64(response, "x-ratelimit-reset"),
            header_u64(response, "x-ratelimit-remaining"),
            now_secs(),
        );
        if let Some(retry_after) = wait {
            return Err(CommandError::rate_limited(
                "GitHub rate-limited the update check",
                retry_after,
            ));
        }
    }
    Err(http_error(format!(
        "GitHub returned {} for the release",
        status.as_u16()
    )))
}

fn client(timeout_secs: u64) -> CommandResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}

async fn open(
    origins: &Origins,
    client: &reqwest::Client,
    start: Url,
    token: &str,
    accept: &str,
) -> CommandResult<reqwest::Response> {
    let mut url = start;
    for _ in 0..=MAX_REDIRECTS {
        let hop = origins.classify(&url)?;
        let mut request = client.get(url.clone()).header(ACCEPT, accept);
        if hop == Hop::Api {
            request = request
                .bearer_auth(token)
                .header("X-GitHub-Api-Version", API_VERSION);
        }
        let response = request.send().await?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| http_error("redirect without a location"))?;
            url = url.join(location)?;
            continue;
        }
        check_status(&response)?;
        return Ok(response);
    }
    Err(http_error("too many redirects"))
}

async fn read_limited<F: FnMut(u64, Option<u64>)>(
    mut response: reqwest::Response,
    limit: usize,
    mut on_progress: F,
) -> CommandResult<Vec<u8>> {
    let total = response.content_length();
    if total.is_some_and(|length| length > limit as u64) {
        return Err(http_error("update response too large"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > limit {
            return Err(http_error("update response too large"));
        }
        body.extend_from_slice(&chunk);
        on_progress(body.len() as u64, total);
    }
    Ok(body)
}

fn decoded_file_name(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let segment = parsed.path_segments()?.next_back()?;
    percent_encoding::percent_decode_str(segment)
        .decode_utf8()
        .ok()
        .map(|name| name.into_owned())
}

fn rewrite_manifest(
    origins: &Origins,
    repository: &str,
    mut manifest: Value,
    assets: &[Asset],
) -> CommandResult<Value> {
    let platforms = manifest
        .get_mut("platforms")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| http_error("latest.json has no platforms"))?;
    platforms.retain(|_, entry| {
        let asset = entry
            .get("url")
            .and_then(Value::as_str)
            .and_then(decoded_file_name)
            .and_then(|name| assets.iter().find(|asset| asset.name == name));
        match asset {
            Some(asset) => {
                entry["url"] = Value::String(origins.asset_url(repository, asset.id));
                true
            }
            None => false,
        }
    });
    Ok(manifest)
}

async fn fetch_manifest(
    origins: &Origins,
    repository: &str,
    token: &str,
) -> CommandResult<Option<Value>> {
    let client = client(CHECK_TIMEOUT_SECS)?;
    let release_url = Url::parse(&origins.latest_release_url(repository))?;
    let response = open(origins, &client, release_url, token, JSON_ACCEPT).await?;
    let release: Release =
        serde_json::from_slice(&read_limited(response, MAX_RELEASE_BYTES, |_, _| {}).await?)
            .map_err(|_| http_error("release response is not valid JSON"))?;
    let Some(asset) = release
        .assets
        .iter()
        .find(|asset| asset.name == MANIFEST_ASSET)
    else {
        return Ok(None);
    };
    let manifest_url = Url::parse(&origins.asset_url(repository, asset.id))?;
    let response = open(origins, &client, manifest_url, token, BINARY_ACCEPT).await?;
    let manifest: Value =
        serde_json::from_slice(&read_limited(response, MAX_MANIFEST_BYTES, |_, _| {}).await?)
            .map_err(|_| http_error("latest.json is not valid JSON"))?;
    rewrite_manifest(origins, repository, manifest, &release.assets).map(Some)
}

async fn download_package<F: FnMut(u64, Option<u64>)>(
    origins: &Origins,
    url: Url,
    token: &str,
    on_progress: F,
) -> CommandResult<Vec<u8>> {
    if origins.classify(&url)? != Hop::Api {
        return Err(policy("the package must come from the GitHub API"));
    }
    let client = client(DOWNLOAD_TIMEOUT_SECS)?;
    let response = open(origins, &client, url, token, BINARY_ACCEPT).await?;
    read_limited(response, MAX_PACKAGE_BYTES, on_progress).await
}

fn restore<R: Runtime>(app: &AppHandle<R>, manifest: Value) -> CommandResult<Option<Update>> {
    let endpoint = Url::parse(&GITHUB.latest_release_url(RELEASE_REPOSITORY))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .and_then(|builder| builder.build())
        .map_err(updater_error)?;
    match updater.restore_update(manifest) {
        Ok(update) => Ok(update),
        Err(tauri_plugin_updater::Error::TargetNotFound(_))
        | Err(tauri_plugin_updater::Error::TargetsNotFound(_)) => Ok(None),
        Err(error) => Err(updater_error(error)),
    }
}

#[tauri::command]
pub async fn updater_check<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
    token: String,
) -> CommandResult<Option<AvailableUpdate>> {
    let update = match fetch_manifest(&GITHUB, RELEASE_REPOSITORY, &token).await? {
        Some(manifest) => restore(&app, manifest)?,
        None => None,
    };
    let available = update.as_ref().map(AvailableUpdate::from);
    pending.replace(update);
    Ok(available)
}

#[tauri::command]
pub async fn updater_install(
    pending: State<'_, PendingUpdate>,
    token: String,
    on_event: Channel<DownloadEvent>,
) -> CommandResult<()> {
    let update = pending
        .current()
        .ok_or_else(|| CommandError::new(ErrorKind::StateMismatch, "no update to install"))?;
    let bytes = download_package(
        &GITHUB,
        update.download_url.clone(),
        &token,
        |downloaded, total| {
            let _ = on_event.send(DownloadEvent::Progress { downloaded, total });
        },
    )
    .await?;
    let _ = on_event.send(DownloadEvent::Finished);
    run_blocking(move || update.install(bytes).map_err(updater_error)).await?;
    pending.replace(None);
    Ok(())
}

#[tauri::command]
pub fn updater_restart<R: Runtime>(app: AppHandle<R>) {
    app.state::<ProcessRegistry>().terminate_all();
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread::JoinHandle;

    const LOCAL: Origins = Origins {
        api_host: "127.0.0.1",
        storage_hosts: &["localhost"],
        https_only: false,
    };

    fn assets() -> Vec<Asset> {
        vec![
            Asset {
                id: 11,
                name: "latest.json".into(),
            },
            Asset {
                id: 22,
                name: "ClawdMeter_universal.app.tar.gz".into(),
            },
            Asset {
                id: 33,
                name: "ClawdMeter_0.2.0_x64-setup.exe".into(),
            },
        ]
    }

    fn manifest() -> Value {
        json!({
            "version": "0.2.0",
            "notes": "Fixes",
            "pub_date": "2026-11-05T12:00:00Z",
            "platforms": {
                "darwin-aarch64": {
                    "signature": "sig-mac",
                    "url": "https://github.com/rafalibano/clawdmeter/releases/download/v0.2.0/ClawdMeter_universal.app.tar.gz"
                },
                "windows-x86_64-nsis": {
                    "signature": "sig-win",
                    "url": "https://github.com/rafalibano/clawdmeter/releases/download/v0.2.0/ClawdMeter_0.2.0_x64-setup.exe"
                },
                "linux-x86_64": {
                    "signature": "sig-linux",
                    "url": "https://github.com/rafalibano/clawdmeter/releases/download/v0.2.0/missing.AppImage"
                }
            }
        })
    }

    #[test]
    fn the_repository_is_one_owner_and_one_name() {
        let parts: Vec<&str> = RELEASE_REPOSITORY.split('/').collect();
        assert_eq!(parts.len(), 2);
        assert!(parts.iter().all(|part| !part.is_empty()));
    }

    #[test]
    fn manifest_urls_become_api_asset_urls_and_unknown_assets_are_dropped() {
        let rewritten = rewrite_manifest(&GITHUB, "acme/app", manifest(), &assets()).unwrap();
        let platforms = rewritten["platforms"].as_object().unwrap();
        assert_eq!(platforms.len(), 2);
        assert_eq!(
            platforms["darwin-aarch64"]["url"],
            "https://api.github.com/repos/acme/app/releases/assets/22"
        );
        assert_eq!(platforms["darwin-aarch64"]["signature"], "sig-mac");
        assert_eq!(
            platforms["windows-x86_64-nsis"]["url"],
            "https://api.github.com/repos/acme/app/releases/assets/33"
        );
        assert_eq!(rewritten["version"], "0.2.0");
    }

    #[test]
    fn manifest_file_names_are_percent_decoded() {
        let assets = vec![Asset {
            id: 7,
            name: "Clawd Meter.app.tar.gz".into(),
        }];
        let manifest = json!({ "version": "1.0.0", "platforms": { "darwin-aarch64": {
            "signature": "s", "url": "https://github.com/a/b/releases/download/v1/Clawd%20Meter.app.tar.gz" } } });
        let rewritten = rewrite_manifest(&GITHUB, "a/b", manifest, &assets).unwrap();
        assert_eq!(
            rewritten["platforms"]["darwin-aarch64"]["url"],
            "https://api.github.com/repos/a/b/releases/assets/7"
        );
    }

    #[test]
    fn manifest_without_platforms_is_refused() {
        let error =
            rewrite_manifest(&GITHUB, "a/b", json!({ "version": "1.0.0" }), &assets()).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
    }

    #[test]
    fn rewritten_manifest_parses_as_a_tauri_release() {
        let rewritten = rewrite_manifest(&GITHUB, "acme/app", manifest(), &assets()).unwrap();
        let release: tauri_plugin_updater::RemoteRelease =
            serde_json::from_value(rewritten).unwrap();
        assert_eq!(release.version.to_string(), "0.2.0");
        assert_eq!(
            release.download_url("darwin-aarch64").unwrap().as_str(),
            "https://api.github.com/repos/acme/app/releases/assets/22"
        );
    }

    #[test]
    fn only_the_api_and_the_asset_storage_are_allowed() {
        let classify = |url: &str| GITHUB.classify(&Url::parse(url).unwrap());
        assert_eq!(
            classify("https://api.github.com/repos/a/b").unwrap(),
            Hop::Api
        );
        assert_eq!(
            classify("https://release-assets.githubusercontent.com/x").unwrap(),
            Hop::Storage
        );
        assert_eq!(
            classify("https://objects.githubusercontent.com/x").unwrap(),
            Hop::Storage
        );
        assert_eq!(
            classify("https://evil.example/x").unwrap_err().kind,
            ErrorKind::Policy
        );
        assert_eq!(
            classify("http://api.github.com/x").unwrap_err().kind,
            ErrorKind::Policy
        );
        assert_eq!(
            classify("https://api.github.com.evil.example/x")
                .unwrap_err()
                .kind,
            ErrorKind::Policy
        );
    }

    #[test]
    fn rate_limit_reads_retry_after_or_the_reset_time() {
        assert_eq!(rate_limit_wait(Some(30), None, None, 0), Some(Some(30)));
        assert_eq!(
            rate_limit_wait(None, Some(1_120), Some(0), 1_000),
            Some(Some(120))
        );
        assert_eq!(
            rate_limit_wait(None, Some(99_999), Some(0), 0),
            Some(Some(MAX_RETRY_AFTER_SECS))
        );
        assert_eq!(rate_limit_wait(None, None, Some(0), 0), Some(None));
        assert_eq!(rate_limit_wait(None, Some(10), Some(12), 0), None);
    }

    fn listen() -> (TcpListener, u16) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        (listener, port)
    }

    fn serve(listener: TcpListener, responses: Vec<String>) -> JoinHandle<Vec<String>> {
        std::thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = [0u8; 8192];
                let read = stream.read(&mut buffer).unwrap();
                requests.push(String::from_utf8_lossy(&buffer[..read]).to_lowercase());
                stream.write_all(response.as_bytes()).unwrap();
            }
            requests
        })
    }

    fn ok(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn redirect(location: &str) -> String {
        format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    }

    fn local_origins(api_port: u16, storage_port: u16) -> Origins {
        let api: &'static str = Box::leak(format!("127.0.0.1:{api_port}").into_boxed_str());
        let storage: &'static str = Box::leak(format!("localhost:{storage_port}").into_boxed_str());
        let hosts: &'static [&'static str] = Box::leak(vec![storage].into_boxed_slice());
        Origins {
            api_host: api,
            storage_hosts: hosts,
            ..LOCAL
        }
    }

    #[test]
    fn the_token_goes_to_the_api_but_never_follows_the_redirect_to_storage() {
        let (api, api_port) = listen();
        let (storage, storage_port) = listen();
        let origins = local_origins(api_port, storage_port);
        let release = json!({ "assets": [{ "id": 11, "name": "latest.json" }, { "id": 22, "name": "ClawdMeter_universal.app.tar.gz" }] }).to_string();
        let latest = json!({ "version": "0.2.0", "platforms": { "darwin-aarch64": {
            "signature": "sig", "url": "https://github.com/a/b/releases/download/v0.2.0/ClawdMeter_universal.app.tar.gz" } } }).to_string();
        let api_server = serve(
            api,
            vec![
                ok(&release),
                redirect(&format!("http://localhost:{storage_port}/signed?x=1")),
            ],
        );
        let storage_server = serve(storage, vec![ok(&latest)]);
        let manifest =
            tauri::async_runtime::block_on(fetch_manifest(&origins, "a/b", "ghp_secret"))
                .unwrap()
                .unwrap();
        let api_requests = api_server.join().unwrap();
        let storage_requests = storage_server.join().unwrap();
        assert!(api_requests[0].starts_with("get /repos/a/b/releases/latest"));
        assert!(api_requests[0].contains("authorization: bearer ghp_secret"));
        assert!(api_requests[0].contains("user-agent: clawdmeter-updater"));
        assert!(api_requests[1].starts_with("get /repos/a/b/releases/assets/11"));
        assert!(api_requests[1].contains("accept: application/octet-stream"));
        assert!(storage_requests[0].starts_with("get /signed?x=1"));
        assert!(!storage_requests[0].contains("authorization"));
        assert!(!storage_requests[0].contains("ghp_secret"));
        assert_eq!(
            manifest["platforms"]["darwin-aarch64"]["url"],
            format!("http://127.0.0.1:{api_port}/repos/a/b/releases/assets/22")
        );
    }

    #[test]
    fn a_release_without_latest_json_means_no_update() {
        let (api, api_port) = listen();
        let origins = local_origins(api_port, 1);
        let server = serve(api, vec![ok(r#"{"assets":[{"id":1,"name":"app.dmg"}]}"#)]);
        let manifest =
            tauri::async_runtime::block_on(fetch_manifest(&origins, "a/b", "t")).unwrap();
        server.join().unwrap();
        assert!(manifest.is_none());
    }

    #[test]
    fn a_redirect_to_an_unknown_host_is_refused_before_connecting() {
        let (api, api_port) = listen();
        let (elsewhere, elsewhere_port) = listen();
        elsewhere.set_nonblocking(true).unwrap();
        let origins = local_origins(api_port, 1);
        let server = serve(
            api,
            vec![redirect(&format!("http://127.0.0.2:{elsewhere_port}/x"))],
        );
        let url = Url::parse(&origins.asset_url("a/b", 22)).unwrap();
        let error = tauri::async_runtime::block_on(download_package(&origins, url, "t", |_, _| {}))
            .unwrap_err();
        server.join().unwrap();
        assert_eq!(error.kind, ErrorKind::Policy);
        assert!(elsewhere.accept().is_err());
    }

    #[test]
    fn a_package_url_outside_the_api_is_refused() {
        let origins = local_origins(1, 2);
        let url = Url::parse("http://localhost:2/package").unwrap();
        let error = tauri::async_runtime::block_on(download_package(&origins, url, "t", |_, _| {}))
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Policy);
    }

    #[test]
    fn download_reports_progress_and_returns_the_bytes() {
        let (api, api_port) = listen();
        let origins = local_origins(api_port, 1);
        let server = serve(api, vec![ok("package-bytes")]);
        let url = Url::parse(&origins.asset_url("a/b", 22)).unwrap();
        let mut seen = Vec::new();
        let bytes = tauri::async_runtime::block_on(download_package(
            &origins,
            url,
            "t",
            |downloaded, total| seen.push((downloaded, total)),
        ))
        .unwrap();
        server.join().unwrap();
        assert_eq!(bytes, b"package-bytes");
        assert_eq!(seen.last(), Some(&(13, Some(13))));
    }

    #[test]
    fn github_rate_limit_is_a_typed_error() {
        let (api, api_port) = listen();
        let origins = local_origins(api_port, 1);
        let server = serve(
            api,
            vec!["HTTP/1.1 403 Forbidden\r\nx-ratelimit-remaining: 0\r\nRetry-After: 60\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()],
        );
        let error =
            tauri::async_runtime::block_on(fetch_manifest(&origins, "a/b", "t")).unwrap_err();
        server.join().unwrap();
        assert_eq!(error.kind, ErrorKind::RateLimited);
        assert_eq!(error.retry_after_secs, Some(Some(60)));
    }

    #[test]
    fn other_statuses_are_http_errors_with_the_status() {
        let (api, api_port) = listen();
        let origins = local_origins(api_port, 1);
        let server = serve(
            api,
            vec!["HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()],
        );
        let error =
            tauri::async_runtime::block_on(fetch_manifest(&origins, "a/b", "t")).unwrap_err();
        server.join().unwrap();
        assert_eq!(error.kind, ErrorKind::Http);
        assert!(error.message.contains("404"));
    }

    #[test]
    fn download_events_serialize_for_the_webview() {
        let progress = DownloadEvent::Progress {
            downloaded: 5,
            total: Some(10),
        };
        assert_eq!(
            serde_json::to_string(&progress).unwrap(),
            r#"{"event":"progress","data":{"downloaded":5,"total":10}}"#
        );
        assert_eq!(
            serde_json::to_string(&DownloadEvent::Finished).unwrap(),
            r#"{"event":"finished"}"#
        );
    }
}

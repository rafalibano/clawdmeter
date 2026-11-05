use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri_plugin_http::reqwest;

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};
use super::home::home_dir;

pub const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const USAGE_TIMEOUT_SECS: u64 = 15;
const MAX_USAGE_BYTES: usize = 256 * 1024;
const MAX_EXPIRES_AT_MS: f64 = 9_007_199_254_740_991.0;

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCredentials {
    claude_ai_oauth: Option<StoredOauth>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredOauth {
    access_token: Option<String>,
    expires_at: Option<f64>,
    subscription_type: Option<String>,
}

#[derive(Clone, PartialEq)]
pub struct ClaudeCredential {
    pub access_token: String,
    pub expires_at: Option<u64>,
    pub subscription_type: Option<String>,
}

impl std::fmt::Debug for ClaudeCredential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ClaudeCredential")
            .field("expires_at", &self.expires_at)
            .field("subscription_type", &self.subscription_type)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCredentialStatus {
    pub expires_at: Option<u64>,
    pub subscription_type: Option<String>,
}

impl From<&ClaudeCredential> for ClaudeCredentialStatus {
    fn from(credential: &ClaudeCredential) -> Self {
        Self {
            expires_at: credential.expires_at,
            subscription_type: credential.subscription_type.clone(),
        }
    }
}

pub fn parse_credentials(raw: &str) -> CommandResult<ClaudeCredential> {
    let malformed =
        |detail: &str| CommandError::new(ErrorKind::CredentialMalformed, detail.to_string());
    let stored: StoredCredentials = serde_json::from_str(raw.trim())
        .map_err(|_| malformed("credencial do Claude Code não é um JSON válido"))?;
    let oauth = stored
        .claude_ai_oauth
        .ok_or_else(|| malformed("credencial sem claudeAiOauth"))?;
    let access_token = oauth
        .access_token
        .filter(|token| !token.is_empty())
        .ok_or_else(|| malformed("credencial sem accessToken"))?;
    Ok(ClaudeCredential {
        access_token,
        expires_at: oauth
            .expires_at
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(|value| value.min(MAX_EXPIRES_AT_MS) as u64),
        subscription_type: oauth.subscription_type,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub enum KeychainOutcome {
    Missing,
    Denied,
    Failed,
}

pub fn classify_security_failure(exit_code: Option<i32>, stderr: &str) -> KeychainOutcome {
    let text = stderr.to_lowercase();
    if exit_code == Some(44) || text.contains("could not be found") {
        return KeychainOutcome::Missing;
    }
    let denied_codes = [Some(36), Some(51), Some(128)];
    if denied_codes.contains(&exit_code)
        || text.contains("user canceled")
        || text.contains("user interaction is not allowed")
        || text.contains("denied")
    {
        return KeychainOutcome::Denied;
    }
    KeychainOutcome::Failed
}

pub fn credentials_file_path(home: Option<PathBuf>) -> Option<PathBuf> {
    home.map(|dir| dir.join(".claude").join(".credentials.json"))
}

fn read_credentials_file() -> CommandResult<Option<String>> {
    let Some(path) = credentials_file_path(home_dir()) else {
        return Ok(None);
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[cfg(target_os = "macos")]
fn read_keychain() -> CommandResult<Option<String>> {
    let output = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
        .output()?;
    if output.status.success() {
        return Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned()));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    match classify_security_failure(output.status.code(), &stderr) {
        KeychainOutcome::Missing => Ok(None),
        KeychainOutcome::Denied => Err(CommandError::new(
            ErrorKind::KeychainDenied,
            "acesso ao Keychain do Claude Code negado",
        )),
        KeychainOutcome::Failed => Err(CommandError::new(
            ErrorKind::Keychain,
            stderr.trim().to_string(),
        )),
    }
}

#[cfg(not(target_os = "macos"))]
fn read_keychain() -> CommandResult<Option<String>> {
    Ok(None)
}

fn read_credential() -> CommandResult<ClaudeCredential> {
    let raw = match read_keychain()? {
        Some(raw) => Some(raw),
        None => read_credentials_file()?,
    };
    match raw {
        Some(raw) => parse_credentials(&raw),
        None => Err(CommandError::new(
            ErrorKind::ClaudeCodeMissing,
            "credencial do Claude Code não encontrada",
        )),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

fn expired(credential: &ClaudeCredential, now: u64) -> bool {
    credential
        .expires_at
        .is_some_and(|expires_at| expires_at <= now)
}

fn claude_expired() -> CommandError {
    CommandError::new(ErrorKind::ClaudeExpired, "login do Claude expirado")
}

fn usage_too_large() -> CommandError {
    CommandError::new(ErrorKind::Http, "resposta de usage grande demais")
}

async fn read_limited(mut response: reqwest::Response, limit: usize) -> CommandResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(usage_too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > limit {
            return Err(usage_too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn request_usage(url: &str, access_token: &str) -> CommandResult<serde_json::Value> {
    request_usage_limited(url, access_token, MAX_USAGE_BYTES).await
}

async fn request_usage_limited(
    url: &str,
    access_token: &str,
    limit: usize,
) -> CommandResult<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(USAGE_TIMEOUT_SECS))
        .build()?;
    let response = client
        .get(url)
        .bearer_auth(access_token)
        .header("anthropic-beta", OAUTH_BETA)
        .header("Accept", "application/json")
        .send()
        .await?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(claude_expired());
    }
    if !status.is_success() {
        return Err(CommandError::new(
            ErrorKind::Http,
            format!(
                "Anthropic respondeu {} em /api/oauth/usage",
                status.as_u16()
            ),
        ));
    }
    let body = read_limited(response, limit).await?;
    serde_json::from_slice(&body)
        .map_err(|_| CommandError::new(ErrorKind::Http, "resposta de usage não é um JSON válido"))
}

async fn fetch_usage(url: &str) -> CommandResult<serde_json::Value> {
    let credential = run_blocking(read_credential).await?;
    if expired(&credential, now_ms()) {
        return Err(claude_expired());
    }
    request_usage(url, &credential.access_token).await
}

#[tauri::command]
pub async fn claude_credentials_status() -> CommandResult<ClaudeCredentialStatus> {
    let credential = run_blocking(read_credential).await?;
    Ok(ClaudeCredentialStatus::from(&credential))
}

#[tauri::command]
pub async fn claude_usage_fetch() -> CommandResult<serde_json::Value> {
    fetch_usage(USAGE_URL).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc","refreshToken":"sk-ant-ort01-xyz","expiresAt":1767225600000,"scopes":["user:inference"],"subscriptionType":"max"}}"#;

    #[test]
    fn parses_access_token_expiry_and_plan() {
        let credential = parse_credentials(VALID).unwrap();
        assert_eq!(credential.access_token, "sk-ant-oat01-abc");
        assert_eq!(credential.expires_at, Some(1_767_225_600_000));
        assert_eq!(credential.subscription_type.as_deref(), Some("max"));
    }

    #[test]
    fn the_status_sent_to_the_webview_carries_no_token() {
        let credential = parse_credentials(VALID).unwrap();
        let json = serde_json::to_string(&ClaudeCredentialStatus::from(&credential)).unwrap();
        assert_eq!(
            json,
            r#"{"expiresAt":1767225600000,"subscriptionType":"max"}"#
        );
        assert!(!json.contains("sk-ant"));
        assert!(!json.contains("refresh"));
    }

    #[test]
    fn debug_output_hides_the_access_token() {
        let credential = parse_credentials(VALID).unwrap();
        let text = format!("{credential:?}");
        assert!(!text.contains("sk-ant-oat01-abc"));
        assert!(!text.contains("refresh"));
    }

    #[test]
    fn expiry_is_checked_against_the_clock() {
        let credential = parse_credentials(VALID).unwrap();
        assert!(expired(&credential, 1_767_225_600_000));
        assert!(expired(&credential, 1_767_225_600_001));
        assert!(!expired(&credential, 1_767_225_599_999));
        let eternal = parse_credentials(r#"{"claudeAiOauth":{"accessToken":"t"}}"#).unwrap();
        assert!(!expired(&eternal, u64::MAX));
    }

    #[test]
    fn tolerates_missing_optional_fields() {
        let credential = parse_credentials(r#"{"claudeAiOauth":{"accessToken":"t"}}"#).unwrap();
        assert_eq!(credential.expires_at, None);
        assert_eq!(credential.subscription_type, None);
    }

    #[test]
    fn accepts_trailing_newline_from_security_cli() {
        assert!(parse_credentials(&format!("{VALID}\n")).is_ok());
    }

    #[test]
    fn rejects_invalid_json() {
        assert_eq!(
            parse_credentials("nao-json").unwrap_err().kind,
            ErrorKind::CredentialMalformed
        );
    }

    #[test]
    fn rejects_missing_oauth_block_and_empty_token() {
        assert_eq!(
            parse_credentials("{}").unwrap_err().kind,
            ErrorKind::CredentialMalformed
        );
        assert_eq!(
            parse_credentials(r#"{"claudeAiOauth":{"accessToken":""}}"#)
                .unwrap_err()
                .kind,
            ErrorKind::CredentialMalformed
        );
    }

    #[test]
    fn classifies_security_exit_codes() {
        assert_eq!(
            classify_security_failure(
                Some(44),
                "The specified item could not be found in the keychain."
            ),
            KeychainOutcome::Missing
        );
        assert_eq!(
            classify_security_failure(Some(51), "User canceled the operation."),
            KeychainOutcome::Denied
        );
        assert_eq!(
            classify_security_failure(Some(36), ""),
            KeychainOutcome::Denied
        );
        assert_eq!(
            classify_security_failure(Some(1), "boom"),
            KeychainOutcome::Failed
        );
    }

    fn serve_once(
        status_line: &'static str,
        body: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!(
            "http://127.0.0.1:{}/usage",
            listener.local_addr().unwrap().port()
        );
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let read = stream.read(&mut request).unwrap();
            let response = format!(
                "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&request[..read]).into_owned()
        });
        (url, server)
    }

    #[test]
    fn usage_request_sends_bearer_and_beta_header_and_returns_the_json() {
        let (url, server) = serve_once("200 OK", r#"{"five_hour":{"utilization":41.0}}"#);
        let usage =
            tauri::async_runtime::block_on(request_usage(&url, "sk-ant-oat01-abc")).unwrap();
        assert_eq!(usage["five_hour"]["utilization"], 41.0);
        let request = server.join().unwrap().to_lowercase();
        assert!(request.contains("authorization: bearer sk-ant-oat01-abc"));
        assert!(request.contains("anthropic-beta: oauth-2025-04-20"));
    }

    #[test]
    fn usage_401_is_a_typed_expired_login() {
        let (url, server) = serve_once("401 Unauthorized", "{}");
        let error = tauri::async_runtime::block_on(request_usage(&url, "t")).unwrap_err();
        server.join().unwrap();
        assert_eq!(error.kind, ErrorKind::ClaudeExpired);
    }

    #[test]
    fn usage_other_statuses_are_http_errors_without_the_token() {
        let (url, server) = serve_once("429 Too Many Requests", "{}");
        let error =
            tauri::async_runtime::block_on(request_usage(&url, "sk-ant-oat01-secret")).unwrap_err();
        server.join().unwrap();
        assert_eq!(error.kind, ErrorKind::Http);
        assert_eq!(error.message, "Anthropic respondeu 429 em /api/oauth/usage");
        assert!(!error.message.contains("secret"));
    }

    #[test]
    fn usage_body_that_is_not_json_is_an_http_error() {
        let (url, server) = serve_once("200 OK", "<html>");
        let error = tauri::async_runtime::block_on(request_usage(&url, "t")).unwrap_err();
        server.join().unwrap();
        assert_eq!(error.kind, ErrorKind::Http);
    }

    fn serve_raw(response: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!(
            "http://127.0.0.1:{}/usage",
            listener.local_addr().unwrap().port()
        );
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(&response);
        });
        (url, server)
    }

    #[test]
    fn usage_body_over_the_limit_is_refused_from_the_content_length_alone() {
        let head = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 5000\r\nConnection: close\r\n\r\n".to_vec();
        let (url, server) = serve_raw(head);
        let error =
            tauri::async_runtime::block_on(request_usage_limited(&url, "t", 1_024)).unwrap_err();
        server.join().unwrap();
        assert_eq!(error.kind, ErrorKind::Http);
        assert_eq!(error.message, "resposta de usage grande demais");
    }

    #[test]
    fn usage_body_without_a_content_length_is_cut_at_the_limit_while_reading() {
        let mut response =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
        for _ in 0..8 {
            response.extend_from_slice(b"200\r\n");
            response.extend(std::iter::repeat_n(b'a', 0x200));
            response.extend_from_slice(b"\r\n");
        }
        response.extend_from_slice(b"0\r\n\r\n");
        let (url, server) = serve_raw(response);
        let error =
            tauri::async_runtime::block_on(request_usage_limited(&url, "t", 1_024)).unwrap_err();
        server.join().unwrap();
        assert_eq!(error.message, "resposta de usage grande demais");
    }

    #[test]
    fn usage_body_exactly_at_the_limit_is_still_parsed() {
        let body = format!(r#"{{"k":"{}"}}"#, "a".repeat(1_024 - 8));
        assert_eq!(body.len(), 1_024);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let (url, server) = serve_raw(response.into_bytes());
        let usage =
            tauri::async_runtime::block_on(request_usage_limited(&url, "t", 1_024)).unwrap();
        server.join().unwrap();
        assert_eq!(usage["k"].as_str().unwrap().len(), 1_016);
    }

    #[test]
    fn builds_credentials_path_under_home() {
        let path = credentials_file_path(Some(PathBuf::from("/home/dev"))).unwrap();
        assert!(
            path.ends_with(".claude/.credentials.json")
                || path.ends_with(".claude\\.credentials.json")
        );
        assert_eq!(credentials_file_path(None), None);
    }
}

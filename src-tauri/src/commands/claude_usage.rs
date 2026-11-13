use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::State;
use tauri_plugin_http::reqwest;

use super::blocking::run_blocking;
use super::claude_oauth::{
    load_fresh_tokens, load_tokens, refresh_tokens, save_tokens, signin_required,
    validate_account_id, validate_client_id, AccountLocks, Endpoints, StoredTokens,
};
use super::error::{CommandError, CommandResult, ErrorKind};
use super::secrets::{app_store, SecretStore};

pub const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
pub const OAUTH_BETA: &str = "oauth-2025-04-20";
const RESETS_QUERY: &str = "cedar_ember=1&skip_spend=1";
const USER_AGENT: &str = concat!("ClawdMeter/", env!("CARGO_PKG_VERSION"));
const USAGE_TIMEOUT_SECS: u64 = 15;
const MAX_USAGE_BYTES: usize = 256 * 1024;
const MAX_RETRY_AFTER_SECS: u64 = 3_600;
const SAVE_RETRY_DELAY: Duration = Duration::from_millis(200);

pub type TokenStore = &'static (dyn SecretStore + Sync);

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let shifted_month = (month + 9) % 12;
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn http_date_secs(value: &str) -> Option<i64> {
    let (_, rest) = value.split_once(", ")?;
    let mut parts = rest.split(' ');
    let day: i64 = parts.next()?.parse().ok()?;
    let month = parts.next()?;
    let month = MONTHS.iter().position(|name| *name == month)? as i64 + 1;
    let year: i64 = parts.next()?.parse().ok()?;
    let mut clock = parts.next()?.split(':');
    let mut field = |max: i64| {
        clock
            .next()
            .and_then(|part| part.parse::<i64>().ok())
            .filter(|value| (0..=max).contains(value))
    };
    let (hour, minute, second) = (field(23)?, field(59)?, field(60)?);
    if parts.next()? != "GMT" || parts.next().is_some() || !(1..=31).contains(&day) {
        return None;
    }
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

fn retry_after_secs(value: &str, now_secs: u64) -> Option<u64> {
    let value = value.trim();
    let seconds = match value.parse::<u64>() {
        Ok(seconds) => seconds,
        Err(_) => {
            let at = http_date_secs(value)?;
            let now = i64::try_from(now_secs).ok()?;
            u64::try_from(at - now).unwrap_or(0)
        }
    };
    Some(seconds.min(MAX_RETRY_AFTER_SECS))
}

pub fn rate_limited(response: &reqwest::Response, message: &str) -> CommandError {
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| retry_after_secs(value, now_ms() / 1000));
    CommandError::rate_limited(message, retry_after)
}

pub fn claude_client(timeout_secs: u64) -> CommandResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()?)
}

pub async fn read_limited(
    mut response: reqwest::Response,
    limit: usize,
    label: &str,
) -> CommandResult<Vec<u8>> {
    let too_large = || CommandError::new(ErrorKind::Http, format!("{label} response too large"));
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(too_large());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > limit {
            return Err(too_large());
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
    let response = claude_client(USAGE_TIMEOUT_SECS)?
        .get(url)
        .bearer_auth(access_token)
        .header("anthropic-beta", OAUTH_BETA)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(signin_required());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(rate_limited(
            &response,
            "Anthropic rate-limited /api/oauth/usage (429)",
        ));
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
    let body = read_limited(response, limit, "usage").await?;
    serde_json::from_slice(&body)
        .map_err(|_| CommandError::new(ErrorKind::Http, "usage response is not valid JSON"))
}

async fn load(store: TokenStore, account_id: &str) -> CommandResult<Option<StoredTokens>> {
    let account_id = account_id.to_string();
    run_blocking(move || load_tokens(store, &account_id)).await
}

async fn load_current(store: TokenStore, account_id: &str) -> CommandResult<StoredTokens> {
    let account_id = account_id.to_string();
    let tokens = run_blocking(move || load_fresh_tokens(store, &account_id))
        .await?
        .ok_or_else(signin_required)?;
    if tokens.rejected {
        return Err(signin_required());
    }
    Ok(tokens)
}

async fn save(store: TokenStore, account_id: &str, tokens: &StoredTokens) -> CommandResult<()> {
    let account_id = account_id.to_string();
    let tokens = tokens.clone();
    run_blocking(move || save_tokens(store, &account_id, &tokens)).await
}

async fn save_rotated(
    store: TokenStore,
    account_id: &str,
    tokens: &StoredTokens,
) -> CommandResult<()> {
    let account_id = account_id.to_string();
    let tokens = tokens.clone();
    run_blocking(move || {
        save_tokens(store, &account_id, &tokens).or_else(|error| {
            if error.kind != ErrorKind::Keychain {
                return Err(error);
            }
            thread::sleep(SAVE_RETRY_DELAY);
            save_tokens(store, &account_id, &tokens)
        })
    })
    .await
}

async fn reject(store: TokenStore, account_id: &str, tokens: StoredTokens) -> CommandError {
    let marked = StoredTokens {
        rejected: true,
        ..tokens
    };
    let _ = save(store, account_id, &marked).await;
    signin_required()
}

fn is_signin_required(error: &CommandError) -> bool {
    error.kind == ErrorKind::ClaudeSigninRequired
}

pub async fn fetch_usage(
    locks: &AccountLocks,
    store: TokenStore,
    endpoints: &Endpoints<'_>,
    account_id: &str,
    client_id: &str,
) -> CommandResult<serde_json::Value> {
    fetch_authorized(
        locks,
        store,
        endpoints,
        endpoints.usage,
        account_id,
        client_id,
    )
    .await
}

fn resets_url(usage_url: &str) -> String {
    format!("{usage_url}?{RESETS_QUERY}")
}

pub async fn fetch_resets(
    locks: &AccountLocks,
    store: TokenStore,
    endpoints: &Endpoints<'_>,
    account_id: &str,
    client_id: &str,
) -> CommandResult<serde_json::Value> {
    let url = resets_url(endpoints.usage);
    let mut body = fetch_authorized(locks, store, endpoints, &url, account_id, client_id).await?;
    Ok(body
        .get_mut("cedar_ember")
        .map_or(serde_json::Value::Null, serde_json::Value::take))
}

async fn fetch_authorized(
    locks: &AccountLocks,
    store: TokenStore,
    endpoints: &Endpoints<'_>,
    url: &str,
    account_id: &str,
    client_id: &str,
) -> CommandResult<serde_json::Value> {
    validate_account_id(account_id)?;
    validate_client_id(client_id)?;
    let lock = locks.for_account(account_id);
    let _serialized = lock.lock().await;
    let mut tokens = load(store, account_id).await?.ok_or_else(signin_required)?;
    if tokens.rejected {
        return Err(signin_required());
    }
    if tokens.needs_refresh(now_ms()) {
        tokens = load_current(store, account_id).await?;
    }
    let mut renewed = false;
    if tokens.needs_refresh(now_ms()) {
        match refresh_tokens(endpoints.token, client_id, &tokens).await {
            Ok(fresh) => {
                save_rotated(store, account_id, &fresh).await?;
                tokens = fresh;
                renewed = true;
            }
            Err(error) if is_signin_required(&error) => {
                return Err(reject(store, account_id, tokens).await)
            }
            Err(error) if tokens.expired(now_ms()) => return Err(error),
            Err(_) => {}
        }
    } else if tokens.expired(now_ms()) {
        return Err(signin_required());
    }
    match request_usage(url, &tokens.access_token).await {
        Err(error) if is_signin_required(&error) => {}
        outcome => return outcome,
    }
    if renewed || !tokens.has_refresh_token() {
        return Err(reject(store, account_id, tokens).await);
    }
    let current = load_current(store, account_id).await?;
    let fresh = if current.access_token != tokens.access_token {
        current
    } else {
        let fresh = match refresh_tokens(endpoints.token, client_id, &current).await {
            Ok(fresh) => fresh,
            Err(error) if is_signin_required(&error) => {
                return Err(reject(store, account_id, current).await)
            }
            Err(error) => return Err(error),
        };
        save_rotated(store, account_id, &fresh).await?;
        fresh
    };
    match request_usage(url, &fresh.access_token).await {
        Err(error) if is_signin_required(&error) => Err(reject(store, account_id, fresh).await),
        outcome => outcome,
    }
}

#[tauri::command]
pub async fn claude_usage_fetch(
    locks: State<'_, AccountLocks>,
    account_id: String,
    client_id: String,
) -> CommandResult<serde_json::Value> {
    fetch_usage(
        &locks,
        app_store(),
        &Endpoints::anthropic(),
        &account_id,
        &client_id,
    )
    .await
}

#[tauri::command]
pub async fn claude_usage_resets_fetch(
    locks: State<'_, AccountLocks>,
    account_id: String,
    client_id: String,
) -> CommandResult<serde_json::Value> {
    fetch_resets(
        &locks,
        app_store(),
        &Endpoints::anthropic(),
        &account_id,
        &client_id,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::claude_oauth::account_status;
    use crate::commands::secrets::CachedStore;
    use crate::commands::test_support::{json_response, MemoryStore, TestServer};

    const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
    const USAGE_JSON: &str = r#"{"five_hour":{"utilization":41.0}}"#;

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn tokens(access: &str, refresh: Option<&str>, expires_at: Option<u64>) -> StoredTokens {
        StoredTokens {
            access_token: access.to_string(),
            refresh_token: refresh.map(str::to_string),
            expires_at,
            scopes: vec!["user:profile".into(), "user:inference".into()],
            client_id: None,
            rejected: false,
        }
    }

    fn store_with(account_id: &str, stored: &StoredTokens) -> &'static MemoryStore {
        let store = MemoryStore::leaked();
        save_tokens(store, account_id, stored).unwrap();
        store
    }

    fn endpoints<'a>(token: &'a TestServer, usage: &'a TestServer) -> Endpoints<'a> {
        Endpoints {
            token: &token.url,
            profile: "http://127.0.0.1:9/profile",
            usage: &usage.url,
        }
    }

    fn fetch(
        store: &'static MemoryStore,
        token: &TestServer,
        usage: &TestServer,
        account_id: &str,
    ) -> CommandResult<serde_json::Value> {
        block_on(fetch_usage(
            &AccountLocks::default(),
            store,
            &endpoints(token, usage),
            account_id,
            CLIENT_ID,
        ))
    }

    fn in_minutes(minutes: u64) -> Option<u64> {
        Some(now_ms() + minutes * 60_000)
    }

    #[test]
    fn usage_request_sends_bearer_and_beta_header_and_returns_the_json() {
        let server = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let usage = block_on(request_usage(&server.url, "sk-ant-oat01-abc")).unwrap();
        assert_eq!(usage["five_hour"]["utilization"], 41.0);
        let request = server.requests().remove(0).to_lowercase();
        assert!(request.contains("authorization: bearer sk-ant-oat01-abc"));
        assert!(request.contains("anthropic-beta: oauth-2025-04-20"));
    }

    #[test]
    fn usage_401_asks_for_a_new_sign_in() {
        let server = TestServer::json("/usage", "401 Unauthorized", "{}");
        let error = block_on(request_usage(&server.url, "t")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
    }

    #[test]
    fn usage_other_statuses_are_http_errors_without_the_token() {
        let server = TestServer::json("/usage", "503 Service Unavailable", "{}");
        let error = block_on(request_usage(&server.url, "sk-ant-oat01-secret")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert_eq!(error.message, "Anthropic respondeu 503 em /api/oauth/usage");
        assert_eq!(error.retry_after_secs, None);
        assert!(!error.message.contains("secret"));
    }

    fn rate_limited_with(headers: &str) -> CommandError {
        let response = format!(
            "HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\n{headers}Content-Length: 2\r\nConnection: close\r\n\r\n{{}}"
        );
        let server = TestServer::start("/usage", vec![response]);
        block_on(request_usage(&server.url, "sk-ant-oat01-secret")).unwrap_err()
    }

    #[test]
    fn usage_429_with_retry_after_seconds_is_rate_limited() {
        let error = rate_limited_with("Retry-After: 120\r\n");
        assert_eq!(error.kind, ErrorKind::RateLimited);
        assert_eq!(error.retry_after_secs, Some(Some(120)));
        assert!(!error.message.contains("secret"));
        let json = serde_json::to_value(&error).unwrap();
        assert_eq!(json["kind"], "rate_limited");
        assert_eq!(json["retryAfterSecs"], 120);
    }

    #[test]
    fn usage_429_without_retry_after_sends_null() {
        let error = rate_limited_with("");
        assert_eq!(error.kind, ErrorKind::RateLimited);
        let json = serde_json::to_value(&error).unwrap();
        assert!(json["retryAfterSecs"].is_null());
        assert!(json.as_object().unwrap().contains_key("retryAfterSecs"));
    }

    #[test]
    fn usage_429_with_an_http_date_far_ahead_is_capped_at_one_hour() {
        let error = rate_limited_with("Retry-After: Fri, 01 Jan 2100 00:00:00 GMT\r\n");
        assert_eq!(error.kind, ErrorKind::RateLimited);
        assert_eq!(error.retry_after_secs, Some(Some(MAX_RETRY_AFTER_SECS)));
    }

    #[test]
    fn retry_after_accepts_seconds_and_http_dates() {
        let now = 1_445_412_480;
        assert_eq!(retry_after_secs("120", now), Some(120));
        assert_eq!(retry_after_secs(" 0 ", now), Some(0));
        assert_eq!(
            retry_after_secs("Wed, 21 Oct 2015 07:28:30 GMT", now),
            Some(30)
        );
        assert_eq!(
            retry_after_secs("Wed, 21 Oct 2015 07:27:00 GMT", now),
            Some(0)
        );
        assert_eq!(http_date_secs("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0));
        assert_eq!(
            http_date_secs("Tue, 29 Feb 2028 12:00:00 GMT"),
            Some(1_835_438_400)
        );
        for invalid in [
            "",
            "-5",
            "tomorrow",
            "Wed, 21 Foo 2015 07:28:30 GMT",
            "Wed, 21 Oct 2015 25:28:30 GMT",
            "Wed, 21 Oct 2015 07:28:30 UTC",
            "Wed, 32 Oct 2015 07:28:30 GMT",
        ] {
            assert_eq!(retry_after_secs(invalid, now), None, "{invalid}");
        }
    }

    #[test]
    fn retry_after_is_capped_at_one_hour() {
        assert_eq!(retry_after_secs("86400", 0), Some(MAX_RETRY_AFTER_SECS));
        assert_eq!(retry_after_secs("18446744073709551615", 0), Some(3_600));
        assert_eq!(retry_after_secs("3599", 0), Some(3_599));
    }

    #[test]
    fn usage_body_that_is_not_json_is_an_http_error() {
        let server = TestServer::json("/usage", "200 OK", "<html>");
        let error = block_on(request_usage(&server.url, "t")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
    }

    #[test]
    fn usage_redirects_are_not_followed() {
        let target = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        target.set_nonblocking(true).unwrap();
        let location = format!(
            "http://127.0.0.1:{}/elsewhere",
            target.local_addr().unwrap().port()
        );
        let response = format!(
            "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let server = TestServer::start("/usage", vec![response]);
        let error = block_on(request_usage(&server.url, "sk-ant-oat01-secret")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert!(error.message.contains("302"));
        assert!(
            target.accept().is_err(),
            "the redirect target was contacted"
        );
    }

    #[test]
    fn usage_body_over_the_limit_is_refused_from_the_content_length_alone() {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 5000\r\nConnection: close\r\n\r\n";
        let server = TestServer::start("/usage", vec![head.to_string()]);
        let error = block_on(request_usage_limited(&server.url, "t", 1_024)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert_eq!(error.message, "usage response too large");
    }

    #[test]
    fn usage_body_without_a_content_length_is_cut_at_the_limit_while_reading() {
        let mut response = String::from(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
        );
        for _ in 0..8 {
            response.push_str("200\r\n");
            response.push_str(&"a".repeat(0x200));
            response.push_str("\r\n");
        }
        response.push_str("0\r\n\r\n");
        let server = TestServer::start("/usage", vec![response]);
        let error = block_on(request_usage_limited(&server.url, "t", 1_024)).unwrap_err();
        assert_eq!(error.message, "usage response too large");
    }

    #[test]
    fn usage_body_exactly_at_the_limit_is_still_parsed() {
        let body = format!(r#"{{"k":"{}"}}"#, "a".repeat(1_024 - 8));
        assert_eq!(body.len(), 1_024);
        let server = TestServer::json("/usage", "200 OK", &body);
        let usage = block_on(request_usage_limited(&server.url, "t", 1_024)).unwrap();
        assert_eq!(usage["k"].as_str().unwrap().len(), 1_016);
    }

    #[test]
    fn without_stored_tokens_the_account_must_sign_in_and_nothing_is_called() {
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = fetch(MemoryStore::leaked(), &token, &usage, "acc-1").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(token.requests().is_empty());
        assert!(usage.requests().is_empty());
    }

    #[test]
    fn invalid_account_or_client_ids_are_refused_before_any_io() {
        let store = MemoryStore::leaked();
        let run = |account: &str, client: &str| {
            block_on(fetch_usage(
                &AccountLocks::default(),
                store,
                &Endpoints::anthropic(),
                account,
                client,
            ))
            .unwrap_err()
            .kind
        };
        assert_eq!(run("../x", CLIENT_ID), ErrorKind::InvalidArgument);
        assert_eq!(run("acc", "not-a-uuid"), ErrorKind::InvalidArgument);
    }

    #[test]
    fn a_valid_token_is_used_without_refreshing() {
        let store = store_with("acc", &tokens("at-1", Some("rt-1"), in_minutes(60)));
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let json = fetch(store, &token, &usage, "acc").unwrap();
        assert_eq!(json["five_hour"]["utilization"], 41.0);
        assert!(token.requests().is_empty());
        assert!(usage.requests()[0]
            .to_lowercase()
            .contains("authorization: bearer at-1"));
    }

    #[test]
    fn a_token_within_five_minutes_of_expiry_is_refreshed_and_the_rotation_is_saved() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), in_minutes(4)));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":28800,"scope":"user:profile user:inference"}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        fetch(store, &token, &usage, "acc").unwrap();
        let refresh = token.requests().remove(0);
        let body: serde_json::Value =
            serde_json::from_str(refresh.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["grant_type"], "refresh_token");
        assert_eq!(body["refresh_token"], "rt-old");
        assert_eq!(body["client_id"], CLIENT_ID);
        assert_eq!(body["scope"], "user:profile user:inference");
        assert!(usage.requests()[0]
            .to_lowercase()
            .contains("authorization: bearer at-new"));
        let saved = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(saved.access_token, "at-new");
        assert_eq!(saved.refresh_token.as_deref(), Some("rt-new"));
        assert!(saved.expires_at.unwrap() > now_ms() + 7 * 3_600_000);
        assert_eq!(saved.client_id.as_deref(), Some(CLIENT_ID));
    }

    const OTHER_CLIENT_ID: &str = "00000000-0000-4000-8000-000000000000";

    fn refreshed_with(stored: StoredTokens, fallback_client_id: &str) -> (String, StoredTokens) {
        let store = store_with("acc", &stored);
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        block_on(fetch_usage(
            &AccountLocks::default(),
            store,
            &endpoints(&token, &usage),
            "acc",
            fallback_client_id,
        ))
        .unwrap();
        let body: serde_json::Value =
            serde_json::from_str(token.requests().remove(0).split("\r\n\r\n").nth(1).unwrap())
                .unwrap();
        let client = body["client_id"].as_str().unwrap().to_string();
        (client, load_tokens(store, "acc").unwrap().unwrap())
    }

    #[test]
    fn the_refresh_uses_the_client_that_issued_the_token_not_the_one_in_settings() {
        let stored = StoredTokens {
            client_id: Some(CLIENT_ID.into()),
            ..tokens("at-old", Some("rt-old"), in_minutes(1))
        };
        let (client, saved) = refreshed_with(stored, OTHER_CLIENT_ID);
        assert_eq!(client, CLIENT_ID);
        assert_eq!(saved.client_id.as_deref(), Some(CLIENT_ID));
    }

    #[test]
    fn a_token_saved_without_a_client_falls_back_to_the_one_in_settings_and_keeps_it() {
        let (client, saved) = refreshed_with(
            tokens("at-old", Some("rt-old"), in_minutes(1)),
            OTHER_CLIENT_ID,
        );
        assert_eq!(client, OTHER_CLIENT_ID);
        assert_eq!(saved.client_id.as_deref(), Some(OTHER_CLIENT_ID));
        let tampered = StoredTokens {
            client_id: Some("not-a-uuid".into()),
            ..tokens("at-old", Some("rt-old"), in_minutes(1))
        };
        let (client, _) = refreshed_with(tampered, OTHER_CLIENT_ID);
        assert_eq!(client, OTHER_CLIENT_ID);
    }

    #[test]
    fn a_refresh_without_expires_in_leaves_the_expiry_unknown() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), in_minutes(1)));
        let token = TestServer::json("/token", "200 OK", r#"{"access_token":"at-new"}"#);
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        fetch(store, &token, &usage, "acc").unwrap();
        let saved = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(saved.access_token, "at-new");
        assert_eq!(saved.refresh_token.as_deref(), Some("rt-old"));
        assert_eq!(saved.expires_at, None);
        assert!(!account_status(Some(&saved), now_ms()).needs_login);
    }

    #[test]
    fn a_rotated_token_whose_first_save_fails_is_saved_on_the_retry() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), in_minutes(1)));
        store.fail_next_writes(1);
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        fetch(store, &token, &usage, "acc").unwrap();
        let saved = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(saved.refresh_token.as_deref(), Some("rt-new"));
        assert!(usage.requests()[0]
            .to_lowercase()
            .contains("authorization: bearer at-new"));
    }

    #[test]
    fn a_rotated_token_that_cannot_be_saved_twice_is_a_keychain_error() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), in_minutes(1)));
        store.fail_next_writes(2);
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::Keychain);
        assert!(usage.requests().is_empty());
        let kept = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(kept.access_token, "at-old");
        assert!(!kept.rejected);
    }

    #[test]
    fn an_expired_token_without_a_refresh_token_must_sign_in() {
        let store = store_with("acc", &tokens("at", None, Some(now_ms() - 1)));
        let token = TestServer::json("/token", "200 OK", "{}");
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(usage.requests().is_empty());
        assert!(load_tokens(store, "acc").unwrap().is_some());
    }

    #[test]
    fn a_rejected_refresh_asks_for_sign_in_keeps_the_tokens_and_marks_the_account() {
        let store = store_with("acc", &tokens("at", Some("rt"), in_minutes(1)));
        let token = TestServer::json("/token", "400 Bad Request", r#"{"error":"invalid_grant"}"#);
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(usage.requests().is_empty());
        let kept = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(kept.access_token, "at");
        assert_eq!(kept.refresh_token.as_deref(), Some("rt"));
        assert!(account_status(Some(&kept), now_ms()).needs_login);
        let again = TestServer::json("/token", "200 OK", "{}");
        let usage_again = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = fetch(store, &again, &usage_again, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(again.requests().is_empty());
        assert!(usage_again.requests().is_empty());
    }

    #[test]
    fn invalid_client_also_marks_the_account_for_a_new_sign_in() {
        let store = store_with("acc", &tokens("at", Some("rt"), Some(now_ms() - 1)));
        let token = TestServer::json(
            "/token",
            "401 Unauthorized",
            r#"{"error":"invalid_client"}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(load_tokens(store, "acc").unwrap().unwrap().rejected);
    }

    const TRANSIENT_REFUSALS: [(&str, &str); 6] = [
        ("403 Forbidden", "<html>blocked by the firewall</html>"),
        ("404 Not Found", "{}"),
        ("405 Method Not Allowed", ""),
        ("415 Unsupported Media Type", r#"{"error":"unsupported"}"#),
        ("400 Bad Request", r#"{"error":"invalid_request"}"#),
        (
            "401 Unauthorized",
            r#"{"type":"error","error":{"type":"authentication_error"}}"#,
        ),
    ];

    #[test]
    fn other_refresh_refusals_fall_back_to_a_token_that_has_not_expired() {
        for (status, body) in TRANSIENT_REFUSALS {
            let store = store_with("acc", &tokens("at", Some("rt"), in_minutes(2)));
            let token = TestServer::json("/token", status, body);
            let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
            assert!(fetch(store, &token, &usage, "acc").is_ok(), "{status}");
            assert!(usage.requests()[0]
                .to_lowercase()
                .contains("authorization: bearer at"));
            assert!(
                !load_tokens(store, "acc").unwrap().unwrap().rejected,
                "{status}"
            );
        }
    }

    #[test]
    fn other_refresh_refusals_with_an_expired_token_are_http_errors_without_marking() {
        for (status, body) in TRANSIENT_REFUSALS {
            let store = store_with("acc", &tokens("at", Some("rt"), Some(now_ms() - 1)));
            let token = TestServer::json("/token", status, body);
            let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
            let error = fetch(store, &token, &usage, "acc").unwrap_err();
            assert_eq!(error.kind, ErrorKind::Http, "{status}");
            assert!(usage.requests().is_empty());
            assert!(
                !load_tokens(store, "acc").unwrap().unwrap().rejected,
                "{status}"
            );
        }
    }

    #[test]
    fn a_401_followed_by_a_refusal_that_is_not_a_grant_error_does_not_mark_the_account() {
        let store = store_with("acc", &tokens("at", Some("rt"), None));
        let token = TestServer::json("/token", "403 Forbidden", "<html>");
        let usage = TestServer::json("/usage", "401 Unauthorized", "{}");
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert!(!load_tokens(store, "acc").unwrap().unwrap().rejected);
    }

    #[test]
    fn a_transient_refresh_failure_still_uses_a_token_that_has_not_expired() {
        let store = store_with("acc", &tokens("at", Some("rt"), in_minutes(2)));
        let token = TestServer::json("/token", "503 Service Unavailable", "{}");
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        assert!(fetch(store, &token, &usage, "acc").is_ok());
        assert!(!load_tokens(store, "acc").unwrap().unwrap().rejected);
    }

    #[test]
    fn a_transient_refresh_failure_with_an_expired_token_is_reported_as_is() {
        let store = store_with("acc", &tokens("at", Some("rt"), Some(now_ms() - 1)));
        let token = TestServer::json("/token", "503 Service Unavailable", "{}");
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert!(usage.requests().is_empty());
        assert!(!load_tokens(store, "acc").unwrap().unwrap().rejected);
    }

    #[test]
    fn a_401_triggers_one_refresh_and_a_retry() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), None));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::start(
            "/usage",
            vec![
                json_response("401 Unauthorized", "{}"),
                json_response("200 OK", USAGE_JSON),
            ],
        );
        let json = fetch(store, &token, &usage, "acc").unwrap();
        assert_eq!(json["five_hour"]["utilization"], 41.0);
        assert_eq!(token.requests().len(), 1);
        let calls = usage.requests();
        assert!(calls[1]
            .to_lowercase()
            .contains("authorization: bearer at-new"));
        assert_eq!(
            load_tokens(store, "acc")
                .unwrap()
                .unwrap()
                .refresh_token
                .as_deref(),
            Some("rt-new")
        );
    }

    #[test]
    fn a_401_after_the_renewal_asks_for_sign_in_without_deleting_the_tokens() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), None));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "401 Unauthorized", "{}");
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert_eq!(usage.requests().len(), 2);
        let kept = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(kept.access_token, "at-new");
        assert!(kept.rejected);
        assert!(account_status(Some(&kept), now_ms()).needs_login);
    }

    #[test]
    fn a_401_on_a_token_without_refresh_asks_for_sign_in() {
        let store = store_with("acc", &tokens("at", None, None));
        let token = TestServer::json("/token", "200 OK", "{}");
        let usage = TestServer::json("/usage", "401 Unauthorized", "{}");
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(token.requests().is_empty());
        assert!(load_tokens(store, "acc").unwrap().unwrap().rejected);
    }

    #[test]
    fn concurrent_fetches_of_the_same_account_spend_the_refresh_token_once() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), in_minutes(1)));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let locks = AccountLocks::default();
        let targets = endpoints(&token, &usage);
        std::thread::scope(|scope| {
            let runs: Vec<_> = (0..2)
                .map(|_| {
                    scope.spawn(|| block_on(fetch_usage(&locks, store, &targets, "acc", CLIENT_ID)))
                })
                .collect();
            for run in runs {
                assert!(run.join().unwrap().is_ok());
            }
        });
        let refreshes = token.requests();
        assert_eq!(refreshes.len(), 1, "{refreshes:?}");
    }

    fn cached_with(stored: &StoredTokens) -> (&'static CachedStore<MemoryStore>, usize) {
        let store = MemoryStore::cached();
        save_tokens(store.backend(), "acc", stored).unwrap();
        (store, store.backend().reads())
    }

    fn cached_fetch(
        store: TokenStore,
        token: &TestServer,
        usage: &TestServer,
    ) -> CommandResult<serde_json::Value> {
        block_on(fetch_usage(
            &AccountLocks::default(),
            store,
            &endpoints(token, usage),
            "acc",
            CLIENT_ID,
        ))
    }

    #[test]
    fn fetches_and_status_read_the_account_tokens_from_the_keychain_once() {
        let (store, before) = cached_with(&tokens("at-1", Some("rt-1"), in_minutes(60)));
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::start(
            "/usage",
            vec![
                json_response("200 OK", USAGE_JSON),
                json_response("200 OK", USAGE_JSON),
            ],
        );
        for _ in 0..2 {
            cached_fetch(store, &token, &usage).unwrap();
            let loaded = load_tokens(store, "acc").unwrap();
            assert!(!account_status(loaded.as_ref(), now_ms()).needs_login);
        }
        assert_eq!(store.backend().reads() - before, 1);
        assert!(token.requests().is_empty());
    }

    #[test]
    fn a_refresh_is_saved_and_the_next_read_sees_it_without_the_keychain() {
        let (store, before) = cached_with(&tokens("at-old", Some("rt-old"), in_minutes(4)));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":28800,"scope":"user:profile user:inference"}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        cached_fetch(store, &token, &usage).unwrap();
        let saved = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(saved.access_token, "at-new");
        assert_eq!(saved.refresh_token.as_deref(), Some("rt-new"));
        assert_eq!(store.backend().reads() - before, 2);
        let stored = load_tokens(store.backend(), "acc").unwrap().unwrap();
        assert_eq!(stored, saved);
    }

    #[test]
    fn a_denied_save_of_rotated_tokens_is_not_retried() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), in_minutes(1)));
        store.fail_next_writes_with(ErrorKind::KeychainDenied, 2);
        let before = store.writes();
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = fetch(store, &token, &usage, "acc").unwrap_err();
        assert_eq!(error.kind, ErrorKind::KeychainDenied);
        assert_eq!(store.writes() - before, 1);
        assert!(usage.requests().is_empty());
    }

    fn renewed_elsewhere(
        cached: &StoredTokens,
        stored: &StoredTokens,
    ) -> &'static CachedStore<MemoryStore> {
        let store = MemoryStore::cached();
        save_tokens(store, "acc", cached).unwrap();
        save_tokens(store.backend(), "acc", stored).unwrap();
        store
    }

    fn refresh_body(request: &str) -> serde_json::Value {
        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap()
    }

    #[test]
    fn a_refresh_spends_the_refresh_token_another_instance_saved_not_the_cached_one() {
        let store = renewed_elsewhere(
            &tokens("at-old", Some("rt-old"), in_minutes(1)),
            &tokens("at-other", Some("rt-other"), in_minutes(2)),
        );
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        cached_fetch(store, &token, &usage).unwrap();
        let refreshes = token.requests();
        assert_eq!(refreshes.len(), 1);
        assert_eq!(refresh_body(&refreshes[0])["refresh_token"], "rt-other");
        assert!(!refreshes[0].contains("rt-old"));
        let saved = load_tokens(store.backend(), "acc").unwrap().unwrap();
        assert_eq!(saved.refresh_token.as_deref(), Some("rt-new"));
    }

    #[test]
    fn tokens_another_instance_already_renewed_are_used_without_a_refresh() {
        let store = renewed_elsewhere(
            &tokens("at-old", Some("rt-old"), in_minutes(1)),
            &tokens("at-other", Some("rt-other"), in_minutes(60)),
        );
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        cached_fetch(store, &token, &usage).unwrap();
        assert!(token.requests().is_empty());
        assert!(usage.requests()[0]
            .to_lowercase()
            .contains("authorization: bearer at-other"));
        let current = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(current.refresh_token.as_deref(), Some("rt-other"));
    }

    #[test]
    fn a_401_retries_with_tokens_another_instance_renewed_before_refreshing() {
        let store = renewed_elsewhere(
            &tokens("at-old", Some("rt-old"), in_minutes(60)),
            &tokens("at-other", Some("rt-other"), in_minutes(60)),
        );
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::start(
            "/usage",
            vec![
                json_response("401 Unauthorized", "{}"),
                json_response("200 OK", USAGE_JSON),
            ],
        );
        cached_fetch(store, &token, &usage).unwrap();
        assert!(token.requests().is_empty());
        let calls = usage.requests();
        assert!(calls[0]
            .to_lowercase()
            .contains("authorization: bearer at-old"));
        assert!(calls[1]
            .to_lowercase()
            .contains("authorization: bearer at-other"));
    }

    #[test]
    fn a_rejection_found_on_the_reread_is_not_refreshed() {
        let store = renewed_elsewhere(
            &tokens("at-old", Some("rt-old"), in_minutes(1)),
            &StoredTokens {
                rejected: true,
                ..tokens("at-old", Some("rt-old"), in_minutes(1))
            },
        );
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        let error = cached_fetch(store, &token, &usage).unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(token.requests().is_empty());
        assert!(usage.requests().is_empty());
    }

    const RESETS_JSON: &str = r#"{"five_hour":{"utilization":41.0},"cedar_ember":{"eligible":true,"grants":[{"id":"g1"}]}}"#;

    fn resets(
        store: &'static MemoryStore,
        token: &TestServer,
        usage: &TestServer,
    ) -> CommandResult<serde_json::Value> {
        block_on(fetch_resets(
            &AccountLocks::default(),
            store,
            &endpoints(token, usage),
            "acc",
            CLIENT_ID,
        ))
    }

    #[test]
    fn the_resets_url_appends_the_query_to_the_usage_url() {
        assert_eq!(
            resets_url(USAGE_URL),
            "https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1"
        );
    }

    #[test]
    fn resets_ask_for_the_cedar_ember_query_and_return_only_that_block() {
        let store = store_with("acc", &tokens("at-1", Some("rt-1"), in_minutes(60)));
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::json("/usage", "200 OK", RESETS_JSON);
        let block = resets(store, &token, &usage).unwrap();
        assert_eq!(block["eligible"], true);
        assert_eq!(block["grants"][0]["id"], "g1");
        assert!(block.get("five_hour").is_none());
        let request = usage.requests().remove(0).to_lowercase();
        assert!(request.starts_with("get /usage?cedar_ember=1&skip_spend=1 "));
        assert!(request.contains("authorization: bearer at-1"));
        assert!(request.contains("anthropic-beta: oauth-2025-04-20"));
        assert!(token.requests().is_empty());
    }

    #[test]
    fn a_response_without_the_resets_block_is_null() {
        let store = store_with("acc", &tokens("at", Some("rt"), in_minutes(60)));
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::json("/usage", "200 OK", USAGE_JSON);
        assert!(resets(store, &token, &usage).unwrap().is_null());
    }

    #[test]
    fn resets_are_refused_before_any_io_for_invalid_ids() {
        let run = |account: &str, client: &str| {
            block_on(fetch_resets(
                &AccountLocks::default(),
                MemoryStore::leaked(),
                &Endpoints::anthropic(),
                account,
                client,
            ))
            .unwrap_err()
            .kind
        };
        assert_eq!(run("../x", CLIENT_ID), ErrorKind::InvalidArgument);
        assert_eq!(run("acc", "not-a-uuid"), ErrorKind::InvalidArgument);
    }

    #[test]
    fn resets_without_stored_tokens_must_sign_in_and_call_nothing() {
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::json("/usage", "200 OK", RESETS_JSON);
        let error = resets(MemoryStore::leaked(), &token, &usage).unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(usage.requests().is_empty());
    }

    #[test]
    fn resets_429_is_rate_limited_with_the_retry_after() {
        let store = store_with("acc", &tokens("at", Some("rt"), in_minutes(60)));
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let response = "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 90\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";
        let usage = TestServer::start("/usage", vec![response.to_string()]);
        let error = resets(store, &token, &usage).unwrap_err();
        assert_eq!(error.kind, ErrorKind::RateLimited);
        assert_eq!(error.retry_after_secs, Some(Some(90)));
        assert_eq!(usage.requests().len(), 1);
    }

    #[test]
    fn resets_5xx_is_an_http_error_without_the_token() {
        let store = store_with("acc", &tokens("at-secret", Some("rt"), in_minutes(60)));
        let token = TestServer::json("/token", "500 Internal Server Error", "{}");
        let usage = TestServer::json("/usage", "503 Service Unavailable", "{}");
        let error = resets(store, &token, &usage).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert!(!error.message.contains("secret"));
    }

    #[test]
    fn resets_share_the_token_refresh_and_save_the_rotation() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), in_minutes(4)));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":28800}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", RESETS_JSON);
        resets(store, &token, &usage).unwrap();
        assert!(usage.requests()[0]
            .to_lowercase()
            .contains("authorization: bearer at-new"));
        let saved = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(saved.refresh_token.as_deref(), Some("rt-new"));
    }

    #[test]
    fn resets_401_after_the_renewal_asks_for_sign_in_and_marks_the_account() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), None));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "401 Unauthorized", "{}");
        let error = resets(store, &token, &usage).unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(load_tokens(store, "acc").unwrap().unwrap().rejected);
        assert_eq!(token.requests().len(), 1);
    }

    #[test]
    fn a_resets_401_refreshes_once_and_retries_the_same_resets_url() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), None));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::start(
            "/usage",
            vec![
                json_response("401 Unauthorized", "{}"),
                json_response("200 OK", RESETS_JSON),
            ],
        );
        let block = resets(store, &token, &usage).unwrap();
        assert_eq!(block["grants"][0]["id"], "g1");
        assert_eq!(token.requests().len(), 1);
        let calls = usage.requests();
        assert_eq!(calls.len(), 2);
        for call in &calls {
            assert!(
                call.to_lowercase()
                    .starts_with("get /usage?cedar_ember=1&skip_spend=1 "),
                "{call}"
            );
        }
        assert!(calls[1]
            .to_lowercase()
            .contains("authorization: bearer at-new"));
    }

    #[test]
    fn resets_and_usage_of_the_same_account_spend_the_refresh_token_once() {
        let store = store_with("acc", &tokens("at-old", Some("rt-old"), in_minutes(1)));
        let token = TestServer::json(
            "/token",
            "200 OK",
            r#"{"access_token":"at-new","refresh_token":"rt-new","expires_in":3600}"#,
        );
        let usage = TestServer::json("/usage", "200 OK", RESETS_JSON);
        let locks = AccountLocks::default();
        let targets = endpoints(&token, &usage);
        std::thread::scope(|scope| {
            let plain =
                scope.spawn(|| block_on(fetch_usage(&locks, store, &targets, "acc", CLIENT_ID)));
            let block =
                scope.spawn(|| block_on(fetch_resets(&locks, store, &targets, "acc", CLIENT_ID)));
            assert!(plain.join().unwrap().is_ok());
            assert!(block.join().unwrap().is_ok());
        });
        assert_eq!(token.requests().len(), 1);
    }
}

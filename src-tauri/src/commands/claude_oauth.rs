use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_http::reqwest::{self, header, StatusCode};
use url::Url;

use super::blocking::run_blocking;
use super::claude_usage::{
    claude_client, now_ms, rate_limited, read_limited, TokenStore, OAUTH_BETA, USAGE_URL,
};
use super::error::{CommandError, CommandResult, ErrorKind};
use super::oauth_loopback::{self, same_state, ListenInfo, LoopbackRegistry};
use super::secrets::{app_store, SecretStore};

pub const AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
pub const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
pub const PROFILE_URL: &str = "https://api.anthropic.com/api/oauth/profile";
pub const MANUAL_REDIRECT_URI: &str = "https://platform.claude.com/oauth/code/callback";
pub const DEFAULT_SCOPES: [&str; 2] = ["user:profile", "user:inference"];
pub const TOKEN_KEY_PREFIX: &str = "claude.account.";
const MAX_ACCOUNT_ID_CHARS: usize = 64;
const MAX_PASTED_CODE_CHARS: usize = 4_096;
const MAX_PENDING_LOGINS: usize = 2;
const LOGIN_TTL: Duration = Duration::from_secs(605);
const TOKEN_TIMEOUT_SECS: u64 = 15;
const PROFILE_TIMEOUT_SECS: u64 = 10;
const MAX_TOKEN_BYTES: usize = 64 * 1024;
const MAX_PROFILE_BYTES: usize = 64 * 1024;
const REFRESH_LEEWAY_MS: u64 = 5 * 60 * 1_000;
const MAX_EXPIRES_AT_MS: u64 = 9_007_199_254_740_991;

pub struct Endpoints<'a> {
    pub token: &'a str,
    pub profile: &'a str,
    pub usage: &'a str,
}

impl Endpoints<'static> {
    pub fn anthropic() -> Self {
        Self {
            token: TOKEN_URL,
            profile: PROFILE_URL,
            usage: USAGE_URL,
        }
    }
}

fn invalid(message: &str) -> CommandError {
    CommandError::new(ErrorKind::InvalidArgument, message)
}

pub fn signin_required() -> CommandError {
    CommandError::new(
        ErrorKind::ClaudeSigninRequired,
        "Claude account needs a new sign-in",
    )
}

pub fn validate_account_id(account_id: &str) -> CommandResult<()> {
    let valid = (1..=MAX_ACCOUNT_ID_CHARS).contains(&account_id.len())
        && account_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    if valid {
        Ok(())
    } else {
        Err(invalid("invalid account id"))
    }
}

pub fn validate_client_id(client_id: &str) -> CommandResult<()> {
    let groups: Vec<&str> = client_id.split('-').collect();
    let valid = groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(group, length)| {
            group.len() == length && group.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
    if valid {
        Ok(())
    } else {
        Err(invalid("the OAuth client id must be a UUID"))
    }
}

fn random_token(bytes: usize) -> CommandResult<String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|error| {
        CommandError::new(ErrorKind::Io, format!("no secure random source: {error}"))
    })?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

pub fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn authorize_url(
    client_id: &str,
    redirect_uri: &str,
    verifier: &str,
    state: &str,
) -> CommandResult<String> {
    let mut url = Url::parse(AUTHORIZE_URL)?;
    url.query_pairs_mut()
        .append_pair("code", "true")
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", &DEFAULT_SCOPES.join(" "))
        .append_pair("code_challenge", &code_challenge(verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state);
    Ok(url.into())
}

pub fn parse_pasted_code(raw: &str, expected_state: &str) -> CommandResult<String> {
    let pasted = raw.trim();
    if pasted.len() > MAX_PASTED_CODE_CHARS {
        return Err(invalid("pasted code is too long"));
    }
    let (code, state) = match pasted.split_once('#') {
        Some((code, state)) => (code, Some(state)),
        None => (pasted, None),
    };
    if code.is_empty() {
        return Err(invalid("no authorization code pasted"));
    }
    match state {
        Some(state) if !expected_state.is_empty() && same_state(expected_state, state) => {
            Ok(code.to_string())
        }
        Some(_) => Err(CommandError::new(
            ErrorKind::StateMismatch,
            "pasted code belongs to another sign-in",
        )),
        None => Err(CommandError::new(
            ErrorKind::StateMismatch,
            "pasted code without state, expected code#state",
        )),
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_at: Option<u64>,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub rejected: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

impl std::fmt::Debug for StoredTokens {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StoredTokens")
            .field("has_refresh_token", &self.has_refresh_token())
            .field("expires_at", &self.expires_at)
            .field("scopes", &self.scopes)
            .field("client_id", &self.client_id)
            .field("rejected", &self.rejected)
            .finish_non_exhaustive()
    }
}

impl StoredTokens {
    pub fn has_refresh_token(&self) -> bool {
        self.refresh_token
            .as_deref()
            .is_some_and(|token| !token.is_empty())
    }

    pub fn expired(&self, now: u64) -> bool {
        self.expires_at.is_some_and(|expires_at| expires_at <= now)
    }

    pub fn needs_refresh(&self, now: u64) -> bool {
        self.has_refresh_token()
            && self
                .expires_at
                .is_some_and(|expires_at| expires_at <= now.saturating_add(REFRESH_LEEWAY_MS))
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<Value>,
    scope: Option<Value>,
}

fn expires_in_ms(value: &Value) -> Option<u64> {
    let seconds = match value {
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => text.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some((seconds * 1_000.0).min(MAX_EXPIRES_AT_MS as f64) as u64)
}

pub fn parse_token_response(
    body: &[u8],
    now: u64,
    previous: Option<&StoredTokens>,
) -> CommandResult<StoredTokens> {
    let malformed = || CommandError::new(ErrorKind::Http, "Claude token response is not valid");
    let response: TokenResponse = serde_json::from_slice(body).map_err(|_| malformed())?;
    let access_token = response
        .access_token
        .filter(|token| !token.is_empty())
        .ok_or_else(malformed)?;
    let scopes = response
        .scope
        .as_ref()
        .and_then(Value::as_str)
        .map(|scope| scope.split_whitespace().map(str::to_string).collect())
        .filter(|scopes: &Vec<String>| !scopes.is_empty())
        .or_else(|| {
            previous
                .map(|tokens| tokens.scopes.clone())
                .filter(|scopes| !scopes.is_empty())
        })
        .unwrap_or_else(|| {
            DEFAULT_SCOPES
                .iter()
                .map(|scope| scope.to_string())
                .collect()
        });
    Ok(StoredTokens {
        access_token,
        refresh_token: response
            .refresh_token
            .filter(|token| !token.is_empty())
            .or_else(|| previous.and_then(|tokens| tokens.refresh_token.clone())),
        expires_at: response
            .expires_in
            .as_ref()
            .and_then(expires_in_ms)
            .map(|lifetime| now.saturating_add(lifetime).min(MAX_EXPIRES_AT_MS)),
        scopes,
        client_id: previous.and_then(|tokens| tokens.client_id.clone()),
        rejected: false,
    })
}

pub fn parse_profile_email(body: &[u8]) -> Option<String> {
    let profile: Value = serde_json::from_slice(body).ok()?;
    let email = profile.get("account")?.get("email")?.as_str()?.trim();
    (!email.is_empty() && email.len() <= 320).then(|| email.to_string())
}

pub fn token_key(account_id: &str) -> CommandResult<String> {
    validate_account_id(account_id)?;
    Ok(format!("{TOKEN_KEY_PREFIX}{account_id}"))
}

pub fn load_tokens(
    store: &dyn SecretStore,
    account_id: &str,
) -> CommandResult<Option<StoredTokens>> {
    let raw = store.get(&token_key(account_id)?)?;
    Ok(raw
        .and_then(|raw| serde_json::from_str::<StoredTokens>(&raw).ok())
        .filter(|tokens| !tokens.access_token.is_empty()))
}

pub fn save_tokens(
    store: &dyn SecretStore,
    account_id: &str,
    tokens: &StoredTokens,
) -> CommandResult<()> {
    let key = token_key(account_id)?;
    let raw = serde_json::to_string(tokens)
        .map_err(|_| CommandError::new(ErrorKind::Io, "could not encode the Claude tokens"))?;
    store.set(&key, &raw)
}

pub fn delete_tokens(store: &dyn SecretStore, account_id: &str) -> CommandResult<()> {
    store.delete(&token_key(account_id)?)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub signed_in: bool,
    pub expires_at: Option<u64>,
    pub needs_login: bool,
}

pub fn account_status(tokens: Option<&StoredTokens>, now: u64) -> AccountStatus {
    match tokens {
        None => AccountStatus {
            signed_in: false,
            expires_at: None,
            needs_login: true,
        },
        Some(tokens) => AccountStatus {
            signed_in: true,
            expires_at: tokens.expires_at,
            needs_login: tokens.rejected || (tokens.expired(now) && !tokens.has_refresh_token()),
        },
    }
}

#[derive(Default)]
pub struct AccountLocks {
    locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl AccountLocks {
    pub fn for_account(&self, account_id: &str) -> Arc<AsyncMutex<()>> {
        let mut locks = self
            .locks
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        Arc::clone(locks.entry(account_id.to_string()).or_default())
    }
}

struct PendingLogin {
    verifier: String,
    state: String,
    client_id: String,
    redirect_uri: String,
    listener_id: String,
    started: Instant,
    awaited: bool,
}

type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;

pub struct ClaudeLogins {
    pending: Mutex<HashMap<String, PendingLogin>>,
    ttl: Duration,
    clock: Clock,
}

impl Default for ClaudeLogins {
    fn default() -> Self {
        Self::with_clock(LOGIN_TTL, Arc::new(Instant::now))
    }
}

impl ClaudeLogins {
    fn with_clock(ttl: Duration, clock: Clock) -> Self {
        Self {
            pending: Mutex::default(),
            ttl,
            clock,
        }
    }

    fn now(&self) -> Instant {
        (self.clock)()
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, PendingLogin>> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn alive(&self, login: &PendingLogin) -> bool {
        self.now().saturating_duration_since(login.started) < self.ttl
    }

    fn insert(&self, login_id: String, login: PendingLogin) -> CommandResult<()> {
        let mut pending = self.lock();
        pending.retain(|_, login| self.alive(login));
        if pending.len() >= MAX_PENDING_LOGINS {
            return Err(CommandError::new(
                ErrorKind::TooManyProcesses,
                format!("limit of {MAX_PENDING_LOGINS} pending Claude sign-ins reached"),
            ));
        }
        pending.insert(login_id, login);
        Ok(())
    }

    fn state_of(&self, login_id: &str) -> Option<String> {
        self.lock()
            .get(login_id)
            .filter(|login| self.alive(login))
            .map(|login| login.state.clone())
    }

    fn start_wait(&self, login_id: &str) -> CommandResult<(String, String)> {
        let mut pending = self.lock();
        let login = pending
            .get_mut(login_id)
            .filter(|login| self.alive(login))
            .ok_or_else(unknown_login)?;
        if login.awaited {
            return Err(invalid("this Claude sign-in is already being awaited"));
        }
        login.awaited = true;
        Ok((login.state.clone(), login.listener_id.clone()))
    }

    fn remove(&self, login_id: &str) -> Option<PendingLogin> {
        self.lock().remove(login_id)
    }

    fn take(&self, login_id: &str) -> Option<PendingLogin> {
        self.remove(login_id).filter(|login| self.alive(login))
    }
}

fn unknown_login() -> CommandError {
    invalid("unknown or expired Claude sign-in")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    pub login_id: String,
    pub authorize_url: String,
    pub state: String,
    pub redirect_uri: String,
    pub manual_authorize_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub expires_at: Option<u64>,
    pub email: Option<String>,
}

fn register_login(
    logins: &ClaudeLogins,
    client_id: &str,
    listener: &ListenInfo,
) -> CommandResult<LoginStart> {
    let verifier = random_token(32)?;
    let state = random_token(32)?;
    let login_id = random_token(16)?;
    let redirect_uri = format!("http://localhost:{}/callback", listener.port);
    let start = LoginStart {
        login_id: login_id.clone(),
        authorize_url: authorize_url(client_id, &redirect_uri, &verifier, &state)?,
        manual_authorize_url: authorize_url(client_id, MANUAL_REDIRECT_URI, &verifier, &state)?,
        state: state.clone(),
        redirect_uri: redirect_uri.clone(),
    };
    let login = PendingLogin {
        verifier,
        state,
        client_id: client_id.to_string(),
        redirect_uri,
        listener_id: listener.id.clone(),
        started: logins.now(),
        awaited: false,
    };
    logins.insert(login_id, login)?;
    Ok(start)
}

pub fn begin_login(
    logins: &ClaudeLogins,
    loopback: &LoopbackRegistry,
    client_id: &str,
) -> CommandResult<LoginStart> {
    validate_client_id(client_id)?;
    let listener = oauth_loopback::open_internal_listener(loopback)?;
    register_login(logins, client_id, &listener)
        .inspect_err(|_| oauth_loopback::cancel_internal_listener(loopback, &listener.id))
}

pub fn cancel_login(logins: &ClaudeLogins, loopback: &LoopbackRegistry, login_id: &str) {
    if let Some(login) = logins.remove(login_id) {
        oauth_loopback::cancel_internal_listener(loopback, &login.listener_id);
    }
}

fn oauth_error_code(body: &[u8]) -> Option<String> {
    let response: Value = serde_json::from_slice(body).ok()?;
    let error = response.get("error")?;
    let code = error
        .as_str()
        .or_else(|| error.get("type").and_then(Value::as_str))?;
    let safe = !code.is_empty()
        && code.len() <= 64
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
    safe.then(|| code.to_string())
}

fn is_refusal(status: StatusCode) -> bool {
    status.is_client_error()
        && status != StatusCode::REQUEST_TIMEOUT
        && status != StatusCode::TOO_MANY_REQUESTS
}

fn is_rejection(status: StatusCode, code: Option<&str>) -> bool {
    is_refusal(status) && matches!(code, Some("invalid_grant" | "invalid_client"))
}

struct TokenFailure {
    error: CommandError,
    rejected: bool,
}

impl From<CommandError> for TokenFailure {
    fn from(error: CommandError) -> Self {
        Self {
            error,
            rejected: false,
        }
    }
}

impl From<reqwest::Error> for TokenFailure {
    fn from(error: reqwest::Error) -> Self {
        CommandError::from(error).into()
    }
}

async fn post_token(url: &str, body: &Value) -> Result<Vec<u8>, TokenFailure> {
    let response = claude_client(TOKEN_TIMEOUT_SECS)?
        .post(url)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ACCEPT, "application/json")
        .body(body.to_string())
        .send()
        .await?;
    let status = response.status();
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(rate_limited(
            &response,
            "Claude token endpoint rate-limited the request (429)",
        )
        .into());
    }
    let payload = read_limited(response, MAX_TOKEN_BYTES, "token").await;
    if status.is_success() {
        return Ok(payload?);
    }
    let code = payload.ok().as_deref().and_then(oauth_error_code);
    let message = match &code {
        Some(code) => format!(
            "Claude token endpoint answered {} ({code})",
            status.as_u16()
        ),
        None => format!("Claude token endpoint answered {}", status.as_u16()),
    };
    let kind = if is_refusal(status) {
        ErrorKind::ProviderError
    } else {
        ErrorKind::Http
    };
    Err(TokenFailure {
        error: CommandError::new(kind, message),
        rejected: is_rejection(status, code.as_deref()),
    })
}

async fn exchange_code(
    token_url: &str,
    login: &PendingLogin,
    code: &str,
    redirect_uri: &str,
) -> CommandResult<StoredTokens> {
    let body = json!({
        "grant_type": "authorization_code",
        "code": code,
        "state": login.state,
        "client_id": login.client_id,
        "redirect_uri": redirect_uri,
        "code_verifier": login.verifier,
    });
    let raw = post_token(token_url, &body)
        .await
        .map_err(|failure| failure.error)?;
    Ok(StoredTokens {
        client_id: Some(login.client_id.clone()),
        ..parse_token_response(&raw, now_ms(), None)?
    })
}

fn issuing_client<'a>(current: &'a StoredTokens, fallback_client_id: &'a str) -> &'a str {
    current
        .client_id
        .as_deref()
        .filter(|client_id| validate_client_id(client_id).is_ok())
        .unwrap_or(fallback_client_id)
}

pub async fn refresh_tokens(
    token_url: &str,
    fallback_client_id: &str,
    current: &StoredTokens,
) -> CommandResult<StoredTokens> {
    let refresh_token = current
        .refresh_token
        .as_deref()
        .filter(|token| !token.is_empty())
        .ok_or_else(signin_required)?;
    let client_id = issuing_client(current, fallback_client_id);
    let mut body = json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    });
    if !current.scopes.is_empty() {
        body["scope"] = Value::from(current.scopes.join(" "));
    }
    let raw = post_token(token_url, &body)
        .await
        .map_err(|TokenFailure { error, rejected }| {
            if rejected {
                CommandError::new(
                    ErrorKind::ClaudeSigninRequired,
                    format!("Claude refused the token refresh: {}", error.message),
                )
            } else if error.kind == ErrorKind::ProviderError {
                CommandError::new(ErrorKind::Http, error.message)
            } else {
                error
            }
        })?;
    Ok(StoredTokens {
        client_id: Some(client_id.to_string()),
        ..parse_token_response(&raw, now_ms(), Some(current))?
    })
}

async fn fetch_email(profile_url: &str, access_token: &str) -> Option<String> {
    let response = claude_client(PROFILE_TIMEOUT_SECS)
        .ok()?
        .get(profile_url)
        .bearer_auth(access_token)
        .header("anthropic-beta", OAUTH_BETA)
        .header(header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = read_limited(response, MAX_PROFILE_BYTES, "profile")
        .await
        .ok()?;
    parse_profile_email(&body)
}

pub struct LoginContext<'a> {
    pub logins: &'a ClaudeLogins,
    pub loopback: &'a LoopbackRegistry,
    pub locks: &'a AccountLocks,
    pub store: TokenStore,
    pub endpoints: Endpoints<'a>,
}

pub struct Completion<'a> {
    pub login_id: &'a str,
    pub account_id: &'a str,
    pub code: Option<String>,
    pub timeout_ms: Option<u64>,
}

async fn claim_code(
    context: &LoginContext<'_>,
    completion: &Completion<'_>,
) -> CommandResult<(PendingLogin, String, String)> {
    let logins = context.logins;
    if let Some(pasted) = &completion.code {
        let expected = logins
            .state_of(completion.login_id)
            .ok_or_else(unknown_login)?;
        let code = parse_pasted_code(pasted, &expected)?;
        let login = logins.take(completion.login_id).ok_or_else(unknown_login)?;
        oauth_loopback::cancel_internal_listener(context.loopback, &login.listener_id);
        return Ok((login, code, MANUAL_REDIRECT_URI.to_string()));
    }
    let (state, listener_id) = logins.start_wait(completion.login_id)?;
    let waited = oauth_loopback::await_internal_code(
        context.loopback,
        &listener_id,
        state,
        completion.timeout_ms,
    )
    .await;
    let login = logins.take(completion.login_id);
    let code = waited?;
    let login =
        login.ok_or_else(|| CommandError::new(ErrorKind::Cancelled, "sign-in cancelled"))?;
    let redirect_uri = login.redirect_uri.clone();
    Ok((login, code, redirect_uri))
}

pub async fn complete_login(
    context: &LoginContext<'_>,
    completion: Completion<'_>,
) -> CommandResult<LoginResult> {
    validate_account_id(completion.account_id)?;
    let (login, code, redirect_uri) = claim_code(context, &completion).await?;
    let tokens = exchange_code(context.endpoints.token, &login, &code, &redirect_uri).await?;
    let lock = context.locks.for_account(completion.account_id);
    let serialized = lock.lock().await;
    let (store, account_id, saved) = (
        context.store,
        completion.account_id.to_string(),
        tokens.clone(),
    );
    run_blocking(move || save_tokens(store, &account_id, &saved)).await?;
    drop(serialized);
    let email = fetch_email(context.endpoints.profile, &tokens.access_token).await;
    Ok(LoginResult {
        expires_at: tokens.expires_at,
        email,
    })
}

pub async fn remove_account(
    locks: &AccountLocks,
    store: TokenStore,
    account_id: &str,
) -> CommandResult<()> {
    validate_account_id(account_id)?;
    let lock = locks.for_account(account_id);
    let _serialized = lock.lock().await;
    let account_id = account_id.to_string();
    run_blocking(move || delete_tokens(store, &account_id)).await
}

#[tauri::command]
pub async fn claude_oauth_begin(app: AppHandle, client_id: String) -> CommandResult<LoginStart> {
    run_blocking(move || {
        begin_login(
            &app.state::<ClaudeLogins>(),
            &app.state::<LoopbackRegistry>(),
            &client_id,
        )
    })
    .await
}

#[tauri::command]
pub async fn claude_oauth_complete(
    logins: State<'_, ClaudeLogins>,
    loopback: State<'_, LoopbackRegistry>,
    locks: State<'_, AccountLocks>,
    login_id: String,
    account_id: String,
    code: Option<String>,
    timeout_ms: Option<u64>,
) -> CommandResult<LoginResult> {
    let context = LoginContext {
        logins: &logins,
        loopback: &loopback,
        locks: &locks,
        store: app_store(),
        endpoints: Endpoints::anthropic(),
    };
    complete_login(
        &context,
        Completion {
            login_id: &login_id,
            account_id: &account_id,
            code,
            timeout_ms,
        },
    )
    .await
}

#[tauri::command]
pub async fn claude_oauth_cancel(
    logins: State<'_, ClaudeLogins>,
    loopback: State<'_, LoopbackRegistry>,
    login_id: String,
) -> CommandResult<()> {
    cancel_login(&logins, &loopback, &login_id);
    Ok(())
}

#[tauri::command]
pub async fn claude_account_status(account_id: String) -> CommandResult<AccountStatus> {
    validate_account_id(&account_id)?;
    let tokens = run_blocking(move || load_tokens(app_store(), &account_id)).await?;
    Ok(account_status(tokens.as_ref(), now_ms()))
}

#[tauri::command]
pub async fn claude_account_remove(
    locks: State<'_, AccountLocks>,
    account_id: String,
) -> CommandResult<()> {
    remove_account(&locks, app_store(), &account_id).await
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    use super::*;
    use crate::commands::claude_usage::fetch_usage;
    use crate::commands::secrets::{secret_get, SecretBackend, ALLOWED_SECRET_KEYS};
    use crate::commands::test_support::{json_response, MemoryStore, TestServer};

    const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
    const TOKEN_JSON: &str = r#"{"access_token":"sk-ant-oat01-new","refresh_token":"sk-ant-ort01-new","expires_in":28800,"scope":"user:profile user:inference","token_type":"Bearer"}"#;

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn tokens(refresh: Option<&str>, expires_at: Option<u64>) -> StoredTokens {
        StoredTokens {
            access_token: "sk-ant-oat01-abc".into(),
            refresh_token: refresh.map(str::to_string),
            expires_at,
            scopes: vec!["user:profile".into(), "user:inference".into()],
            client_id: None,
            rejected: false,
        }
    }

    fn query(url: &str) -> Vec<(String, String)> {
        Url::parse(url)
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect()
    }

    fn request_body(request: &str) -> Value {
        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap()
    }

    #[test]
    fn the_code_challenge_matches_the_rfc_7636_vector() {
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn random_tokens_are_url_safe_and_unique() {
        let first = random_token(32).unwrap();
        assert_eq!(first.len(), 43);
        assert!(first
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
        assert_ne!(first, random_token(32).unwrap());
    }

    #[test]
    fn the_authorize_url_carries_every_parameter_in_order() {
        let url = authorize_url(
            CLIENT_ID,
            "http://localhost:4567/callback",
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            "the-state",
        )
        .unwrap();
        assert!(url.starts_with("https://claude.ai/oauth/authorize?"));
        let expected: Vec<(String, String)> = [
            ("code", "true"),
            ("client_id", CLIENT_ID),
            ("response_type", "code"),
            ("redirect_uri", "http://localhost:4567/callback"),
            ("scope", "user:profile user:inference"),
            (
                "code_challenge",
                "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            ),
            ("code_challenge_method", "S256"),
            ("state", "the-state"),
        ]
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
        assert_eq!(query(&url), expected);
        assert!(
            !url.contains("dBjftJeZ4CVP"),
            "the verifier must not leave Rust"
        );
    }

    #[test]
    fn a_pasted_code_needs_the_state_of_this_sign_in() {
        assert_eq!(parse_pasted_code("abc#s-1", "s-1").unwrap(), "abc");
        assert_eq!(parse_pasted_code("  abc#s-1\n", "s-1").unwrap(), "abc");
        for (pasted, kind) in [
            ("abc", ErrorKind::StateMismatch),
            ("abc#other", ErrorKind::StateMismatch),
            ("abc#", ErrorKind::StateMismatch),
            ("", ErrorKind::InvalidArgument),
            ("   ", ErrorKind::InvalidArgument),
            ("#s-1", ErrorKind::InvalidArgument),
        ] {
            assert_eq!(
                parse_pasted_code(pasted, "s-1").unwrap_err().kind,
                kind,
                "{pasted:?}"
            );
        }
        assert_eq!(
            parse_pasted_code("abc#", "").unwrap_err().kind,
            ErrorKind::StateMismatch
        );
        let huge = format!("{}#s-1", "a".repeat(MAX_PASTED_CODE_CHARS));
        assert_eq!(
            parse_pasted_code(&huge, "s-1").unwrap_err().kind,
            ErrorKind::InvalidArgument
        );
    }

    #[test]
    fn refresh_starts_five_minutes_before_expiry_and_needs_a_refresh_token() {
        let now = 1_000_000_000;
        let at = |offset: u64| tokens(Some("rt"), Some(now + offset));
        assert!(at(REFRESH_LEEWAY_MS).needs_refresh(now));
        assert!(at(REFRESH_LEEWAY_MS - 1).needs_refresh(now));
        assert!(at(0).needs_refresh(now));
        assert!(!at(REFRESH_LEEWAY_MS + 1).needs_refresh(now));
        assert!(tokens(Some("rt"), Some(now - 1)).needs_refresh(now));
        assert!(!tokens(None, Some(now)).needs_refresh(now));
        assert!(!tokens(Some(""), Some(now)).needs_refresh(now));
        assert!(!tokens(Some("rt"), None).needs_refresh(now));
        assert!(tokens(Some("rt"), Some(u64::MAX)).needs_refresh(u64::MAX - 1));
    }

    #[test]
    fn account_ids_only_take_safe_characters() {
        for valid in ["a", "acc_1-B", "0", &"x".repeat(64)] {
            assert!(validate_account_id(valid).is_ok(), "{valid:?}");
        }
        for invalid_id in [
            "",
            &"x".repeat(65),
            "a.b",
            "a#1",
            "../x",
            "a b",
            "ação",
            "a/b",
            "claude.account.x",
            " acc",
        ] {
            assert_eq!(
                validate_account_id(invalid_id).unwrap_err().kind,
                ErrorKind::InvalidArgument,
                "{invalid_id:?}"
            );
        }
        assert_eq!(token_key("acc-1").unwrap(), "claude.account.acc-1");
        assert!(token_key("a#1").is_err());
    }

    #[test]
    fn client_ids_must_be_uuids() {
        for valid in [CLIENT_ID, "9D1C250A-E61B-44D9-88ED-5944D1962F5E"] {
            assert!(validate_client_id(valid).is_ok(), "{valid:?}");
        }
        for invalid_id in [
            "",
            "9d1c250ae61b44d988ed5944d1962f5e",
            "{9d1c250a-e61b-44d9-88ed-5944d1962f5e}",
            "urn:uuid:9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            "9d1c250a-e61b-44d9-88ed-5944d1962f5",
            "9d1c250a-e61b-44d9-88ed-5944d1962f5e0",
            "9d1c250a-e61b-44d9-88ed-5944d1962f5g",
            "9d1c250a-e61b-44d9-88ed-5944d1962f5e ",
            "9d1c250a-e61b-44d9-88ed5944-d1962f5e",
        ] {
            assert_eq!(
                validate_client_id(invalid_id).unwrap_err().kind,
                ErrorKind::InvalidArgument,
                "{invalid_id:?}"
            );
        }
    }

    #[test]
    fn a_full_token_response_becomes_stored_tokens() {
        let parsed = parse_token_response(TOKEN_JSON.as_bytes(), 1_000, None).unwrap();
        assert_eq!(parsed.access_token, "sk-ant-oat01-new");
        assert_eq!(parsed.refresh_token.as_deref(), Some("sk-ant-ort01-new"));
        assert_eq!(parsed.expires_at, Some(1_000 + 28_800_000));
        assert_eq!(parsed.scopes, vec!["user:profile", "user:inference"]);
        assert!(!parsed.rejected);
    }

    #[test]
    fn a_token_response_without_refresh_token_keeps_it_but_never_inherits_the_expiry() {
        let bare = br#"{"access_token":"at-2"}"#;
        let fresh = parse_token_response(bare, 1_000, None).unwrap();
        assert_eq!(fresh.refresh_token, None);
        assert_eq!(fresh.expires_at, None);
        assert_eq!(fresh.client_id, None);
        assert_eq!(fresh.scopes, vec!["user:profile", "user:inference"]);
        let previous = StoredTokens {
            scopes: vec!["user:inference".into()],
            client_id: Some(CLIENT_ID.into()),
            rejected: true,
            ..tokens(Some("rt-old"), Some(5_000))
        };
        let rotated = parse_token_response(bare, 1_000, Some(&previous)).unwrap();
        assert_eq!(rotated.access_token, "at-2");
        assert_eq!(rotated.refresh_token.as_deref(), Some("rt-old"));
        assert_eq!(rotated.expires_at, None);
        assert_eq!(rotated.scopes, vec!["user:inference"]);
        assert_eq!(rotated.client_id.as_deref(), Some(CLIENT_ID));
        assert!(!rotated.rejected);
    }

    #[test]
    fn token_lifetimes_accept_numbers_and_strings_and_are_capped() {
        let parse = |body: &str| parse_token_response(body.as_bytes(), 1_000, None).unwrap();
        assert_eq!(
            parse(r#"{"access_token":"t","expires_in":"60"}"#).expires_at,
            Some(61_000)
        );
        assert_eq!(
            parse(r#"{"access_token":"t","expires_in":1.5}"#).expires_at,
            Some(2_500)
        );
        assert_eq!(
            parse(r#"{"access_token":"t","expires_in":1e300}"#).expires_at,
            Some(MAX_EXPIRES_AT_MS)
        );
        assert_eq!(
            parse(r#"{"access_token":"t","expires_in":-5}"#).expires_at,
            None
        );
        assert_eq!(
            parse(r#"{"access_token":"t","expires_in":null,"scope":""}"#).scopes,
            vec!["user:profile", "user:inference"]
        );
    }

    #[test]
    fn a_token_response_without_access_token_is_refused() {
        for body in [
            "not-json",
            "{}",
            r#"{"access_token":""}"#,
            r#"{"access_token":42}"#,
        ] {
            let error = parse_token_response(body.as_bytes(), 0, None).unwrap_err();
            assert_eq!(error.kind, ErrorKind::Http, "{body}");
            assert!(!error.message.contains("access_token\":"));
        }
    }

    #[test]
    fn the_profile_email_is_read_when_present() {
        assert_eq!(
            parse_profile_email(br#"{"account":{"email":" dev@mottu.com.br ","uuid":"u"}}"#)
                .as_deref(),
            Some("dev@mottu.com.br")
        );
        for body in [
            "nope",
            "{}",
            r#"{"account":{}}"#,
            r#"{"account":{"email":""}}"#,
            r#"{"account":{"email":7}}"#,
        ] {
            assert_eq!(parse_profile_email(body.as_bytes()), None, "{body}");
        }
    }

    #[test]
    fn results_reach_the_webview_in_camel_case_without_tokens() {
        let start = LoginStart {
            login_id: "l".into(),
            authorize_url: "https://claude.ai/oauth/authorize?x".into(),
            state: "s".into(),
            redirect_uri: "http://localhost:1/callback".into(),
            manual_authorize_url: "https://claude.ai/oauth/authorize?y".into(),
        };
        assert_eq!(
            serde_json::to_string(&start).unwrap(),
            r#"{"loginId":"l","authorizeUrl":"https://claude.ai/oauth/authorize?x","state":"s","redirectUri":"http://localhost:1/callback","manualAuthorizeUrl":"https://claude.ai/oauth/authorize?y"}"#
        );
        assert_eq!(
            serde_json::to_string(&LoginResult {
                expires_at: Some(5),
                email: None
            })
            .unwrap(),
            r#"{"expiresAt":5,"email":null}"#
        );
        assert_eq!(
            serde_json::to_string(&account_status(Some(&tokens(None, Some(9))), 1)).unwrap(),
            r#"{"signedIn":true,"expiresAt":9,"needsLogin":false}"#
        );
        assert_eq!(
            serde_json::to_string(&account_status(None, 1)).unwrap(),
            r#"{"signedIn":false,"expiresAt":null,"needsLogin":true}"#
        );
    }

    #[test]
    fn stored_tokens_use_the_agreed_json_and_hide_secrets_from_debug() {
        let stored = StoredTokens {
            client_id: Some(CLIENT_ID.into()),
            ..tokens(Some("sk-ant-ort01-xyz"), Some(1_767_225_600_000))
        };
        assert_eq!(
            serde_json::to_string(&stored).unwrap(),
            r#"{"accessToken":"sk-ant-oat01-abc","refreshToken":"sk-ant-ort01-xyz","expiresAt":1767225600000,"scopes":["user:profile","user:inference"],"clientId":"9d1c250a-e61b-44d9-88ed-5944d1962f5e"}"#
        );
        let legacy: StoredTokens = serde_json::from_str(
            r#"{"accessToken":"a","refreshToken":"r","expiresAt":1,"scopes":["user:profile"]}"#,
        )
        .unwrap();
        assert_eq!(legacy.client_id, None);
        assert!(!serde_json::to_string(&legacy).unwrap().contains("clientId"));
        let rejected = StoredTokens {
            rejected: true,
            ..stored.clone()
        };
        assert!(serde_json::to_string(&rejected)
            .unwrap()
            .ends_with(r#","rejected":true}"#));
        let debug = format!("{stored:?}");
        assert!(!debug.contains("sk-ant"), "{debug}");
    }

    #[test]
    fn needs_login_follows_missing_expired_and_rejected_tokens() {
        let now = 10_000;
        assert!(account_status(None, now).needs_login);
        assert!(!account_status(Some(&tokens(Some("rt"), Some(now + 1))), now).needs_login);
        assert!(!account_status(Some(&tokens(Some("rt"), Some(now))), now).needs_login);
        assert!(account_status(Some(&tokens(None, Some(now))), now).needs_login);
        assert!(!account_status(Some(&tokens(None, None)), now).needs_login);
        let rejected = StoredTokens {
            rejected: true,
            ..tokens(Some("rt"), None)
        };
        let status = account_status(Some(&rejected), now);
        assert!(status.signed_in && status.needs_login);
    }

    #[test]
    fn the_token_key_is_never_readable_through_secret_get() {
        assert!(!ALLOWED_SECRET_KEYS
            .iter()
            .any(|key| key.starts_with(TOKEN_KEY_PREFIX) || key.starts_with("claude")));
        let denied = block_on(secret_get(token_key("acc").unwrap())).unwrap_err();
        assert_eq!(denied.kind, ErrorKind::Policy);
    }

    #[test]
    fn tokens_round_trip_through_the_store_and_large_ones_are_sliced() {
        let store = MemoryStore::default();
        assert_eq!(load_tokens(&store, "acc").unwrap(), None);
        let big = StoredTokens {
            access_token: "a".repeat(5_000),
            ..tokens(Some("rt"), Some(7))
        };
        save_tokens(&store, "acc", &big).unwrap();
        assert!(store.keys().contains(&"claude.account.acc#1".to_string()));
        assert_eq!(load_tokens(&store, "acc").unwrap(), Some(big));
        delete_tokens(&store, "acc").unwrap();
        assert!(store.keys().is_empty());
        delete_tokens(&store, "acc").unwrap();
        store.write("claude.account.bad", "{not json").unwrap();
        assert_eq!(load_tokens(&store, "bad").unwrap(), None);
        assert_eq!(
            save_tokens(&store, "../x", &tokens(None, None))
                .unwrap_err()
                .kind,
            ErrorKind::InvalidArgument
        );
    }

    #[test]
    fn saved_and_removed_tokens_are_served_from_the_cache() {
        let store = MemoryStore::cached();
        assert_eq!(load_tokens(store, "acc").unwrap(), None);
        save_tokens(store, "acc", &tokens(Some("rt"), None)).unwrap();
        let loaded = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(loaded.refresh_token.as_deref(), Some("rt"));
        assert!(account_status(Some(&loaded), 0).signed_in);
        block_on(remove_account(&AccountLocks::default(), store, "acc")).unwrap();
        assert_eq!(load_tokens(store, "acc").unwrap(), None);
        assert!(store.backend().keys().is_empty());
        assert_eq!(store.backend().reads(), 1);
    }

    fn pending(logins: &ClaudeLogins, listener_id: &str) -> PendingLogin {
        PendingLogin {
            verifier: "v".into(),
            state: "s".into(),
            client_id: CLIENT_ID.into(),
            redirect_uri: "http://localhost:1/callback".into(),
            listener_id: listener_id.into(),
            started: logins.now(),
            awaited: false,
        }
    }

    fn manual_clock() -> (Clock, Arc<Mutex<Duration>>) {
        let base = Instant::now();
        let advanced = Arc::new(Mutex::new(Duration::ZERO));
        let reading = Arc::clone(&advanced);
        let clock: Clock = Arc::new(move || base + *reading.lock().unwrap());
        (clock, advanced)
    }

    #[test]
    fn at_most_two_sign_ins_wait_at_once_and_old_ones_expire() {
        let (clock, advanced) = manual_clock();
        let logins = ClaudeLogins::with_clock(LOGIN_TTL, clock);
        logins.insert("a".into(), pending(&logins, "1")).unwrap();
        logins.insert("b".into(), pending(&logins, "2")).unwrap();
        assert_eq!(
            logins
                .insert("c".into(), pending(&logins, "3"))
                .unwrap_err()
                .kind,
            ErrorKind::TooManyProcesses
        );
        *advanced.lock().unwrap() = LOGIN_TTL - Duration::from_millis(1);
        assert_eq!(logins.state_of("a").as_deref(), Some("s"));
        *advanced.lock().unwrap() = LOGIN_TTL;
        assert_eq!(logins.state_of("a"), None);
        assert!(logins.take("a").is_none());
        logins.insert("c".into(), pending(&logins, "3")).unwrap();
        logins.insert("d".into(), pending(&logins, "4")).unwrap();
        assert!(logins.take("c").is_some());
        assert!(logins.take("c").is_none());
    }

    #[test]
    fn a_sign_in_can_be_awaited_only_once() {
        let logins = ClaudeLogins::default();
        logins.insert("a".into(), pending(&logins, "1")).unwrap();
        assert_eq!(logins.start_wait("a").unwrap(), ("s".into(), "1".into()));
        assert_eq!(
            logins.start_wait("a").unwrap_err().kind,
            ErrorKind::InvalidArgument
        );
        assert_eq!(
            logins.start_wait("zz").unwrap_err().kind,
            ErrorKind::InvalidArgument
        );
    }

    struct Harness {
        logins: ClaudeLogins,
        loopback: LoopbackRegistry,
        locks: AccountLocks,
        store: &'static MemoryStore,
        token: TestServer,
        profile: TestServer,
    }

    impl Harness {
        fn new(token: TestServer, profile: TestServer) -> Self {
            Self {
                logins: ClaudeLogins::default(),
                loopback: LoopbackRegistry::default(),
                locks: AccountLocks::default(),
                store: MemoryStore::leaked(),
                token,
                profile,
            }
        }

        fn context(&self) -> LoginContext<'_> {
            LoginContext {
                logins: &self.logins,
                loopback: &self.loopback,
                locks: &self.locks,
                store: self.store,
                endpoints: Endpoints {
                    token: &self.token.url,
                    profile: &self.profile.url,
                    usage: "http://127.0.0.1:9/usage",
                },
            }
        }

        fn complete(
            &self,
            login_id: &str,
            code: Option<&str>,
            timeout_ms: Option<u64>,
        ) -> CommandResult<LoginResult> {
            block_on(complete_login(
                &self.context(),
                Completion {
                    login_id,
                    account_id: "acc",
                    code: code.map(str::to_string),
                    timeout_ms,
                },
            ))
        }
    }

    fn ok_servers() -> Harness {
        Harness::new(
            TestServer::json("/token", "200 OK", TOKEN_JSON),
            TestServer::json(
                "/profile",
                "200 OK",
                r#"{"account":{"email":"dev@mottu.com.br"}}"#,
            ),
        )
    }

    fn port_of(redirect_uri: &str) -> u16 {
        Url::parse(redirect_uri).unwrap().port().unwrap()
    }

    fn listener_of(logins: &ClaudeLogins, login_id: &str) -> String {
        logins.lock().get(login_id).unwrap().listener_id.clone()
    }

    fn wait_until(condition: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !condition() {
            assert!(Instant::now() < deadline, "condition never became true");
            thread::yield_now();
        }
    }

    fn browser_hits(port: u16, target: String) -> thread::JoinHandle<String> {
        thread::spawn(move || {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            stream
                .write_all(format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes())
                .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        })
    }

    #[test]
    fn begin_opens_a_localhost_listener_and_builds_both_authorize_urls() {
        let harness = ok_servers();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        assert!(start.redirect_uri.starts_with("http://localhost:"));
        assert!(start.redirect_uri.ends_with("/callback"));
        let loopback = query(&start.authorize_url);
        let manual = query(&start.manual_authorize_url);
        let get = |pairs: &[(String, String)], name: &str| {
            pairs
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
                .unwrap()
        };
        assert_eq!(get(&loopback, "redirect_uri"), start.redirect_uri);
        assert_eq!(get(&manual, "redirect_uri"), MANUAL_REDIRECT_URI);
        assert_eq!(get(&loopback, "state"), start.state);
        assert_eq!(get(&manual, "state"), start.state);
        assert_eq!(
            get(&loopback, "code_challenge"),
            get(&manual, "code_challenge")
        );
        assert_eq!(get(&loopback, "client_id"), CLIENT_ID);
        assert_eq!(
            begin_login(&harness.logins, &harness.loopback, "nope")
                .unwrap_err()
                .kind,
            ErrorKind::InvalidArgument
        );
        cancel_login(&harness.logins, &harness.loopback, &start.login_id);
        assert!(TcpListener::bind(("127.0.0.1", port_of(&start.redirect_uri))).is_ok());
    }

    #[test]
    fn a_browser_callback_is_exchanged_with_pkce_and_the_tokens_are_stored() {
        let harness = ok_servers();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let browser = browser_hits(
            port_of(&start.redirect_uri),
            format!("/callback?code=the-code&state={}", start.state),
        );
        let result = harness
            .complete(&start.login_id, None, Some(5_000))
            .unwrap();
        assert!(browser.join().unwrap().starts_with("HTTP/1.1 200"));
        assert_eq!(result.email.as_deref(), Some("dev@mottu.com.br"));
        assert!(result.expires_at.unwrap() > now_ms());
        let Harness {
            token,
            profile,
            store,
            ..
        } = harness;
        let body = request_body(&token.requests()[0]);
        assert_eq!(body["grant_type"], "authorization_code");
        assert_eq!(body["code"], "the-code");
        assert_eq!(body["state"], start.state.as_str());
        assert_eq!(body["client_id"], CLIENT_ID);
        assert_eq!(body["redirect_uri"], start.redirect_uri.as_str());
        let verifier = body["code_verifier"].as_str().unwrap();
        let challenge = query(&start.authorize_url)
            .into_iter()
            .find(|(key, _)| key == "code_challenge")
            .unwrap()
            .1;
        assert_eq!(code_challenge(verifier), challenge);
        assert!(profile.requests()[0]
            .to_lowercase()
            .contains("authorization: bearer sk-ant-oat01-new"));
        let saved = load_tokens(store, "acc").unwrap().unwrap();
        assert_eq!(saved.access_token, "sk-ant-oat01-new");
        assert_eq!(saved.refresh_token.as_deref(), Some("sk-ant-ort01-new"));
        assert_eq!(saved.expires_at, result.expires_at);
        assert_eq!(saved.client_id.as_deref(), Some(CLIENT_ID));
    }

    #[test]
    fn a_pasted_code_uses_the_code_page_redirect_and_closes_the_listener() {
        let harness = ok_servers();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let wrong = harness
            .complete(&start.login_id, Some("pasted#forged"), None)
            .unwrap_err();
        assert_eq!(wrong.kind, ErrorKind::StateMismatch);
        let pasted = format!("pasted-code#{}", start.state);
        harness
            .complete(&start.login_id, Some(&pasted), None)
            .unwrap();
        assert!(TcpListener::bind(("127.0.0.1", port_of(&start.redirect_uri))).is_ok());
        assert_eq!(
            harness
                .complete(&start.login_id, Some(&pasted), None)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidArgument
        );
        let body = request_body(&harness.token.requests()[0]);
        assert_eq!(body["code"], "pasted-code");
        assert_eq!(body["redirect_uri"], MANUAL_REDIRECT_URI);
    }

    #[test]
    fn a_paste_while_waiting_takes_over_the_sign_in() {
        let harness = ok_servers();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let pasted = format!("pasted-code#{}", start.state);
        let listener_id = listener_of(&harness.logins, &start.login_id);
        let (waiting, pasting) = thread::scope(|scope| {
            let waiting = scope.spawn(|| harness.complete(&start.login_id, None, Some(10_000)));
            wait_until(|| harness.loopback.is_claimed(&listener_id));
            let pasting = harness.complete(&start.login_id, Some(&pasted), None);
            (waiting.join().unwrap(), pasting)
        });
        assert!(pasting.is_ok());
        assert_eq!(waiting.unwrap_err().kind, ErrorKind::Cancelled);
    }

    #[test]
    fn cancelling_during_a_loopback_wait_ends_it_and_frees_the_port() {
        let harness = ok_servers();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let listener_id = listener_of(&harness.logins, &start.login_id);
        let waited = thread::scope(|scope| {
            let waiting = scope.spawn(|| harness.complete(&start.login_id, None, Some(10_000)));
            wait_until(|| harness.loopback.is_claimed(&listener_id));
            cancel_login(&harness.logins, &harness.loopback, &start.login_id);
            waiting.join().unwrap()
        });
        assert_eq!(waited.unwrap_err().kind, ErrorKind::Cancelled);
        assert_eq!(harness.logins.state_of(&start.login_id), None);
        assert!(TcpListener::bind(("127.0.0.1", port_of(&start.redirect_uri))).is_ok());
        cancel_login(&harness.logins, &harness.loopback, &start.login_id);
        assert!(harness.store.keys().is_empty());
        assert!(harness.token.requests().is_empty());
    }

    #[test]
    fn the_sign_in_listener_is_out_of_reach_of_the_webview_loopback_commands() {
        let harness = ok_servers();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let listener_id = listener_of(&harness.logins, &start.login_id);
        let waited = block_on(oauth_loopback::await_code(
            &harness.loopback,
            &listener_id,
            start.state.clone(),
            Some(100),
        ))
        .unwrap_err();
        assert_eq!(waited.kind, ErrorKind::Policy);
        assert_eq!(
            oauth_loopback::cancel_listener(&harness.loopback, &listener_id)
                .unwrap_err()
                .kind,
            ErrorKind::Policy
        );
        let browser = browser_hits(
            port_of(&start.redirect_uri),
            format!("/callback?code=the-code&state={}", start.state),
        );
        harness
            .complete(&start.login_id, None, Some(10_000))
            .unwrap();
        assert!(browser.join().unwrap().starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn the_profile_is_best_effort_and_the_email_may_be_null() {
        let harness = Harness::new(
            TestServer::json("/token", "200 OK", TOKEN_JSON),
            TestServer::json("/profile", "500 Internal Server Error", "{}"),
        );
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let result = harness
            .complete(&start.login_id, Some(&format!("c#{}", start.state)), None)
            .unwrap();
        assert_eq!(result.email, None);
        assert!(load_tokens(harness.store, "acc").unwrap().is_some());
    }

    #[test]
    fn a_refused_exchange_consumes_the_sign_in_and_stores_nothing() {
        let harness = Harness::new(
            TestServer::json(
                "/token",
                "400 Bad Request",
                r#"{"error":"invalid_grant","error_description":"code sk-ant-oat01 leaked"}"#,
            ),
            TestServer::json("/profile", "200 OK", "{}"),
        );
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let error = harness
            .complete(&start.login_id, Some(&format!("c#{}", start.state)), None)
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::ProviderError);
        assert!(error.message.contains("invalid_grant"));
        assert!(!error.message.contains("sk-ant"));
        assert!(harness.store.keys().is_empty());
        assert_eq!(
            harness
                .complete(&start.login_id, Some(&format!("c#{}", start.state)), None)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidArgument
        );
    }

    #[test]
    fn complete_validates_the_account_and_unknown_or_cancelled_sign_ins() {
        let harness = ok_servers();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let bad_account = block_on(complete_login(
            &harness.context(),
            Completion {
                login_id: &start.login_id,
                account_id: "a/b",
                code: Some(format!("c#{}", start.state)),
                timeout_ms: None,
            },
        ))
        .unwrap_err();
        assert_eq!(bad_account.kind, ErrorKind::InvalidArgument);
        cancel_login(&harness.logins, &harness.loopback, &start.login_id);
        cancel_login(&harness.logins, &harness.loopback, &start.login_id);
        assert_eq!(
            harness
                .complete(&start.login_id, None, Some(100))
                .unwrap_err()
                .kind,
            ErrorKind::InvalidArgument
        );
        assert!(harness.token.requests().is_empty());
    }

    #[test]
    fn a_loopback_wait_times_out_and_clears_the_sign_in() {
        let harness = ok_servers();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let error = harness
            .complete(&start.login_id, None, Some(100))
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Timeout);
        assert_eq!(harness.logins.state_of(&start.login_id), None);
    }

    #[test]
    fn token_endpoint_failures_map_to_typed_errors() {
        let call = |server: TestServer| {
            let failure = block_on(post_token(&server.url, &json!({}))).unwrap_err();
            (
                failure.error.kind,
                failure.error.retry_after_secs,
                failure.error.message,
                failure.rejected,
            )
        };
        let (kind, _, message, rejected) = call(TestServer::json(
            "/token",
            "401 Unauthorized",
            r#"{"type":"error","error":{"type":"authentication_error","message":"x"}}"#,
        ));
        assert_eq!(kind, ErrorKind::ProviderError);
        assert!(message.contains("authentication_error"));
        assert!(!rejected);
        let limited = TestServer::start(
            "/token",
            vec!["HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()],
        );
        let (kind, retry, _, rejected) = call(limited);
        assert_eq!(kind, ErrorKind::RateLimited);
        assert_eq!(retry, Some(Some(30)));
        assert!(!rejected);
        let (kind, _, message, rejected) = call(TestServer::json(
            "/token",
            "503 Service Unavailable",
            "<html>",
        ));
        assert_eq!(kind, ErrorKind::Http);
        assert_eq!(message, "Claude token endpoint answered 503");
        assert!(!rejected);
        let (kind, _, _, rejected) = call(TestServer::json(
            "/token",
            "408 Request Timeout",
            r#"{"error":"invalid_grant"}"#,
        ));
        assert_eq!(kind, ErrorKind::Http);
        assert!(!rejected);
    }

    #[test]
    fn only_invalid_grant_and_invalid_client_count_as_a_rejection() {
        let rejected = |status: &str, body: &str| {
            let server = TestServer::json("/token", status, body);
            block_on(post_token(&server.url, &json!({})))
                .unwrap_err()
                .rejected
        };
        assert!(rejected("400 Bad Request", r#"{"error":"invalid_grant"}"#));
        assert!(rejected(
            "401 Unauthorized",
            r#"{"error":"invalid_client"}"#
        ));
        assert!(rejected(
            "400 Bad Request",
            r#"{"error":{"type":"invalid_grant"}}"#
        ));
        for (status, body) in [
            ("403 Forbidden", "<html>blocked</html>"),
            ("404 Not Found", "{}"),
            ("405 Method Not Allowed", ""),
            ("415 Unsupported Media Type", r#"{"error":"unsupported"}"#),
            ("400 Bad Request", r#"{"error":"invalid_request"}"#),
            ("400 Bad Request", r#"{"error":"invalid_scope"}"#),
            ("401 Unauthorized", r#"{"error":"unauthorized_client"}"#),
            ("500 Internal Server Error", r#"{"error":"invalid_grant"}"#),
        ] {
            assert!(!rejected(status, body), "{status} {body}");
        }
    }

    #[test]
    fn a_rejected_refresh_asks_for_sign_in_and_a_missing_refresh_token_skips_the_call() {
        let server = TestServer::json("/token", "400 Bad Request", r#"{"error":"invalid_grant"}"#);
        let error = block_on(refresh_tokens(
            &server.url,
            CLIENT_ID,
            &tokens(Some("rt"), Some(1)),
        ))
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert_eq!(server.requests().len(), 1);
        let waf = TestServer::json("/token", "403 Forbidden", "<html>blocked</html>");
        let error = block_on(refresh_tokens(
            &waf.url,
            CLIENT_ID,
            &tokens(Some("rt"), Some(1)),
        ))
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert_eq!(error.message, "Claude token endpoint answered 403");
        let unused = TestServer::json("/token", "200 OK", TOKEN_JSON);
        let error = block_on(refresh_tokens(
            &unused.url,
            CLIENT_ID,
            &tokens(None, Some(1)),
        ))
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::ClaudeSigninRequired);
        assert!(unused.requests().is_empty());
    }

    const USAGE_JSON: &str = r#"{"five_hour":{"utilization":41.0}}"#;
    const REFRESHED_JSON: &str =
        r#"{"access_token":"at-refreshed","refresh_token":"rt-refreshed","expires_in":3600}"#;

    struct InFlightFetch {
        refresh: TestServer,
        usage: TestServer,
        gate: crate::commands::test_support::Gate,
    }

    impl InFlightFetch {
        fn new() -> Self {
            let refresh = TestServer::json("/token", "200 OK", REFRESHED_JSON);
            let (usage, gate) = TestServer::gated(
                "/usage",
                vec![
                    json_response("401 Unauthorized", "{}"),
                    json_response("200 OK", USAGE_JSON),
                ],
            );
            Self {
                refresh,
                usage,
                gate,
            }
        }

        fn endpoints(&self) -> Endpoints<'_> {
            Endpoints {
                token: &self.refresh.url,
                profile: "http://127.0.0.1:9/profile",
                usage: &self.usage.url,
            }
        }
    }

    #[test]
    fn a_remove_issued_during_a_fetch_waits_for_it_and_wins() {
        let store = MemoryStore::leaked();
        save_tokens(store, "acc", &tokens(Some("rt-old"), None)).unwrap();
        let locks = AccountLocks::default();
        let fetch = InFlightFetch::new();
        let endpoints = fetch.endpoints();
        let (fetched, removed) = thread::scope(|scope| {
            let fetching =
                scope.spawn(|| block_on(fetch_usage(&locks, store, &endpoints, "acc", CLIENT_ID)));
            fetch.gate.wait_for_request();
            assert!(locks.for_account("acc").try_lock().is_err());
            let removing = scope.spawn(|| block_on(remove_account(&locks, store, "acc")));
            fetch.gate.release();
            (fetching.join().unwrap(), removing.join().unwrap())
        });
        assert_eq!(fetched.unwrap()["five_hour"]["utilization"], 41.0);
        removed.unwrap();
        assert!(store.keys().is_empty(), "{:?}", store.keys());
        assert_eq!(fetch.refresh.requests().len(), 1);
    }

    #[test]
    fn a_sign_in_completed_during_a_fetch_waits_for_it_and_its_tokens_are_kept() {
        let harness = ok_servers();
        save_tokens(harness.store, "acc", &tokens(Some("rt-old"), None)).unwrap();
        let start = begin_login(&harness.logins, &harness.loopback, CLIENT_ID).unwrap();
        let pasted = format!("pasted-code#{}", start.state);
        let fetch = InFlightFetch::new();
        let endpoints = fetch.endpoints();
        let (fetched, completed) = thread::scope(|scope| {
            let fetching = scope.spawn(|| {
                block_on(fetch_usage(
                    &harness.locks,
                    harness.store,
                    &endpoints,
                    "acc",
                    CLIENT_ID,
                ))
            });
            fetch.gate.wait_for_request();
            assert!(harness.locks.for_account("acc").try_lock().is_err());
            let completing = scope.spawn(|| harness.complete(&start.login_id, Some(&pasted), None));
            fetch.gate.release();
            (fetching.join().unwrap(), completing.join().unwrap())
        });
        assert!(fetched.is_ok());
        completed.unwrap();
        let saved = load_tokens(harness.store, "acc").unwrap().unwrap();
        assert_eq!(saved.access_token, "sk-ant-oat01-new");
        assert_eq!(saved.refresh_token.as_deref(), Some("sk-ant-ort01-new"));
        assert!(!saved.rejected);
        assert_eq!(fetch.refresh.requests().len(), 1);
    }

    #[test]
    fn removing_an_account_is_idempotent_and_validated() {
        let store = MemoryStore::leaked();
        save_tokens(store, "acc", &tokens(Some("rt"), None)).unwrap();
        let locks = AccountLocks::default();
        block_on(remove_account(&locks, store, "acc")).unwrap();
        assert!(store.keys().is_empty());
        block_on(remove_account(&locks, store, "acc")).unwrap();
        assert_eq!(
            block_on(remove_account(&locks, store, "a.b"))
                .unwrap_err()
                .kind,
            ErrorKind::InvalidArgument
        );
    }
}

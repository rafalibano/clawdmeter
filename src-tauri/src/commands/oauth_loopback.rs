use std::collections::HashMap;
use std::io::{ErrorKind as IoErrorKind, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;
use url::Url;

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};

const CALLBACK_PATH: &str = "/callback";
const MAX_REQUEST_BYTES: usize = 8_192;
const ACCEPT_POLL_MS: u64 = 40;
const READ_TIMEOUT_MS: u64 = 2_000;
const HEAD_DEADLINE_MS: u64 = 5_000;
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MAX_TIMEOUT_MS: u64 = 600_000;
const LISTENER_TTL_MS: u64 = MAX_TIMEOUT_MS + 5_000;
const MAX_LISTENERS: usize = 2;

type ListenerMap = Arc<Mutex<HashMap<String, Arc<LoopbackListener>>>>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Owner {
    Webview,
    Internal,
}

pub struct LoopbackListener {
    socket: TcpListener,
    owner: Owner,
    cancelled: AtomicBool,
    claimed: AtomicBool,
}

impl LoopbackListener {
    fn new(socket: TcpListener, owner: Owner) -> Self {
        Self {
            socket,
            owner,
            cancelled: AtomicBool::new(false),
            claimed: AtomicBool::new(false),
        }
    }
}

#[derive(Default)]
pub struct LoopbackRegistry {
    next_id: AtomicU64,
    listeners: ListenerMap,
}

impl LoopbackRegistry {
    fn insert(&self, listener: LoopbackListener) -> CommandResult<String> {
        self.insert_with_ttl(listener, Duration::from_millis(LISTENER_TTL_MS))
    }

    fn insert_with_ttl(&self, listener: LoopbackListener, ttl: Duration) -> CommandResult<String> {
        let id = (self.next_id.fetch_add(1, Ordering::SeqCst) + 1).to_string();
        let shared = Arc::new(listener);
        {
            let mut listeners = self.listeners.lock().map_err(|_| too_many_listeners())?;
            if listeners.len() >= MAX_LISTENERS {
                return Err(too_many_listeners());
            }
            listeners.insert(id.clone(), Arc::clone(&shared));
        }
        let weak = Arc::downgrade(&shared);
        let listeners = Arc::clone(&self.listeners);
        let expiring = id.clone();
        thread::spawn(move || {
            thread::sleep(ttl);
            if let Some(listener) = weak.upgrade() {
                listener.cancelled.store(true, Ordering::SeqCst);
            }
            if let Ok(mut listeners) = listeners.lock() {
                listeners.remove(&expiring);
            }
        });
        Ok(id)
    }

    fn owned(&self, id: &str, owner: Owner) -> CommandResult<Option<Arc<LoopbackListener>>> {
        match self.get(id) {
            Some(listener) if listener.owner != owner => Err(reserved_listener()),
            found => Ok(found),
        }
    }

    fn claim(&self, id: &str, owner: Owner) -> CommandResult<Arc<LoopbackListener>> {
        self.owned(id, owner)?
            .filter(|listener| !listener.claimed.swap(true, Ordering::SeqCst))
            .ok_or_else(|| {
                CommandError::new(
                    ErrorKind::InvalidArgument,
                    "unknown or already awaited listener",
                )
            })
    }

    #[cfg(test)]
    pub fn is_claimed(&self, id: &str) -> bool {
        self.get(id)
            .is_some_and(|listener| listener.claimed.load(Ordering::SeqCst))
    }

    fn get(&self, id: &str) -> Option<Arc<LoopbackListener>> {
        self.listeners
            .lock()
            .ok()
            .and_then(|listeners| listeners.get(id).cloned())
    }

    fn remove(&self, id: &str) {
        if let Ok(mut listeners) = self.listeners.lock() {
            listeners.remove(id);
        }
    }
}

fn reserved_listener() -> CommandError {
    CommandError::new(
        ErrorKind::Policy,
        "this listener belongs to another sign-in",
    )
}

fn too_many_listeners() -> CommandError {
    CommandError::new(
        ErrorKind::TooManyProcesses,
        format!("limit of {MAX_LISTENERS} open login listeners reached"),
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenInfo {
    pub id: String,
    pub port: u16,
}

#[derive(Debug, Serialize)]
pub struct CallbackResult {
    pub code: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CallbackOutcome {
    Code(String),
    NotCallback,
}

pub fn request_target(head: &str) -> CommandResult<String> {
    let line = head.lines().next().unwrap_or_default();
    let mut parts = line.split_whitespace();
    match (parts.next(), parts.next()) {
        (Some("GET"), Some(target)) if target.starts_with('/') => Ok(target.to_string()),
        _ => Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "invalid callback request",
        )),
    }
}

pub fn same_state(expected: &str, received: &str) -> bool {
    if expected.len() != received.len() {
        return false;
    }
    expected
        .bytes()
        .zip(received.bytes())
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

pub fn evaluate_callback(target: &str, expected_state: &str) -> CommandResult<CallbackOutcome> {
    let base = Url::parse("http://127.0.0.1")?;
    let url = base
        .join(target)
        .map_err(|_| CommandError::new(ErrorKind::InvalidArgument, "callback with invalid URL"))?;
    if url.path() != CALLBACK_PATH {
        return Ok(CallbackOutcome::NotCallback);
    }
    let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let state_ok = query
        .get("state")
        .map(|received| !expected_state.is_empty() && same_state(expected_state, received))
        .unwrap_or(false);
    if !state_ok {
        return Err(CommandError::new(
            ErrorKind::StateMismatch,
            "callback state does not match",
        ));
    }
    if let Some(error) = query.get("error") {
        let detail = query
            .get("error_description")
            .map(String::as_str)
            .unwrap_or(error.as_str());
        return Err(CommandError::new(
            ErrorKind::ProviderError,
            format!("{error}: {detail}"),
        ));
    }
    match query.get("code").filter(|code| !code.is_empty()) {
        Some(code) => Ok(CallbackOutcome::Code(code.clone())),
        None => Err(CommandError::new(
            ErrorKind::ProviderError,
            "callback without code",
        )),
    }
}

fn page(status: &str, title: &str) -> String {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>ClawdMeter</title><body style=\"font-family:-apple-system,Segoe UI,sans-serif;text-align:center;margin-top:20vh\"><h2>{title}</h2><p>You can close this window now.</p></body>"
    );
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    )
}

fn read_head(stream: &mut TcpStream) -> Option<String> {
    read_head_within(
        stream,
        Duration::from_millis(READ_TIMEOUT_MS),
        Duration::from_millis(HEAD_DEADLINE_MS),
    )
}

fn read_head_within(
    stream: &mut TcpStream,
    per_read: Duration,
    deadline: Duration,
) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    let started = Instant::now();
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    while buffer.len() < MAX_REQUEST_BYTES && !buffer.windows(4).any(|window| window == b"\r\n\r\n")
    {
        let remaining = deadline.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            break;
        }
        stream
            .set_read_timeout(Some(per_read.min(remaining)))
            .ok()?;
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            Err(error) if error.kind() == IoErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

fn reply(stream: &mut TcpStream, response: &str) {
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn serve_until_callback(
    listener: &LoopbackListener,
    expected_state: &str,
    limit: Duration,
) -> CommandResult<String> {
    listener.socket.set_nonblocking(true)?;
    let started = Instant::now();
    loop {
        if listener.cancelled.load(Ordering::SeqCst) {
            return Err(CommandError::new(ErrorKind::Cancelled, "sign-in cancelled"));
        }
        if started.elapsed() >= limit {
            return Err(CommandError::new(
                ErrorKind::Timeout,
                "timed out waiting for sign-in",
            ));
        }
        let mut stream = match listener.socket.accept() {
            Ok((stream, _)) => stream,
            Err(error) if error.kind() == IoErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(ACCEPT_POLL_MS));
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        let Some(head) = read_head(&mut stream) else {
            continue;
        };
        let outcome =
            request_target(&head).and_then(|target| evaluate_callback(&target, expected_state));
        match outcome {
            Ok(CallbackOutcome::Code(code)) => {
                reply(&mut stream, &page("200 OK", "Sign-in complete"));
                return Ok(code);
            }
            Ok(CallbackOutcome::NotCallback) => {
                reply(&mut stream, &page("404 Not Found", "Not found"))
            }
            Err(error)
                if matches!(
                    error.kind,
                    ErrorKind::InvalidArgument | ErrorKind::StateMismatch
                ) =>
            {
                reply(&mut stream, &page("400 Bad Request", "Invalid request"));
            }
            Err(error) => {
                reply(
                    &mut stream,
                    &page("400 Bad Request", "Sign-in not completed"),
                );
                return Err(error);
            }
        }
    }
}

fn open(registry: &LoopbackRegistry, owner: Owner) -> CommandResult<ListenInfo> {
    let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let port = socket.local_addr()?.port();
    let id = registry.insert(LoopbackListener::new(socket, owner))?;
    Ok(ListenInfo { id, port })
}

async fn wait_for_code(
    registry: &LoopbackRegistry,
    id: &str,
    owner: Owner,
    expected_state: String,
    timeout_ms: Option<u64>,
) -> CommandResult<String> {
    let listener = registry.claim(id, owner)?;
    let limit = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS));
    let result =
        run_blocking(move || serve_until_callback(&listener, &expected_state, limit)).await;
    registry.remove(id);
    result
}

fn cancel(registry: &LoopbackRegistry, id: &str, owner: Owner) -> CommandResult<()> {
    if let Some(listener) = registry.owned(id, owner)? {
        listener.cancelled.store(true, Ordering::SeqCst);
    }
    registry.remove(id);
    Ok(())
}

pub fn open_listener(registry: &LoopbackRegistry) -> CommandResult<ListenInfo> {
    open(registry, Owner::Webview)
}

pub async fn await_code(
    registry: &LoopbackRegistry,
    id: &str,
    expected_state: String,
    timeout_ms: Option<u64>,
) -> CommandResult<String> {
    wait_for_code(registry, id, Owner::Webview, expected_state, timeout_ms).await
}

pub fn cancel_listener(registry: &LoopbackRegistry, id: &str) -> CommandResult<()> {
    cancel(registry, id, Owner::Webview)
}

pub fn open_internal_listener(registry: &LoopbackRegistry) -> CommandResult<ListenInfo> {
    open(registry, Owner::Internal)
}

pub async fn await_internal_code(
    registry: &LoopbackRegistry,
    id: &str,
    expected_state: String,
    timeout_ms: Option<u64>,
) -> CommandResult<String> {
    wait_for_code(registry, id, Owner::Internal, expected_state, timeout_ms).await
}

pub fn cancel_internal_listener(registry: &LoopbackRegistry, id: &str) {
    let _ = cancel(registry, id, Owner::Internal);
}

#[tauri::command(async)]
pub fn oauth_loopback_listen(registry: State<LoopbackRegistry>) -> CommandResult<ListenInfo> {
    open_listener(&registry)
}

#[tauri::command]
pub async fn oauth_loopback_wait(
    registry: State<'_, LoopbackRegistry>,
    id: String,
    expected_state: String,
    timeout_ms: Option<u64>,
) -> CommandResult<CallbackResult> {
    await_code(&registry, &id, expected_state, timeout_ms)
        .await
        .map(|code| CallbackResult { code })
}

#[tauri::command(async)]
pub fn oauth_loopback_cancel(registry: State<LoopbackRegistry>, id: String) -> CommandResult<()> {
    cancel_listener(&registry, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_target_from_a_get_request() {
        let head = "GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(
            request_target(head).unwrap(),
            "/callback?code=abc&state=xyz"
        );
    }

    #[test]
    fn rejects_non_get_and_garbage_requests() {
        assert!(request_target("POST /callback HTTP/1.1\r\n\r\n").is_err());
        assert!(request_target("").is_err());
        assert!(request_target("GET callback HTTP/1.1\r\n\r\n").is_err());
    }

    #[test]
    fn returns_the_code_when_state_matches() {
        let outcome = evaluate_callback("/callback?code=abc%2B1&state=s-1", "s-1").unwrap();
        assert_eq!(outcome, CallbackOutcome::Code("abc+1".into()));
    }

    #[test]
    fn rejects_mismatched_or_missing_state() {
        let mismatch = evaluate_callback("/callback?code=abc&state=outro", "s-1").unwrap_err();
        assert_eq!(mismatch.kind, ErrorKind::StateMismatch);
        let missing = evaluate_callback("/callback?code=abc", "s-1").unwrap_err();
        assert_eq!(missing.kind, ErrorKind::StateMismatch);
        let empty_expected = evaluate_callback("/callback?code=abc&state=", "").unwrap_err();
        assert_eq!(empty_expected.kind, ErrorKind::StateMismatch);
    }

    #[test]
    fn surfaces_provider_errors_after_validating_state() {
        let error = evaluate_callback(
            "/callback?error=access_denied&error_description=user%20denied&state=s-1",
            "s-1",
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::ProviderError);
        assert!(error.message.contains("access_denied"));
        assert!(error.message.contains("user denied"));
    }

    #[test]
    fn requires_a_code() {
        let error = evaluate_callback("/callback?state=s-1", "s-1").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ProviderError);
    }

    #[test]
    fn other_paths_are_not_callbacks() {
        assert_eq!(
            evaluate_callback("/favicon.ico", "s-1").unwrap(),
            CallbackOutcome::NotCallback
        );
    }

    #[test]
    fn state_comparison_checks_length_and_content() {
        assert!(same_state("abc", "abc"));
        assert!(!same_state("abc", "abd"));
        assert!(!same_state("abc", "abcd"));
    }

    #[test]
    fn unused_listeners_expire_without_wait_or_cancel() {
        let registry = LoopbackRegistry::default();
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        let id = registry
            .insert_with_ttl(
                LoopbackListener::new(socket, Owner::Webview),
                Duration::from_millis(60),
            )
            .unwrap();
        let kept = registry.get(&id).unwrap();
        assert!(!kept.cancelled.load(Ordering::SeqCst));
        thread::sleep(Duration::from_millis(250));
        assert!(registry.get(&id).is_none());
        assert!(kept.cancelled.load(Ordering::SeqCst));
        drop(kept);
        thread::sleep(Duration::from_millis(50));
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
    }

    #[test]
    fn removed_listener_closes_its_socket_without_waiting_for_the_ttl() {
        let registry = LoopbackRegistry::default();
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        let id = registry
            .insert_with_ttl(
                LoopbackListener::new(socket, Owner::Webview),
                Duration::from_secs(60),
            )
            .unwrap();
        registry.remove(&id);
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
    }

    #[test]
    fn serves_a_real_callback_over_loopback() {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        let listener = LoopbackListener::new(socket, Owner::Webview);
        let client = thread::spawn(move || {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            stream
                .write_all(b"GET /callback?code=the-code&state=s-1 HTTP/1.1\r\nHost: x\r\n\r\n")
                .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        });
        let code = serve_until_callback(&listener, "s-1", Duration::from_secs(5)).unwrap();
        assert_eq!(code, "the-code");
        assert!(client.join().unwrap().starts_with("HTTP/1.1 200 OK"));
    }

    fn send_get(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes())
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    fn listener_on_free_port() -> (LoopbackListener, u16) {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        let listener = LoopbackListener::new(socket, Owner::Webview);
        (listener, port)
    }

    #[test]
    fn a_wrong_state_gets_a_400_and_the_login_keeps_waiting() {
        let (listener, port) = listener_on_free_port();
        let client = thread::spawn(move || {
            let rejected = send_get(port, "/callback?code=x&state=forged");
            let missing = send_get(port, "/callback?code=x");
            let accepted = send_get(port, "/callback?code=the-code&state=s-1");
            (rejected, missing, accepted)
        });
        let code = serve_until_callback(&listener, "s-1", Duration::from_secs(5)).unwrap();
        assert_eq!(code, "the-code");
        let (rejected, missing, accepted) = client.join().unwrap();
        assert!(rejected.starts_with("HTTP/1.1 400"));
        assert!(missing.starts_with("HTTP/1.1 400"));
        assert!(accepted.starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn a_provider_error_with_a_valid_state_still_ends_the_wait() {
        let (listener, port) = listener_on_free_port();
        let client = thread::spawn(move || {
            let forged = send_get(port, "/callback?error=access_denied&state=forged");
            let real = send_get(port, "/callback?error=access_denied&state=s-1");
            (forged, real)
        });
        let error = serve_until_callback(&listener, "s-1", Duration::from_secs(5)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::ProviderError);
        let (forged, real) = client.join().unwrap();
        assert!(forged.starts_with("HTTP/1.1 400"));
        assert!(real.starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn a_client_dripping_bytes_cannot_hold_the_connection_past_the_deadline() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = thread::spawn(move || {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            for byte in b"GET /callback?code=x&state=s-1 HTTP/1.1".iter() {
                if stream.write_all(&[*byte]).is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(60));
            }
        });
        let (mut server_side, _) = listener.accept().unwrap();
        let started = Instant::now();
        let head = read_head_within(
            &mut server_side,
            Duration::from_secs(2),
            Duration::from_millis(400),
        )
        .unwrap();
        let elapsed = started.elapsed();
        assert!(elapsed >= Duration::from_millis(350), "{elapsed:?}");
        assert!(elapsed < Duration::from_millis(1_200), "{elapsed:?}");
        assert!(!head.is_empty() && !head.contains("\r\n\r\n"));
        assert!(head.len() < "GET /callback?code=x&state=s-1 HTTP/1.1".len());
        drop(server_side);
        client.join().unwrap();
    }

    #[test]
    fn a_complete_head_is_read_well_before_the_deadline() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = thread::spawn(move || {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            stream
                .write_all(b"GET /callback?code=x&state=s-1 HTTP/1.1\r\nHost: x\r\n\r\n")
                .unwrap();
            thread::sleep(Duration::from_millis(300));
        });
        let (mut server_side, _) = listener.accept().unwrap();
        let started = Instant::now();
        let head = read_head_within(
            &mut server_side,
            Duration::from_secs(2),
            Duration::from_secs(5),
        )
        .unwrap();
        assert!(started.elapsed() < Duration::from_millis(250));
        assert_eq!(request_target(&head).unwrap(), "/callback?code=x&state=s-1");
        client.join().unwrap();
    }

    #[test]
    fn a_slow_client_does_not_stop_the_next_real_callback() {
        let (listener, port) = listener_on_free_port();
        let slow = thread::spawn(move || {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
            let _ = stream.write_all(b"GET /call");
            thread::sleep(Duration::from_millis(300));
        });
        thread::sleep(Duration::from_millis(100));
        let real = thread::spawn(move || send_get(port, "/callback?code=the-code&state=s-1"));
        let code = serve_until_callback(&listener, "s-1", Duration::from_secs(15)).unwrap();
        assert_eq!(code, "the-code");
        slow.join().unwrap();
        assert!(real.join().unwrap().starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn times_out_without_a_callback() {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let listener = LoopbackListener::new(socket, Owner::Webview);
        let error = serve_until_callback(&listener, "s-1", Duration::from_millis(120)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Timeout);
    }

    #[test]
    fn cancellation_stops_the_wait() {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let listener = LoopbackListener::new(socket, Owner::Webview);
        listener.cancelled.store(true, Ordering::SeqCst);
        let error = serve_until_callback(&listener, "s-1", Duration::from_secs(5)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Cancelled);
    }

    fn fresh_listener() -> LoopbackListener {
        LoopbackListener::new(
            TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap(),
            Owner::Webview,
        )
    }

    #[test]
    fn at_most_two_listeners_are_open_at_once() {
        let registry = LoopbackRegistry::default();
        let first = registry.insert(fresh_listener()).unwrap();
        registry.insert(fresh_listener()).unwrap();
        let error = registry.insert(fresh_listener()).unwrap_err();
        assert_eq!(error.kind, ErrorKind::TooManyProcesses);
        registry.remove(&first);
        assert!(registry.insert(fresh_listener()).is_ok());
    }

    #[test]
    fn a_listener_can_be_awaited_only_once_and_still_cancelled() {
        let registry = LoopbackRegistry::default();
        let id = registry.insert(fresh_listener()).unwrap();
        let waiting = registry.claim(&id, Owner::Webview).unwrap();
        assert!(registry.claim(&id, Owner::Webview).is_err());
        assert!(registry.claim("unknown", Owner::Webview).is_err());
        registry
            .get(&id)
            .unwrap()
            .cancelled
            .store(true, Ordering::SeqCst);
        assert!(waiting.cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn the_webview_commands_cannot_wait_on_or_cancel_an_internal_listener() {
        let registry = LoopbackRegistry::default();
        let internal = open_internal_listener(&registry).unwrap();
        let waited = tauri::async_runtime::block_on(await_code(
            &registry,
            &internal.id,
            "s-1".into(),
            Some(100),
        ))
        .unwrap_err();
        assert_eq!(waited.kind, ErrorKind::Policy);
        let cancelled = cancel_listener(&registry, &internal.id).unwrap_err();
        assert_eq!(cancelled.kind, ErrorKind::Policy);
        let kept = registry.get(&internal.id).unwrap();
        assert!(!kept.claimed.load(Ordering::SeqCst));
        assert!(!kept.cancelled.load(Ordering::SeqCst));
        drop(kept);
        let client = thread::spawn(move || send_get(internal.port, "/callback?code=c-1&state=s-1"));
        let code = tauri::async_runtime::block_on(await_internal_code(
            &registry,
            &internal.id,
            "s-1".into(),
            Some(5_000),
        ))
        .unwrap();
        assert_eq!(code, "c-1");
        assert!(client.join().unwrap().starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn the_webview_flow_still_waits_on_and_cancels_its_own_listeners() {
        let registry = LoopbackRegistry::default();
        let public = open_listener(&registry).unwrap();
        let client = thread::spawn(move || send_get(public.port, "/callback?code=c-2&state=s-2"));
        let code = tauri::async_runtime::block_on(await_code(
            &registry,
            &public.id,
            "s-2".into(),
            Some(5_000),
        ))
        .unwrap();
        assert_eq!(code, "c-2");
        assert!(client.join().unwrap().starts_with("HTTP/1.1 200"));
        let other = open_listener(&registry).unwrap();
        cancel_listener(&registry, &other.id).unwrap();
        assert!(registry.get(&other.id).is_none());
        cancel_listener(&registry, "unknown").unwrap();
        cancel_internal_listener(&registry, &open_listener(&registry).unwrap().id);
        assert_eq!(registry.listeners.lock().unwrap().len(), 1);
    }
}

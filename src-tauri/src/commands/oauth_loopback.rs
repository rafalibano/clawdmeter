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

use super::error::{CommandError, CommandResult, ErrorKind};

const CALLBACK_PATH: &str = "/callback";
const MAX_REQUEST_BYTES: usize = 8_192;
const ACCEPT_POLL_MS: u64 = 40;
const READ_TIMEOUT_MS: u64 = 2_000;
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MAX_TIMEOUT_MS: u64 = 600_000;
const LISTENER_TTL_MS: u64 = MAX_TIMEOUT_MS + 5_000;

type ListenerMap = Arc<Mutex<HashMap<String, Arc<LoopbackListener>>>>;

pub struct LoopbackListener {
    socket: TcpListener,
    cancelled: AtomicBool,
}

#[derive(Default)]
pub struct LoopbackRegistry {
    next_id: AtomicU64,
    listeners: ListenerMap,
}

impl LoopbackRegistry {
    fn insert(&self, listener: LoopbackListener) -> String {
        self.insert_with_ttl(listener, Duration::from_millis(LISTENER_TTL_MS))
    }

    fn insert_with_ttl(&self, listener: LoopbackListener, ttl: Duration) -> String {
        let id = (self.next_id.fetch_add(1, Ordering::SeqCst) + 1).to_string();
        let shared = Arc::new(listener);
        if let Ok(mut listeners) = self.listeners.lock() {
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
        id
    }

    fn get(&self, id: &str) -> Option<Arc<LoopbackListener>> {
        self.listeners.lock().ok().and_then(|listeners| listeners.get(id).cloned())
    }

    fn remove(&self, id: &str) {
        if let Ok(mut listeners) = self.listeners.lock() {
            listeners.remove(id);
        }
    }
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
        _ => Err(CommandError::new(ErrorKind::InvalidArgument, "requisição de callback inválida")),
    }
}

fn same_state(expected: &str, received: &str) -> bool {
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
    let base = Url::parse("http://127.0.0.1").map_err(CommandError::io)?;
    let url = base
        .join(target)
        .map_err(|_| CommandError::new(ErrorKind::InvalidArgument, "callback com URL inválida"))?;
    if url.path() != CALLBACK_PATH {
        return Ok(CallbackOutcome::NotCallback);
    }
    let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let state_ok = query
        .get("state")
        .map(|received| !expected_state.is_empty() && same_state(expected_state, received))
        .unwrap_or(false);
    if !state_ok {
        return Err(CommandError::new(ErrorKind::StateMismatch, "state do callback não confere"));
    }
    if let Some(error) = query.get("error") {
        let detail = query.get("error_description").map(String::as_str).unwrap_or(error.as_str());
        return Err(CommandError::new(ErrorKind::ProviderError, format!("{error}: {detail}")));
    }
    match query.get("code").filter(|code| !code.is_empty()) {
        Some(code) => Ok(CallbackOutcome::Code(code.clone())),
        None => Err(CommandError::new(ErrorKind::ProviderError, "callback sem code")),
    }
}

fn page(status: &str, title: &str) -> String {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Dev Pulse</title><body style=\"font-family:-apple-system,Segoe UI,sans-serif;text-align:center;margin-top:20vh\"><h2>{title}</h2><p>Você já pode fechar esta janela.</p></body>"
    );
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    )
}

fn read_head(stream: &mut TcpStream) -> Option<String> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(READ_TIMEOUT_MS))).ok()?;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    while buffer.len() < MAX_REQUEST_BYTES && !buffer.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            Err(_) => break,
        }
    }
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

fn reply(stream: &mut TcpStream, response: &str) {
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn serve_until_callback(listener: &LoopbackListener, expected_state: &str, limit: Duration) -> CommandResult<String> {
    listener.socket.set_nonblocking(true).map_err(CommandError::io)?;
    let started = Instant::now();
    loop {
        if listener.cancelled.load(Ordering::SeqCst) {
            return Err(CommandError::new(ErrorKind::Cancelled, "login cancelado"));
        }
        if started.elapsed() >= limit {
            return Err(CommandError::new(ErrorKind::Timeout, "tempo esgotado aguardando o login"));
        }
        let mut stream = match listener.socket.accept() {
            Ok((stream, _)) => stream,
            Err(error) if error.kind() == IoErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(ACCEPT_POLL_MS));
                continue;
            }
            Err(error) => return Err(CommandError::io(error)),
        };
        let Some(head) = read_head(&mut stream) else {
            continue;
        };
        let outcome = request_target(&head).and_then(|target| evaluate_callback(&target, expected_state));
        match outcome {
            Ok(CallbackOutcome::Code(code)) => {
                reply(&mut stream, &page("200 OK", "Login concluído"));
                return Ok(code);
            }
            Ok(CallbackOutcome::NotCallback) => reply(&mut stream, &page("404 Not Found", "Não encontrado")),
            Err(error) if error.kind == ErrorKind::InvalidArgument => {
                reply(&mut stream, &page("400 Bad Request", "Requisição inválida"));
            }
            Err(error) => {
                reply(&mut stream, &page("400 Bad Request", "Login não concluído"));
                return Err(error);
            }
        }
    }
}

#[tauri::command(async)]
pub fn oauth_loopback_listen(registry: State<LoopbackRegistry>) -> CommandResult<ListenInfo> {
    let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(CommandError::io)?;
    let port = socket.local_addr().map_err(CommandError::io)?.port();
    let id = registry.insert(LoopbackListener {
        socket,
        cancelled: AtomicBool::new(false),
    });
    Ok(ListenInfo { id, port })
}

#[tauri::command(async)]
pub fn oauth_loopback_wait(
    registry: State<LoopbackRegistry>,
    id: String,
    expected_state: String,
    timeout_ms: Option<u64>,
) -> CommandResult<CallbackResult> {
    let listener = registry
        .get(&id)
        .ok_or_else(|| CommandError::new(ErrorKind::InvalidArgument, "listener desconhecido"))?;
    let limit = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS));
    let result = serve_until_callback(&listener, &expected_state, limit);
    registry.remove(&id);
    result.map(|code| CallbackResult { code })
}

#[tauri::command(async)]
pub fn oauth_loopback_cancel(registry: State<LoopbackRegistry>, id: String) {
    if let Some(listener) = registry.get(&id) {
        listener.cancelled.store(true, Ordering::SeqCst);
    }
    registry.remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_target_from_a_get_request() {
        let head = "GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(request_target(head).unwrap(), "/callback?code=abc&state=xyz");
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
            "/callback?error=access_denied&error_description=usu%C3%A1rio%20negou&state=s-1",
            "s-1",
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::ProviderError);
        assert!(error.message.contains("access_denied"));
        assert!(error.message.contains("usuário negou"));
    }

    #[test]
    fn requires_a_code() {
        let error = evaluate_callback("/callback?state=s-1", "s-1").unwrap_err();
        assert_eq!(error.kind, ErrorKind::ProviderError);
    }

    #[test]
    fn other_paths_are_not_callbacks() {
        assert_eq!(evaluate_callback("/favicon.ico", "s-1").unwrap(), CallbackOutcome::NotCallback);
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
        let id = registry.insert_with_ttl(
            LoopbackListener {
                socket,
                cancelled: AtomicBool::new(false),
            },
            Duration::from_millis(60),
        );
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
        let id = registry.insert_with_ttl(
            LoopbackListener {
                socket,
                cancelled: AtomicBool::new(false),
            },
            Duration::from_secs(60),
        );
        registry.remove(&id);
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
    }

    #[test]
    fn serves_a_real_callback_over_loopback() {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        let listener = LoopbackListener {
            socket,
            cancelled: AtomicBool::new(false),
        };
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

    #[test]
    fn times_out_without_a_callback() {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let listener = LoopbackListener {
            socket,
            cancelled: AtomicBool::new(false),
        };
        let error = serve_until_callback(&listener, "s-1", Duration::from_millis(120)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Timeout);
    }

    #[test]
    fn cancellation_stops_the_wait() {
        let socket = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let listener = LoopbackListener {
            socket,
            cancelled: AtomicBool::new(true),
        };
        let error = serve_until_callback(&listener, "s-1", Duration::from_secs(5)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Cancelled);
    }
}

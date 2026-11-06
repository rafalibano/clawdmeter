use std::collections::HashMap;
use std::io::{ErrorKind as IoErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use super::error::{CommandError, CommandResult, ErrorKind};
use super::secrets::{CachedStore, SecretBackend};

pub struct Gate {
    arrived: Receiver<()>,
    release: Sender<()>,
}

impl Gate {
    pub fn wait_for_request(&self) {
        self.arrived
            .recv_timeout(Duration::from_secs(10))
            .expect("the gated request never arrived");
    }

    pub fn release(&self) {
        let _ = self.release.send(());
    }
}

pub struct TestServer {
    pub url: String,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<Vec<String>>>,
}

impl TestServer {
    pub fn start(path: &str, responses: Vec<String>) -> Self {
        Self::spawn(path, responses, None)
    }

    pub fn gated(path: &str, responses: Vec<String>) -> (Self, Gate) {
        let (arrived_tx, arrived) = channel();
        let (release, release_rx) = channel();
        let server = Self::spawn(path, responses, Some((arrived_tx, release_rx)));
        (server, Gate { arrived, release })
    }

    fn spawn(path: &str, responses: Vec<String>, gate: Option<(Sender<()>, Receiver<()>)>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!(
            "http://127.0.0.1:{}{path}",
            listener.local_addr().unwrap().port()
        );
        let stop = Arc::new(AtomicBool::new(false));
        let running = Arc::clone(&stop);
        let handle = thread::spawn(move || {
            let mut seen = Vec::new();
            while !running.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let request = read_request(&mut stream);
                        if let (true, Some((arrived, release))) = (seen.is_empty(), &gate) {
                            let _ = arrived.send(());
                            let _ = release.recv();
                        }
                        let response = responses
                            .get(seen.len())
                            .or(responses.last())
                            .cloned()
                            .unwrap_or_default();
                        seen.push(request);
                        let _ = stream.write_all(response.as_bytes());
                    }
                    Err(error) if error.kind() == IoErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(_) => break,
                }
            }
            seen
        });
        Self {
            url,
            stop,
            handle: Some(handle),
        }
    }

    pub fn json(path: &str, status_line: &str, body: &str) -> Self {
        Self::start(path, vec![json_response(status_line, body)])
    }

    pub fn requests(mut self) -> Vec<String> {
        self.stop.store(true, Ordering::SeqCst);
        self.handle
            .take()
            .map(|handle| handle.join().unwrap())
            .unwrap_or_default()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

pub fn json_response(status_line: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn read_request(stream: &mut TcpStream) -> String {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break end + 4;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return String::from_utf8_lossy(&buffer).into_owned(),
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).to_lowercase();
    let length = head
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    while buffer.len() < head_end + length {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    }
    String::from_utf8_lossy(&buffer).into_owned()
}

#[derive(Default)]
pub struct MemoryStore {
    entries: Mutex<HashMap<String, String>>,
    failing_writes: Mutex<usize>,
    reads: AtomicUsize,
}

impl MemoryStore {
    pub fn leaked() -> &'static Self {
        Box::leak(Box::default())
    }

    pub fn fail_next_writes(&self, count: usize) {
        *self.failing_writes.lock().unwrap() = count;
    }

    pub fn keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self.entries.lock().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    }

    pub fn reads(&self) -> usize {
        self.reads.load(Ordering::SeqCst)
    }

    pub fn cached() -> &'static CachedStore<MemoryStore> {
        Box::leak(Box::new(CachedStore::new(MemoryStore::default())))
    }
}

impl SecretBackend for MemoryStore {
    fn read(&self, key: &str) -> CommandResult<Option<String>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        Ok(self.entries.lock().unwrap().get(key).cloned())
    }

    fn write(&self, key: &str, value: &str) -> CommandResult<()> {
        let mut failing = self.failing_writes.lock().unwrap();
        if *failing > 0 {
            *failing -= 1;
            return Err(CommandError::new(
                ErrorKind::Keychain,
                "keychain write failed",
            ));
        }
        drop(failing);
        self.entries
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn remove(&self, key: &str) -> CommandResult<()> {
        self.entries.lock().unwrap().remove(key);
        Ok(())
    }
}

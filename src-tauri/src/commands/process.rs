use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::error::{CommandError, CommandResult, ErrorKind};
use super::process_policy::{home_dir, validate_cwd, validate_invocation, validate_program};

const DEFAULT_RUN_TIMEOUT_MS: u64 = 15_000;
const MAX_RUN_TIMEOUT_MS: u64 = 120_000;
const POLL_INTERVAL_MS: u64 = 25;
const READER_JOIN_LIMIT_MS: u64 = 2_000;
pub const OUTPUT_EVENT: &str = "process-output";
pub const EXIT_EVENT: &str = "process-exit";

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct ProcessRegistry(Mutex<HashSet<u32>>);

impl ProcessRegistry {
    fn insert(&self, pid: u32) {
        if let Ok(mut pids) = self.0.lock() {
            pids.insert(pid);
        }
    }

    fn remove(&self, pid: u32) {
        if let Ok(mut pids) = self.0.lock() {
            pids.remove(&pid);
        }
    }

    fn contains(&self, pid: u32) -> bool {
        self.0.lock().map(|pids| pids.contains(&pid)).unwrap_or(false)
    }

    fn drain(&self) -> Vec<u32> {
        self.0.lock().map(|mut pids| pids.drain().collect()).unwrap_or_default()
    }

    pub fn terminate_all(&self) {
        for pid in self.drain() {
            let _ = terminate(pid, true);
        }
    }
}

#[derive(Debug, Serialize)]
pub struct RunOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize)]
struct OutputEvent {
    pid: u32,
    stream: &'static str,
    line: String,
}

#[derive(Debug, Clone, Serialize)]
struct ExitEvent {
    pid: u32,
    code: Option<i32>,
}

pub fn candidate_paths(program: &str, path_var: Option<&str>, home: Option<&Path>, windows: bool) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = path_var
        .map(|value| {
            std::env::split_paths(value)
                .filter(|dir| !dir.as_os_str().is_empty())
                .collect()
        })
        .unwrap_or_default();
    if windows {
        if let Some(home) = home {
            dirs.push(home.join("AppData").join("Roaming").join("npm"));
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".claude").join("local"));
        }
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
        if let Some(home) = home {
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".claude").join("local"));
            dirs.push(home.join(".npm-global").join("bin"));
        }
    }
    let names: Vec<String> = if windows {
        vec![format!("{program}.exe"), format!("{program}.cmd")]
    } else {
        vec![program.to_string()]
    };
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for dir in dirs {
        for name in &names {
            let candidate = dir.join(name);
            if seen.insert(candidate.clone()) {
                result.push(candidate);
            }
        }
    }
    result
}

fn resolve_program(program: &str) -> CommandResult<PathBuf> {
    let program = validate_program(program)?;
    let home = home_dir();
    let path_var = std::env::var("PATH").ok();
    candidate_paths(program, path_var.as_deref(), home.as_deref(), cfg!(windows))
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| CommandError::new(ErrorKind::ProgramNotFound, format!("{program} não encontrado")))
}

fn build_command(program: &str, args: &[String], cwd: Option<&str>) -> CommandResult<Command> {
    validate_invocation(program, args)?;
    let home = home_dir();
    let effective = cwd
        .map(str::to_string)
        .or_else(|| home.as_ref().map(|dir| dir.to_string_lossy().into_owned()));
    let dir = validate_cwd(effective.as_deref(), home.as_deref())?;
    let mut command = Command::new(resolve_program(program)?);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(command)
}

fn join_with_limit<T>(handle: thread::JoinHandle<T>, limit: Duration) -> Option<T> {
    let started = Instant::now();
    while !handle.is_finished() {
        if started.elapsed() >= limit {
            return None;
        }
        thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
    }
    handle.join().ok()
}

struct Capture {
    buffer: Arc<Mutex<Vec<u8>>>,
    reader: thread::JoinHandle<()>,
}

impl Capture {
    fn start(mut source: impl Read + Send + 'static) -> Self {
        let buffer = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&buffer);
        let reader = thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            while let Ok(read) = source.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                if let Ok(mut bytes) = sink.lock() {
                    bytes.extend_from_slice(&chunk[..read]);
                }
            }
        });
        Self { buffer, reader }
    }

    fn finish(self) -> String {
        self.finish_within(Duration::from_millis(READER_JOIN_LIMIT_MS))
    }

    fn finish_within(self, limit: Duration) -> String {
        let _ = join_with_limit(self.reader, limit);
        let bytes = self.buffer.lock().map(|bytes| bytes.clone()).unwrap_or_default();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

#[tauri::command(async)]
pub fn process_run(program: String, args: Vec<String>, timeout_ms: Option<u64>) -> CommandResult<RunOutput> {
    let mut child = build_command(&program, &args, None)?
        .spawn()
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))?;
    let stdout = child.stdout.take().map(Capture::start);
    let stderr = child.stderr.take().map(Capture::start);
    let limit = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_RUN_TIMEOUT_MS).min(MAX_RUN_TIMEOUT_MS));
    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(CommandError::io)? {
            Some(status) => break status,
            None if started.elapsed() >= limit => {
                let _ = terminate(child.id(), true);
                let _ = child.kill();
                let _ = child.wait();
                for capture in [stdout, stderr].into_iter().flatten() {
                    let _ = capture.finish();
                }
                return Err(CommandError::new(ErrorKind::Timeout, format!("{program} excedeu o tempo limite")));
            }
            None => thread::sleep(Duration::from_millis(POLL_INTERVAL_MS)),
        }
    };
    Ok(RunOutput {
        code: status.code(),
        stdout: stdout.map(Capture::finish).unwrap_or_default(),
        stderr: stderr.map(Capture::finish).unwrap_or_default(),
    })
}

fn stream_lines(app: AppHandle, pid: u32, stream: &'static str, source: impl Read + Send + 'static) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(source).lines().map_while(Result::ok) {
            let _ = app.emit(OUTPUT_EVENT, OutputEvent { pid, stream, line });
        }
    })
}

fn watch_exit(app: AppHandle, mut child: Child, pid: u32, readers: Vec<thread::JoinHandle<()>>) {
    thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code());
        for reader in readers {
            let _ = join_with_limit(reader, Duration::from_millis(READER_JOIN_LIMIT_MS));
        }
        if let Some(registry) = tauri::Manager::try_state::<ProcessRegistry>(&app) {
            registry.remove(pid);
        }
        let _ = app.emit(EXIT_EVENT, ExitEvent { pid, code });
    });
}

#[tauri::command(async)]
pub fn process_spawn(
    app: AppHandle,
    registry: State<ProcessRegistry>,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> CommandResult<u32> {
    let mut child = build_command(&program, &args, cwd.as_deref())?
        .spawn()
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))?;
    let pid = child.id();
    registry.insert(pid);
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(stream_lines(app.clone(), pid, "stdout", out));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(stream_lines(app.clone(), pid, "stderr", err));
    }
    watch_exit(app, child, pid, readers);
    Ok(pid)
}

#[tauri::command(async)]
pub fn process_kill(registry: State<ProcessRegistry>, pid: u32) -> CommandResult<()> {
    kill_registered(&registry, pid)
}

fn kill_registered(registry: &ProcessRegistry, pid: u32) -> CommandResult<()> {
    if !registry.contains(pid) {
        return Ok(());
    }
    terminate(pid, false)
}

#[cfg(unix)]
fn terminate(pid: u32, force: bool) -> CommandResult<()> {
    let target = pid as i32;
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    let group = unsafe { libc::kill(-target, signal) };
    if group == 0 {
        return Ok(());
    }
    let single = unsafe { libc::kill(target, signal) };
    if single == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(CommandError::io(error))
    }
}

#[cfg(windows)]
fn terminate(pid: u32, _force: bool) -> CommandResult<()> {
    use std::os::windows::process::CommandExt;
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(CommandError::io)?;
    if status.success() {
        Ok(())
    } else {
        Err(CommandError::new(ErrorKind::Io, "taskkill falhou"))
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn tasklist_lists_pid(output: &str, pid: u32) -> bool {
    output.lines().any(|line| {
        line.split("\",\"")
            .nth(1)
            .map(|field| field.trim_matches('"').trim() == pid.to_string())
            .unwrap_or(false)
    })
}

#[cfg(unix)]
fn is_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as i32, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn is_alive(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|output| tasklist_lists_pid(&String::from_utf8_lossy(&output.stdout), pid))
        .unwrap_or(false)
}

#[tauri::command(async)]
pub fn process_is_alive(pid: u32) -> bool {
    pid != 0 && is_alive(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_candidates_include_path_homebrew_and_home() {
        let paths = candidate_paths("gh", Some("/custom/bin:/usr/bin"), Some(Path::new("/Users/dev")), false);
        assert_eq!(paths[0], PathBuf::from("/custom/bin/gh"));
        assert!(paths.contains(&PathBuf::from("/opt/homebrew/bin/gh")));
        assert!(paths.contains(&PathBuf::from("/Users/dev/.local/bin/gh")));
        let usr_bin = paths.iter().filter(|path| **path == PathBuf::from("/usr/bin/gh")).count();
        assert_eq!(usr_bin, 1);
    }

    #[test]
    fn windows_candidates_try_exe_and_cmd() {
        let paths = candidate_paths("claude", None, Some(Path::new("C:\\Users\\dev")), true);
        let names: Vec<String> = paths
            .iter()
            .filter_map(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
            .collect();
        assert!(names.contains(&"claude.exe".to_string()));
        assert!(names.contains(&"claude.cmd".to_string()));
    }

    #[test]
    fn tasklist_output_is_parsed_for_the_pid() {
        let listed = "\"node.exe\",\"4242\",\"Console\",\"1\",\"50.000 K\"\r\n";
        assert!(tasklist_lists_pid(listed, 4242));
        assert!(!tasklist_lists_pid(listed, 42));
        let none = "INFO: No tasks are running which match the specified criteria.\r\n";
        assert!(!tasklist_lists_pid(none, 4242));
    }

    #[test]
    fn capture_returns_partial_output_when_the_pipe_stays_open() {
        struct HeldOpen(bool);
        impl Read for HeldOpen {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if self.0 {
                    thread::sleep(Duration::from_secs(5));
                    return Ok(0);
                }
                self.0 = true;
                buf[..5].copy_from_slice(b"parte");
                Ok(5)
            }
        }
        let started = Instant::now();
        let capture = Capture::start(HeldOpen(false));
        thread::sleep(Duration::from_millis(100));
        assert_eq!(capture.finish_within(Duration::from_millis(200)), "parte");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn join_with_limit_gives_up_on_a_stuck_thread() {
        let stuck = thread::spawn(|| thread::sleep(Duration::from_secs(3)));
        assert!(join_with_limit(stuck, Duration::from_millis(100)).is_none());
        let quick = thread::spawn(|| 7);
        assert_eq!(join_with_limit(quick, Duration::from_secs(1)), Some(7));
    }

    #[cfg(unix)]
    #[test]
    fn forced_terminate_kills_the_whole_process_group() {
        use std::os::unix::process::{CommandExt, ExitStatusExt};
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 30 & wait"])
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id();
        thread::sleep(Duration::from_millis(150));
        terminate(pid, true).unwrap();
        let status = child.wait().unwrap();
        assert_eq!(status.signal(), Some(libc::SIGKILL));
        thread::sleep(Duration::from_millis(100));
        let group_alive = unsafe { libc::kill(-(pid as i32), 0) } == 0;
        assert!(!group_alive);
    }

    #[cfg(unix)]
    #[test]
    fn current_process_is_alive_and_pid_zero_is_not() {
        assert!(is_alive(std::process::id()));
        assert!(!process_is_alive(0));
    }

    #[test]
    fn killing_a_pid_this_app_never_started_is_a_noop() {
        let registry = ProcessRegistry::default();
        assert!(kill_registered(&registry, std::process::id()).is_ok());
        assert!(kill_registered(&registry, 0).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn killing_an_already_exited_registered_pid_is_ignored() {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("/bin/sh").args(["-c", "exit 0"]).process_group(0).spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        let registry = ProcessRegistry::default();
        registry.insert(pid);
        assert!(kill_registered(&registry, pid).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn terminate_all_kills_every_registered_group_and_empties_the_registry() {
        use std::os::unix::process::{CommandExt, ExitStatusExt};
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 30 & wait"])
            .process_group(0)
            .spawn()
            .unwrap();
        let registry = ProcessRegistry::default();
        registry.insert(child.id());
        thread::sleep(Duration::from_millis(150));
        registry.terminate_all();
        assert_eq!(child.wait().unwrap().signal(), Some(libc::SIGKILL));
        assert!(!registry.contains(child.id()));
    }

    #[test]
    fn registry_tracks_only_inserted_pids() {
        let registry = ProcessRegistry::default();
        registry.insert(10);
        assert!(registry.contains(10));
        registry.remove(10);
        assert!(!registry.contains(10));
    }
}

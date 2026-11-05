use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};
use super::home::{home_dir, protected_dirs, skill_workdir};
use super::process_policy::{prepare_invocation, resolve_working_dir, validate_program, GH_ENV};

const DEFAULT_RUN_TIMEOUT_MS: u64 = 15_000;
const MAX_RUN_TIMEOUT_MS: u64 = 120_000;
const POLL_INTERVAL_MS: u64 = 25;
const READER_JOIN_LIMIT_MS: u64 = 2_000;
const MAX_CONCURRENT_PROCESSES: usize = 4;
const MAX_CAPTURE_BYTES: usize = 1_048_576;
const MAX_STDOUT_LINE_BYTES: usize = 4_194_304;
const MAX_STDERR_LINE_BYTES: usize = 65_536;
const CAPTURE_TRUNCATED_MARK: &str = "\n[output truncated]";
const LINE_TRUNCATED_MARK: &str = " …[line truncated]";
pub const OUTPUT_EVENT: &str = "process-output";
pub const EXIT_EVENT: &str = "process-exit";

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slot {
    Running,
    Exiting,
}

#[derive(Default)]
pub struct ProcessRegistry(Mutex<HashMap<u32, Slot>>);

impl ProcessRegistry {
    fn ensure_capacity(&self) -> CommandResult<()> {
        let full = self
            .0
            .lock()
            .map(|slots| slots.len() >= MAX_CONCURRENT_PROCESSES)
            .unwrap_or(true);
        if full {
            Err(too_many_processes())
        } else {
            Ok(())
        }
    }

    fn insert(&self, pid: u32) -> CommandResult<()> {
        let mut slots = self.0.lock().map_err(|_| too_many_processes())?;
        if slots.len() >= MAX_CONCURRENT_PROCESSES {
            return Err(too_many_processes());
        }
        slots.insert(pid, Slot::Running);
        Ok(())
    }

    fn mark_exiting(&self, pid: u32) {
        if let Ok(mut slots) = self.0.lock() {
            if let Some(slot) = slots.get_mut(&pid) {
                *slot = Slot::Exiting;
            }
        }
    }

    fn remove(&self, pid: u32) {
        if let Ok(mut slots) = self.0.lock() {
            slots.remove(&pid);
        }
    }

    #[cfg(test)]
    fn is_running(&self, pid: u32) -> bool {
        self.0
            .lock()
            .map(|slots| slots.get(&pid) == Some(&Slot::Running))
            .unwrap_or(false)
    }

    fn signal_if_running(
        &self,
        pid: u32,
        send: impl FnOnce() -> CommandResult<()>,
    ) -> CommandResult<()> {
        let Ok(slots) = self.0.lock() else {
            return Ok(());
        };
        if slots.get(&pid) == Some(&Slot::Running) {
            send()
        } else {
            Ok(())
        }
    }

    fn drain_running(&self) -> Vec<u32> {
        self.0
            .lock()
            .map(|mut slots| {
                slots
                    .drain()
                    .filter(|(_, slot)| *slot == Slot::Running)
                    .map(|(pid, _)| pid)
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn terminate_all(&self) {
        for pid in self.drain_running() {
            let _ = terminate(pid, true);
        }
    }
}

fn too_many_processes() -> CommandError {
    CommandError::new(
        ErrorKind::TooManyProcesses,
        format!("limit of {MAX_CONCURRENT_PROCESSES} concurrent processes reached"),
    )
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

pub fn candidate_paths(
    program: &str,
    path_var: Option<&str>,
    home: Option<&Path>,
    windows: bool,
) -> Vec<PathBuf> {
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

pub fn resolve_program(program: &str) -> CommandResult<PathBuf> {
    let program = validate_program(program)?;
    let home = home_dir();
    let path_var = std::env::var("PATH").ok();
    candidate_paths(program, path_var.as_deref(), home.as_deref(), cfg!(windows))
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            CommandError::new(ErrorKind::ProgramNotFound, format!("{program} not found"))
        })
}

fn build_command(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    protected: &[PathBuf],
    default_dir: Option<&Path>,
) -> CommandResult<Command> {
    let argv = prepare_invocation(program, args)?;
    let dir = resolve_working_dir(cwd, home_dir().as_deref(), protected, default_dir)?;
    let mut command = Command::new(resolve_program(program)?);
    command
        .args(&argv)
        .envs(GH_ENV.iter().copied())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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

#[derive(Default)]
struct Captured {
    bytes: Vec<u8>,
    truncated: bool,
}

struct Capture {
    buffer: Arc<Mutex<Captured>>,
    reader: thread::JoinHandle<()>,
}

impl Capture {
    fn start(source: impl Read + Send + 'static) -> Self {
        Self::start_with_limit(source, MAX_CAPTURE_BYTES)
    }

    fn start_with_limit(mut source: impl Read + Send + 'static, limit: usize) -> Self {
        let buffer = Arc::new(Mutex::new(Captured::default()));
        let sink = Arc::clone(&buffer);
        let reader = thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            loop {
                let read = match source.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(read) => read,
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                };
                if let Ok(mut captured) = sink.lock() {
                    let room = limit.saturating_sub(captured.bytes.len());
                    let kept = read.min(room);
                    captured.bytes.extend_from_slice(&chunk[..kept]);
                    captured.truncated |= kept < read;
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
        let Ok(captured) = self.buffer.lock() else {
            return String::new();
        };
        let mut text = String::from_utf8_lossy(&captured.bytes).into_owned();
        if captured.truncated {
            text.push_str(CAPTURE_TRUNCATED_MARK);
        }
        text
    }
}

fn run_to_completion(
    program: &str,
    args: &[String],
    timeout_ms: Option<u64>,
) -> CommandResult<RunOutput> {
    if validate_program(program)? != "gh" {
        return Err(CommandError::new(
            ErrorKind::ProgramNotAllowed,
            "process_run only runs gh",
        ));
    }
    let mut child = build_command(program, args, None, &[], None)?
        .spawn()
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))?;
    let stdout = child.stdout.take().map(Capture::start);
    let stderr = child.stderr.take().map(Capture::start);
    let limit = Duration::from_millis(
        timeout_ms
            .unwrap_or(DEFAULT_RUN_TIMEOUT_MS)
            .min(MAX_RUN_TIMEOUT_MS),
    );
    let started = Instant::now();
    let status = loop {
        match child.try_wait()? {
            Some(status) => break status,
            None if started.elapsed() >= limit => {
                let _ = terminate(child.id(), true);
                let _ = child.kill();
                let _ = child.wait();
                for capture in [stdout, stderr].into_iter().flatten() {
                    let _ = capture.finish();
                }
                return Err(CommandError::new(
                    ErrorKind::Timeout,
                    format!("{program} exceeded the time limit"),
                ));
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

#[tauri::command]
pub async fn process_run(
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> CommandResult<RunOutput> {
    run_blocking(move || run_to_completion(&program, &args, timeout_ms)).await
}

fn finish_line(line: &mut Vec<u8>, truncated: &mut bool) -> String {
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    let mut text = String::from_utf8_lossy(line).into_owned();
    if *truncated {
        text.push_str(LINE_TRUNCATED_MARK);
    }
    line.clear();
    *truncated = false;
    text
}

fn read_bounded_lines(source: impl Read, max: usize, mut emit: impl FnMut(String)) {
    let mut reader = BufReader::new(source);
    let mut line: Vec<u8> = Vec::new();
    let mut truncated = false;
    loop {
        let (consumed, complete) = match reader.fill_buf() {
            Ok([]) => break,
            Ok(chunk) => {
                let end = chunk.iter().position(|byte| *byte == b'\n');
                let piece = &chunk[..end.unwrap_or(chunk.len())];
                let kept = piece.len().min(max.saturating_sub(line.len()));
                truncated |= kept < piece.len();
                line.extend_from_slice(&piece[..kept]);
                (end.map_or(chunk.len(), |index| index + 1), end.is_some())
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        reader.consume(consumed);
        if complete {
            emit(finish_line(&mut line, &mut truncated));
        }
    }
    if !line.is_empty() || truncated {
        emit(finish_line(&mut line, &mut truncated));
    }
}

fn stream_lines(
    app: AppHandle,
    pid: u32,
    stream: &'static str,
    source: impl Read + Send + 'static,
    max_line: usize,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        read_bounded_lines(source, max_line, |line| {
            let _ = app.emit(OUTPUT_EVENT, OutputEvent { pid, stream, line });
        });
    })
}

#[cfg(unix)]
fn wait_until_exited(pid: u32) {
    loop {
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOWAIT,
            )
        };
        if result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::EINTR) {
            return;
        }
    }
}

fn reap(child: &mut Child, registry: &ProcessRegistry) -> Option<i32> {
    let pid = child.id();
    #[cfg(unix)]
    {
        wait_until_exited(pid);
        registry.mark_exiting(pid);
        child.wait().ok().and_then(|status| status.code())
    }
    #[cfg(not(unix))]
    {
        let code = child.wait().ok().and_then(|status| status.code());
        registry.mark_exiting(pid);
        code
    }
}

fn watch_exit(app: AppHandle, mut child: Child, pid: u32, readers: Vec<thread::JoinHandle<()>>) {
    thread::spawn(move || {
        let registry = app.try_state::<ProcessRegistry>();
        let code = match &registry {
            Some(registry) => reap(&mut child, registry),
            None => child.wait().ok().and_then(|status| status.code()),
        };
        for reader in readers {
            let _ = join_with_limit(reader, Duration::from_millis(READER_JOIN_LIMIT_MS));
        }
        if let Some(registry) = registry {
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
    registry.ensure_capacity()?;
    let protected = protected_dirs(&app)?;
    let workdir = skill_workdir(&app)?;
    let mut child = build_command(&program, &args, cwd.as_deref(), &protected, Some(&workdir))?
        .spawn()
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))?;
    let pid = child.id();
    if let Err(error) = registry.insert(pid) {
        let _ = terminate(pid, true);
        let _ = child.wait();
        return Err(error);
    }
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(stream_lines(
            app.clone(),
            pid,
            "stdout",
            out,
            MAX_STDOUT_LINE_BYTES,
        ));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(stream_lines(
            app.clone(),
            pid,
            "stderr",
            err,
            MAX_STDERR_LINE_BYTES,
        ));
    }
    watch_exit(app, child, pid, readers);
    Ok(pid)
}

#[tauri::command]
pub async fn process_kill(app: AppHandle, pid: u32) -> CommandResult<()> {
    run_blocking(move || kill_registered(&app.state::<ProcessRegistry>(), pid)).await
}

fn kill_registered(registry: &ProcessRegistry, pid: u32) -> CommandResult<()> {
    registry.signal_if_running(pid, || terminate(pid, false))
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
        Err(error.into())
    }
}

#[cfg(windows)]
fn terminate(pid: u32, _force: bool) -> CommandResult<()> {
    use std::os::windows::process::CommandExt;
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(CommandError::new(ErrorKind::Io, "taskkill failed"))
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

#[tauri::command]
pub async fn process_is_alive(pid: u32) -> bool {
    pid != 0
        && tauri::async_runtime::spawn_blocking(move || is_alive(pid))
            .await
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_candidates_include_path_homebrew_and_home() {
        let paths = candidate_paths(
            "gh",
            Some("/custom/bin:/usr/bin"),
            Some(Path::new("/Users/dev")),
            false,
        );
        assert_eq!(paths[0], PathBuf::from("/custom/bin/gh"));
        assert!(paths.contains(&PathBuf::from("/opt/homebrew/bin/gh")));
        assert!(paths.contains(&PathBuf::from("/Users/dev/.local/bin/gh")));
        let usr_bin = paths
            .iter()
            .filter(|path| path.as_path() == Path::new("/usr/bin/gh"))
            .count();
        assert_eq!(usr_bin, 1);
    }

    #[test]
    fn windows_candidates_try_exe_and_cmd() {
        let paths = candidate_paths("claude", None, Some(Path::new("C:\\Users\\dev")), true);
        let names: Vec<String> = paths
            .iter()
            .filter_map(|path| {
                path.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
            })
            .collect();
        assert!(names.contains(&"claude.exe".to_string()));
        assert!(names.contains(&"claude.cmd".to_string()));
    }

    #[test]
    fn process_run_refuses_claude_and_anything_but_gh() {
        for program in ["claude", "rm", "bash"] {
            let error = run_to_completion(program, &[], None).unwrap_err();
            assert_eq!(error.kind, ErrorKind::ProgramNotAllowed, "{program}");
        }
        let claude_print = [
            "-p",
            "oi",
            "--output-format",
            "stream-json",
            "--max-budget-usd",
            "1",
        ]
        .map(String::from);
        assert_eq!(
            run_to_completion("claude", &claude_print, None)
                .unwrap_err()
                .kind,
            ErrorKind::ProgramNotAllowed
        );
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
        assert!(!tauri::async_runtime::block_on(process_is_alive(0)));
        assert!(tauri::async_runtime::block_on(process_is_alive(
            std::process::id()
        )));
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
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id();
        child.wait().unwrap();
        let registry = ProcessRegistry::default();
        registry.insert(pid).unwrap();
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
        registry.insert(child.id()).unwrap();
        thread::sleep(Duration::from_millis(150));
        registry.terminate_all();
        assert_eq!(child.wait().unwrap().signal(), Some(libc::SIGKILL));
        assert!(!registry.is_running(child.id()));
    }

    #[test]
    fn registry_tracks_only_inserted_pids() {
        let registry = ProcessRegistry::default();
        registry.insert(10).unwrap();
        assert!(registry.is_running(10));
        registry.remove(10);
        assert!(!registry.is_running(10));
    }
    #[test]
    fn capture_keeps_at_most_the_limit_marks_the_cut_and_keeps_draining() {
        let source = std::io::repeat(b'a').take(50_000);
        let capture = Capture::start_with_limit(source, 100);
        let text = capture.finish_within(Duration::from_secs(5));
        assert_eq!(text, format!("{}{CAPTURE_TRUNCATED_MARK}", "a".repeat(100)));
    }

    #[test]
    fn capture_keeps_reading_after_an_interrupted_read() {
        struct Flaky(u8);
        impl Read for Flaky {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.0 += 1;
                match self.0 {
                    1 | 3 => Err(std::io::ErrorKind::Interrupted.into()),
                    2 => {
                        buf[..4].copy_from_slice(b"ab\ncd"[..4].as_ref());
                        Ok(4)
                    }
                    4 => {
                        buf[..2].copy_from_slice(b"ef");
                        Ok(2)
                    }
                    _ => Ok(0),
                }
            }
        }
        let text = Capture::start(Flaky(0)).finish_within(Duration::from_secs(5));
        assert_eq!(text, "ab\ncef");
    }

    #[test]
    fn capture_below_the_limit_is_untouched() {
        let capture = Capture::start_with_limit(&b"curto"[..], 100);
        assert_eq!(capture.finish_within(Duration::from_secs(5)), "curto");
    }

    #[test]
    fn capture_default_limit_is_one_mebibyte() {
        assert_eq!(MAX_CAPTURE_BYTES, 1_048_576);
        let source = std::io::repeat(b'x').take(3 * 1_048_576);
        let text = Capture::start(source).finish_within(Duration::from_secs(10));
        assert_eq!(text.len(), MAX_CAPTURE_BYTES + CAPTURE_TRUNCATED_MARK.len());
        assert!(text.ends_with(CAPTURE_TRUNCATED_MARK));
    }

    fn lines_of(input: &[u8], max: usize) -> Vec<String> {
        let mut lines = Vec::new();
        read_bounded_lines(input, max, |line| lines.push(line));
        lines
    }

    #[test]
    fn bounded_lines_match_plain_lines_when_nothing_is_too_long() {
        assert_eq!(lines_of(b"a\nb\r\n\nc", 100), ["a", "b", "", "c"]);
        assert_eq!(lines_of(b"a\n", 100), ["a"]);
        assert!(lines_of(b"", 100).is_empty());
    }

    #[test]
    fn a_line_over_the_limit_is_cut_and_marked_without_swallowing_the_next_one() {
        let mut input = "x".repeat(300).into_bytes();
        input.extend_from_slice(b"\nproxima\n");
        let lines = lines_of(&input, 64);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], format!("{}{LINE_TRUNCATED_MARK}", "x".repeat(64)));
        assert_eq!(lines[1], "proxima");
    }

    #[test]
    fn a_huge_last_line_without_newline_is_still_bounded() {
        let input = vec![b'y'; 1_000_000];
        let lines = lines_of(&input, MAX_STDERR_LINE_BYTES);
        assert_eq!(lines.len(), 1);
        assert_eq!(
            lines[0].len(),
            MAX_STDERR_LINE_BYTES + LINE_TRUNCATED_MARK.len()
        );
    }

    #[test]
    fn stdout_lines_allow_four_mebibytes_while_stderr_stays_at_sixty_four_kib() {
        assert_eq!(MAX_STDOUT_LINE_BYTES, 4 * 1_048_576);
        assert_eq!(MAX_STDERR_LINE_BYTES, 65_536);
        let mut event = br#"{"type":"result","result":""#.to_vec();
        event.extend(std::iter::repeat_n(b'a', 1_000_000));
        event.extend_from_slice(b"\"}\n");
        let kept = lines_of(&event, MAX_STDOUT_LINE_BYTES);
        assert_eq!(kept.len(), 1);
        assert!(!kept[0].ends_with(LINE_TRUNCATED_MARK));
        assert!(kept[0].ends_with("\"}"));
        let cut = lines_of(&event, MAX_STDERR_LINE_BYTES);
        assert!(cut[0].ends_with(LINE_TRUNCATED_MARK));
    }

    #[test]
    fn a_stdout_line_over_four_mebibytes_is_cut_with_the_mark_the_ui_looks_for() {
        let mut input = vec![b'{'; MAX_STDOUT_LINE_BYTES + 10];
        input.extend_from_slice(b"\nok\n");
        let lines = lines_of(&input, MAX_STDOUT_LINE_BYTES);
        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines[0].len(),
            MAX_STDOUT_LINE_BYTES + LINE_TRUNCATED_MARK.len()
        );
        assert!(lines[0].ends_with(LINE_TRUNCATED_MARK));
        assert_eq!(lines[1], "ok");
        assert_eq!(LINE_TRUNCATED_MARK, " …[line truncated]");
    }

    #[test]
    fn invalid_utf8_in_a_line_is_replaced_instead_of_ending_the_stream() {
        let lines = lines_of(b"ok\n\xff\xfe\nfim\n", 100);
        assert_eq!(lines, ["ok", "\u{fffd}\u{fffd}", "fim"]);
    }

    #[test]
    fn the_registry_refuses_more_than_the_concurrent_limit() {
        let registry = ProcessRegistry::default();
        for pid in 1..=MAX_CONCURRENT_PROCESSES as u32 {
            registry.ensure_capacity().unwrap();
            registry.insert(pid).unwrap();
        }
        assert_eq!(
            registry.ensure_capacity().unwrap_err().kind,
            ErrorKind::TooManyProcesses
        );
        assert_eq!(
            registry.insert(99).unwrap_err().kind,
            ErrorKind::TooManyProcesses
        );
        registry.remove(1);
        assert!(registry.ensure_capacity().is_ok());
        assert!(registry.insert(99).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn killing_a_pid_marked_as_exiting_is_a_noop() {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 30"])
            .process_group(0)
            .spawn()
            .unwrap();
        let registry = ProcessRegistry::default();
        registry.insert(child.id()).unwrap();
        registry.mark_exiting(child.id());
        kill_registered(&registry, child.id()).unwrap();
        thread::sleep(Duration::from_millis(100));
        assert!(child.try_wait().unwrap().is_none());
        let _ = terminate(child.id(), true);
        let _ = child.wait();
    }

    #[cfg(unix)]
    #[test]
    fn waiting_for_exit_leaves_the_zombie_so_the_pid_cannot_be_recycled_yet() {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exit 3"])
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id();
        wait_until_exited(pid);
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, 0);
        assert_eq!(child.wait().unwrap().code(), Some(3));
    }

    #[cfg(unix)]
    #[test]
    fn reap_marks_the_pid_as_exiting_before_the_pid_is_released() {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exit 5"])
            .process_group(0)
            .spawn()
            .unwrap();
        let registry = ProcessRegistry::default();
        registry.insert(child.id()).unwrap();
        assert!(registry.is_running(child.id()));
        assert_eq!(reap(&mut child, &registry), Some(5));
        assert!(!registry.is_running(child.id()));
        assert_eq!(
            registry.0.lock().unwrap().get(&child.id()),
            Some(&Slot::Exiting)
        );
        kill_registered(&registry, child.id()).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_kill_racing_the_exit_never_signals_a_released_pid() {
        use std::os::unix::process::CommandExt;
        for _ in 0..20 {
            let mut child = Command::new("/bin/sh")
                .args(["-c", "exit 0"])
                .process_group(0)
                .spawn()
                .unwrap();
            let pid = child.id();
            let registry = Arc::new(ProcessRegistry::default());
            registry.insert(pid).unwrap();
            let killer = {
                let registry = Arc::clone(&registry);
                thread::spawn(move || {
                    for _ in 0..200 {
                        registry
                            .signal_if_running(pid, || {
                                assert!(is_alive(pid), "signal sent to an already released pid");
                                Ok(())
                            })
                            .unwrap();
                    }
                })
            };
            reap(&mut child, &registry);
            killer.join().unwrap();
        }
    }
}

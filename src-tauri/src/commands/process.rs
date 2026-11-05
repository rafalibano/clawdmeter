use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};
use super::home::{app_dirs, claude_settings_file, home_dir, skill_workdir};
use super::process_policy::{prepare_invocation, resolve_working_dir, validate_program, GH_ENV};

const DEFAULT_RUN_TIMEOUT_MS: u64 = 15_000;
const MAX_RUN_TIMEOUT_MS: u64 = 120_000;
const POLL_INTERVAL_MS: u64 = 25;
const READER_JOIN_LIMIT_MS: u64 = 2_000;
const MAX_CONCURRENT_PROCESSES: usize = 4;
const MAX_SPAWN_RUNTIME: Duration = Duration::from_secs(15 * 60);
const CHILD_ENV: &[&str] = &["PATH", "HOME", "USER", "LANG", "TMPDIR", "SHELL", "TERM"];
const WINDOWS_CHILD_ENV: &[&str] = &[
    "SystemRoot",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PATHEXT",
    "COMSPEC",
    "TEMP",
    "TMP",
];
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

#[derive(Debug, Clone, Copy)]
struct Entry {
    pid: u32,
    slot: Slot,
}

#[derive(Default)]
pub struct ProcessRegistry {
    next_id: AtomicU64,
    entries: Mutex<HashMap<u64, Entry>>,
}

impl ProcessRegistry {
    fn ensure_capacity(&self) -> CommandResult<()> {
        let full = self
            .entries
            .lock()
            .map(|entries| entries.len() >= MAX_CONCURRENT_PROCESSES)
            .unwrap_or(true);
        if full {
            Err(too_many_processes())
        } else {
            Ok(())
        }
    }

    fn insert(&self, pid: u32) -> CommandResult<u64> {
        let mut entries = self.entries.lock().map_err(|_| too_many_processes())?;
        if entries.len() >= MAX_CONCURRENT_PROCESSES {
            return Err(too_many_processes());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        entries.insert(
            id,
            Entry {
                pid,
                slot: Slot::Running,
            },
        );
        Ok(id)
    }

    fn mark_exiting(&self, id: u64) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(entry) = entries.get_mut(&id) {
                entry.slot = Slot::Exiting;
            }
        }
    }

    fn remove(&self, id: u64) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(&id);
        }
    }

    #[cfg(test)]
    fn is_running(&self, id: u64) -> bool {
        self.entries
            .lock()
            .map(|entries| {
                entries
                    .get(&id)
                    .is_some_and(|entry| entry.slot == Slot::Running)
            })
            .unwrap_or(false)
    }

    fn signal_if_running(
        &self,
        id: u64,
        send: impl FnOnce(u32) -> CommandResult<()>,
    ) -> CommandResult<()> {
        let Ok(entries) = self.entries.lock() else {
            return Ok(());
        };
        match entries.get(&id) {
            Some(entry) if entry.slot == Slot::Running => send(entry.pid),
            _ => Ok(()),
        }
    }

    fn drain_running(&self) -> Vec<u32> {
        self.entries
            .lock()
            .map(|mut entries| {
                entries
                    .drain()
                    .filter(|(_, entry)| entry.slot == Slot::Running)
                    .map(|(_, entry)| entry.pid)
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
    id: u64,
    stream: &'static str,
    line: String,
}

#[derive(Debug, Clone, Serialize)]
struct ExitEvent {
    id: u64,
    code: Option<i32>,
}

fn is_inherited_env(name: &str, windows: bool) -> bool {
    let same = |allowed: &&str| {
        if windows {
            allowed.eq_ignore_ascii_case(name)
        } else {
            *allowed == name
        }
    };
    CHILD_ENV.iter().any(same)
        || name.starts_with("LC_")
        || (windows && WINDOWS_CHILD_ENV.iter().any(same))
}

pub fn child_env(
    vars: impl IntoIterator<Item = (OsString, OsString)>,
    windows: bool,
) -> Vec<(OsString, OsString)> {
    vars.into_iter()
        .filter(|(name, _)| {
            name.to_str()
                .is_some_and(|name| is_inherited_env(name, windows))
        })
        .collect()
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

#[derive(Clone, Copy)]
struct Launch<'a> {
    cwd: Option<&'a str>,
    protected: &'a [PathBuf],
    default_dir: Option<&'a Path>,
    claude_settings: Option<&'a Path>,
}

impl Launch<'_> {
    const NONE: Launch<'static> = Launch {
        cwd: None,
        protected: &[],
        default_dir: None,
        claude_settings: None,
    };
}

fn build_command(program: &str, args: &[String], launch: &Launch) -> CommandResult<Command> {
    let Launch {
        cwd,
        protected,
        default_dir,
        claude_settings,
    } = *launch;
    let argv = prepare_invocation(program, args, claude_settings)?;
    let dir = resolve_working_dir(cwd, home_dir().as_deref(), protected, default_dir)?;
    let mut command = Command::new(resolve_program(program)?);
    command
        .args(&argv)
        .env_clear()
        .envs(child_env(std::env::vars_os(), cfg!(windows)))
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
    let mut child = build_command(program, args, &Launch::NONE)?
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
    id: u64,
    stream: &'static str,
    source: impl Read + Send + 'static,
    max_line: usize,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        read_bounded_lines(source, max_line, |line| {
            let _ = app.emit(OUTPUT_EVENT, OutputEvent { id, stream, line });
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

#[cfg(unix)]
fn kill_group(pid: u32) {
    if let Ok(group) = i32::try_from(pid) {
        unsafe { libc::kill(-group, libc::SIGKILL) };
    }
}

fn reap(child: &mut Child, registry: &ProcessRegistry, id: u64) -> Option<i32> {
    #[cfg(unix)]
    {
        let pid = child.id();
        wait_until_exited(pid);
        // The zombie still holds the pid, so the group id cannot have been recycled yet.
        kill_group(pid);
        registry.mark_exiting(id);
        child.wait().ok().and_then(|status| status.code())
    }
    #[cfg(not(unix))]
    {
        let code = child.wait().ok().and_then(|status| status.code());
        registry.mark_exiting(id);
        code
    }
}

fn arm_deadline(limit: Duration, done: Receiver<()>, on_timeout: impl FnOnce() + Send + 'static) {
    thread::spawn(move || {
        if done.recv_timeout(limit) == Err(RecvTimeoutError::Timeout) {
            on_timeout();
        }
    });
}

struct Spawned {
    child: Child,
    id: u64,
    tree: ProcessTree,
    readers: Vec<thread::JoinHandle<()>>,
}

fn watch_exit(app: AppHandle, spawned: Spawned) {
    let Spawned {
        mut child,
        id,
        tree,
        readers,
    } = spawned;
    let (done, finished) = mpsc::channel();
    let deadline_app = app.clone();
    arm_deadline(MAX_SPAWN_RUNTIME, finished, move || {
        if let Some(registry) = deadline_app.try_state::<ProcessRegistry>() {
            let _ = registry.signal_if_running(id, |pid| terminate(pid, true));
        }
    });
    thread::spawn(move || {
        let registry = app.try_state::<ProcessRegistry>();
        let code = match &registry {
            Some(registry) => reap(&mut child, registry, id),
            None => child.wait().ok().and_then(|status| status.code()),
        };
        let _ = done.send(());
        tree.terminate();
        for reader in readers {
            let _ = join_with_limit(reader, Duration::from_millis(READER_JOIN_LIMIT_MS));
        }
        if let Some(registry) = registry {
            registry.remove(id);
        }
        let _ = app.emit(EXIT_EVENT, ExitEvent { id, code });
    });
}

#[tauri::command(async)]
pub fn process_spawn(
    app: AppHandle,
    registry: State<ProcessRegistry>,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> CommandResult<u64> {
    registry.ensure_capacity()?;
    let protected = app_dirs(&app)?;
    let workdir = skill_workdir(&app)?;
    let settings = claude_settings_file(&app)?;
    let launch = Launch {
        cwd: cwd.as_deref(),
        protected: &protected,
        default_dir: Some(&workdir),
        claude_settings: Some(&settings),
    };
    let mut child = build_command(&program, &args, &launch)?
        .spawn()
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))?;
    let pid = child.id();
    let tree = ProcessTree::adopt(&child);
    let id = match registry.insert(pid) {
        Ok(id) => id,
        Err(error) => {
            let _ = terminate(pid, true);
            tree.terminate();
            let _ = child.wait();
            return Err(error);
        }
    };
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(stream_lines(
            app.clone(),
            id,
            "stdout",
            out,
            MAX_STDOUT_LINE_BYTES,
        ));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(stream_lines(
            app.clone(),
            id,
            "stderr",
            err,
            MAX_STDERR_LINE_BYTES,
        ));
    }
    watch_exit(
        app,
        Spawned {
            child,
            id,
            tree,
            readers,
        },
    );
    Ok(id)
}

#[cfg(unix)]
struct ProcessTree;

#[cfg(unix)]
impl ProcessTree {
    fn adopt(_child: &Child) -> Self {
        Self
    }

    fn terminate(&self) {}
}

#[cfg(windows)]
struct ProcessTree(Option<windows::Win32::Foundation::HANDLE>);

#[cfg(windows)]
unsafe impl Send for ProcessTree {}

#[cfg(windows)]
impl ProcessTree {
    fn adopt(child: &Child) -> Self {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let Ok(job) = (unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }) else {
            return Self(None);
        };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                u32::try_from(std::mem::size_of_val(&limits)).unwrap_or(0),
            )
        };
        let assigned = configured
            .and_then(|()| unsafe { AssignProcessToJobObject(job, HANDLE(child.as_raw_handle())) });
        if assigned.is_err() {
            let _ = unsafe { CloseHandle(job) };
            return Self(None);
        }
        Self(Some(job))
    }

    fn terminate(&self) {
        if let Some(job) = self.0 {
            let _ = unsafe { windows::Win32::System::JobObjects::TerminateJobObject(job, 1) };
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        if let Some(job) = self.0.take() {
            let _ = unsafe { windows::Win32::Foundation::CloseHandle(job) };
        }
    }
}

#[tauri::command]
pub async fn process_kill(app: AppHandle, id: u64) -> CommandResult<()> {
    run_blocking(move || kill_registered(&app.state::<ProcessRegistry>(), id)).await
}

fn kill_registered(registry: &ProcessRegistry, id: u64) -> CommandResult<()> {
    registry.signal_if_running(id, |pid| terminate(pid, false))
}

#[cfg(unix)]
fn terminate(pid: u32, force: bool) -> CommandResult<()> {
    let Ok(target) = i32::try_from(pid) else {
        return Ok(());
    };
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

pub fn is_probeable_pid(pid: u32) -> bool {
    pid != 0 && i32::try_from(pid).is_ok()
}

#[cfg(unix)]
fn is_alive(pid: u32) -> bool {
    let Ok(target) = i32::try_from(pid) else {
        return false;
    };
    let result = unsafe { libc::kill(target, 0) };
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
    is_probeable_pid(pid)
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
    fn killing_an_id_this_app_never_issued_is_a_noop() {
        let registry = ProcessRegistry::default();
        assert!(kill_registered(&registry, u64::from(std::process::id())).is_ok());
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
        let id = registry.insert(pid).unwrap();
        assert!(kill_registered(&registry, id).is_ok());
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
        let id = registry.insert(child.id()).unwrap();
        thread::sleep(Duration::from_millis(150));
        registry.terminate_all();
        assert_eq!(child.wait().unwrap().signal(), Some(libc::SIGKILL));
        assert!(!registry.is_running(id));
    }

    #[test]
    fn registry_tracks_only_inserted_pids() {
        let registry = ProcessRegistry::default();
        let id = registry.insert(10).unwrap();
        assert!(registry.is_running(id));
        registry.remove(id);
        assert!(!registry.is_running(id));
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
        let mut ids = Vec::new();
        for pid in 1..=MAX_CONCURRENT_PROCESSES as u32 {
            registry.ensure_capacity().unwrap();
            ids.push(registry.insert(pid).unwrap());
        }
        assert_eq!(
            registry.ensure_capacity().unwrap_err().kind,
            ErrorKind::TooManyProcesses
        );
        assert_eq!(
            registry.insert(99).unwrap_err().kind,
            ErrorKind::TooManyProcesses
        );
        registry.remove(ids[0]);
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
        let id = registry.insert(child.id()).unwrap();
        registry.mark_exiting(id);
        kill_registered(&registry, id).unwrap();
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
        let id = registry.insert(child.id()).unwrap();
        assert!(registry.is_running(id));
        assert_eq!(reap(&mut child, &registry, id), Some(5));
        assert!(!registry.is_running(id));
        assert_eq!(
            registry
                .entries
                .lock()
                .unwrap()
                .get(&id)
                .map(|entry| entry.slot),
            Some(Slot::Exiting)
        );
        kill_registered(&registry, id).unwrap();
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
            let id = registry.insert(pid).unwrap();
            let killer = {
                let registry = Arc::clone(&registry);
                thread::spawn(move || {
                    for _ in 0..200 {
                        registry
                            .signal_if_running(id, |target| {
                                assert_eq!(target, pid);
                                assert!(is_alive(pid), "signal sent to an already released pid");
                                Ok(())
                            })
                            .unwrap();
                    }
                })
            };
            reap(&mut child, &registry, id);
            killer.join().unwrap();
        }
    }

    #[test]
    fn spawn_ids_are_unique_even_when_a_pid_comes_back() {
        let registry = ProcessRegistry::default();
        let first = registry.insert(4242).unwrap();
        registry.remove(first);
        let second = registry.insert(4242).unwrap();
        assert_ne!(first, second);
        assert!(!registry.is_running(first));
        assert!(registry.is_running(second));
        let mut signalled = None;
        registry
            .signal_if_running(first, |pid| {
                signalled = Some(pid);
                Ok(())
            })
            .unwrap();
        assert_eq!(signalled, None);
    }

    #[test]
    fn events_carry_the_spawn_id_not_the_pid() {
        let output = serde_json::to_value(OutputEvent {
            id: 7,
            stream: "stdout",
            line: "x".into(),
        })
        .unwrap();
        assert_eq!(
            output,
            serde_json::json!({ "id": 7, "stream": "stdout", "line": "x" })
        );
        let exit = serde_json::to_value(ExitEvent {
            id: 7,
            code: Some(0),
        })
        .unwrap();
        assert_eq!(exit, serde_json::json!({ "id": 7, "code": 0 }));
    }

    #[cfg(unix)]
    #[test]
    fn reaping_the_main_process_kills_what_it_left_in_its_group() {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 30 & echo $!"])
            .process_group(0)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let orphan: i32 = line.trim().parse().unwrap();
        let registry = ProcessRegistry::default();
        let id = registry.insert(child.id()).unwrap();
        reap(&mut child, &registry, id);
        thread::sleep(Duration::from_millis(150));
        let mut status = 0;
        unsafe { libc::waitpid(orphan, &mut status, libc::WNOHANG) };
        assert_ne!(
            unsafe { libc::kill(orphan, 0) },
            0,
            "orphan {orphan} still alive"
        );
    }

    #[test]
    fn the_deadline_fires_only_when_the_run_is_still_going() {
        let (fired_tx, fired) = mpsc::channel();
        let (_done, finished) = mpsc::channel::<()>();
        arm_deadline(Duration::from_millis(30), finished, move || {
            let _ = fired_tx.send(());
        });
        assert!(fired.recv_timeout(Duration::from_secs(2)).is_ok());

        let (fired_tx, fired) = mpsc::channel();
        let (done, finished) = mpsc::channel();
        arm_deadline(Duration::from_millis(200), finished, move || {
            let _ = fired_tx.send(());
        });
        done.send(()).unwrap();
        assert!(fired.recv_timeout(Duration::from_millis(400)).is_err());
        assert_eq!(MAX_SPAWN_RUNTIME, Duration::from_secs(900));
    }

    #[test]
    fn children_get_only_the_allowed_environment() {
        let vars = [
            ("PATH", "/usr/bin"),
            ("HOME", "/Users/dev"),
            ("LC_ALL", "en_US.UTF-8"),
            ("LANG", "en_US.UTF-8"),
            ("ANTHROPIC_API_KEY", "sk"),
            ("NODE_OPTIONS", "--require x"),
            ("HTTPS_PROXY", "http://proxy"),
            ("GH_TOKEN", "gho"),
            ("SystemRoot", "C:\\Windows"),
        ]
        .map(|(name, value)| (OsString::from(name), OsString::from(value)));
        let names = |windows| -> Vec<String> {
            child_env(vars.clone(), windows)
                .into_iter()
                .map(|(name, _)| name.to_string_lossy().into_owned())
                .collect()
        };
        assert_eq!(names(false), ["PATH", "HOME", "LC_ALL", "LANG"]);
        assert_eq!(
            names(true),
            ["PATH", "HOME", "LC_ALL", "LANG", "SystemRoot"]
        );
        let windows_case = [(OsString::from("Path"), OsString::from("C:\\bin"))];
        assert_eq!(child_env(windows_case.clone(), true).len(), 1);
        assert!(child_env(windows_case, false).is_empty());
    }

    #[test]
    fn pids_above_i32_max_are_never_probed() {
        assert!(!is_probeable_pid(0));
        assert!(!is_probeable_pid(u32::MAX));
        assert!(!is_probeable_pid(i32::MAX as u32 + 1));
        assert!(is_probeable_pid(1));
        assert!(!tauri::async_runtime::block_on(process_is_alive(u32::MAX)));
    }
}

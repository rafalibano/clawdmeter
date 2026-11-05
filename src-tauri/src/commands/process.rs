use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::error::{CommandError, CommandResult, ErrorKind};

const ALLOWED_PROGRAMS: &[&str] = &["claude", "gh"];
const DEFAULT_RUN_TIMEOUT_MS: u64 = 15_000;
const MAX_RUN_TIMEOUT_MS: u64 = 120_000;
const POLL_INTERVAL_MS: u64 = 25;
pub const OUTPUT_EVENT: &str = "process-output";
pub const EXIT_EVENT: &str = "process-exit";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

pub fn validate_program(program: &str) -> CommandResult<&'static str> {
    ALLOWED_PROGRAMS
        .iter()
        .copied()
        .find(|allowed| *allowed == program)
        .ok_or_else(|| CommandError::new(ErrorKind::ProgramNotAllowed, format!("programa não permitido: {program}")))
}

pub fn validate_args(args: &[String]) -> CommandResult<()> {
    if args.len() > 64 || args.iter().any(|arg| arg.len() > 8_192 || arg.contains('\0')) {
        return Err(CommandError::new(ErrorKind::InvalidArgument, "argumentos inválidos"));
    }
    Ok(())
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
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    let path_var = std::env::var("PATH").ok();
    candidate_paths(program, path_var.as_deref(), home.as_deref(), cfg!(windows))
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| CommandError::new(ErrorKind::ProgramNotFound, format!("{program} não encontrado")))
}

fn build_command(program: &str, args: &[String], cwd: Option<&str>) -> CommandResult<Command> {
    validate_args(args)?;
    let mut command = Command::new(resolve_program(program)?);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(dir) = cwd {
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

fn read_all(mut source: impl Read + Send + 'static) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = source.read_to_end(&mut buffer);
        String::from_utf8_lossy(&buffer).into_owned()
    })
}

#[tauri::command(async)]
pub fn process_run(program: String, args: Vec<String>, timeout_ms: Option<u64>) -> CommandResult<RunOutput> {
    let mut child = build_command(&program, &args, None)?
        .spawn()
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))?;
    let stdout = child.stdout.take().map(read_all);
    let stderr = child.stderr.take().map(read_all);
    let limit = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_RUN_TIMEOUT_MS).min(MAX_RUN_TIMEOUT_MS));
    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(CommandError::io)? {
            Some(status) => break status,
            None if started.elapsed() >= limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CommandError::new(ErrorKind::Timeout, format!("{program} excedeu o tempo limite")));
            }
            None => thread::sleep(Duration::from_millis(POLL_INTERVAL_MS)),
        }
    };
    Ok(RunOutput {
        code: status.code(),
        stdout: stdout.map(|handle| handle.join().unwrap_or_default()).unwrap_or_default(),
        stderr: stderr.map(|handle| handle.join().unwrap_or_default()).unwrap_or_default(),
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
            let _ = reader.join();
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
    if !registry.contains(pid) {
        return Err(CommandError::new(ErrorKind::InvalidArgument, "pid não foi iniciado por este app"));
    }
    terminate(pid)
}

#[cfg(unix)]
fn terminate(pid: u32) -> CommandResult<()> {
    let target = pid as i32;
    let group = unsafe { libc::kill(-target, libc::SIGTERM) };
    if group == 0 {
        return Ok(());
    }
    let single = unsafe { libc::kill(target, libc::SIGTERM) };
    if single == 0 {
        Ok(())
    } else {
        Err(CommandError::io(std::io::Error::last_os_error()))
    }
}

#[cfg(windows)]
fn terminate(pid: u32) -> CommandResult<()> {
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
    fn only_allowlisted_programs_are_accepted() {
        assert_eq!(validate_program("claude").unwrap(), "claude");
        assert_eq!(validate_program("gh").unwrap(), "gh");
        assert_eq!(validate_program("rm").unwrap_err().kind, ErrorKind::ProgramNotAllowed);
        assert_eq!(validate_program("../claude").unwrap_err().kind, ErrorKind::ProgramNotAllowed);
    }

    #[test]
    fn rejects_nul_bytes_and_oversized_args() {
        assert!(validate_args(&["ok".into()]).is_ok());
        assert!(validate_args(&["a\0b".into()]).is_err());
        assert!(validate_args(&vec!["x".to_string(); 65]).is_err());
    }

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

    #[cfg(unix)]
    #[test]
    fn current_process_is_alive_and_pid_zero_is_not() {
        assert!(is_alive(std::process::id()));
        assert!(!process_is_alive(0));
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

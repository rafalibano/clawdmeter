use std::process::Command;

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use super::error::{CommandError, CommandResult, ErrorKind};
use super::home::{home_dir, protected_dirs, skill_workdir};
use super::process::resolve_program;
use super::process_policy::{
    validate_args, validate_cwd, validate_program, validate_terminal_invocation,
};

pub fn validate_terminal_args(args: &[String]) -> CommandResult<()> {
    validate_args(args)?;
    let safe = |arg: &String| {
        !arg.is_empty()
            && arg.chars().all(|c| {
                c.is_ascii_alphanumeric()
                    || matches!(c, '-' | '_' | '.' | '/' | ':' | '=' | ',' | '@')
            })
    };
    if args.iter().all(safe) {
        Ok(())
    } else {
        Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "argument not allowed in the terminal",
        ))
    }
}

pub fn quote_path(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy())
}

pub fn shell_line(program: &Path, args: &[String]) -> String {
    std::iter::once(quote_path(program))
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

fn has_forbidden_path_char(text: &str, backslash_forbidden: bool) -> bool {
    text.chars()
        .any(|c| matches!(c, '\'' | '"' | '\n' | '\r' | '\0') || (backslash_forbidden && c == '\\'))
}

pub fn validate_terminal_path(path: &Path) -> CommandResult<()> {
    if has_forbidden_path_char(&path.to_string_lossy(), cfg!(target_os = "macos")) {
        return Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "path not allowed in the terminal",
        ));
    }
    Ok(())
}

pub fn validate_terminal_cwd(
    cwd: Option<&str>,
    home: Option<&Path>,
    protected: &[PathBuf],
) -> CommandResult<Option<PathBuf>> {
    let resolved = validate_cwd(cwd, home, protected)?;
    if let Some(dir) = &resolved {
        validate_terminal_path(dir)?;
    }
    Ok(resolved)
}

pub fn shell_line_in(cwd: Option<&Path>, program: &Path, args: &[String]) -> String {
    let line = shell_line(program, args);
    match cwd {
        Some(dir) => format!("cd {} && {line}", quote_path(dir)),
        None => line,
    }
}

pub fn osascript_args(line: &str) -> Vec<String> {
    vec![
        "-e".into(),
        "tell application \"Terminal\" to activate".into(),
        "-e".into(),
        format!("tell application \"Terminal\" to do script \"{line}\""),
    ]
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_terminal_args(program: &Path, args: &[String]) -> Vec<String> {
    ["/C", "start", "", "cmd", "/K"]
        .iter()
        .map(|part| part.to_string())
        .chain(std::iter::once(program.to_string_lossy().into_owned()))
        .chain(args.iter().cloned())
        .collect()
}

#[cfg(target_os = "macos")]
fn launch(program: &Path, args: &[String], cwd: Option<&Path>) -> CommandResult<()> {
    Command::new("/usr/bin/osascript")
        .args(osascript_args(&shell_line_in(cwd, program, args)))
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))
}

#[cfg(target_os = "windows")]
fn launch(program: &Path, args: &[String], cwd: Option<&Path>) -> CommandResult<()> {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new("cmd");
    command
        .args(windows_terminal_args(program, args))
        .creation_flags(super::process::CREATE_NO_WINDOW);
    if let Some(dir) = cwd.map(Path::to_path_buf).or_else(home_dir) {
        command.current_dir(dir);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn launch(_program: &Path, _args: &[String], _cwd: Option<&Path>) -> CommandResult<()> {
    Err(CommandError::new(
        ErrorKind::SpawnFailed,
        "terminal not supported on this system",
    ))
}

#[tauri::command(async)]
pub fn terminal_run(
    app: AppHandle,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> CommandResult<()> {
    let workdir = skill_workdir(&app)?;
    run_terminal(
        &program,
        &args,
        cwd.as_deref(),
        &protected_dirs(&app)?,
        Some(&workdir),
    )
}

fn terminal_dir(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    protected: &[PathBuf],
    default_dir: Option<&Path>,
) -> CommandResult<Option<PathBuf>> {
    let resumes = program == "claude" && args.first().map(String::as_str) == Some("--resume");
    match default_dir {
        Some(dir) if cwd.is_none() && resumes => {
            validate_terminal_path(dir)?;
            Ok(Some(dir.to_path_buf()))
        }
        _ => validate_terminal_cwd(cwd, home_dir().as_deref(), protected),
    }
}

fn run_terminal(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    protected: &[PathBuf],
    default_dir: Option<&Path>,
) -> CommandResult<()> {
    let program = validate_program(program)?;
    validate_terminal_args(args)?;
    validate_terminal_invocation(program, args)?;
    let dir = terminal_dir(program, args, cwd, protected, default_dir)?;
    let executable = resolve_program(program)?;
    validate_terminal_path(&executable)?;
    launch(&executable, args, dir.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn backslash_is_only_rejected_where_the_shell_line_needs_it() {
        let windows_path = r"C:\Users\dev\proj";
        assert!(!has_forbidden_path_char(windows_path, false));
        assert!(has_forbidden_path_char(windows_path, true));
        assert!(has_forbidden_path_char(r"C:\Users\o'brien", false));
        assert!(has_forbidden_path_char("C:\\dev\n", false));
    }

    #[test]
    fn accepts_login_and_resume_arguments() {
        assert!(validate_terminal_args(&args(&["/login"])).is_ok());
        assert!(validate_terminal_args(&args(&["/mcp"])).is_ok());
        assert!(validate_terminal_args(&args(&[
            "--resume",
            "3f2a9c1e-0000-4000-8000-123456789abc"
        ]))
        .is_ok());
        assert!(validate_terminal_args(&args(&["auth", "refresh", "-s", "repo,read:org"])).is_ok());
    }

    #[test]
    fn rejects_shell_metacharacters() {
        for bad in [
            "a;b", "a b", "$(x)", "a\"b", "a`b", "a&b", "a|b", "", "a\nb",
        ] {
            assert!(
                validate_terminal_args(&args(&[bad])).is_err(),
                "{bad:?} deveria ser barrado"
            );
        }
    }

    #[test]
    fn builds_the_shell_line() {
        let claude = Path::new("/opt/homebrew/bin/claude");
        assert_eq!(
            shell_line(claude, &args(&["/login"])),
            "'/opt/homebrew/bin/claude' /login"
        );
        assert_eq!(shell_line(Path::new("/usr/bin/gh"), &[]), "'/usr/bin/gh'");
    }

    #[test]
    fn builds_the_shell_line_in_a_directory() {
        let dir = Path::new("/Users/dev/My Projects");
        let claude = Path::new("/Users/dev/.local/bin/claude");
        assert_eq!(
            shell_line_in(Some(dir), claude, &args(&["--resume", "abc"])),
            "cd '/Users/dev/My Projects' && '/Users/dev/.local/bin/claude' --resume abc"
        );
        assert_eq!(
            shell_line_in(None, claude, &args(&["/mcp"])),
            "'/Users/dev/.local/bin/claude' /mcp"
        );
    }

    #[test]
    fn the_resolved_program_path_follows_the_same_forbidden_chars_as_the_cwd() {
        assert!(validate_terminal_path(Path::new("/opt/homebrew/bin/claude")).is_ok());
        assert!(validate_terminal_path(Path::new("/Users/dev/My Tools/claude")).is_ok());
        for bad in [
            "/Users/o'brien/claude",
            "/Users/\"x\"/claude",
            "/Users/a\nb/claude",
        ] {
            assert!(validate_terminal_path(Path::new(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn terminal_cwd_rejects_quotes_and_backslashes_and_keeps_the_home_rule() {
        let root = std::env::temp_dir().join(format!("clawdmeter-term-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("home");
        let quoted = home.join("it's");
        std::fs::create_dir_all(&quoted).unwrap();
        std::fs::create_dir_all(home.join("with space")).unwrap();
        std::fs::create_dir_all(root.join("fora")).unwrap();
        assert!(validate_terminal_cwd(quoted.to_str(), Some(&home), &[]).is_err());
        assert!(
            validate_terminal_cwd(home.join("with space").to_str(), Some(&home), &[])
                .unwrap()
                .is_some()
        );
        assert!(validate_terminal_cwd(root.join("fora").to_str(), Some(&home), &[]).is_err());
        assert!(validate_terminal_cwd(None, Some(&home), &[])
            .unwrap()
            .is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn terminal_refuses_a_cwd_inside_the_app_config_before_launching() {
        let root = std::env::temp_dir().join(format!("clawdmeter-termcfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("home");
        let config = home.join("config-do-app");
        std::fs::create_dir_all(&config).unwrap();
        assert!(
            validate_terminal_cwd(config.to_str(), Some(&home), std::slice::from_ref(&config))
                .is_err()
        );
        assert!(validate_terminal_cwd(config.to_str(), Some(&home), &[]).is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn builds_osascript_arguments() {
        let built = osascript_args("claude /login");
        assert_eq!(built[0], "-e");
        assert!(built[3].ends_with("do script \"claude /login\""));
    }

    #[test]
    fn builds_windows_arguments_without_quoting() {
        let built = windows_terminal_args(Path::new("claude.cmd"), &args(&["/login"]));
        assert_eq!(
            built,
            args(&["/C", "start", "", "cmd", "/K", "claude.cmd", "/login"])
        );
    }

    #[test]
    fn rejects_arguments_outside_the_per_program_policy_before_launching() {
        let denied = run_terminal(
            "claude",
            &args(&["--dangerously-skip-permissions"]),
            None,
            &[],
            None,
        )
        .unwrap_err();
        assert_eq!(denied.kind, ErrorKind::InvalidArgument);
        let other = run_terminal("gh", &args(&["auth", "token"]), None, &[], None).unwrap_err();
        assert_eq!(other.kind, ErrorKind::InvalidArgument);
    }

    #[test]
    fn rejects_programs_outside_the_allowlist() {
        assert_eq!(
            run_terminal("bash", &args(&["-c"]), None, &[], None)
                .unwrap_err()
                .kind,
            ErrorKind::ProgramNotAllowed
        );
    }

    #[test]
    fn resume_without_a_cwd_reopens_in_the_skill_workdir() {
        let workdir = Path::new("/Users/dev/Library/Caches/com.fake.clawdmeter/skill-cwd");
        let resume = args(&["--resume", "3f2a9c1e-0000-4000-8000-123456789abc"]);
        assert_eq!(
            terminal_dir("claude", &resume, None, &[], Some(workdir)).unwrap(),
            Some(workdir.to_path_buf())
        );
        assert_eq!(
            terminal_dir("claude", &args(&["/login"]), None, &[], Some(workdir)).unwrap(),
            None
        );
        assert!(terminal_dir("claude", &resume, Some("relativo"), &[], Some(workdir)).is_err());
        let quoted = Path::new("/Users/o'brien/Library/Caches/x/skill-cwd");
        assert!(terminal_dir("claude", &resume, None, &[], Some(quoted)).is_err());
    }
}

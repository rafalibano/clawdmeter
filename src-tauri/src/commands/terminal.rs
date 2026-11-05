use std::process::Command;

use super::error::{CommandError, CommandResult, ErrorKind};
use super::process::{validate_args, validate_program};

pub fn validate_terminal_args(args: &[String]) -> CommandResult<()> {
    validate_args(args)?;
    let safe = |arg: &String| {
        !arg.is_empty()
            && arg
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '=' | ',' | '@'))
    };
    if args.iter().all(safe) {
        Ok(())
    } else {
        Err(CommandError::new(ErrorKind::InvalidArgument, "argumento não permitido no terminal"))
    }
}

pub fn shell_line(program: &str, args: &[String]) -> String {
    std::iter::once(program.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
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
pub fn windows_terminal_args(program: &str, args: &[String]) -> Vec<String> {
    ["/C", "start", "", "cmd", "/K", program]
        .iter()
        .map(|part| part.to_string())
        .chain(args.iter().cloned())
        .collect()
}

#[cfg(target_os = "macos")]
fn launch(program: &str, args: &[String]) -> CommandResult<()> {
    Command::new("/usr/bin/osascript")
        .args(osascript_args(&shell_line(program, args)))
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))
}

#[cfg(target_os = "windows")]
fn launch(program: &str, args: &[String]) -> CommandResult<()> {
    use std::os::windows::process::CommandExt;
    Command::new("cmd")
        .args(windows_terminal_args(program, args))
        .creation_flags(0x0800_0000)
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn launch(_program: &str, _args: &[String]) -> CommandResult<()> {
    Err(CommandError::new(ErrorKind::SpawnFailed, "terminal não suportado neste sistema"))
}

#[tauri::command(async)]
pub fn terminal_run(program: String, args: Vec<String>) -> CommandResult<()> {
    let program = validate_program(&program)?;
    validate_terminal_args(&args)?;
    launch(program, &args)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn accepts_login_and_resume_arguments() {
        assert!(validate_terminal_args(&args(&["/login"])).is_ok());
        assert!(validate_terminal_args(&args(&["--resume", "3f2a9c1e-0000-4000-8000-123456789abc"])).is_ok());
        assert!(validate_terminal_args(&args(&["auth", "refresh", "-s", "repo,read:org"])).is_ok());
    }

    #[test]
    fn rejects_shell_metacharacters() {
        for bad in ["a;b", "a b", "$(x)", "a\"b", "a`b", "a&b", "a|b", "", "a\nb"] {
            assert!(validate_terminal_args(&args(&[bad])).is_err(), "{bad:?} deveria ser barrado");
        }
    }

    #[test]
    fn builds_the_shell_line() {
        assert_eq!(shell_line("claude", &args(&["/login"])), "claude /login");
        assert_eq!(shell_line("gh", &[]), "gh");
    }

    #[test]
    fn builds_osascript_arguments() {
        let built = osascript_args("claude /login");
        assert_eq!(built[0], "-e");
        assert!(built[3].ends_with("do script \"claude /login\""));
    }

    #[test]
    fn builds_windows_arguments_without_quoting() {
        let built = windows_terminal_args("claude", &args(&["/login"]));
        assert_eq!(built, args(&["/C", "start", "", "cmd", "/K", "claude", "/login"]));
    }

    #[test]
    fn rejects_programs_outside_the_allowlist() {
        assert_eq!(
            terminal_run("bash".into(), args(&["-c"])).unwrap_err().kind,
            ErrorKind::ProgramNotAllowed
        );
    }
}

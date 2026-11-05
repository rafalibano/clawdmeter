use std::process::Command;

use super::error::{CommandError, CommandResult, ErrorKind};
use std::path::{Path, PathBuf};

use super::process_policy::{
    home_dir, validate_args, validate_cwd, validate_program, validate_terminal_invocation,
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
            "argumento não permitido no terminal",
        ))
    }
}

pub fn shell_line(program: &str, args: &[String]) -> String {
    std::iter::once(program.to_string())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ")
}

fn has_forbidden_cwd_char(text: &str, backslash_forbidden: bool) -> bool {
    text.chars()
        .any(|c| matches!(c, '\'' | '"' | '\n' | '\r' | '\0') || (backslash_forbidden && c == '\\'))
}

pub fn validate_terminal_cwd(
    cwd: Option<&str>,
    home: Option<&Path>,
) -> CommandResult<Option<PathBuf>> {
    let resolved = validate_cwd(cwd, home)?;
    if let Some(dir) = &resolved {
        let text = dir.to_string_lossy();
        if has_forbidden_cwd_char(&text, cfg!(target_os = "macos")) {
            return Err(CommandError::new(
                ErrorKind::InvalidArgument,
                "diretório de trabalho não permitido no terminal",
            ));
        }
    }
    Ok(resolved)
}

pub fn shell_line_in(cwd: Option<&Path>, program: &str, args: &[String]) -> String {
    let line = shell_line(program, args);
    match cwd {
        Some(dir) => format!("cd '{}' && {line}", dir.to_string_lossy()),
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
pub fn windows_terminal_args(program: &str, args: &[String]) -> Vec<String> {
    ["/C", "start", "", "cmd", "/K", program]
        .iter()
        .map(|part| part.to_string())
        .chain(args.iter().cloned())
        .collect()
}

#[cfg(target_os = "macos")]
fn launch(program: &str, args: &[String], cwd: Option<&Path>) -> CommandResult<()> {
    Command::new("/usr/bin/osascript")
        .args(osascript_args(&shell_line_in(cwd, program, args)))
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))
}

#[cfg(target_os = "windows")]
fn launch(program: &str, args: &[String], cwd: Option<&Path>) -> CommandResult<()> {
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
fn launch(_program: &str, _args: &[String], _cwd: Option<&Path>) -> CommandResult<()> {
    Err(CommandError::new(
        ErrorKind::SpawnFailed,
        "terminal não suportado neste sistema",
    ))
}

#[tauri::command(async)]
pub fn terminal_run(program: String, args: Vec<String>, cwd: Option<String>) -> CommandResult<()> {
    let program = validate_program(&program)?;
    validate_terminal_args(&args)?;
    validate_terminal_invocation(program, &args)?;
    let dir = validate_terminal_cwd(cwd.as_deref(), home_dir().as_deref())?;
    launch(program, &args, dir.as_deref())
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
        assert!(!has_forbidden_cwd_char(windows_path, false));
        assert!(has_forbidden_cwd_char(windows_path, true));
        assert!(has_forbidden_cwd_char(r"C:\Users\o'brien", false));
        assert!(has_forbidden_cwd_char("C:\\dev\n", false));
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
        assert_eq!(shell_line("claude", &args(&["/login"])), "claude /login");
        assert_eq!(shell_line("gh", &[]), "gh");
    }

    #[test]
    fn builds_the_shell_line_in_a_directory() {
        let dir = Path::new("/Users/dev/My Projects");
        assert_eq!(
            shell_line_in(Some(dir), "claude", &args(&["--resume", "abc"])),
            "cd '/Users/dev/My Projects' && claude --resume abc"
        );
        assert_eq!(
            shell_line_in(None, "claude", &args(&["/mcp"])),
            "claude /mcp"
        );
    }

    #[test]
    fn terminal_cwd_rejects_quotes_and_backslashes_and_keeps_the_home_rule() {
        let root = std::env::temp_dir().join(format!("dev-pulse-term-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("home");
        let quoted = home.join("it's");
        std::fs::create_dir_all(&quoted).unwrap();
        std::fs::create_dir_all(home.join("com espaço")).unwrap();
        std::fs::create_dir_all(root.join("fora")).unwrap();
        assert!(validate_terminal_cwd(quoted.to_str(), Some(&home)).is_err());
        assert!(
            validate_terminal_cwd(home.join("com espaço").to_str(), Some(&home))
                .unwrap()
                .is_some()
        );
        assert!(validate_terminal_cwd(root.join("fora").to_str(), Some(&home)).is_err());
        assert!(validate_terminal_cwd(None, Some(&home)).unwrap().is_none());
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
        let built = windows_terminal_args("claude", &args(&["/login"]));
        assert_eq!(
            built,
            args(&["/C", "start", "", "cmd", "/K", "claude", "/login"])
        );
    }

    #[test]
    fn rejects_arguments_outside_the_per_program_policy_before_launching() {
        let denied = terminal_run(
            "claude".into(),
            args(&["--dangerously-skip-permissions"]),
            None,
        )
        .unwrap_err();
        assert_eq!(denied.kind, ErrorKind::InvalidArgument);
        let other = terminal_run("gh".into(), args(&["auth", "token"]), None).unwrap_err();
        assert_eq!(other.kind, ErrorKind::InvalidArgument);
    }

    #[test]
    fn rejects_programs_outside_the_allowlist() {
        assert_eq!(
            terminal_run("bash".into(), args(&["-c"]), None)
                .unwrap_err()
                .kind,
            ErrorKind::ProgramNotAllowed
        );
    }
}

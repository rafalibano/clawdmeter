use std::path::{Component, Path, PathBuf};

use super::error::{CommandError, CommandResult, ErrorKind};

const ALLOWED_PROGRAMS: &[&str] = &["claude", "gh"];
const MAX_ARGS: usize = 64;
const MAX_ARG_BYTES: usize = 8_192;
const MAX_ALLOWED_TOOLS_BYTES: usize = 1_024;
pub const ALLOWED_CLAUDE_TOOLS: &[&str] = &[
    "Read(./**)",
    "Grep",
    "Glob",
    "Bash(gh pr list:*)",
    "Bash(gh pr view:*)",
    "Bash(gh pr checks:*)",
    "Bash(gh pr diff:*)",
    "Bash(gh search prs:*)",
    "mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql",
    "mcp__plugin_atlassian_atlassian__getJiraIssue",
];
const MAX_BUDGET_USD: f64 = 1_000.0;
const GH_HOST: &str = "github.com";
const DENIED_CLAUDE_FLAGS: &[&str] = &[
    "--dangerously-skip-permissions",
    "--permission-mode",
    "--add-dir",
    "--mcp-config",
    "--settings",
    "--setting-sources",
    "--strict-mcp-config",
    "--disallowedTools",
    "--disallowed-tools",
];
const CLAUDE_HARDENING_ARGS: [&str; 4] = [
    "--setting-sources",
    "user",
    "--disallowedTools",
    "Write,Edit,MultiEdit,NotebookEdit",
];

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::new(ErrorKind::InvalidArgument, message)
}

pub fn validate_program(program: &str) -> CommandResult<&'static str> {
    ALLOWED_PROGRAMS
        .iter()
        .copied()
        .find(|allowed| *allowed == program)
        .ok_or_else(|| {
            CommandError::new(
                ErrorKind::ProgramNotAllowed,
                format!("programa não permitido: {program}"),
            )
        })
}

pub fn validate_args(args: &[String]) -> CommandResult<()> {
    if args.len() > MAX_ARGS
        || args
            .iter()
            .any(|arg| arg.len() > MAX_ARG_BYTES || arg.contains('\0'))
    {
        return Err(invalid("argumentos inválidos"));
    }
    Ok(())
}

pub fn validate_invocation(program: &str, args: &[String]) -> CommandResult<()> {
    validate_args(args)?;
    match validate_program(program)? {
        "gh" => validate_gh_process(args),
        _ => validate_claude(args),
    }
}

pub fn prepare_invocation(program: &str, args: &[String]) -> CommandResult<Vec<String>> {
    validate_invocation(program, args)?;
    let mut argv = args.to_vec();
    let is_print =
        validate_program(program)? == "claude" && args.first().map(String::as_str) == Some("-p");
    if is_print {
        argv.extend(CLAUDE_HARDENING_ARGS.iter().map(|arg| arg.to_string()));
    }
    Ok(argv)
}

pub fn validate_terminal_invocation(program: &str, args: &[String]) -> CommandResult<()> {
    validate_args(args)?;
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match validate_program(program)? {
        "gh" => validate_gh_terminal(&args),
        _ => match args.as_slice() {
            ["/login"] | ["/mcp"] => Ok(()),
            ["--resume", id] if is_uuid(id) => Ok(()),
            _ => Err(invalid("argumentos do claude não permitidos")),
        },
    }
}

fn is_host_flag(flag: &str) -> bool {
    matches!(flag, "-h" | "--hostname")
}

fn validate_gh_process(args: &[String]) -> CommandResult<()> {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["auth", "token"] => Ok(()),
        ["auth", "token", flag, GH_HOST] if is_host_flag(flag) => Ok(()),
        _ => Err(invalid("argumentos do gh não permitidos")),
    }
}

fn is_scope_list(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.split(',').all(|scope| {
            !scope.is_empty()
                && scope
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || matches!(c, ':' | '_' | '-'))
        })
}

fn validate_gh_terminal(args: &[&str]) -> CommandResult<()> {
    match args {
        ["auth", "login", flag, GH_HOST, "-w"] if is_host_flag(flag) => Ok(()),
        ["auth", "refresh", "-s", scopes] if is_scope_list(scopes) => Ok(()),
        ["auth", "refresh", flag, GH_HOST, "-s", scopes]
            if is_host_flag(flag) && is_scope_list(scopes) =>
        {
            Ok(())
        }
        _ => Err(invalid("argumentos do gh não permitidos")),
    }
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn is_budget(value: &str) -> bool {
    let plain = !value.is_empty()
        && value.len() <= 12
        && value.chars().all(|c| c.is_ascii_digit() || c == '.')
        && value.matches('.').count() <= 1
        && !value.starts_with('.')
        && !value.ends_with('.');
    plain
        && value
            .parse::<f64>()
            .is_ok_and(|budget| budget.is_finite() && budget > 0.0 && budget <= MAX_BUDGET_USD)
}

fn is_tool_list(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ALLOWED_TOOLS_BYTES
        && value
            .split(',')
            .all(|tool| ALLOWED_CLAUDE_TOOLS.contains(&tool))
}

fn validate_claude_print(prompt: &str, options: &[String]) -> CommandResult<()> {
    if prompt.trim().is_empty() || prompt.starts_with('-') {
        return Err(invalid("prompt inválido"));
    }
    let (mut format, mut budget, mut tools, mut verbose) = (false, false, false, false);
    let mut rest = options.iter().map(String::as_str);
    while let Some(flag) = rest.next() {
        if flag == "--verbose" {
            if verbose {
                return Err(invalid("valor inválido ou repetido em --verbose"));
            }
            verbose = true;
            continue;
        }
        let Some(value) = rest.next() else {
            return Err(invalid("flag do claude sem valor"));
        };
        let (seen, valid) = match flag {
            "--output-format" => (&mut format, value == "stream-json"),
            "--max-budget-usd" => (&mut budget, is_budget(value)),
            "--allowedTools" => (&mut tools, is_tool_list(value)),
            _ => return Err(invalid(format!("flag do claude não permitida: {flag}"))),
        };
        if *seen || !valid {
            return Err(invalid(format!("valor inválido ou repetido em {flag}")));
        }
        *seen = true;
    }
    if format && budget {
        Ok(())
    } else {
        Err(invalid(
            "o claude exige --output-format stream-json e --max-budget-usd",
        ))
    }
}

fn validate_claude(args: &[String]) -> CommandResult<()> {
    let prompt_index = (args.first().map(String::as_str) == Some("-p")).then_some(1);
    for (index, arg) in args.iter().enumerate() {
        let name = arg.split('=').next().unwrap_or(arg);
        if Some(index) != prompt_index && DENIED_CLAUDE_FLAGS.contains(&name) {
            return Err(invalid(format!("flag do claude negada: {name}")));
        }
    }
    let view: Vec<&str> = args.iter().map(String::as_str).collect();
    match view.as_slice() {
        ["/login"] => Ok(()),
        ["--resume", id] if is_uuid(id) => Ok(()),
        ["-p", prompt, ..] => validate_claude_print(prompt, &args[2..]),
        _ => Err(invalid("argumentos do claude não permitidos")),
    }
}

pub fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

fn is_protected_dir(resolved: &Path, home: &Path, protected: &[PathBuf]) -> bool {
    std::iter::once(home.join(".claude"))
        .chain(protected.iter().cloned())
        .filter_map(|dir| dir.canonicalize().ok())
        .any(|dir| resolved.starts_with(dir))
}

pub fn validate_cwd(
    cwd: Option<&str>,
    home: Option<&Path>,
    protected: &[PathBuf],
) -> CommandResult<Option<PathBuf>> {
    let Some(raw) = cwd else {
        return Ok(None);
    };
    let path = Path::new(raw);
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return Err(invalid("diretório de trabalho inválido"));
    }
    let home = home
        .and_then(|dir| dir.canonicalize().ok())
        .ok_or_else(|| invalid("pasta do usuário não encontrada"))?;
    let resolved = path
        .canonicalize()
        .map_err(|_| invalid("diretório de trabalho inexistente"))?;
    if !resolved.starts_with(&home) {
        return Err(invalid("diretório de trabalho fora da pasta do usuário"));
    }
    if is_protected_dir(&resolved, &home, protected) {
        return Err(invalid(
            "diretório de trabalho dentro da configuração do app ou de ~/.claude",
        ));
    }
    Ok(Some(strip_verbatim_prefix(resolved)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    const SESSION: &str = "3f2a9c1e-0000-4000-8000-123456789abc";

    #[test]
    fn only_allowlisted_programs_are_accepted() {
        assert_eq!(validate_program("claude").unwrap(), "claude");
        assert_eq!(validate_program("gh").unwrap(), "gh");
        assert_eq!(
            validate_program("rm").unwrap_err().kind,
            ErrorKind::ProgramNotAllowed
        );
        assert_eq!(
            validate_program("../claude").unwrap_err().kind,
            ErrorKind::ProgramNotAllowed
        );
    }

    #[test]
    fn rejects_nul_bytes_and_oversized_args() {
        assert!(validate_args(&args(&["ok"])).is_ok());
        assert!(validate_args(&args(&["a\0b"])).is_err());
        assert!(validate_args(&vec!["x".to_string(); 65]).is_err());
    }

    #[test]
    fn gh_accepts_only_auth_token_with_optional_host() {
        assert!(validate_invocation("gh", &args(&["auth", "token"])).is_ok());
        assert!(validate_invocation("gh", &args(&["auth", "token", "-h", "github.com"])).is_ok());
        assert!(
            validate_invocation("gh", &args(&["auth", "token", "--hostname", "github.com"]))
                .is_ok()
        );
    }

    #[test]
    fn gh_denies_everything_else() {
        for bad in [
            vec!["api", "/user"],
            vec!["auth", "login"],
            vec!["auth", "token", "-h", "evil.example"],
            vec!["auth", "token", "--show-token"],
            vec!["auth", "status"],
            vec!["extension", "install", "x/y"],
            vec!["alias", "set", "a", "!rm -rf ~"],
            vec![],
        ] {
            assert!(
                validate_invocation("gh", &args(&bad)).is_err(),
                "{bad:?} deveria ser barrado"
            );
        }
    }

    #[test]
    fn claude_accepts_the_print_format_used_by_the_app() {
        let base = [
            "-p",
            "resuma o PR",
            "--output-format",
            "stream-json",
            "--max-budget-usd",
            "0.5",
        ];
        assert!(validate_invocation("claude", &args(&base)).is_ok());
        let with_tools = [
            "-p",
            "resuma o PR",
            "--output-format",
            "stream-json",
            "--max-budget-usd",
            "2",
            "--allowedTools",
            "Read(./**),Grep,Bash(gh pr diff:*)",
        ];
        assert!(validate_invocation("claude", &args(&with_tools)).is_ok());
    }

    #[test]
    fn claude_accepts_the_exact_argv_built_by_the_app() {
        let argv = [
            "-p",
            "/acabativa",
            "--output-format",
            "stream-json",
            "--verbose",
            "--max-budget-usd",
            "2",
            "--allowedTools",
            "Read(./**),Grep,Glob,Bash(gh pr list:*),Bash(gh pr view:*),Bash(gh pr checks:*),Bash(gh pr diff:*),Bash(gh search prs:*)",
        ];
        assert!(validate_invocation("claude", &args(&argv)).is_ok());
        let without_tools = [
            "-p",
            "/acabativa",
            "--output-format",
            "stream-json",
            "--verbose",
            "--max-budget-usd",
            "2",
        ];
        assert!(validate_invocation("claude", &args(&without_tools)).is_ok());
    }

    fn print_call_with_tools(tools: &str) -> Vec<String> {
        args(&[
            "-p",
            "oi",
            "--output-format",
            "stream-json",
            "--max-budget-usd",
            "1",
            "--allowedTools",
            tools,
        ])
    }

    #[test]
    fn claude_tools_outside_the_exact_allowlist_are_rejected() {
        for tools in [
            "Bash",
            "Bash(*)",
            "Bash(git:*)",
            "Bash(gh:*)",
            "Bash(git log)",
            "Bash(git log:*)",
            "Bash(git diff:*)",
            "Bash(git status:*)",
            "Read",
            "Read(**)",
            "Read(~/.ssh/**)",
            "Bash(gh pr diff:*) ",
            "Bash(git -c core.sshCommand=x log:*)",
            "Bash(gh api:*)",
            "Bash(gh pr merge:*)",
            "Write",
            "Edit",
            "MultiEdit",
            "NotebookEdit",
            "WebFetch",
            "*",
            "mcp__*",
            "mcp__plugin_atlassian_atlassian__*",
            "read",
            "Read,Write",
            "Read,Bash(git:*)",
        ] {
            assert!(
                validate_invocation("claude", &print_call_with_tools(tools)).is_err(),
                "{tools:?} deveria ser barrado"
            );
        }
    }

    #[test]
    fn claude_accepts_every_allowlisted_tool_alone_and_together() {
        for tool in ALLOWED_CLAUDE_TOOLS {
            assert!(
                validate_invocation("claude", &print_call_with_tools(tool)).is_ok(),
                "{tool} deveria passar"
            );
        }
        let all = ALLOWED_CLAUDE_TOOLS.join(",");
        assert!(validate_invocation("claude", &print_call_with_tools(&all)).is_ok());
    }

    #[test]
    fn claude_verbose_is_a_bare_flag_accepted_once() {
        let twice = [
            "-p",
            "oi",
            "--output-format",
            "stream-json",
            "--verbose",
            "--verbose",
            "--max-budget-usd",
            "1",
        ];
        assert!(validate_invocation("claude", &args(&twice)).is_err());
        let with_value = [
            "-p",
            "oi",
            "--output-format",
            "stream-json",
            "--verbose",
            "true",
            "--max-budget-usd",
            "1",
        ];
        assert!(validate_invocation("claude", &args(&with_value)).is_err());
    }

    const HARDENING: [&str; 4] = [
        "--setting-sources",
        "user",
        "--disallowedTools",
        "Write,Edit,MultiEdit,NotebookEdit",
    ];

    #[test]
    fn rust_appends_the_hardening_flags_to_the_final_claude_print_argv() {
        let from_ts = [
            "-p",
            "/acabativa",
            "--output-format",
            "stream-json",
            "--verbose",
            "--max-budget-usd",
            "2",
            "--allowedTools",
            "Read(./**),Grep,Bash(gh pr diff:*)",
        ];
        let argv = prepare_invocation("claude", &args(&from_ts)).unwrap();
        let expected: Vec<&str> = from_ts.iter().chain(HARDENING.iter()).copied().collect();
        assert_eq!(argv, args(&expected));
        let without_tools = prepare_invocation(
            "claude",
            &args(&[
                "-p",
                "oi",
                "--output-format",
                "stream-json",
                "--max-budget-usd",
                "1",
            ]),
        )
        .unwrap();
        assert!(without_tools.ends_with(&args(&HARDENING)));
    }

    #[test]
    fn hardening_flags_are_not_added_to_login_resume_or_gh() {
        for (program, call) in [
            ("claude", vec!["/login"]),
            ("claude", vec!["--resume", SESSION]),
            ("gh", vec!["auth", "token"]),
        ] {
            let call = args(&call);
            assert_eq!(prepare_invocation(program, &call).unwrap(), call);
        }
    }

    #[test]
    fn the_webview_cannot_pass_the_hardening_flags_itself() {
        let base = [
            "-p",
            "oi",
            "--output-format",
            "stream-json",
            "--max-budget-usd",
            "1",
        ];
        for extra in [
            vec!["--setting-sources", "user,project"],
            vec!["--setting-sources", "user"],
            vec!["--strict-mcp-config"],
            vec!["--disallowedTools", "Write"],
            vec!["--disallowed-tools", "Write"],
            vec!["--settings", "{}"],
            vec!["--setting-sources=project"],
        ] {
            let call: Vec<&str> = base.iter().chain(extra.iter()).copied().collect();
            assert!(
                prepare_invocation("claude", &args(&call)).is_err(),
                "{extra:?}"
            );
        }
    }

    #[test]
    fn prepare_invocation_still_applies_the_regular_policy() {
        assert!(prepare_invocation("claude", &args(&["-p", "oi"])).is_err());
        assert!(prepare_invocation("rm", &args(&["-p", "oi"])).is_err());
        assert!(prepare_invocation("gh", &args(&["api", "/user"])).is_err());
    }

    #[test]
    fn claude_accepts_login_and_resume() {
        assert!(validate_invocation("claude", &args(&["/login"])).is_ok());
        assert!(validate_invocation("claude", &args(&["--resume", SESSION])).is_ok());
    }

    #[test]
    fn claude_requires_format_and_budget() {
        assert!(validate_invocation("claude", &args(&["-p", "oi"])).is_err());
        assert!(validate_invocation(
            "claude",
            &args(&["-p", "oi", "--output-format", "stream-json"])
        )
        .is_err());
        assert!(
            validate_invocation("claude", &args(&["-p", "oi", "--max-budget-usd", "1"])).is_err()
        );
        assert!(validate_invocation(
            "claude",
            &args(&[
                "-p",
                "oi",
                "--output-format",
                "text",
                "--max-budget-usd",
                "1"
            ])
        )
        .is_err());
    }

    #[test]
    fn claude_denies_dangerous_flags_anywhere() {
        for flag in DENIED_CLAUDE_FLAGS {
            let appended = [
                "-p",
                "oi",
                "--output-format",
                "stream-json",
                "--max-budget-usd",
                "1",
                flag,
                "x",
            ];
            assert!(
                validate_invocation("claude", &args(&appended)).is_err(),
                "{flag} deveria ser barrado"
            );
            let assigned = format!("{flag}=x");
            let inline = [
                "-p",
                "oi",
                "--output-format",
                "stream-json",
                "--max-budget-usd",
                "1",
                assigned.as_str(),
            ];
            assert!(
                validate_invocation("claude", &args(&inline)).is_err(),
                "{assigned} deveria ser barrado"
            );
            assert!(validate_invocation("claude", &args(&[flag, "x"])).is_err());
        }
    }

    #[test]
    fn claude_prompt_cannot_smuggle_a_flag() {
        let tail = ["--output-format", "stream-json", "--max-budget-usd", "1"];
        let smuggled: Vec<&str> = ["-p", "--dangerously-skip-permissions"]
            .into_iter()
            .chain(tail)
            .collect();
        assert!(validate_invocation("claude", &args(&smuggled)).is_err());
        let mentioning: Vec<&str> = ["-p", "explique --add-dir"]
            .into_iter()
            .chain(tail)
            .collect();
        assert!(validate_invocation("claude", &args(&mentioning)).is_ok());
    }

    #[test]
    fn claude_rejects_bad_values_and_repeats() {
        let head = ["-p", "oi", "--output-format", "stream-json"];
        for budget in [
            "0", "-1", "abc", "1e3", "inf", "NaN", "1001", "", ".5", "1.",
        ] {
            let call: Vec<&str> = head
                .into_iter()
                .chain(["--max-budget-usd", budget])
                .collect();
            assert!(
                validate_invocation("claude", &args(&call)).is_err(),
                "{budget:?} deveria ser barrado"
            );
        }
        let repeated: Vec<&str> = head
            .into_iter()
            .chain(["--max-budget-usd", "1", "--max-budget-usd", "2"])
            .collect();
        assert!(validate_invocation("claude", &args(&repeated)).is_err());
        for tools in [
            "",
            "-x",
            "Bash;rm",
            "Bash$(x)",
            "a`b`",
            "a\nb",
            "a|b",
            "Read,",
            ",Read",
            "Read,,Grep",
        ] {
            let call: Vec<&str> = head
                .into_iter()
                .chain(["--max-budget-usd", "1", "--allowedTools", tools])
                .collect();
            assert!(
                validate_invocation("claude", &args(&call)).is_err(),
                "{tools:?} deveria ser barrado"
            );
        }
    }

    #[test]
    fn claude_rejects_unknown_shapes() {
        for bad in [
            vec!["--resume", "nao-e-uuid"],
            vec!["--resume", SESSION, "--add-dir", "/"],
            vec!["/login", "extra"],
            vec!["--version"],
            vec!["mcp", "add", "x"],
            vec![
                "-p",
                "oi",
                "--output-format",
                "stream-json",
                "--max-budget-usd",
                "1",
                "--verbose",
                "true",
            ],
            vec![
                "-p",
                "oi",
                "--output-format",
                "stream-json",
                "--max-budget-usd",
                "1",
                "--debug",
            ],
            vec![
                "-p",
                "oi",
                "--output-format",
                "stream-json",
                "--max-budget-usd",
            ],
            vec![
                "-p",
                "  ",
                "--output-format",
                "stream-json",
                "--max-budget-usd",
                "1",
            ],
            vec![],
        ] {
            assert!(
                validate_invocation("claude", &args(&bad)).is_err(),
                "{bad:?} deveria ser barrado"
            );
        }
    }

    #[test]
    fn terminal_accepts_the_commands_the_app_launches() {
        assert!(validate_terminal_invocation("claude", &args(&["/login"])).is_ok());
        assert!(validate_terminal_invocation("claude", &args(&["--resume", SESSION])).is_ok());
        assert!(validate_terminal_invocation("claude", &args(&["/mcp"])).is_ok());
        assert!(validate_terminal_invocation(
            "gh",
            &args(&["auth", "login", "-h", "github.com", "-w"])
        )
        .is_ok());
        assert!(validate_terminal_invocation(
            "gh",
            &args(&["auth", "refresh", "-h", "github.com", "-s", "repo,read:org"])
        )
        .is_ok());
        assert!(validate_terminal_invocation(
            "gh",
            &args(&["auth", "refresh", "-s", "repo,read:org"])
        )
        .is_ok());
    }

    #[test]
    fn terminal_denies_everything_else() {
        assert!(validate_terminal_invocation("gh", &args(&["auth", "token"])).is_err());
        assert!(validate_terminal_invocation(
            "gh",
            &args(&["auth", "login", "-h", "evil.example", "-w"])
        )
        .is_err());
        assert!(
            validate_terminal_invocation("gh", &args(&["auth", "refresh", "-s", "repo;rm"]))
                .is_err()
        );
        assert!(
            validate_terminal_invocation("claude", &args(&["--dangerously-skip-permissions"]))
                .is_err()
        );
        assert!(validate_terminal_invocation("claude", &args(&["/mcp", "extra"])).is_err());
        assert!(validate_invocation("claude", &args(&["/mcp"])).is_err());
        assert!(validate_terminal_invocation("bash", &args(&["-c", "x"])).is_err());
    }

    #[test]
    fn terminal_never_runs_claude_in_print_mode() {
        let print = [
            "-p",
            "oi",
            "--output-format",
            "stream-json",
            "--max-budget-usd",
            "1",
        ];
        assert!(validate_invocation("claude", &args(&print)).is_ok());
        assert!(validate_terminal_invocation("claude", &args(&print)).is_err());
        assert!(validate_terminal_invocation("claude", &args(&["--resume", "x"])).is_err());
        assert!(validate_terminal_invocation("claude", &args(&["--version"])).is_err());
    }

    struct TempTree {
        root: PathBuf,
    }

    impl TempTree {
        fn new(label: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("dev-pulse-{label}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(root.join("home").join("work")).unwrap();
            std::fs::create_dir_all(root.join("outside")).unwrap();
            Self { root }
        }

        fn home(&self) -> PathBuf {
            self.root.join("home")
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn verbatim_prefix_is_stripped_from_drive_paths_only() {
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from(r"\\?\C:\Users\dev")),
            PathBuf::from(r"C:\Users\dev")
        );
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\?\UNC\server\share")
        );
        assert_eq!(
            strip_verbatim_prefix(PathBuf::from("/Users/dev")),
            PathBuf::from("/Users/dev")
        );
    }

    #[test]
    fn cwd_none_is_always_fine() {
        assert_eq!(validate_cwd(None, None, &[]).unwrap(), None);
    }

    #[test]
    fn cwd_accepts_home_and_its_subdirectories() {
        let tree = TempTree::new("cwd-ok");
        let home = tree.home();
        let inside = home.join("work");
        assert!(validate_cwd(home.to_str(), Some(&home), &[])
            .unwrap()
            .is_some());
        assert!(validate_cwd(inside.to_str(), Some(&home), &[])
            .unwrap()
            .is_some());
    }

    #[test]
    fn cwd_rejects_outside_relative_and_parent_paths() {
        let tree = TempTree::new("cwd-bad");
        let home = tree.home();
        let outside = tree.root.join("outside");
        assert!(validate_cwd(outside.to_str(), Some(&home), &[]).is_err());
        assert!(validate_cwd(Some("work"), Some(&home), &[]).is_err());
        assert!(validate_cwd(Some(""), Some(&home), &[]).is_err());
        let escaping = home.join("work").join("..").join("..").join("outside");
        assert!(validate_cwd(escaping.to_str(), Some(&home), &[]).is_err());
        assert!(validate_cwd(home.join("nao-existe").to_str(), Some(&home), &[]).is_err());
        assert!(validate_cwd(home.to_str(), None, &[]).is_err());
    }

    #[test]
    fn cwd_rejects_the_app_config_dir_and_everything_inside_it() {
        let tree = TempTree::new("cwd-config");
        let home = tree.home();
        let config = home.join("Library").join("com.fake.devpulse");
        let nested = config.join("projeto").join(".claude");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(home.join("Library").join("outro")).unwrap();
        let protected = [config.clone()];
        for blocked in [&config, &config.join("projeto"), &nested] {
            let error = validate_cwd(blocked.to_str(), Some(&home), &protected).unwrap_err();
            assert_eq!(error.kind, ErrorKind::InvalidArgument, "{blocked:?}");
        }
        let sibling = home.join("Library").join("outro");
        assert!(validate_cwd(sibling.to_str(), Some(&home), &protected)
            .unwrap()
            .is_some());
        assert!(validate_cwd(home.to_str(), Some(&home), &protected)
            .unwrap()
            .is_some());
        let parent = home.join("Library");
        assert!(validate_cwd(parent.to_str(), Some(&home), &protected)
            .unwrap()
            .is_some());
    }

    #[test]
    fn cwd_rejects_dot_claude_in_the_home_and_its_subdirectories() {
        let tree = TempTree::new("cwd-dotclaude");
        let home = tree.home();
        let hooks = home.join(".claude").join("hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        for blocked in [home.join(".claude"), hooks] {
            assert!(validate_cwd(blocked.to_str(), Some(&home), &[]).is_err());
        }
        let lookalike = home.join(".claude-projects");
        std::fs::create_dir_all(&lookalike).unwrap();
        assert!(validate_cwd(lookalike.to_str(), Some(&home), &[])
            .unwrap()
            .is_some());
    }

    #[test]
    fn a_missing_protected_dir_does_not_block_anything() {
        let tree = TempTree::new("cwd-missing-config");
        let home = tree.home();
        let protected = [home.join("nao-existe")];
        assert!(validate_cwd(home.to_str(), Some(&home), &protected)
            .unwrap()
            .is_some());
    }

    #[cfg(unix)]
    #[test]
    fn cwd_rejects_a_symlink_that_points_into_the_app_config() {
        let tree = TempTree::new("cwd-config-link");
        let home = tree.home();
        let config = home.join("config-do-app");
        std::fs::create_dir_all(&config).unwrap();
        let link = home.join("atalho");
        std::os::unix::fs::symlink(&config, &link).unwrap();
        assert!(validate_cwd(link.to_str(), Some(&home), &[config]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn cwd_rejects_symlinks_that_escape_the_home() {
        let tree = TempTree::new("cwd-link");
        let home = tree.home();
        let link = home.join("atalho");
        std::os::unix::fs::symlink(tree.root.join("outside"), &link).unwrap();
        assert!(validate_cwd(link.to_str(), Some(&home), &[]).is_err());
    }
}

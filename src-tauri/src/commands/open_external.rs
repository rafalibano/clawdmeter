use std::process::Command;

use url::Url;

use super::error::{CommandError, CommandResult, ErrorKind};
#[cfg(target_os = "windows")]
use super::process::CREATE_NO_WINDOW;

pub fn validate_https_url(raw: &str) -> CommandResult<Url> {
    let url = Url::parse(raw).map_err(|_| CommandError::new(ErrorKind::InvalidArgument, "URL inválida"))?;
    if url.scheme() == "https" && url.host_str().is_some_and(|host| !host.is_empty()) {
        Ok(url)
    } else {
        Err(CommandError::new(ErrorKind::InvalidArgument, "só URLs https são abertas"))
    }
}

pub fn settings_target(pane: &str) -> CommandResult<&'static str> {
    match (pane, cfg!(windows)) {
        ("notifications", false) => Ok("x-apple.systempreferences:com.apple.Notifications-Settings.extension"),
        ("notifications", true) => Ok("ms-settings:notifications"),
        _ => Err(CommandError::new(ErrorKind::InvalidArgument, "painel de ajustes desconhecido")),
    }
}

#[cfg(target_os = "windows")]
fn launch(target: &str, is_url: bool) -> CommandResult<()> {
    use std::os::windows::process::CommandExt;
    let mut command = if is_url {
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", target]);
        command
    } else {
        let mut command = Command::new("explorer.exe");
        command.arg(target);
        command
    };
    command
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))
}

#[cfg(not(target_os = "windows"))]
fn launch(target: &str, _is_url: bool) -> CommandResult<()> {
    let opener = if cfg!(target_os = "macos") { "/usr/bin/open" } else { "xdg-open" };
    Command::new(opener)
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))
}

#[tauri::command(async)]
pub fn open_url(url: String) -> CommandResult<()> {
    let url = validate_https_url(&url)?;
    launch(url.as_str(), true)
}

#[tauri::command(async)]
pub fn open_system_settings(pane: String) -> CommandResult<()> {
    launch(settings_target(&pane)?, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_urls() {
        assert!(validate_https_url("https://github.com/orgs/Mottu-ops/sso").is_ok());
    }

    #[test]
    fn rejects_other_schemes_and_garbage() {
        for bad in ["http://example.com", "file:///etc/passwd", "javascript:alert(1)", "ms-settings:privacy", "nao é url", "https://"] {
            assert!(validate_https_url(bad).is_err(), "{bad:?} deveria ser barrado");
        }
    }

    #[test]
    fn maps_known_settings_panes_only() {
        assert!(settings_target("notifications").is_ok());
        assert!(settings_target("privacy").is_err());
    }
}

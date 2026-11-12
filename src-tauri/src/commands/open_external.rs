use std::process::Command;

use url::Url;

use super::error::{CommandError, CommandResult, ErrorKind};
#[cfg(target_os = "windows")]
use super::process::CREATE_NO_WINDOW;

pub fn validate_https_url(raw: &str) -> CommandResult<Url> {
    let url = Url::parse(raw)
        .map_err(|_| CommandError::new(ErrorKind::InvalidArgument, "invalid URL"))?;
    if url.scheme() == "https" && url.host_str().is_some_and(|host| !host.is_empty()) {
        Ok(url)
    } else {
        Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "only https URLs are opened",
        ))
    }
}

#[cfg_attr(target_os = "linux", allow(dead_code))]
pub fn settings_target(pane: &str) -> CommandResult<&'static str> {
    match (pane, cfg!(windows)) {
        ("notifications", false) => {
            Ok("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
        }
        ("notifications", true) => Ok("ms-settings:notifications"),
        _ => Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "unknown settings pane",
        )),
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
    let opener = if cfg!(target_os = "macos") {
        "/usr/bin/open"
    } else {
        "xdg-open"
    };
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

type SettingsCommand = (&'static str, &'static [&'static str]);

const LINUX_NOTIFICATION_SETTINGS: [SettingsCommand; 2] = [
    ("gnome-control-center", &["notifications"]),
    ("systemsettings", &["kcm_notifications"]),
];

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn linux_settings_command(
    pane: &str,
    is_installed: impl Fn(&str) -> bool,
) -> CommandResult<SettingsCommand> {
    if pane != "notifications" {
        return Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "unknown settings pane",
        ));
    }
    LINUX_NOTIFICATION_SETTINGS
        .into_iter()
        .find(|(program, _)| is_installed(program))
        .ok_or_else(|| {
            CommandError::new(
                ErrorKind::ProgramNotFound,
                "no system settings app found for notifications",
            )
        })
}

#[cfg(target_os = "linux")]
fn launch_settings(pane: &str) -> CommandResult<()> {
    let path_var = std::env::var_os("PATH").unwrap_or_default();
    let is_installed =
        |program: &str| std::env::split_paths(&path_var).any(|dir| dir.join(program).is_file());
    let (program, args) = linux_settings_command(pane, is_installed)?;
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::new(ErrorKind::SpawnFailed, error.to_string()))
}

#[cfg(not(target_os = "linux"))]
fn launch_settings(pane: &str) -> CommandResult<()> {
    launch(settings_target(pane)?, false)
}

#[tauri::command(async)]
pub fn open_system_settings(pane: String) -> CommandResult<()> {
    launch_settings(&pane)
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
        for bad in [
            "http://example.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ms-settings:privacy",
            "not a url",
            "https://",
        ] {
            assert!(
                validate_https_url(bad).is_err(),
                "{bad:?} deveria ser barrado"
            );
        }
    }

    #[test]
    fn linux_opens_the_first_installed_settings_app_for_notifications() {
        assert_eq!(
            linux_settings_command("notifications", |_: &str| true).unwrap(),
            ("gnome-control-center", &["notifications"][..])
        );
        assert_eq!(
            linux_settings_command("notifications", |program: &str| program == "systemsettings")
                .unwrap(),
            ("systemsettings", &["kcm_notifications"][..])
        );
    }

    #[test]
    fn linux_settings_fail_cleanly_without_an_app_or_for_unknown_panes() {
        assert_eq!(
            linux_settings_command("notifications", |_: &str| false)
                .unwrap_err()
                .kind,
            ErrorKind::ProgramNotFound
        );
        assert_eq!(
            linux_settings_command("privacy", |_: &str| true)
                .unwrap_err()
                .kind,
            ErrorKind::InvalidArgument
        );
    }

    #[test]
    fn maps_known_settings_panes_only() {
        assert!(settings_target("notifications").is_ok());
        assert!(settings_target("privacy").is_err());
    }
}

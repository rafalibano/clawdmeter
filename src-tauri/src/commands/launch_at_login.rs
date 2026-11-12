use serde::Serialize;
use tauri::AppHandle;

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LaunchAtLoginStatus {
    pub supported: bool,
    pub enabled: bool,
}

pub trait LaunchAtLogin {
    fn status(&self) -> CommandResult<LaunchAtLoginStatus>;
    fn enable(&self) -> CommandResult<()>;
    fn disable(&self) -> CommandResult<()>;
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn ensure_stable_location(executable: &str) -> CommandResult<()> {
    if executable.contains("/AppTranslocation/") || executable.starts_with("/Volumes/") {
        Err(CommandError::new(
            ErrorKind::Policy,
            "ClawdMeter is running from a disk image or a temporary location; move it to /Applications and open it again before turning on launch at login",
        ))
    } else {
        Ok(())
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn agent_points_to(plist: &str, executable: &str, identifier: &str) -> bool {
    plist.contains(&format!("<array><string>{executable}</string></array>"))
        && plist.contains(&format!("<array><string>{identifier}</string></array>"))
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn autostart_exec(appimage: Option<&str>, executable: &str) -> CommandResult<String> {
    let appimage = appimage.filter(|path| !path.is_empty());
    let target = appimage.unwrap_or(executable);
    if appimage.is_none() && executable.starts_with("/tmp/.mount_") {
        return Err(CommandError::new(
            ErrorKind::Policy,
            "ClawdMeter is running from a mounted AppImage without $APPIMAGE; open the .AppImage file directly before turning on launch at login",
        ));
    }
    if target
        .chars()
        .any(|c| c.is_control() || matches!(c, '"' | '`' | '$' | '\\' | '%'))
    {
        return Err(CommandError::new(
            ErrorKind::Policy,
            "the path of ClawdMeter has characters an autostart entry cannot hold; move it to a plain folder before turning on launch at login",
        ));
    }
    Ok(format!("\"{target}\""))
}

pub fn refresh(system: &impl LaunchAtLogin) -> CommandResult<bool> {
    if !system.status()?.enabled {
        return Ok(false);
    }
    system.enable().map(|()| true)
}

pub fn system(app: &AppHandle) -> platform::System {
    platform::System::new(app)
}

#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn from_auto_launch(error: auto_launch::Error) -> CommandError {
    match error {
        auto_launch::Error::Io(error) => error.into(),
        _ => CommandError::new(ErrorKind::Io, "could not change launch at login"),
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::{Path, PathBuf};

    use auto_launch::{AutoLaunch, AutoLaunchBuilder, MacOSLaunchMode};
    use tauri::AppHandle;

    use super::{
        agent_points_to, ensure_stable_location, from_auto_launch, LaunchAtLogin,
        LaunchAtLoginStatus,
    };
    use crate::commands::error::CommandResult;

    pub struct System {
        name: String,
        identifier: String,
    }

    impl System {
        pub fn new(app: &AppHandle) -> Self {
            Self {
                name: app.package_info().name.clone(),
                identifier: app.config().identifier.clone(),
            }
        }

        fn agent(&self, executable: &Path) -> CommandResult<AutoLaunch> {
            AutoLaunchBuilder::new()
                .set_app_name(&self.name)
                .set_app_path(&executable.display().to_string())
                .set_macos_launch_mode(MacOSLaunchMode::LaunchAgent)
                .set_bundle_identifiers(&[&self.identifier])
                .build()
                .map_err(from_auto_launch)
        }

        fn plist(&self) -> Option<PathBuf> {
            std::env::var_os("HOME").map(|home| {
                PathBuf::from(home)
                    .join("Library/LaunchAgents")
                    .join(format!("{}.plist", self.name))
            })
        }
    }

    impl LaunchAtLogin for System {
        fn status(&self) -> CommandResult<LaunchAtLoginStatus> {
            let enabled = self
                .agent(&std::env::current_exe()?)?
                .is_enabled()
                .map_err(from_auto_launch)?;
            Ok(LaunchAtLoginStatus {
                supported: true,
                enabled,
            })
        }

        fn enable(&self) -> CommandResult<()> {
            let executable = std::env::current_exe()?.canonicalize()?;
            let path = executable.display().to_string();
            ensure_stable_location(&path)?;
            let current = self
                .plist()
                .and_then(|plist| std::fs::read_to_string(plist).ok())
                .is_some_and(|plist| agent_points_to(&plist, &path, &self.identifier));
            if current {
                return Ok(());
            }
            self.agent(&executable)?.enable().map_err(from_auto_launch)
        }

        fn disable(&self) -> CommandResult<()> {
            self.agent(&std::env::current_exe()?)?
                .disable()
                .map_err(from_auto_launch)
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};
    use tauri::AppHandle;

    use super::{from_auto_launch, LaunchAtLogin, LaunchAtLoginStatus};
    use crate::commands::error::CommandResult;

    pub struct System {
        name: String,
    }

    impl System {
        pub fn new(app: &AppHandle) -> Self {
            Self {
                name: app.package_info().name.clone(),
            }
        }

        fn run_key(&self) -> CommandResult<AutoLaunch> {
            let executable = std::env::current_exe()?;
            AutoLaunchBuilder::new()
                .set_app_name(&self.name)
                .set_app_path(&format!("\"{}\"", executable.display()))
                .set_windows_enable_mode(WindowsEnableMode::CurrentUser)
                .build()
                .map_err(from_auto_launch)
        }
    }

    impl LaunchAtLogin for System {
        fn status(&self) -> CommandResult<LaunchAtLoginStatus> {
            let enabled = self.run_key()?.is_enabled().map_err(from_auto_launch)?;
            Ok(LaunchAtLoginStatus {
                supported: true,
                enabled,
            })
        }

        fn enable(&self) -> CommandResult<()> {
            self.run_key()?.enable().map_err(from_auto_launch)
        }

        fn disable(&self) -> CommandResult<()> {
            self.run_key()?.disable().map_err(from_auto_launch)
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use auto_launch::{AutoLaunch, AutoLaunchBuilder, LinuxLaunchMode};
    use tauri::AppHandle;

    use super::{autostart_exec, from_auto_launch, LaunchAtLogin, LaunchAtLoginStatus};
    use crate::commands::error::CommandResult;

    pub struct System {
        name: String,
    }

    impl System {
        pub fn new(app: &AppHandle) -> Self {
            Self {
                name: app.package_info().name.clone(),
            }
        }

        fn entry(&self, exec: &str) -> CommandResult<AutoLaunch> {
            AutoLaunchBuilder::new()
                .set_app_name(&self.name)
                .set_app_path(exec)
                .set_linux_launch_mode(LinuxLaunchMode::XdgAutostart)
                .build()
                .map_err(from_auto_launch)
        }

        fn current_entry(&self) -> CommandResult<AutoLaunch> {
            self.entry(&std::env::current_exe()?.to_string_lossy())
        }
    }

    impl LaunchAtLogin for System {
        fn status(&self) -> CommandResult<LaunchAtLoginStatus> {
            let enabled = self
                .current_entry()?
                .is_enabled()
                .map_err(from_auto_launch)?;
            Ok(LaunchAtLoginStatus {
                supported: true,
                enabled,
            })
        }

        fn enable(&self) -> CommandResult<()> {
            let executable = std::env::current_exe()?;
            let appimage = std::env::var("APPIMAGE").ok();
            let exec = autostart_exec(appimage.as_deref(), &executable.to_string_lossy())?;
            self.entry(&exec)?.enable().map_err(from_auto_launch)
        }

        fn disable(&self) -> CommandResult<()> {
            self.current_entry()?.disable().map_err(from_auto_launch)
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod platform {
    use tauri::AppHandle;

    use super::{unsupported, LaunchAtLogin, LaunchAtLoginStatus};
    use crate::commands::error::CommandResult;

    pub struct System;

    impl System {
        pub fn new(_app: &AppHandle) -> Self {
            Self
        }
    }

    impl LaunchAtLogin for System {
        fn status(&self) -> CommandResult<LaunchAtLoginStatus> {
            Ok(LaunchAtLoginStatus {
                supported: false,
                enabled: false,
            })
        }

        fn enable(&self) -> CommandResult<()> {
            Err(unsupported())
        }

        fn disable(&self) -> CommandResult<()> {
            Err(unsupported())
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn unsupported() -> CommandError {
    CommandError::new(
        ErrorKind::Policy,
        "launch at login is not supported on this system",
    )
}

#[tauri::command]
pub async fn launch_at_login_status(app: AppHandle) -> CommandResult<LaunchAtLoginStatus> {
    let system = system(&app);
    run_blocking(move || system.status()).await
}

#[tauri::command]
pub async fn launch_at_login_enable(app: AppHandle) -> CommandResult<()> {
    let system = system(&app);
    run_blocking(move || system.enable()).await
}

#[tauri::command]
pub async fn launch_at_login_disable(app: AppHandle) -> CommandResult<()> {
    let system = system(&app);
    run_blocking(move || system.disable()).await
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;

    struct FakeSystem {
        status: CommandResult<LaunchAtLoginStatus>,
        enable: CommandResult<()>,
        enables: Cell<u32>,
        calls: RefCell<Vec<&'static str>>,
    }

    impl FakeSystem {
        fn new(supported: bool, enabled: bool) -> Self {
            Self {
                status: Ok(LaunchAtLoginStatus { supported, enabled }),
                enable: Ok(()),
                enables: Cell::new(0),
                calls: RefCell::new(Vec::new()),
            }
        }
    }

    impl LaunchAtLogin for FakeSystem {
        fn status(&self) -> CommandResult<LaunchAtLoginStatus> {
            self.calls.borrow_mut().push("status");
            self.status.clone()
        }

        fn enable(&self) -> CommandResult<()> {
            self.calls.borrow_mut().push("enable");
            self.enables.set(self.enables.get() + 1);
            self.enable.clone()
        }

        fn disable(&self) -> CommandResult<()> {
            self.calls.borrow_mut().push("disable");
            Ok(())
        }
    }

    #[test]
    fn accepts_an_app_installed_in_applications() {
        assert!(
            ensure_stable_location("/Applications/ClawdMeter.app/Contents/MacOS/clawdmeter")
                .is_ok()
        );
        assert!(ensure_stable_location(
            "/Users/dev/Applications/ClawdMeter.app/Contents/MacOS/clawdmeter"
        )
        .is_ok());
    }

    #[test]
    fn refuses_an_app_running_from_app_translocation() {
        let error = ensure_stable_location(
            "/private/var/folders/xy/T/AppTranslocation/0A1B2C/d/ClawdMeter.app/Contents/MacOS/clawdmeter",
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Policy);
        assert!(error.message.contains("/Applications"));
        assert!(!error.message.contains("AppTranslocation/0A1B2C"));
    }

    #[test]
    fn refuses_an_app_running_from_a_mounted_disk_image() {
        let error =
            ensure_stable_location("/Volumes/ClawdMeter/ClawdMeter.app/Contents/MacOS/clawdmeter")
                .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Policy);
        assert!(error.message.contains("/Applications"));
    }

    #[test]
    fn only_refuses_volumes_at_the_root() {
        assert!(ensure_stable_location("/Users/dev/Volumes/ClawdMeter.app/clawdmeter").is_ok());
    }

    #[test]
    fn agent_is_current_only_with_the_same_executable_and_bundle_identifier() {
        let plist = "<plist version=\"1.0\">\n  <dict>\n  <key>Label</key>\n  <string>ClawdMeter</string>\n  <key>AssociatedBundleIdentifiers</key>\n  <array><string>com.mottu.clawdmeter</string></array>\n  <key>ProgramArguments</key>\n  <array><string>/Applications/ClawdMeter.app/Contents/MacOS/clawdmeter</string></array>\n  </dict>\n</plist>";
        let executable = "/Applications/ClawdMeter.app/Contents/MacOS/clawdmeter";
        assert!(agent_points_to(plist, executable, "com.mottu.clawdmeter"));
        assert!(!agent_points_to(
            plist,
            "/Users/dev/Downloads/ClawdMeter.app/Contents/MacOS/clawdmeter",
            "com.mottu.clawdmeter"
        ));
        assert!(!agent_points_to(plist, executable, "com.mottu.devpulse"));
        let without_identifiers = plist.replace("<string>com.mottu.clawdmeter</string>", "");
        assert!(!agent_points_to(
            &without_identifiers,
            executable,
            "com.mottu.clawdmeter"
        ));
    }

    #[test]
    fn the_autostart_entry_starts_the_appimage_file_not_its_temporary_mount() {
        assert_eq!(
            autostart_exec(
                Some("/home/dev/Apps/ClawdMeter_0.2.4_amd64.AppImage"),
                "/tmp/.mount_ClawdMaBcDe/usr/bin/clawdmeter"
            ),
            Ok("\"/home/dev/Apps/ClawdMeter_0.2.4_amd64.AppImage\"".to_owned())
        );
        assert_eq!(
            autostart_exec(None, "/usr/bin/clawdmeter"),
            Ok("\"/usr/bin/clawdmeter\"".to_owned())
        );
        assert_eq!(
            autostart_exec(Some("/home/dev/My Apps/ClawdMeter.AppImage"), "/x"),
            Ok("\"/home/dev/My Apps/ClawdMeter.AppImage\"".to_owned())
        );
    }

    #[test]
    fn the_autostart_entry_refuses_a_mount_without_appimage_or_an_unquotable_path() {
        let mounted =
            autostart_exec(None, "/tmp/.mount_ClawdMaBcDe/usr/bin/clawdmeter").unwrap_err();
        assert_eq!(mounted.kind, ErrorKind::Policy);
        assert!(mounted.message.contains(".AppImage"));
        for path in [
            "/home/dev/$HOME/ClawdMeter.AppImage",
            "/home/dev/a\"b/ClawdMeter.AppImage",
            "/home/dev/100%/ClawdMeter.AppImage",
            "/home/dev/a\\b/ClawdMeter.AppImage",
            "/home/dev/a`id`/ClawdMeter.AppImage",
            "/home/dev/a\nExec=evil/ClawdMeter.AppImage",
        ] {
            assert_eq!(
                autostart_exec(Some(path), "/x").unwrap_err().kind,
                ErrorKind::Policy,
                "{path:?}"
            );
        }
    }

    #[test]
    fn refresh_rewrites_the_entry_only_when_it_is_enabled() {
        let enabled = FakeSystem::new(true, true);
        assert_eq!(refresh(&enabled), Ok(true));
        assert_eq!(*enabled.calls.borrow(), vec!["status", "enable"]);

        let disabled = FakeSystem::new(true, false);
        assert_eq!(refresh(&disabled), Ok(false));
        assert_eq!(disabled.enables.get(), 0);

        let unsupported = FakeSystem::new(false, false);
        assert_eq!(refresh(&unsupported), Ok(false));
        assert_eq!(unsupported.enables.get(), 0);
    }

    #[test]
    fn refresh_reports_read_and_write_failures_without_retrying() {
        let mut unreadable = FakeSystem::new(true, true);
        unreadable.status = Err(CommandError::new(ErrorKind::Io, "denied"));
        assert_eq!(refresh(&unreadable).unwrap_err().kind, ErrorKind::Io);
        assert_eq!(unreadable.enables.get(), 0);

        let mut moved = FakeSystem::new(true, true);
        moved.enable = ensure_stable_location("/Volumes/ClawdMeter/ClawdMeter.app");
        assert_eq!(refresh(&moved).unwrap_err().kind, ErrorKind::Policy);
        assert_eq!(moved.enables.get(), 1);
    }

    #[test]
    fn status_serializes_with_the_fields_the_frontend_reads() {
        assert_eq!(
            serde_json::to_string(&LaunchAtLoginStatus {
                supported: true,
                enabled: false
            })
            .unwrap(),
            r#"{"supported":true,"enabled":false}"#
        );
    }
}

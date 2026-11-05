use tauri::AppHandle;

use super::blocking::run_blocking;
use super::error::CommandResult;

pub const GRANTED: &str = "granted";
pub const DENIED: &str = "denied";
pub const PROMPT: &str = "prompt";
pub const UNKNOWN: &str = "unknown";

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn state_from_authorization_status(raw: isize) -> &'static str {
    match raw {
        0 => PROMPT,
        1 => DENIED,
        2..=4 => GRANTED,
        _ => UNKNOWN,
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn state_from_toast_setting(raw: i32) -> &'static str {
    match raw {
        0 => GRANTED,
        1..=4 => DENIED,
        _ => UNKNOWN,
    }
}

#[cfg(target_os = "macos")]
fn platform_state(_app: &AppHandle) -> &'static str {
    use std::ptr::NonNull;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2_foundation::NSBundle;
    use objc2_user_notifications::{UNNotificationSettings, UNUserNotificationCenter};

    let bundle = NSBundle::mainBundle();
    let packaged =
        bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app");
    if !packaged {
        return UNKNOWN;
    }
    let (sender, receiver) = mpsc::channel();
    let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        let status = unsafe { settings.as_ref() }.authorizationStatus().0;
        let _ = sender.send(status);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&handler);
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map(state_from_authorization_status)
        .unwrap_or(UNKNOWN)
}

#[cfg(windows)]
struct ComScope(bool);

#[cfg(windows)]
impl ComScope {
    fn enter() -> Self {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

#[cfg(windows)]
impl Drop for ComScope {
    fn drop(&mut self) {
        if self.0 {
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
}

#[cfg(windows)]
fn platform_state(app: &AppHandle) -> &'static str {
    use windows::core::HSTRING;
    use windows::UI::Notifications::ToastNotificationManager;

    let _com = ComScope::enter();
    let app_id = HSTRING::from(app.config().identifier.as_str());
    ToastNotificationManager::CreateToastNotifierWithId(&app_id)
        .and_then(|notifier| notifier.Setting())
        .map(|setting| state_from_toast_setting(setting.0))
        .unwrap_or(UNKNOWN)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_state(_app: &AppHandle) -> &'static str {
    UNKNOWN
}

#[tauri::command]
pub async fn notification_permission_state(app: AppHandle) -> CommandResult<&'static str> {
    run_blocking(move || Ok(platform_state(&app))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_unuser_notification_authorization_status() {
        assert_eq!(state_from_authorization_status(0), "prompt");
        assert_eq!(state_from_authorization_status(1), "denied");
        assert_eq!(state_from_authorization_status(2), "granted");
        assert_eq!(state_from_authorization_status(3), "granted");
        assert_eq!(state_from_authorization_status(4), "granted");
        assert_eq!(state_from_authorization_status(99), "unknown");
        assert_eq!(state_from_authorization_status(-1), "unknown");
    }

    #[test]
    fn maps_windows_toast_setting() {
        assert_eq!(state_from_toast_setting(0), "granted");
        for disabled in 1..=4 {
            assert_eq!(state_from_toast_setting(disabled), "denied");
        }
        assert_eq!(state_from_toast_setting(7), "unknown");
    }
}

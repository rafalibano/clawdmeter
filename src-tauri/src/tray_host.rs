use std::path::Path;

pub const NO_TRAY: &str = "no-tray";
pub const NO_TRAY_MARKER: &str = ".no-tray-notice-shown";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupNotice(pub Option<&'static str>);

pub fn tray_missing(watcher_has_owner: Option<bool>) -> bool {
    watcher_has_owner == Some(false)
}

pub fn first_run_notice(tray_missing: bool, shown_before: bool) -> Option<&'static str> {
    (tray_missing && !shown_before).then_some(NO_TRAY)
}

pub fn resolve(marker_dir: Option<&Path>, watcher_has_owner: Option<bool>) -> StartupNotice {
    let marker = marker_dir.map(|dir| dir.join(NO_TRAY_MARKER));
    let shown_before = marker.as_deref().is_some_and(Path::exists);
    let notice = first_run_notice(tray_missing(watcher_has_owner), shown_before);
    if notice.is_some() {
        if let Some(marker) = marker {
            if let Some(dir) = marker.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(marker, NO_TRAY);
        }
    }
    StartupNotice(notice)
}

#[cfg(target_os = "linux")]
pub fn status_notifier_watcher_has_owner() -> Option<bool> {
    use std::time::Duration;

    let connection = dbus::blocking::Connection::new_session().ok()?;
    let bus = connection.with_proxy(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        Duration::from_millis(1_500),
    );
    let (owned,): (bool,) = bus
        .method_call(
            "org.freedesktop.DBus",
            "NameHasOwner",
            ("org.kde.StatusNotifierWatcher",),
        )
        .ok()?;
    Some(owned)
}

#[cfg(not(target_os = "linux"))]
pub fn status_notifier_watcher_has_owner() -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("clawdmeter-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn only_a_watcher_known_to_be_absent_counts_as_no_tray() {
        assert!(tray_missing(Some(false)));
        assert!(!tray_missing(Some(true)));
        assert!(!tray_missing(None));
    }

    #[test]
    fn the_notice_shows_only_on_the_first_run_without_a_tray() {
        assert_eq!(first_run_notice(true, false), Some("no-tray"));
        assert_eq!(first_run_notice(true, true), None);
        assert_eq!(first_run_notice(false, false), None);
    }

    #[test]
    fn the_first_run_writes_the_marker_and_the_second_stays_quiet() {
        let dir = sandbox("tray-notice");
        assert_eq!(
            resolve(Some(&dir), Some(false)),
            StartupNotice(Some("no-tray"))
        );
        assert!(dir.join(NO_TRAY_MARKER).exists());
        assert_eq!(resolve(Some(&dir), Some(false)), StartupNotice(None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_present_or_unknown_tray_leaves_no_marker() {
        let dir = sandbox("tray-present");
        assert_eq!(resolve(Some(&dir), Some(true)), StartupNotice(None));
        assert_eq!(resolve(Some(&dir), None), StartupNotice(None));
        assert!(!dir.join(NO_TRAY_MARKER).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn without_a_state_dir_the_notice_still_shows() {
        assert_eq!(resolve(None, Some(false)), StartupNotice(Some("no-tray")));
    }
}

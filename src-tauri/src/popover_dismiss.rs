use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[cfg(any(target_os = "macos", test))]
use crate::popover_geometry::{Point, Rect};

#[cfg(any(target_os = "macos", test))]
pub const GRACE_MS: u64 = 300;

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HideReason {
    Blur,
    GlobalClick,
    AppActivated,
    Escape,
    Toggle,
}

impl HideReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Blur => "blur",
            Self::GlobalClick => "global-click",
            Self::AppActivated => "app-activated",
            Self::Escape => "esc",
            Self::Toggle => "toggle",
        }
    }

    pub const fn guards_reopen(self) -> bool {
        !matches!(self, Self::Toggle)
    }
}

pub const NEVER: u64 = u64::MAX;

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

pub fn wall_clock_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

pub fn monotonic_ms() -> u64 {
    let elapsed = PROCESS_START.get_or_init(Instant::now).elapsed();
    u64::try_from(elapsed.as_millis()).unwrap_or(NEVER - 1)
}

#[derive(Debug, Default)]
pub struct ShowEpoch(AtomicU64);

impl ShowEpoch {
    pub const fn new() -> Self {
        Self(AtomicU64::new(0))
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn begin(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn is_current(&self, epoch: u64) -> bool {
        self.0.load(Ordering::SeqCst) == epoch
    }
}

pub fn elapsed_since(earlier_ms: u64, now_ms: u64) -> u64 {
    if earlier_ms == NEVER {
        NEVER
    } else {
        now_ms.saturating_sub(earlier_ms)
    }
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Trigger {
    Click(Point),
    AppActivated(i32),
    Escape,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Session {
    pub shown_at_ms: u64,
    pub frontmost_pid: Option<i32>,
    pub own_pid: Option<i32>,
    pub tray_icon: Option<Rect>,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Dismiss(HideReason),
    Ignore(&'static str),
}

#[cfg(any(target_os = "macos", test))]
pub fn decide(session: &Session, now_ms: u64, panel: Rect, trigger: Trigger) -> Decision {
    if now_ms.saturating_sub(session.shown_at_ms) < GRACE_MS {
        return Decision::Ignore("grace");
    }
    match trigger {
        Trigger::Click(point) if panel.contains(point) => Decision::Ignore("inside-panel"),
        Trigger::Click(point) if session.tray_icon.is_some_and(|icon| icon.contains(point)) => {
            Decision::Ignore("tray-icon")
        }
        Trigger::Click(_) => Decision::Dismiss(HideReason::GlobalClick),
        Trigger::AppActivated(pid) if Some(pid) == session.own_pid => Decision::Ignore("own-app"),
        Trigger::AppActivated(pid) if Some(pid) == session.frontmost_pid => {
            Decision::Ignore("same-app")
        }
        Trigger::AppActivated(_) => Decision::Dismiss(HideReason::AppActivated),
        Trigger::Escape => Decision::Dismiss(HideReason::Escape),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHOWN: u64 = 1_000_000;
    const PANEL: Rect = Rect::new(100.0, 100.0, 400.0, 500.0);
    const TRAY: Rect = Rect::new(450.0, 870.0, 64.0, 24.0);

    fn session() -> Session {
        Session {
            shown_at_ms: SHOWN,
            frontmost_pid: Some(42),
            own_pid: Some(7),
            tray_icon: Some(TRAY),
        }
    }

    fn after(ms: u64, trigger: Trigger) -> Decision {
        decide(&session(), SHOWN + ms, PANEL, trigger)
    }

    const OUTSIDE: Point = Point { x: 900.0, y: 300.0 };

    #[test]
    fn nothing_dismisses_during_the_grace_period() {
        for trigger in [
            Trigger::Click(OUTSIDE),
            Trigger::AppActivated(99),
            Trigger::Escape,
        ] {
            assert_eq!(after(0, trigger), Decision::Ignore("grace"));
            assert_eq!(after(GRACE_MS - 1, trigger), Decision::Ignore("grace"));
        }
    }

    #[test]
    fn click_outside_panel_and_tray_dismisses_after_grace() {
        assert_eq!(
            after(GRACE_MS, Trigger::Click(OUTSIDE)),
            Decision::Dismiss(HideReason::GlobalClick)
        );
    }

    #[test]
    fn click_inside_panel_keeps_it_open() {
        let inside = Point { x: 300.0, y: 400.0 };
        assert_eq!(
            after(5_000, Trigger::Click(inside)),
            Decision::Ignore("inside-panel")
        );
    }

    #[test]
    fn click_on_tray_icon_is_left_to_the_toggle() {
        let on_icon = Point { x: 470.0, y: 880.0 };
        assert_eq!(
            after(5_000, Trigger::Click(on_icon)),
            Decision::Ignore("tray-icon")
        );
    }

    #[test]
    fn click_without_known_tray_icon_only_checks_the_panel() {
        let mut no_icon = session();
        no_icon.tray_icon = None;
        let on_icon = Point { x: 470.0, y: 880.0 };
        assert_eq!(
            decide(&no_icon, SHOWN + 5_000, PANEL, Trigger::Click(on_icon)),
            Decision::Dismiss(HideReason::GlobalClick)
        );
    }

    #[test]
    fn reactivating_the_app_that_was_already_frontmost_keeps_it_open() {
        assert_eq!(
            after(5_000, Trigger::AppActivated(42)),
            Decision::Ignore("same-app")
        );
    }

    #[test]
    fn activating_our_own_app_keeps_it_open() {
        assert_eq!(
            after(5_000, Trigger::AppActivated(7)),
            Decision::Ignore("own-app")
        );
    }

    #[test]
    fn activating_another_app_dismisses() {
        assert_eq!(
            after(5_000, Trigger::AppActivated(99)),
            Decision::Dismiss(HideReason::AppActivated)
        );
    }

    #[test]
    fn unknown_frontmost_app_dismisses_on_any_other_activation() {
        let mut unknown = session();
        unknown.frontmost_pid = None;
        assert_eq!(
            decide(&unknown, SHOWN + 5_000, PANEL, Trigger::AppActivated(42)),
            Decision::Dismiss(HideReason::AppActivated)
        );
    }

    #[test]
    fn escape_dismisses_after_grace() {
        assert_eq!(
            after(GRACE_MS, Trigger::Escape),
            Decision::Dismiss(HideReason::Escape)
        );
    }

    #[test]
    fn clock_going_backwards_counts_as_grace() {
        assert_eq!(
            decide(&session(), SHOWN - 10, PANEL, Trigger::Escape),
            Decision::Ignore("grace")
        );
    }

    #[test]
    fn the_monotonic_clock_never_goes_backwards() {
        let first = monotonic_ms();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = monotonic_ms();
        assert!(second >= first + 5);
        assert!(second < NEVER);
    }

    #[test]
    fn a_deferred_hide_from_an_older_show_is_stale() {
        let shows = ShowEpoch::new();
        let first = shows.begin();
        assert!(shows.is_current(first));
        let second = shows.begin();
        assert!(!shows.is_current(first));
        assert!(shows.is_current(second));
    }

    #[test]
    fn a_hide_that_never_happened_is_infinitely_far_away() {
        assert_eq!(elapsed_since(NEVER, 0), NEVER);
        assert_eq!(elapsed_since(NEVER, 123), NEVER);
        assert_eq!(elapsed_since(100, 350), 250);
        assert_eq!(elapsed_since(400, 350), 0);
    }

    #[test]
    fn only_the_toggle_skips_the_reopen_guard() {
        assert!(!HideReason::Toggle.guards_reopen());
        for reason in [
            HideReason::Blur,
            HideReason::GlobalClick,
            HideReason::AppActivated,
            HideReason::Escape,
        ] {
            assert!(reason.guards_reopen());
        }
    }

    #[test]
    fn reasons_have_stable_log_names() {
        let names: Vec<_> = [
            HideReason::Blur,
            HideReason::GlobalClick,
            HideReason::AppActivated,
            HideReason::Escape,
            HideReason::Toggle,
        ]
        .map(HideReason::as_str)
        .to_vec();
        assert_eq!(
            names,
            ["blur", "global-click", "app-activated", "esc", "toggle"]
        );
    }
}

use crate::usage_icon::{self, UsageIcon};

pub const REOPEN_GUARD_MS: u64 = 250;

#[derive(Debug, PartialEq, Eq)]
pub enum ClickAction {
    Show,
    Hide,
    Ignore,
}

pub fn click_action(visible: bool, ms_since_blur_hide: u64) -> ClickAction {
    if visible {
        ClickAction::Hide
    } else if ms_since_blur_hide <= REOPEN_GUARD_MS {
        ClickAction::Ignore
    } else {
        ClickAction::Show
    }
}

#[cfg(target_os = "macos")]
pub fn configure_app(app: &mut tauri::App) {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

#[cfg(not(target_os = "macos"))]
pub fn configure_app(_app: &mut tauri::App) {}

#[cfg(target_os = "macos")]
pub const TRAY_ICON_IS_TEMPLATE: bool = true;

#[cfg(not(target_os = "macos"))]
pub const TRAY_ICON_IS_TEMPLATE: bool = false;

#[cfg(target_os = "macos")]
pub fn usage_icon(five_hour: Option<f64>, seven_day: Option<f64>) -> UsageIcon {
    usage_icon::render_usage_icon(five_hour, seven_day, 2)
}

#[cfg(not(target_os = "macos"))]
pub fn usage_icon(five_hour: Option<f64>, seven_day: Option<f64>) -> UsageIcon {
    usage_icon::render_usage_icon_square(five_hour, seven_day, 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_icon_matches_the_tray_shape_of_the_os() {
        let icon = usage_icon(Some(24.0), Some(51.0));
        if cfg!(target_os = "macos") {
            assert_eq!((icon.width, icon.height), (116, 36));
        } else {
            assert_eq!((icon.width, icon.height), (32, 32));
        }
    }

    #[test]
    fn click_with_visible_popover_hides_it() {
        assert_eq!(click_action(true, 10_000), ClickAction::Hide);
    }

    #[test]
    fn click_right_after_blur_hide_is_ignored() {
        assert_eq!(click_action(false, 50), ClickAction::Ignore);
        assert_eq!(click_action(false, REOPEN_GUARD_MS), ClickAction::Ignore);
    }

    #[test]
    fn click_on_hidden_popover_shows_it() {
        assert_eq!(click_action(false, REOPEN_GUARD_MS + 1), ClickAction::Show);
    }
}

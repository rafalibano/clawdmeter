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

#[cfg(test)]
mod tests {
    use super::*;

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

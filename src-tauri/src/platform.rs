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
mod popover {
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
    use objc2::{define_class, ffi, ClassType, MainThreadOnly};
    use objc2_app_kit::{
        NSPanel, NSPopUpMenuWindowLevel, NSResponder, NSWindow, NSWindowCollectionBehavior,
        NSWindowLevel, NSWindowStyleMask,
    };

    define_class!(
        #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "DevPulsePopoverPanel"]
        pub struct PopoverPanel;

        impl PopoverPanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                true
            }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main_window(&self) -> bool {
                false
            }
        }
    );

    pub fn collection_behavior() -> NSWindowCollectionBehavior {
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle
    }

    pub fn window_level() -> NSWindowLevel {
        NSPopUpMenuWindowLevel
    }

    pub fn merge_behavior(current: NSWindowCollectionBehavior) -> NSWindowCollectionBehavior {
        (current
            - NSWindowCollectionBehavior::FullScreenPrimary
            - NSWindowCollectionBehavior::Transient
            - NSWindowCollectionBehavior::MoveToActiveSpace)
            | collection_behavior()
    }

    pub fn style_mask(current: NSWindowStyleMask) -> NSWindowStyleMask {
        current | NSWindowStyleMask::NonactivatingPanel
    }

    pub fn panel_shares_window_layout() -> bool {
        let window_size = NSWindow::class().instance_size();
        NSPanel::class().instance_size() == window_size
            && PopoverPanel::class().instance_size() == window_size
    }

    fn into_panel(window: &NSWindow) -> Option<&NSPanel> {
        if !window.isKindOfClass(PopoverPanel::class()) {
            if !panel_shares_window_layout()
                || window.class().instance_size() < PopoverPanel::class().instance_size()
            {
                return None;
            }
            let object: *const NSWindow = window;
            unsafe {
                ffi::object_setClass(object.cast_mut().cast::<AnyObject>(), PopoverPanel::class())
            };
        }
        window.downcast_ref::<NSPanel>()
    }

    pub fn apply(window: &NSWindow) {
        if let Some(panel) = into_panel(window) {
            panel.setStyleMask(style_mask(panel.styleMask()));
            panel.setFloatingPanel(true);
            panel.setBecomesKeyOnlyIfNeeded(false);
            panel.setHidesOnDeactivate(false);
        }
        window.setCollectionBehavior(merge_behavior(window.collectionBehavior()));
        window.setLevel(window_level());
    }

    pub fn show(window: &NSWindow) {
        window.orderFrontRegardless();
        window.makeKeyWindow();
    }
}

#[cfg(target_os = "macos")]
fn on_ns_window(
    window: &tauri::WebviewWindow,
    action: impl FnOnce(&objc2_app_kit::NSWindow) + Send + 'static,
) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Ok(ptr) = target.ns_window() {
            if !ptr.is_null() {
                action(unsafe { &*ptr.cast::<objc2_app_kit::NSWindow>() });
            }
        }
    });
}

#[cfg(target_os = "macos")]
pub fn prepare_popover(window: &tauri::WebviewWindow) {
    let _ = window.set_visible_on_all_workspaces(true);
    on_ns_window(window, popover::apply);
}

#[cfg(not(target_os = "macos"))]
pub fn prepare_popover(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "macos")]
mod placement {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSRect};

    use crate::popover_geometry::{self as geometry, PhysicalRect, Point, Rect, Screen};

    fn rect(frame: NSRect) -> Rect {
        Rect::new(
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
        )
    }

    fn area(frame: NSRect) -> Option<Rect> {
        Some(rect(frame)).filter(|area| !area.is_empty())
    }

    fn screen(ns_screen: &NSScreen) -> Screen {
        Screen {
            frame: rect(ns_screen.frame()),
            visible_frame: rect(ns_screen.visibleFrame()),
            scale: ns_screen.backingScaleFactor(),
            aux_top_left: area(ns_screen.auxiliaryTopLeftArea()),
            aux_top_right: area(ns_screen.auxiliaryTopRightArea()),
        }
    }

    pub fn apply(window: &NSWindow, icon: Option<PhysicalRect>) {
        let mtm = MainThreadMarker::from(window);
        let ns_screens = NSScreen::screens(mtm);
        let screens: Vec<Screen> = ns_screens.iter().map(|s| screen(&s)).collect();
        let Some(primary) = screens.first() else {
            return;
        };
        let main = NSScreen::mainScreen(mtm)
            .and_then(|main| ns_screens.iter().position(|s| s == main))
            .unwrap_or(0);
        let mouse = NSEvent::mouseLocation();
        let pointer = Point {
            x: mouse.x,
            y: mouse.y,
        };
        let placement = geometry::locate(icon, Some(pointer), primary.frame.height, &screens, main);
        let size = window.frame().size;
        let origin = geometry::popover_origin(
            placement.icon,
            &screens[placement.screen],
            size.width,
            size.height,
        );
        window.setFrameOrigin(NSPoint::new(origin.x, origin.y));
    }
}

#[cfg(target_os = "macos")]
pub fn position_popover(window: &tauri::WebviewWindow, icon: Option<tauri::Rect>) {
    let icon = icon.map(|rect| {
        let position = rect.position.to_physical::<f64>(1.0);
        let size = rect.size.to_physical::<f64>(1.0);
        crate::popover_geometry::PhysicalRect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }
    });
    on_ns_window(window, move |ns_window| placement::apply(ns_window, icon));
}

#[cfg(not(target_os = "macos"))]
pub fn position_popover(window: &tauri::WebviewWindow, _icon: Option<tauri::Rect>) {
    use tauri_plugin_positioner::{Position, WindowExt};

    if window
        .move_window_constrained(Position::TrayCenter)
        .is_err()
    {
        let _ = window.move_window_constrained(Position::BottomRight);
    }
}

#[cfg(target_os = "macos")]
pub fn show_popover(window: &tauri::WebviewWindow) {
    on_ns_window(window, popover::show);
}

#[cfg(not(target_os = "macos"))]
pub fn show_popover(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

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
            assert_eq!((icon.width, icon.height), (128, 36));
        } else {
            assert_eq!((icon.width, icon.height), (32, 32));
        }
    }

    #[cfg(target_os = "macos")]
    mod popover_style {
        use super::super::popover;
        use objc2_app_kit::{
            NSFloatingWindowLevel, NSStatusWindowLevel, NSWindowCollectionBehavior as Behavior,
        };

        #[test]
        fn popover_joins_every_space_and_fullscreen_spaces() {
            let behavior = popover::collection_behavior();
            assert!(behavior.contains(Behavior::CanJoinAllSpaces));
            assert!(behavior.contains(Behavior::FullScreenAuxiliary));
            assert!(behavior.contains(Behavior::Stationary));
            assert!(behavior.contains(Behavior::IgnoresCycle));
        }

        #[test]
        fn popover_level_is_above_floating_and_status_windows() {
            assert!(popover::window_level() > NSFloatingWindowLevel);
            assert!(popover::window_level() >= NSStatusWindowLevel);
        }

        #[test]
        fn merge_keeps_unrelated_flags_and_drops_conflicting_ones() {
            let current = Behavior::FullScreenAllowsTiling
                | Behavior::FullScreenPrimary
                | Behavior::Transient
                | Behavior::MoveToActiveSpace;
            let merged = popover::merge_behavior(current);
            assert!(merged.contains(Behavior::FullScreenAllowsTiling));
            assert!(merged.contains(popover::collection_behavior()));
            assert!(!merged.contains(Behavior::FullScreenPrimary));
            assert!(!merged.contains(Behavior::Transient));
            assert!(!merged.contains(Behavior::MoveToActiveSpace));
        }

        #[test]
        fn panel_swap_keeps_the_window_memory_layout() {
            assert!(popover::panel_shares_window_layout());
        }

        #[test]
        fn popover_panel_is_an_nspanel_overriding_key_and_main() {
            use objc2::{sel, ClassType};
            use objc2_app_kit::NSPanel;

            let panel = popover::PopoverPanel::class();
            assert_eq!(panel.superclass(), Some(NSPanel::class()));
            for selector in [sel!(canBecomeKeyWindow), sel!(canBecomeMainWindow)] {
                let own = panel
                    .instance_method(selector)
                    .map(|m| m.implementation() as *const ());
                let inherited = NSPanel::class()
                    .instance_method(selector)
                    .map(|m| m.implementation() as *const ());
                assert!(own.is_some());
                assert_ne!(own, inherited);
            }
        }

        #[test]
        fn style_mask_adds_nonactivating_and_keeps_existing_bits() {
            use objc2_app_kit::NSWindowStyleMask as Mask;

            let current = Mask::Borderless | Mask::Miniaturizable;
            let mask = popover::style_mask(current);
            assert!(mask.contains(Mask::NonactivatingPanel));
            assert!(mask.contains(Mask::Miniaturizable));
            assert!(!mask.contains(Mask::Titled));
            assert_eq!(popover::style_mask(mask), mask);
        }

        #[test]
        fn merge_is_idempotent() {
            let once = popover::merge_behavior(Behavior::empty());
            assert_eq!(popover::merge_behavior(once), once);
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

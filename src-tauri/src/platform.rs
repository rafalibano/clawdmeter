use crate::popover_dismiss::HideReason;
use crate::usage_icon::{self, UsageIcon};

pub const REOPEN_GUARD_MS: u64 = 250;

pub const HIDE_ON_BLUR: bool = cfg!(not(target_os = "macos"));

#[derive(Debug, PartialEq, Eq)]
pub enum ClickAction {
    Show,
    Hide,
    Ignore,
}

pub fn click_action(visible: bool, ms_since_auto_hide: u64) -> ClickAction {
    if visible {
        ClickAction::Hide
    } else if ms_since_auto_hide <= REOPEN_GUARD_MS {
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
    use objc2::{define_class, ffi, msg_send, sel, ClassType, MainThreadOnly};
    use objc2_app_kit::{
        NSPanel, NSPopUpMenuWindowLevel, NSResponder, NSWindow, NSWindowCollectionBehavior,
        NSWindowLevel, NSWindowStyleMask,
    };

    use crate::popover_log as log;

    define_class!(
        #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ClawdMeterPopoverPanel"]
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

    fn prevent_activation(panel: &NSPanel) -> bool {
        // AppKit only syncs NonactivatingPanel to the window server at init; tauri-nspanel calls this private setter too.
        if !panel.respondsToSelector(sel!(_setPreventsActivation:)) {
            return false;
        }
        let _: () = unsafe { msg_send![panel, _setPreventsActivation: true] };
        true
    }

    fn pin_to_active_space(window: &NSWindow) {
        window.setCollectionBehavior(merge_behavior(window.collectionBehavior()));
        window.setLevel(window_level());
        window.setCanHide(false);
    }

    pub fn apply(window: &NSWindow) {
        if let Some(panel) = into_panel(window) {
            panel.setStyleMask(style_mask(panel.styleMask()));
            let prevents = prevent_activation(panel);
            panel.setFloatingPanel(true);
            panel.setBecomesKeyOnlyIfNeeded(false);
            panel.setHidesOnDeactivate(false);
            log::write(&format!("panel-class ok prevents_activation={prevents}"));
        } else {
            log::write(&format!(
                "panel-class failed class={}",
                window.class().name().to_string_lossy()
            ));
        }
        pin_to_active_space(window);
    }

    pub fn show(window: &NSWindow) {
        pin_to_active_space(window);
        window.orderFrontRegardless();
        window.makeKeyWindow();
    }

    pub fn describe(window: &NSWindow) -> String {
        let frame = window.frame();
        format!(
            "frame=({:.0},{:.0},{:.0}x{:.0}) level={} behavior={:#x} on_active_space={} visible={} key={}",
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
            window.level(),
            window.collectionBehavior().0,
            window.isOnActiveSpace(),
            window.isVisible(),
            window.isKeyWindow()
        )
    }
}

#[cfg(target_os = "macos")]
mod dismiss {
    use std::cell::{Cell, RefCell};
    use std::ptr::{self, NonNull};
    use std::rc::Rc;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObjectProtocol, ProtocolObject};
    use objc2::Message;
    use objc2_app_kit::{
        NSEvent, NSEventMask, NSRunningApplication, NSWindow, NSWorkspace,
        NSWorkspaceDidActivateApplicationNotification,
    };
    use objc2_foundation::{NSNotification, NSOperationQueue};

    use crate::popover_dismiss::{self as rules, Decision, HideReason, Session, Trigger};
    use crate::popover_geometry::{Point, Rect};
    use crate::popover_log as log;

    const ESCAPE_KEY_CODE: u16 = 53;

    struct Monitors {
        clicks: Option<Retained<AnyObject>>,
        escape: Option<Retained<AnyObject>>,
        activation: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    }

    thread_local! {
        static ACTIVE: RefCell<Option<Monitors>> = const { RefCell::new(None) };
        static TRAY_ICON: Cell<Option<Rect>> = const { Cell::new(None) };
    }

    pub fn remember_tray_icon(icon: Option<Rect>) {
        TRAY_ICON.set(icon);
    }

    fn frontmost() -> Option<Retained<NSRunningApplication>> {
        NSWorkspace::sharedWorkspace().frontmostApplication()
    }

    fn describe_app(app: Option<&NSRunningApplication>) -> String {
        app.map_or_else(
            || "none".to_owned(),
            |app| {
                let bundle = app
                    .bundleIdentifier()
                    .map_or_else(|| "?".to_owned(), |id| id.to_string());
                format!("{}:{bundle}", app.processIdentifier())
            },
        )
    }

    fn defer(on_dismiss: Rc<dyn Fn(HideReason)>, reason: HideReason) {
        let block = RcBlock::new(move || on_dismiss(reason));
        // Removing a monitor frees its block, so the hide must not run inside the monitor handler.
        unsafe { NSOperationQueue::mainQueue().addOperationWithBlock(&block) };
    }

    fn evaluator(
        window: &NSWindow,
        session: Session,
        on_dismiss: Rc<dyn Fn(HideReason)>,
    ) -> Rc<dyn Fn(Trigger) -> bool> {
        let window = window.retain();
        let dismissed = Cell::new(false);
        Rc::new(move |trigger| {
            if dismissed.get() {
                return false;
            }
            let frame = window.frame();
            let panel = Rect::new(
                frame.origin.x,
                frame.origin.y,
                frame.size.width,
                frame.size.height,
            );
            match rules::decide(&session, rules::monotonic_ms(), panel, trigger) {
                Decision::Dismiss(reason) => {
                    dismissed.set(true);
                    defer(on_dismiss.clone(), reason);
                    true
                }
                Decision::Ignore(why) => {
                    log::write(&format!("dismiss-ignored trigger={trigger:?} why={why}"));
                    false
                }
            }
        })
    }

    pub fn install(window: &NSWindow, on_dismiss: Rc<dyn Fn(HideReason)>) {
        remove();
        let front = frontmost();
        let session = Session {
            shown_at_ms: rules::monotonic_ms(),
            frontmost_pid: front.as_ref().map(|app| app.processIdentifier()),
            own_pid: Some(NSRunningApplication::currentApplication().processIdentifier()),
            tray_icon: TRAY_ICON.get(),
        };
        log::write(&format!(
            "monitors-install frontmost={} tray_icon={:?}",
            describe_app(front.as_deref()),
            session.tray_icon
        ));
        let evaluate = evaluator(window, session, on_dismiss);

        let on_click = evaluate.clone();
        let clicks_block = RcBlock::new(move |_event: NonNull<NSEvent>| {
            let location = NSEvent::mouseLocation();
            on_click(Trigger::Click(Point {
                x: location.x,
                y: location.y,
            }));
        });
        let clicks = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(
            NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown,
            &clicks_block,
        );

        let on_key = evaluate.clone();
        let escape_block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            let key = unsafe { event.as_ref() }.keyCode();
            if key == ESCAPE_KEY_CODE && on_key(Trigger::Escape) {
                ptr::null_mut()
            } else {
                event.as_ptr()
            }
        });
        let escape = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::KeyDown,
                &escape_block,
            )
        };

        let activation_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            let app = frontmost();
            log::write(&format!("app-activated {}", describe_app(app.as_deref())));
            if let Some(app) = app {
                evaluate(Trigger::AppActivated(app.processIdentifier()));
            }
        });
        let activation = unsafe {
            NSWorkspace::sharedWorkspace()
                .notificationCenter()
                .addObserverForName_object_queue_usingBlock(
                    Some(NSWorkspaceDidActivateApplicationNotification),
                    None,
                    Some(&NSOperationQueue::mainQueue()),
                    &activation_block,
                )
        };

        log::write(&format!(
            "monitors-installed clicks={} escape={}",
            clicks.is_some(),
            escape.is_some()
        ));
        ACTIVE.set(Some(Monitors {
            clicks,
            escape,
            activation,
        }));
    }

    pub fn remove() -> bool {
        let Some(monitors) = ACTIVE.take() else {
            return false;
        };
        for monitor in [monitors.clicks, monitors.escape].into_iter().flatten() {
            unsafe { NSEvent::removeMonitor(&monitor) };
        }
        let observer: &AnyObject = monitors.activation.as_ref();
        unsafe {
            NSWorkspace::sharedWorkspace()
                .notificationCenter()
                .removeObserver(observer)
        };
        true
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
    use crate::popover_log as log;

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

    pub fn apply(window: &NSWindow, icon: Option<PhysicalRect>) -> Option<Rect> {
        let mtm = MainThreadMarker::from(window);
        let ns_screens = NSScreen::screens(mtm);
        let screens: Vec<Screen> = ns_screens.iter().map(|s| screen(&s)).collect();
        let primary = screens.first()?;
        let main = NSScreen::mainScreen(mtm)
            .and_then(|main| ns_screens.iter().position(|s| s == main))
            .unwrap_or(0);
        let mouse = NSEvent::mouseLocation();
        let pointer = Point {
            x: mouse.x,
            y: mouse.y,
        };
        let placement = geometry::locate(icon, Some(pointer), primary.frame.height, &screens, main);
        let target = &screens[placement.screen];
        let size = window.frame().size;
        let origin = geometry::popover_origin(placement.icon, target, size.width, size.height);
        log::write(&format!(
            "position screen={} frame={:?} visible={:?} icon={:?} origin=({:.0},{:.0})",
            placement.screen,
            target.frame,
            target.visible_frame,
            placement.icon,
            origin.x,
            origin.y
        ));
        window.setFrameOrigin(NSPoint::new(origin.x, origin.y));
        placement.icon
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
    on_ns_window(window, move |ns_window| {
        dismiss::remember_tray_icon(placement::apply(ns_window, icon));
    });
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
const SHOW_PROBE_DELAY: std::time::Duration = std::time::Duration::from_millis(100);

#[cfg(target_os = "macos")]
pub fn show_popover(
    window: &tauri::WebviewWindow,
    on_dismiss: impl Fn(HideReason) + Send + 'static,
) {
    use crate::popover_log as log;

    on_ns_window(window, move |ns_window| {
        popover::show(ns_window);
        log::write(&format!("show {}", popover::describe(ns_window)));
        dismiss::install(ns_window, std::rc::Rc::new(on_dismiss));
    });
    let target = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_PROBE_DELAY);
        on_ns_window(&target, |ns_window| {
            log::write(&format!("show+100ms {}", popover::describe(ns_window)));
        });
    });
}

#[cfg(not(target_os = "macos"))]
pub fn show_popover(
    window: &tauri::WebviewWindow,
    _on_dismiss: impl Fn(HideReason) + Send + 'static,
) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(target_os = "macos")]
pub fn release_popover(window: &tauri::WebviewWindow) {
    on_ns_window(window, |_| {
        if dismiss::remove() {
            crate::popover_log::write("monitors-removed");
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn release_popover(_window: &tauri::WebviewWindow) {}

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
    fn click_right_after_auto_hide_is_ignored() {
        assert_eq!(click_action(false, 50), ClickAction::Ignore);
        assert_eq!(click_action(false, REOPEN_GUARD_MS), ClickAction::Ignore);
    }

    #[test]
    fn click_on_hidden_popover_shows_it() {
        assert_eq!(click_action(false, REOPEN_GUARD_MS + 1), ClickAction::Show);
    }

    #[test]
    fn the_first_click_after_launch_opens_the_popover() {
        use crate::popover_dismiss::{elapsed_since, monotonic_ms, NEVER};
        assert_eq!(
            click_action(false, elapsed_since(NEVER, monotonic_ms())),
            ClickAction::Show
        );
        assert_eq!(
            click_action(false, elapsed_since(NEVER, 0)),
            ClickAction::Show
        );
    }
}

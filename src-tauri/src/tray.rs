use std::sync::atomic::{AtomicU64, Ordering};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Rect, Window, WindowEvent};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

use crate::platform::{self, ClickAction};
use crate::popover_dismiss::{elapsed_since, monotonic_ms, HideReason, NEVER};
use crate::popover_log as log;
use crate::usage_icon;

const MAIN_WINDOW: &str = "main";
const QUIT_ID: &str = "quit";
const TRAY_ID: &str = "main";

static LAST_AUTO_HIDE_MS: AtomicU64 = AtomicU64::new(NEVER);

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW {
        return;
    }
    if let WindowEvent::Focused(focused) = event {
        log::write(&format!("focus {focused}"));
        if platform::HIDE_ON_BLUR && !focused && window.is_visible().unwrap_or(false) {
            hide_popover(window.app_handle(), HideReason::Blur);
        }
    }
}

fn hide_popover(app: &AppHandle, reason: HideReason) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    platform::release_popover(&window);
    if reason.guards_reopen() {
        LAST_AUTO_HIDE_MS.store(monotonic_ms(), Ordering::SeqCst);
    }
    log::write(&format!("hide reason={}", reason.as_str()));
    let _ = window.hide();
}

fn describe_icon(icon: Option<Rect>) -> String {
    icon.map_or_else(
        || "none".to_owned(),
        |rect| {
            let position = rect.position.to_physical::<f64>(1.0);
            let size = rect.size.to_physical::<f64>(1.0);
            format!(
                "({:.0},{:.0},{:.0}x{:.0})",
                position.x, position.y, size.width, size.height
            )
        },
    )
}

fn toggle_popover(app: &AppHandle, icon: Option<Rect>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let since_auto_hide = elapsed_since(LAST_AUTO_HIDE_MS.load(Ordering::SeqCst), monotonic_ms());
    let action = platform::click_action(visible, since_auto_hide);
    log::write(&format!(
        "tray-click rect={} visible={visible} since_auto_hide_ms={since_auto_hide} action={action:?}",
        describe_icon(icon)
    ));
    match action {
        ClickAction::Hide => hide_popover(app, HideReason::Toggle),
        ClickAction::Show => {
            platform::prepare_popover(&window);
            platform::position_popover(&window, icon);
            let handle = app.clone();
            platform::show_popover(&window, move |reason| hide_popover(&handle, reason));
        }
        ClickAction::Ignore => {}
    }
}

fn popover_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyD)
}

pub fn register_shortcut(app: &AppHandle) {
    if let Err(error) = app.global_shortcut().register(popover_shortcut()) {
        log::write(&format!("shortcut-register failed error={error}"));
    }
}

pub fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() == ShortcutState::Pressed && *shortcut == popover_shortcut() {
        toggle_popover(app, None);
    }
}

pub fn prepare_popover(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        platform::keep_painting_when_occluded(&window);
        platform::prepare_popover(&window);
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit ClawdMeter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;

    let icon = if platform::TRAY_ICON_IS_TEMPLATE {
        Image::from_bytes(include_bytes!("../icons/tray-template.png"))?
    } else {
        app.default_window_icon()
            .cloned()
            .expect("default icon missing")
    };

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(platform::TRAY_ICON_IS_TEMPLATE)
        .tooltip("ClawdMeter")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == QUIT_ID {
                app.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popover(tray.app_handle(), Some(rect));
            }
        })
        .build(app)?;
    Ok(())
}

pub fn set_usage(
    app: &AppHandle,
    five_hour: Option<f64>,
    seven_day: Option<f64>,
    tooltip: &str,
) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let icon = platform::usage_icon(five_hour, seven_day);
    tray.set_icon(Some(Image::new_owned(icon.rgba, icon.width, icon.height)))?;
    tray.set_icon_as_template(platform::TRAY_ICON_IS_TEMPLATE)?;
    tray.set_tooltip(Some(usage_icon::sanitize_tooltip(tooltip)))
}

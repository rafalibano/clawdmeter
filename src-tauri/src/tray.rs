use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::platform::{self, ClickAction};
use crate::usage_icon;

const MAIN_WINDOW: &str = "main";
const QUIT_ID: &str = "quit";
const TRAY_ID: &str = "main";

static LAST_BLUR_HIDE_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW {
        return;
    }
    if let WindowEvent::Focused(false) = event {
        if window.is_visible().unwrap_or(false) {
            LAST_BLUR_HIDE_MS.store(now_ms(), Ordering::SeqCst);
            let _ = window.hide();
        }
    }
}

fn toggle_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let since_blur = now_ms().saturating_sub(LAST_BLUR_HIDE_MS.load(Ordering::SeqCst));
    match platform::click_action(visible, since_blur) {
        ClickAction::Hide => {
            let _ = window.hide();
        }
        ClickAction::Show => {
            let _ = window.move_window_constrained(Position::TrayCenter);
            let _ = window.show();
            let _ = window.set_focus();
        }
        ClickAction::Ignore => {}
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, QUIT_ID, "Sair do Dev Pulse", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;

    let icon = if platform::TRAY_ICON_IS_TEMPLATE {
        Image::from_bytes(include_bytes!("../icons/tray-template.png"))?
    } else {
        app.default_window_icon()
            .cloned()
            .expect("ícone padrão ausente")
    };

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(platform::TRAY_ICON_IS_TEMPLATE)
        .tooltip("Dev Pulse")
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
                ..
            } = event
            {
                toggle_popover(tray.app_handle());
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

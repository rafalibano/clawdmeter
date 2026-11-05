mod commands;
mod platform;
mod popover_dismiss;
#[cfg(any(target_os = "macos", test))]
mod popover_geometry;
mod popover_log;
mod tray;
pub mod usage_icon;

use commands::oauth_loopback::LoopbackRegistry;
use commands::process::ProcessRegistry;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(tray::on_shortcut)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessRegistry::default())
        .manage(LoopbackRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::secrets::secret_delete,
            commands::claude_credentials::claude_credentials_status,
            commands::claude_credentials::claude_usage_fetch,
            commands::process::process_run,
            commands::process::process_spawn,
            commands::process::process_kill,
            commands::process::process_is_alive,
            commands::oauth_loopback::oauth_loopback_listen,
            commands::oauth_loopback::oauth_loopback_wait,
            commands::oauth_loopback::oauth_loopback_cancel,
            commands::terminal::terminal_run,
            commands::open_external::open_url,
            commands::open_external::open_system_settings,
            commands::notification_permission::notification_permission_state,
            commands::tray_usage::tray_set_usage,
        ])
        .setup(|app| {
            if let Ok(dir) = app.path().app_log_dir() {
                popover_log::init(dir);
            }
            popover_log::write(&format!("app-start version={}", app.package_info().version));
            platform::configure_app(app);
            tray::create(app.handle())?;
            tray::prepare_popover(app.handle());
            tray::register_shortcut(app.handle());
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o ClawdMeter")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<ProcessRegistry>().terminate_all();
            }
        });
}

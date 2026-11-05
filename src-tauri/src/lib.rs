mod commands;
mod platform;
mod tray;

use commands::oauth_loopback::LoopbackRegistry;
use commands::process::ProcessRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessRegistry::default())
        .manage(LoopbackRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::secrets::secret_delete,
            commands::claude_credentials::claude_credentials_read,
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
        ])
        .setup(|app| {
            platform::configure_app(app);
            tray::create(app.handle())?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Dev Pulse");
}

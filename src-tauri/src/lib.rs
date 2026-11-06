mod commands;
mod legacy_migration;
mod platform;
mod popover_dismiss;
#[cfg(any(target_os = "macos", test))]
mod popover_geometry;
mod popover_log;
mod tray;
pub mod usage_icon;

use commands::claude_oauth::{AccountLocks, ClaudeLogins};
use commands::oauth_loopback::LoopbackRegistry;
use commands::process::ProcessRegistry;
use commands::updater::PendingUpdate;
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ProcessRegistry::default())
        .manage(LoopbackRegistry::default())
        .manage(ClaudeLogins::default())
        .manage(AccountLocks::default())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::secrets::secret_delete,
            commands::claude_oauth::claude_oauth_begin,
            commands::claude_oauth::claude_oauth_complete,
            commands::claude_oauth::claude_oauth_cancel,
            commands::claude_oauth::claude_account_status,
            commands::claude_oauth::claude_account_remove,
            commands::claude_usage::claude_usage_fetch,
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
            commands::updater::updater_check,
            commands::updater::updater_install,
            commands::updater::updater_restart,
        ])
        .setup(|app| {
            let config_dir = app.path().app_config_dir();
            let state_dir = app
                .path()
                .app_data_dir()
                .map(|dir| legacy_migration::state_dir(&dir));
            let migrated = config_dir
                .as_ref()
                .ok()
                .zip(state_dir.as_ref().ok())
                .and_then(|(dir, state)| {
                    let legacy = legacy_migration::legacy_dir_for(dir)?;
                    let marker = state.join(legacy_migration::CONFIG_MARKER);
                    Some(legacy_migration::migrate_config_dir(dir, &legacy, &marker))
                });
            if let Ok(dir) = app.path().app_log_dir() {
                popover_log::init(dir);
            }
            if let Some(outcome) = migrated {
                popover_log::write(&format!("legacy-config {outcome:?}"));
            }
            if let (Ok(config), Ok(state)) = (config_dir, state_dir) {
                commands::secrets::enable_legacy_migration(commands::secrets::LegacyMarkers {
                    done: state.join(legacy_migration::SECRETS_MARKER),
                    previous: config.join(legacy_migration::SECRETS_MARKER),
                });
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
        .expect("error while starting ClawdMeter")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<ProcessRegistry>().terminate_all();
            }
        });
}

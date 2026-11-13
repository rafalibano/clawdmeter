const APP_COMMANDS: &[&str] = &[
    "secret_get",
    "secret_set",
    "secret_delete",
    "claude_oauth_begin",
    "claude_oauth_complete",
    "claude_oauth_cancel",
    "claude_account_status",
    "claude_account_remove",
    "claude_usage_fetch",
    "claude_usage_resets_fetch",
    "process_run",
    "process_spawn",
    "process_kill",
    "process_is_alive",
    "oauth_loopback_listen",
    "oauth_loopback_wait",
    "oauth_loopback_cancel",
    "terminal_run",
    "open_url",
    "open_system_settings",
    "notification_permission_state",
    "notification_permission_request",
    "session_usage",
    "launch_at_login_status",
    "launch_at_login_enable",
    "launch_at_login_disable",
    "tray_set_usage",
    "updater_check",
    "updater_install",
    "updater_restart",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to generate the command permissions")
}

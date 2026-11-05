const APP_COMMANDS: &[&str] = &[
    "secret_get",
    "secret_set",
    "secret_delete",
    "claude_credentials_read",
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
    "tray_set_usage",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("falha ao gerar as permissões dos commands")
}

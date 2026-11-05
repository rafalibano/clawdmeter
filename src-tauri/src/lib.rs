mod platform;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            platform::configure_app(app);
            tray::create(app.handle())?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Dev Pulse");
}

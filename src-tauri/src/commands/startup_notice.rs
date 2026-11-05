use tauri::State;

use crate::tray_host::StartupNotice;

#[tauri::command]
pub fn startup_notice(notice: State<'_, StartupNotice>) -> Option<&'static str> {
    notice.0
}

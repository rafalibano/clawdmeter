use tauri::AppHandle;

use super::error::{CommandError, CommandResult};
use crate::tray;

#[tauri::command(async)]
pub fn tray_set_usage(
    app: AppHandle,
    five_hour: Option<f64>,
    seven_day: Option<f64>,
    tooltip: String,
) -> CommandResult<()> {
    tray::set_usage(&app, five_hour, seven_day, &tooltip).map_err(CommandError::io)
}

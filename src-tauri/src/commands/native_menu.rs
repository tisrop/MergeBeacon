use tauri::AppHandle;

use crate::error::{CommandError, CommandResult};
use crate::native_menu::{self, NativeMenuLabels};

#[tauri::command]
pub fn native_menu_set_labels(app: AppHandle, labels: NativeMenuLabels) -> CommandResult<()> {
    native_menu::install(&app, labels).map_err(CommandError::from)
}

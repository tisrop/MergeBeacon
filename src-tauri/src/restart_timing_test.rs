use crate::commands::update;
use crate::state::AppState;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

const PROBE_DIRECTORY_ENV: &str = "MERGEBEACON_RESTART_TIMING_TEST_DIR";
const RESTART_MARKER: &str = "restart-requested";
const READY_MARKER: &str = "restarted-ready";
const EVENT_LOG: &str = "events.log";

pub fn arm(app: tauri::AppHandle) {
    let Some(directory) = probe_directory() else {
        return;
    };

    let pid = std::process::id();
    record_event(&directory, "setup", pid);

    let marker = directory.join(RESTART_MARKER);
    if OpenOptions::new().write(true).create_new(true).open(&marker).is_err() {
        if let Err(error) = fs::write(directory.join(READY_MARKER), pid.to_string()) {
            record_event(&directory, &format!("ready-write-error:{error}"), pid);
        } else {
            record_event(&directory, "restarted-ready", pid);
        }
        return;
    }

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(750)).await;
        record_event(&directory, "restart-request", pid);
        let state = app.state::<AppState>();
        if let Err(error) = update::restart_for_timing_test(app.clone(), &state).await {
            record_event(&directory, &format!("restart-error:{error}"), pid);
        }
    });
}

pub fn record_duplicate_activation() {
    if let Some(directory) = probe_directory() {
        record_event(&directory, "duplicate-activation", std::process::id());
    }
}

fn probe_directory() -> Option<PathBuf> {
    let directory = std::env::var_os(PROBE_DIRECTORY_ENV).map(PathBuf::from)?;
    fs::create_dir_all(&directory).ok()?;
    Some(directory)
}

fn record_event(directory: &Path, event: &str, pid: u32) {
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(directory.join(EVENT_LOG)) else {
        return;
    };
    let _ = writeln!(file, "{timestamp} {event} {pid}");
}

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::thread;

use crate::popover_dismiss::wall_clock_ms;

pub const FILE_NAME: &str = "popover.log";
pub const MAX_BYTES: u64 = 100 * 1024;

static WRITER: OnceLock<Sender<String>> = OnceLock::new();

pub fn init(dir: PathBuf) {
    if fs::create_dir_all(&dir).is_ok() {
        let _ = WRITER.set(spawn_writer(dir.join(FILE_NAME), MAX_BYTES));
    }
}

fn spawn_writer(path: PathBuf, max: u64) -> Sender<String> {
    let (sender, lines) = mpsc::channel::<String>();
    thread::spawn(move || {
        for line in lines {
            append(&path, &line, max);
        }
    });
    sender
}

pub fn write(message: &str) {
    if let Some(writer) = WRITER.get() {
        let _ = writer.send(format!("{} {message}\n", format_timestamp(wall_clock_ms())));
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn debug(message: impl FnOnce() -> String) {
    if cfg!(debug_assertions) {
        write(&message());
    }
}

fn rotated(path: &Path) -> PathBuf {
    path.with_extension("log.1")
}

pub fn needs_rotation(current: u64, incoming: usize, max: u64) -> bool {
    current > 0 && current.saturating_add(incoming as u64) > max
}

fn append(path: &Path, line: &str, max: u64) {
    let current = fs::metadata(path).map_or(0, |meta| meta.len());
    if needs_rotation(current, line.len(), max) {
        let _ = fs::rename(path, rotated(path));
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z % 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

pub fn format_timestamp(ms: u64) -> String {
    let (year, month, day) = civil_from_days(ms / 86_400_000);
    let of_day = ms % 86_400_000;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        of_day / 3_600_000,
        of_day / 60_000 % 60,
        of_day / 1_000 % 60,
        of_day % 1_000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_is_utc_iso8601_with_millis() {
        assert_eq!(format_timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            format_timestamp(1_709_208_000_123),
            "2024-02-29T12:00:00.123Z"
        );
        assert_eq!(
            format_timestamp(1_793_883_845_007),
            "2026-11-05T13:04:05.007Z"
        );
    }

    #[test]
    fn rotation_starts_only_when_the_line_would_cross_the_limit() {
        assert!(!needs_rotation(0, 500, 100));
        assert!(!needs_rotation(90, 10, 100));
        assert!(needs_rotation(91, 10, 100));
    }

    #[test]
    fn append_rotates_into_a_single_backup() {
        let dir = std::env::temp_dir().join(format!(
            "clawdmeter-popover-log-{}-{}",
            std::process::id(),
            wall_clock_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);

        append(&path, "aaaa\n", 12);
        append(&path, "bbbb\n", 12);
        append(&path, "cccc\n", 12);
        append(&path, "dddd\n", 12);
        append(&path, "eeee\n", 12);

        assert_eq!(fs::read_to_string(&path).unwrap(), "eeee\n");
        assert_eq!(fs::read_to_string(rotated(&path)).unwrap(), "cccc\ndddd\n");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_writer_thread_appends_lines_in_order_off_the_caller() {
        let dir = std::env::temp_dir().join(format!(
            "clawdmeter-popover-writer-{}-{}",
            std::process::id(),
            wall_clock_ms()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        let writer = spawn_writer(path.clone(), MAX_BYTES);
        for line in ["a\n", "b\n", "c\n"] {
            writer.send(line.to_string()).unwrap();
        }
        drop(writer);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while fs::read_to_string(&path).unwrap_or_default() != "a\nb\nc\n" {
            assert!(std::time::Instant::now() < deadline, "lines never written");
            thread::sleep(std::time::Duration::from_millis(10));
        }
        fs::remove_dir_all(&dir).unwrap();
    }
}

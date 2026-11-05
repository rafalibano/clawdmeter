use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::error::CommandResult;
use super::process_policy::strip_verbatim_prefix;

const SKILL_WORKDIR: &str = "skill-cwd";

pub fn home_dir() -> Option<PathBuf> {
    home_from(std::env::var_os(home_variable()))
}

pub fn protected_dirs(app: &AppHandle) -> CommandResult<Vec<PathBuf>> {
    Ok(vec![app.path().app_config_dir()?])
}

pub fn skill_workdir(app: &AppHandle) -> CommandResult<PathBuf> {
    prepare_workdir(&app.path().app_cache_dir()?)
}

pub fn prepare_workdir(cache: &Path) -> CommandResult<PathBuf> {
    let dir = cache.join(SKILL_WORKDIR);
    std::fs::create_dir_all(&dir)?;
    Ok(strip_verbatim_prefix(dir.canonicalize()?))
}

fn home_variable() -> &'static str {
    if cfg!(windows) {
        "USERPROFILE"
    } else {
        "HOME"
    }
}

fn home_from(value: Option<OsString>) -> Option<PathBuf> {
    value.filter(|value| !value.is_empty()).map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_missing_variable_has_no_home() {
        assert_eq!(home_from(None), None);
        assert_eq!(home_from(Some(OsString::new())), None);
        assert_eq!(
            home_from(Some("/Users/dev".into())),
            Some(PathBuf::from("/Users/dev"))
        );
    }

    #[test]
    fn reads_the_variable_of_the_current_os() {
        assert_eq!(
            home_variable(),
            if cfg!(windows) { "USERPROFILE" } else { "HOME" }
        );
    }

    #[test]
    fn the_workdir_is_created_empty_under_the_cache_dir() {
        let cache = std::env::temp_dir().join(format!("dev-pulse-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&cache);
        let workdir = prepare_workdir(&cache).unwrap();
        assert!(workdir.is_dir());
        assert!(workdir.ends_with("skill-cwd"));
        assert_eq!(std::fs::read_dir(&workdir).unwrap().count(), 0);
        assert_eq!(prepare_workdir(&cache).unwrap(), workdir);
        let _ = std::fs::remove_dir_all(&cache);
    }

    #[test]
    fn the_workdir_is_never_the_home_or_the_config_dir() {
        let root = std::env::temp_dir().join(format!("dev-pulse-wd-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let config = root.join("config");
        let cache = root.join("cache");
        std::fs::create_dir_all(&config).unwrap();
        let workdir = prepare_workdir(&cache).unwrap();
        assert!(!workdir.starts_with(config.canonicalize().unwrap()));
        assert_ne!(Some(workdir), home_dir());
        let _ = std::fs::remove_dir_all(&root);
    }
}

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::error::{CommandError, CommandResult, ErrorKind};
use super::process_policy::{is_protected_dir, strip_verbatim_prefix};

const SKILL_WORKDIR: &str = "skill-cwd";

pub fn home_dir() -> Option<PathBuf> {
    home_from(std::env::var_os(home_variable()))
}

pub fn protected_dirs(app: &AppHandle) -> CommandResult<Vec<PathBuf>> {
    Ok(vec![app.path().app_config_dir()?])
}

pub fn skill_workdir(app: &AppHandle) -> CommandResult<PathBuf> {
    prepare_workdir(
        &app.path().app_cache_dir()?,
        home_dir().as_deref(),
        &protected_dirs(app)?,
    )
}

fn unsafe_workdir() -> CommandError {
    CommandError::new(
        ErrorKind::InvalidArgument,
        "pasta de trabalho das skills insegura",
    )
}

pub fn prepare_workdir(
    cache: &Path,
    home: Option<&Path>,
    protected: &[PathBuf],
) -> CommandResult<PathBuf> {
    let dir = cache.join(SKILL_WORKDIR);
    if let Ok(meta) = std::fs::symlink_metadata(&dir) {
        if meta.file_type().is_symlink() {
            std::fs::remove_file(&dir).or_else(|_| std::fs::remove_dir(&dir))?;
        }
    }
    std::fs::create_dir_all(&dir)?;
    let resolved = strip_verbatim_prefix(dir.canonicalize()?);
    let home = home
        .and_then(|value| value.canonicalize().ok())
        .ok_or_else(unsafe_workdir)?;
    if home.starts_with(&resolved) || is_protected_dir(&resolved, &home, protected) {
        return Err(unsafe_workdir());
    }
    Ok(resolved)
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
        let home = std::env::temp_dir();
        let workdir = prepare_workdir(&cache, Some(&home), &[]).unwrap();
        assert!(workdir.is_dir());
        assert!(workdir.ends_with("skill-cwd"));
        assert_eq!(std::fs::read_dir(&workdir).unwrap().count(), 0);
        assert_eq!(prepare_workdir(&cache, Some(&home), &[]).unwrap(), workdir);
        let _ = std::fs::remove_dir_all(&cache);
    }

    #[test]
    fn the_workdir_is_never_the_home_or_the_config_dir() {
        let root = std::env::temp_dir().join(format!("dev-pulse-wd-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let config = root.join("config");
        let cache = root.join("cache");
        std::fs::create_dir_all(&config).unwrap();
        let workdir =
            prepare_workdir(&cache, home_dir().as_deref(), std::slice::from_ref(&config)).unwrap();
        assert!(!workdir.starts_with(config.canonicalize().unwrap()));
        assert_ne!(Some(workdir), home_dir());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_workdir_is_replaced_by_a_real_directory() {
        let root = std::env::temp_dir().join(format!("dev-pulse-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("home");
        let cache = root.join("cache");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&cache).unwrap();
        std::os::unix::fs::symlink(&home, cache.join(SKILL_WORKDIR)).unwrap();
        let workdir = prepare_workdir(&cache, Some(&home), &[]).unwrap();
        assert_ne!(workdir, home.canonicalize().unwrap());
        assert!(!std::fs::symlink_metadata(cache.join(SKILL_WORKDIR))
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(workdir.starts_with(cache.canonicalize().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_workdir_that_is_or_contains_the_home_is_rejected() {
        let root = std::env::temp_dir().join(format!("dev-pulse-hm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let cache = root.join("cache");
        std::fs::create_dir_all(&cache).unwrap();
        let inside = cache.join(SKILL_WORKDIR);
        std::fs::create_dir_all(&inside).unwrap();
        assert!(prepare_workdir(&cache, Some(&inside), &[]).is_err());
        assert!(prepare_workdir(&cache, None, &[]).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}

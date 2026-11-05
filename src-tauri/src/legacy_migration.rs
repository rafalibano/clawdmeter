use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const LEGACY_IDENTIFIER: &str = "com.mottu.devpulse";
pub const CONFIG_MARKER: &str = ".legacy-config-migrated";
pub const SECRETS_MARKER: &str = ".legacy-secrets-migrated";
pub const STATE_DIR: &str = ".migration";

pub fn state_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(STATE_DIR)
}

pub fn write_marker(marker: &Path) -> io::Result<()> {
    if let Some(dir) = marker.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(marker, LEGACY_IDENTIFIER)
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigMigration {
    AlreadyDone,
    NoLegacy,
    TargetInUse,
    Copied(usize),
}

pub fn legacy_dir_for(config_dir: &Path) -> Option<PathBuf> {
    config_dir
        .parent()
        .map(|parent| parent.join(LEGACY_IDENTIFIER))
}

fn has_entries(dir: &Path) -> io::Result<bool> {
    match fs::read_dir(dir) {
        Ok(mut entries) => Ok(entries.next().is_some()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn is_user_file(name: &str) -> bool {
    !name.starts_with('.') && !name.ends_with(".tmp")
}

pub fn migrate_config_dir(
    target: &Path,
    legacy: &Path,
    marker: &Path,
) -> io::Result<ConfigMigration> {
    if marker.exists() || target.join(CONFIG_MARKER).exists() {
        return Ok(ConfigMigration::AlreadyDone);
    }
    if !legacy.is_dir() {
        return Ok(ConfigMigration::NoLegacy);
    }
    if has_entries(target)? {
        return Ok(ConfigMigration::TargetInUse);
    }
    let Some(name) = target.file_name() else {
        return Ok(ConfigMigration::NoLegacy);
    };
    let mut staging_name = name.to_os_string();
    staging_name.push(".migrating");
    let staging = target.with_file_name(staging_name);
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;
    let mut copied = 0;
    for entry in fs::read_dir(legacy)? {
        let entry = entry?;
        let file_name = entry.file_name();
        if !entry.file_type()?.is_file() || !file_name.to_str().is_some_and(is_user_file) {
            continue;
        }
        fs::copy(entry.path(), staging.join(&file_name))?;
        copied += 1;
    }
    // Staging + rename keeps an interrupted copy from leaving a half-migrated config dir.
    if target.exists() {
        fs::remove_dir(target)?;
    }
    fs::rename(&staging, target)?;
    write_marker(marker)?;
    Ok(ConfigMigration::Copied(copied))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "clawdmeter-migration-{label}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }

        fn target(&self) -> PathBuf {
            self.0.join("com.mottu.clawdmeter")
        }

        fn legacy(&self) -> PathBuf {
            legacy_dir_for(&self.target()).unwrap()
        }

        fn marker(&self) -> PathBuf {
            state_dir(&self.0.join("data")).join(CONFIG_MARKER)
        }

        fn migrate(&self) -> io::Result<ConfigMigration> {
            migrate_config_dir(&self.target(), &self.legacy(), &self.marker())
        }

        fn seed_legacy(&self) {
            let legacy = self.legacy();
            fs::create_dir_all(&legacy).unwrap();
            for (name, body) in [
                ("settings.json", "{\"a\":1}"),
                ("usage-history.json", "[1]"),
                ("connections.json", "{}"),
                ("runs.json", "[]"),
                ("skills.json", "{}"),
                ("settings.json.tmp", "partial"),
                (".DS_Store", "x"),
            ] {
                fs::write(legacy.join(name), body).unwrap();
            }
            fs::create_dir_all(legacy.join("nested")).unwrap();
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_legacy_dir_is_a_sibling_of_the_new_one() {
        let target = Path::new("/Users/x/Library/Application Support/com.mottu.clawdmeter");
        assert_eq!(
            legacy_dir_for(target).unwrap(),
            Path::new("/Users/x/Library/Application Support/com.mottu.devpulse")
        );
    }

    #[test]
    fn the_legacy_dir_is_a_sibling_under_the_xdg_config_home_too() {
        let target = Path::new("/home/x/.config/com.mottu.clawdmeter");
        assert_eq!(
            legacy_dir_for(target).unwrap(),
            Path::new("/home/x/.config/com.mottu.devpulse")
        );
    }

    #[test]
    fn copies_the_user_files_once_and_keeps_the_legacy_dir() {
        let sandbox = Sandbox::new("copy");
        sandbox.seed_legacy();
        let target = sandbox.target();

        assert_eq!(sandbox.migrate().unwrap(), ConfigMigration::Copied(5));
        assert_eq!(
            fs::read_to_string(target.join("settings.json")).unwrap(),
            "{\"a\":1}"
        );
        for name in [
            "usage-history.json",
            "connections.json",
            "runs.json",
            "skills.json",
        ] {
            assert!(target.join(name).is_file(), "{name}");
        }
        assert!(!target.join("settings.json.tmp").exists());
        assert!(!target.join(".DS_Store").exists());
        assert!(!target.join("nested").exists());
        assert!(sandbox.marker().is_file());
        assert!(!target.join(CONFIG_MARKER).exists());
        assert!(sandbox.legacy().join("settings.json").is_file());
        assert!(!target
            .with_file_name("com.mottu.clawdmeter.migrating")
            .exists());
    }

    #[test]
    fn running_again_is_a_no_op_and_never_overwrites() {
        let sandbox = Sandbox::new("idempotent");
        sandbox.seed_legacy();
        let target = sandbox.target();
        sandbox.migrate().unwrap();
        fs::write(target.join("settings.json"), "novo").unwrap();
        fs::write(sandbox.legacy().join("settings.json"), "antigo").unwrap();

        assert_eq!(sandbox.migrate().unwrap(), ConfigMigration::AlreadyDone);
        assert_eq!(
            fs::read_to_string(target.join("settings.json")).unwrap(),
            "novo"
        );
    }

    #[test]
    fn a_target_already_in_use_is_left_alone() {
        let sandbox = Sandbox::new("in-use");
        sandbox.seed_legacy();
        let target = sandbox.target();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("settings.json"), "atual").unwrap();

        assert_eq!(sandbox.migrate().unwrap(), ConfigMigration::TargetInUse);
        assert_eq!(
            fs::read_to_string(target.join("settings.json")).unwrap(),
            "atual"
        );
        assert!(!target.join("usage-history.json").exists());
    }

    #[test]
    fn an_empty_target_dir_is_filled() {
        let sandbox = Sandbox::new("empty-target");
        sandbox.seed_legacy();
        let target = sandbox.target();
        fs::create_dir_all(&target).unwrap();

        assert_eq!(sandbox.migrate().unwrap(), ConfigMigration::Copied(5));
        assert!(target.join("runs.json").is_file());
    }

    #[test]
    fn a_leftover_staging_dir_is_replaced() {
        let sandbox = Sandbox::new("staging");
        sandbox.seed_legacy();
        let target = sandbox.target();
        let staging = target.with_file_name("com.mottu.clawdmeter.migrating");
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join("lixo.json"), "x").unwrap();

        sandbox.migrate().unwrap();
        assert!(!target.join("lixo.json").exists());
        assert!(target.join("settings.json").is_file());
    }

    #[test]
    fn without_a_legacy_dir_nothing_happens() {
        let sandbox = Sandbox::new("no-legacy");
        let target = sandbox.target();

        assert_eq!(sandbox.migrate().unwrap(), ConfigMigration::NoLegacy);
        assert!(!target.exists());
    }

    #[test]
    fn with_the_state_dir_inside_the_config_dir_the_marker_lands_after_the_copy() {
        let sandbox = Sandbox::new("shared-dir");
        sandbox.seed_legacy();
        let target = sandbox.target();
        let marker = state_dir(&target).join(CONFIG_MARKER);
        assert_eq!(
            migrate_config_dir(&target, &sandbox.legacy(), &marker).unwrap(),
            ConfigMigration::Copied(5)
        );
        assert!(marker.is_file());
        assert!(target.join("settings.json").is_file());
        assert_eq!(
            migrate_config_dir(&target, &sandbox.legacy(), &marker).unwrap(),
            ConfigMigration::AlreadyDone
        );
    }

    #[test]
    fn a_config_dir_holding_only_the_state_dir_counts_as_in_use() {
        let sandbox = Sandbox::new("state-only");
        sandbox.seed_legacy();
        let target = sandbox.target();
        let secrets_marker = state_dir(&target).join(SECRETS_MARKER);
        write_marker(&secrets_marker).unwrap();
        let marker = state_dir(&target).join(CONFIG_MARKER);
        assert_eq!(
            migrate_config_dir(&target, &sandbox.legacy(), &marker).unwrap(),
            ConfigMigration::TargetInUse
        );
        assert!(secrets_marker.is_file());
    }

    #[test]
    fn the_old_marker_inside_the_config_dir_still_counts() {
        let sandbox = Sandbox::new("old-marker");
        sandbox.seed_legacy();
        let target = sandbox.target();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join(CONFIG_MARKER), LEGACY_IDENTIFIER).unwrap();
        assert_eq!(sandbox.migrate().unwrap(), ConfigMigration::AlreadyDone);
    }
}

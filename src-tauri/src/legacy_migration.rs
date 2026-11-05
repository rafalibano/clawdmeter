use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const LEGACY_IDENTIFIER: &str = "com.mottu.devpulse";
pub const CONFIG_MARKER: &str = ".legacy-config-migrated";
pub const SECRETS_MARKER: &str = ".legacy-secrets-migrated";

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

pub fn migrate_config_dir(target: &Path, legacy: &Path) -> io::Result<ConfigMigration> {
    if target.join(CONFIG_MARKER).exists() {
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
    fs::write(staging.join(CONFIG_MARKER), LEGACY_IDENTIFIER)?;
    // Staging + rename keeps an interrupted copy from leaving a half-migrated config dir.
    if target.exists() {
        fs::remove_dir(target)?;
    }
    fs::rename(&staging, target)?;
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
    fn copies_the_user_files_once_and_keeps_the_legacy_dir() {
        let sandbox = Sandbox::new("copy");
        sandbox.seed_legacy();
        let target = sandbox.target();

        assert_eq!(
            migrate_config_dir(&target, &sandbox.legacy()).unwrap(),
            ConfigMigration::Copied(5)
        );
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
        assert!(target.join(CONFIG_MARKER).is_file());
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
        migrate_config_dir(&target, &sandbox.legacy()).unwrap();
        fs::write(target.join("settings.json"), "novo").unwrap();
        fs::write(sandbox.legacy().join("settings.json"), "antigo").unwrap();

        assert_eq!(
            migrate_config_dir(&target, &sandbox.legacy()).unwrap(),
            ConfigMigration::AlreadyDone
        );
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

        assert_eq!(
            migrate_config_dir(&target, &sandbox.legacy()).unwrap(),
            ConfigMigration::TargetInUse
        );
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

        assert_eq!(
            migrate_config_dir(&target, &sandbox.legacy()).unwrap(),
            ConfigMigration::Copied(5)
        );
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

        migrate_config_dir(&target, &sandbox.legacy()).unwrap();
        assert!(!target.join("lixo.json").exists());
        assert!(target.join("settings.json").is_file());
    }

    #[test]
    fn without_a_legacy_dir_nothing_happens() {
        let sandbox = Sandbox::new("no-legacy");
        let target = sandbox.target();

        assert_eq!(
            migrate_config_dir(&target, &sandbox.legacy()).unwrap(),
            ConfigMigration::NoLegacy
        );
        assert!(!target.exists());
    }
}

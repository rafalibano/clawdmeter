use std::path::PathBuf;
use std::sync::{Once, OnceLock};

use keyring::Entry;

use super::blocking::run_blocking;
use super::error::{CommandError, CommandResult, ErrorKind};
use crate::legacy_migration::{write_marker, LEGACY_IDENTIFIER};

const SERVICE: &str = "com.mottu.clawdmeter";

pub const ALLOWED_SECRET_KEYS: &[&str] = &["github.token", "microsoft.refresh-token"];

fn ensure_known_key(key: &str) -> CommandResult<()> {
    if ALLOWED_SECRET_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(CommandError::new(
            ErrorKind::Policy,
            "secret key not allowed",
        ))
    }
}

const CHUNK_BYTES: usize = 1_200;
const MAX_CHUNKS: usize = 64;
const HEADER_PREFIX: &str = "dp-chunked:v1:";

pub trait SecretBackend {
    fn read(&self, key: &str) -> CommandResult<Option<String>>;
    fn write(&self, key: &str, value: &str) -> CommandResult<()>;
    fn remove(&self, key: &str) -> CommandResult<()>;
}

struct KeyringBackend {
    service: &'static str,
}

const CURRENT: KeyringBackend = KeyringBackend { service: SERVICE };
const LEGACY: KeyringBackend = KeyringBackend {
    service: LEGACY_IDENTIFIER,
};

impl KeyringBackend {
    fn entry(&self, key: &str) -> CommandResult<Entry> {
        Entry::new(self.service, key).map_err(CommandError::from)
    }
}

impl SecretBackend for KeyringBackend {
    fn read(&self, key: &str) -> CommandResult<Option<String>> {
        match self.entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn write(&self, key: &str, value: &str) -> CommandResult<()> {
        self.entry(key)?
            .set_password(value)
            .map_err(CommandError::from)
    }

    fn remove(&self, key: &str) -> CommandResult<()> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

enum Stored<'a> {
    Plain(&'a str),
    Chunked { count: usize, first: &'a str },
    Corrupt,
}

fn classify(stored: &str) -> Stored<'_> {
    let Some(rest) = stored.strip_prefix(HEADER_PREFIX) else {
        return Stored::Plain(stored);
    };
    match rest
        .split_once(':')
        .and_then(|(count, first)| Some((count.parse::<usize>().ok()?, first)))
    {
        Some((count, first)) if (1..=MAX_CHUNKS).contains(&count) => {
            Stored::Chunked { count, first }
        }
        _ => Stored::Corrupt,
    }
}

fn tail_key(key: &str, index: usize) -> String {
    format!("{key}#{index}")
}

fn check_key(key: &str) -> CommandResult<()> {
    if key.trim().is_empty() {
        return Err(CommandError::new(ErrorKind::InvalidArgument, "empty key"));
    }
    if key.contains('#') {
        return Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "key with reserved character",
        ));
    }
    Ok(())
}

pub fn split_chunks(value: &str) -> Vec<&str> {
    let mut pieces = Vec::new();
    let mut rest = value;
    while rest.len() > CHUNK_BYTES {
        let mut cut = CHUNK_BYTES;
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        let (piece, tail) = rest.split_at(cut);
        pieces.push(piece);
        rest = tail;
    }
    pieces.push(rest);
    pieces
}

fn stored_pieces(backend: &dyn SecretBackend, key: &str) -> CommandResult<usize> {
    Ok(match backend.read(key)? {
        None => 0,
        Some(head) => match classify(&head) {
            Stored::Plain(_) => 1,
            Stored::Chunked { count, .. } => count,
            Stored::Corrupt => MAX_CHUNKS,
        },
    })
}

fn drop_tails(backend: &dyn SecretBackend, key: &str, from: usize, to: usize) -> CommandResult<()> {
    for index in from..to {
        backend.remove(&tail_key(key, index))?;
    }
    Ok(())
}

pub fn get_secret(backend: &dyn SecretBackend, key: &str) -> CommandResult<Option<String>> {
    check_key(key)?;
    let Some(head) = backend.read(key)? else {
        return Ok(None);
    };
    match classify(&head) {
        Stored::Plain(value) => Ok(Some(value.to_string())),
        Stored::Corrupt => Ok(None),
        Stored::Chunked { count, first } => {
            let mut value = first.to_string();
            for index in 1..count {
                match backend.read(&tail_key(key, index))? {
                    Some(piece) => value.push_str(&piece),
                    None => return Ok(None),
                }
            }
            Ok(Some(value))
        }
    }
}

pub fn set_secret(backend: &dyn SecretBackend, key: &str, value: &str) -> CommandResult<()> {
    check_key(key)?;
    let pieces = split_chunks(value);
    if pieces.len() > MAX_CHUNKS {
        return Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "secret too large",
        ));
    }
    let previous = stored_pieces(backend, key)?;
    if pieces.len() == 1 && !value.starts_with(HEADER_PREFIX) {
        backend.write(key, value)?;
    } else {
        for (index, piece) in pieces.iter().enumerate().skip(1) {
            backend.write(&tail_key(key, index), piece)?;
        }
        backend.write(
            key,
            &format!("{HEADER_PREFIX}{}:{}", pieces.len(), pieces[0]),
        )?;
    }
    drop_tails(backend, key, pieces.len(), previous)
}

pub fn delete_secret(backend: &dyn SecretBackend, key: &str) -> CommandResult<()> {
    check_key(key)?;
    let previous = stored_pieces(backend, key)?;
    drop_tails(backend, key, 1, previous)?;
    backend.remove(key)
}

pub struct LegacyMarkers {
    pub done: PathBuf,
    pub previous: PathBuf,
}

fn copy_legacy_secrets(
    legacy: &dyn SecretBackend,
    current: &dyn SecretBackend,
) -> CommandResult<usize> {
    let mut copied = 0;
    for key in ALLOWED_SECRET_KEYS {
        if current.read(key)?.is_some() {
            continue;
        }
        if let Some(value) = get_secret(legacy, key)? {
            set_secret(current, key, &value)?;
            copied += 1;
            let _ = delete_secret(legacy, key);
        }
    }
    Ok(copied)
}

fn drop_legacy_secrets(legacy: &dyn SecretBackend) {
    for key in ALLOWED_SECRET_KEYS {
        let _ = delete_secret(legacy, key);
    }
}

pub fn migrate_legacy_secrets(
    legacy: &dyn SecretBackend,
    current: &dyn SecretBackend,
    markers: &LegacyMarkers,
) -> CommandResult<usize> {
    if markers.done.exists() {
        return Ok(0);
    }
    if markers.previous.exists() {
        drop_legacy_secrets(legacy);
        write_marker(&markers.done)?;
        return Ok(0);
    }
    let outcome = copy_legacy_secrets(legacy, current);
    let settled = match &outcome {
        Ok(_) => true,
        Err(error) => error.kind == ErrorKind::KeychainDenied,
    };
    if settled {
        write_marker(&markers.done)?;
    }
    outcome
}

static LEGACY_MARKERS: OnceLock<LegacyMarkers> = OnceLock::new();
static LEGACY_ONCE: Once = Once::new();

pub fn enable_legacy_migration(markers: LegacyMarkers) {
    let _ = LEGACY_MARKERS.set(markers);
}

fn ensure_legacy_migrated() {
    let Some(markers) = LEGACY_MARKERS.get() else {
        return;
    };
    LEGACY_ONCE.call_once(
        || match migrate_legacy_secrets(&LEGACY, &CURRENT, markers) {
            Ok(copied) => crate::popover_log::write(&format!("legacy-secrets copied={copied}")),
            Err(error) => {
                crate::popover_log::write(&format!("legacy-secrets failed={}", error.message))
            }
        },
    );
}

#[tauri::command]
pub async fn secret_get(key: String) -> CommandResult<Option<String>> {
    ensure_known_key(&key)?;
    run_blocking(move || {
        ensure_legacy_migrated();
        get_secret(&CURRENT, &key)
    })
    .await
}

#[tauri::command]
pub async fn secret_set(key: String, value: String) -> CommandResult<()> {
    ensure_known_key(&key)?;
    run_blocking(move || {
        ensure_legacy_migrated();
        set_secret(&CURRENT, &key, &value)
    })
    .await
}

#[tauri::command]
pub async fn secret_delete(key: String) -> CommandResult<()> {
    ensure_known_key(&key)?;
    run_blocking(move || {
        ensure_legacy_migrated();
        delete_secret(&CURRENT, &key)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn only_the_keys_the_app_owns_pass_the_allowlist() {
        for key in ALLOWED_SECRET_KEYS {
            assert!(ensure_known_key(key).is_ok());
        }
        for key in [
            "",
            "  ",
            "k",
            "github.token#1",
            "GitHub.token",
            "claude.token",
            "../x",
        ] {
            assert_eq!(
                ensure_known_key(key).unwrap_err().kind,
                ErrorKind::Policy,
                "{key:?}"
            );
        }
    }

    #[test]
    fn commands_refuse_unknown_keys_before_touching_the_keychain() {
        let denied = tauri::async_runtime::block_on(secret_get("other.key".into())).unwrap_err();
        assert_eq!(denied.kind, ErrorKind::Policy);
        let denied =
            tauri::async_runtime::block_on(secret_set("other.key".into(), "v".into())).unwrap_err();
        assert_eq!(denied.kind, ErrorKind::Policy);
        let denied = tauri::async_runtime::block_on(secret_delete("other.key".into())).unwrap_err();
        assert_eq!(denied.kind, ErrorKind::Policy);
    }

    #[test]
    fn empty_key_is_still_rejected_by_the_storage_layer() {
        let backend = FakeBackend::default();
        assert_eq!(
            get_secret(&backend, "  ").unwrap_err().kind,
            ErrorKind::InvalidArgument
        );
    }

    const WINDOWS_BLOB_LIMIT: usize = 2_560;

    #[derive(Default)]
    struct FakeBackend {
        entries: RefCell<HashMap<String, String>>,
        denied: std::cell::Cell<bool>,
    }

    impl SecretBackend for FakeBackend {
        fn read(&self, key: &str) -> CommandResult<Option<String>> {
            if self.denied.get() {
                return Err(CommandError::new(ErrorKind::KeychainDenied, "denied"));
            }
            Ok(self.entries.borrow().get(key).cloned())
        }

        fn write(&self, key: &str, value: &str) -> CommandResult<()> {
            if value.encode_utf16().count() * 2 > WINDOWS_BLOB_LIMIT {
                return Err(CommandError::new(
                    ErrorKind::Io,
                    "blob above the Credential Manager limit",
                ));
            }
            self.entries
                .borrow_mut()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn remove(&self, key: &str) -> CommandResult<()> {
            self.entries.borrow_mut().remove(key);
            Ok(())
        }
    }

    fn big_secret(len: usize) -> String {
        (0..len)
            .map(|index| char::from(b'a' + (index % 26) as u8))
            .collect()
    }

    #[test]
    fn small_secrets_stay_a_single_plain_entry() {
        let backend = FakeBackend::default();
        set_secret(&backend, "github.token", "gho_abc").unwrap();
        assert_eq!(backend.entries.borrow().len(), 1);
        assert_eq!(
            backend.entries.borrow().get("github.token").unwrap(),
            "gho_abc"
        );
        assert_eq!(
            get_secret(&backend, "github.token").unwrap().as_deref(),
            Some("gho_abc")
        );
    }

    #[test]
    fn a_5000_char_secret_is_split_and_reassembled() {
        let backend = FakeBackend::default();
        let secret = big_secret(5_000);
        set_secret(&backend, "k", &secret).unwrap();
        assert_eq!(
            get_secret(&backend, "k").unwrap().as_deref(),
            Some(secret.as_str())
        );
        let entries = backend.entries.borrow();
        assert!(entries.len() >= 5);
        assert!(entries.contains_key("k#1"));
        assert!(entries
            .values()
            .all(|value| value.encode_utf16().count() * 2 <= WINDOWS_BLOB_LIMIT));
        assert!(entries.get("k").unwrap().starts_with(HEADER_PREFIX));
    }

    #[test]
    fn multibyte_secrets_split_on_char_boundaries() {
        let backend = FakeBackend::default();
        let secret: String = "aé€😀".repeat(900);
        set_secret(&backend, "k", &secret).unwrap();
        assert_eq!(
            get_secret(&backend, "k").unwrap().as_deref(),
            Some(secret.as_str())
        );
    }

    #[test]
    fn shrinking_a_secret_drops_the_stale_pieces() {
        let backend = FakeBackend::default();
        set_secret(&backend, "k", &big_secret(5_000)).unwrap();
        set_secret(&backend, "k", &big_secret(1_500)).unwrap();
        assert_eq!(backend.entries.borrow().len(), 2);
        assert_eq!(get_secret(&backend, "k").unwrap().unwrap().len(), 1_500);
        set_secret(&backend, "k", "curto").unwrap();
        assert_eq!(backend.entries.borrow().len(), 1);
        assert_eq!(get_secret(&backend, "k").unwrap().as_deref(), Some("curto"));
    }

    #[test]
    fn delete_removes_every_piece_and_tolerates_missing_keys() {
        let backend = FakeBackend::default();
        set_secret(&backend, "k", &big_secret(5_000)).unwrap();
        set_secret(&backend, "other", "x").unwrap();
        delete_secret(&backend, "k").unwrap();
        assert_eq!(backend.entries.borrow().len(), 1);
        assert_eq!(get_secret(&backend, "k").unwrap(), None);
        delete_secret(&backend, "never-existed").unwrap();
    }

    #[test]
    fn a_plain_value_that_looks_like_a_header_round_trips() {
        let backend = FakeBackend::default();
        let tricky = format!("{HEADER_PREFIX}3:not-really-chunked");
        set_secret(&backend, "k", &tricky).unwrap();
        assert_eq!(
            get_secret(&backend, "k").unwrap().as_deref(),
            Some(tricky.as_str())
        );
    }

    #[test]
    fn a_missing_or_corrupt_piece_reads_as_absent() {
        let backend = FakeBackend::default();
        set_secret(&backend, "k", &big_secret(5_000)).unwrap();
        backend.entries.borrow_mut().remove("k#2");
        assert_eq!(get_secret(&backend, "k").unwrap(), None);
        backend
            .entries
            .borrow_mut()
            .insert("k".into(), format!("{HEADER_PREFIX}zzz:abc"));
        assert_eq!(get_secret(&backend, "k").unwrap(), None);
        delete_secret(&backend, "k").unwrap();
        assert!(backend.entries.borrow().is_empty());
    }

    #[test]
    fn keys_with_the_reserved_separator_are_rejected() {
        let backend = FakeBackend::default();
        assert_eq!(
            set_secret(&backend, "a#1", "x").unwrap_err().kind,
            ErrorKind::InvalidArgument
        );
        assert_eq!(
            get_secret(&backend, "").unwrap_err().kind,
            ErrorKind::InvalidArgument
        );
    }

    #[test]
    fn oversized_secrets_are_refused() {
        let backend = FakeBackend::default();
        let error =
            set_secret(&backend, "k", &big_secret(CHUNK_BYTES * MAX_CHUNKS + 1)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidArgument);
        assert!(backend.entries.borrow().is_empty());
    }

    struct MarkerDir(PathBuf);

    impl MarkerDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("clawdmeter-secrets-{label}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            Self(dir)
        }

        fn marker(&self) -> PathBuf {
            self.0
                .join(crate::legacy_migration::STATE_DIR)
                .join(crate::legacy_migration::SECRETS_MARKER)
        }

        fn previous(&self) -> PathBuf {
            self.0
                .join("config")
                .join(crate::legacy_migration::SECRETS_MARKER)
        }

        fn markers(&self) -> LegacyMarkers {
            LegacyMarkers {
                done: self.marker(),
                previous: self.previous(),
            }
        }
    }

    impl Drop for MarkerDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn legacy_secrets_are_copied_once_including_chunked_ones() {
        let dir = MarkerDir::new("copy");
        let legacy = FakeBackend::default();
        let current = FakeBackend::default();
        let refresh = big_secret(5_000);
        set_secret(&legacy, "github.token", "gho_old").unwrap();
        set_secret(&legacy, "microsoft.refresh-token", &refresh).unwrap();
        set_secret(&legacy, "claude.token", "not-ours").unwrap();

        assert_eq!(
            migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap(),
            2
        );
        assert_eq!(
            get_secret(&current, "github.token").unwrap().as_deref(),
            Some("gho_old")
        );
        assert_eq!(
            get_secret(&current, "microsoft.refresh-token")
                .unwrap()
                .as_deref(),
            Some(refresh.as_str())
        );
        assert_eq!(current.read("claude.token").unwrap(), None);
        assert_eq!(get_secret(&legacy, "github.token").unwrap(), None);
        assert_eq!(
            get_secret(&legacy, "microsoft.refresh-token").unwrap(),
            None
        );
        assert!(!legacy
            .entries
            .borrow()
            .keys()
            .any(|key| key.starts_with("microsoft")));
        assert_eq!(
            get_secret(&legacy, "claude.token").unwrap().as_deref(),
            Some("not-ours")
        );
        assert!(dir.marker().is_file());
    }

    #[test]
    fn existing_secrets_are_never_overwritten() {
        let dir = MarkerDir::new("keep");
        let legacy = FakeBackend::default();
        let current = FakeBackend::default();
        set_secret(&legacy, "github.token", "gho_old").unwrap();
        set_secret(&current, "github.token", "gho_new").unwrap();

        assert_eq!(
            migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap(),
            0
        );
        assert_eq!(
            get_secret(&current, "github.token").unwrap().as_deref(),
            Some("gho_new")
        );
    }

    #[test]
    fn after_the_marker_a_logout_is_not_undone() {
        let dir = MarkerDir::new("idempotent");
        let legacy = FakeBackend::default();
        let current = FakeBackend::default();
        set_secret(&legacy, "github.token", "gho_old").unwrap();
        migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap();
        delete_secret(&current, "github.token").unwrap();

        assert_eq!(
            migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap(),
            0
        );
        assert_eq!(get_secret(&current, "github.token").unwrap(), None);
    }

    #[test]
    fn without_legacy_secrets_only_the_marker_is_written() {
        let dir = MarkerDir::new("empty");
        let legacy = FakeBackend::default();
        let current = FakeBackend::default();

        assert_eq!(
            migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap(),
            0
        );
        assert!(current.entries.borrow().is_empty());
        assert!(dir.marker().is_file());
    }

    #[test]
    fn splitting_never_exceeds_the_chunk_size() {
        let secret = big_secret(5_000);
        let pieces = split_chunks(&secret);
        assert!(pieces.iter().all(|piece| piece.len() <= CHUNK_BYTES));
        assert_eq!(pieces.concat().len(), 5_000);
    }

    #[test]
    fn a_denied_keychain_prompt_is_not_asked_again_on_the_next_launch() {
        let dir = MarkerDir::new("denied");
        let legacy = FakeBackend::default();
        let current = FakeBackend::default();
        set_secret(&legacy, "github.token", "gho_old").unwrap();
        legacy.denied.set(true);
        let error = migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap_err();
        assert_eq!(error.kind, ErrorKind::KeychainDenied);
        assert!(dir.marker().is_file());
        legacy.denied.set(false);
        assert_eq!(
            migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap(),
            0
        );
        assert_eq!(current.read("github.token").unwrap(), None);
    }

    #[test]
    fn other_keychain_failures_retry_on_the_next_launch() {
        struct Broken;
        impl SecretBackend for Broken {
            fn read(&self, _key: &str) -> CommandResult<Option<String>> {
                Err(CommandError::new(ErrorKind::Keychain, "locked"))
            }
            fn write(&self, _key: &str, _value: &str) -> CommandResult<()> {
                Ok(())
            }
            fn remove(&self, _key: &str) -> CommandResult<()> {
                Ok(())
            }
        }
        let dir = MarkerDir::new("broken");
        let current = FakeBackend::default();
        assert!(migrate_legacy_secrets(&Broken, &current, &dir.markers()).is_err());
        assert!(!dir.marker().exists());
    }

    #[test]
    fn the_previous_marker_settles_the_migration_and_drops_the_stale_items() {
        let dir = MarkerDir::new("previous");
        let legacy = FakeBackend::default();
        let current = FakeBackend::default();
        set_secret(&legacy, "github.token", "gho_logged_out").unwrap();
        write_marker(&dir.previous()).unwrap();
        assert_eq!(
            migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap(),
            0
        );
        assert_eq!(current.read("github.token").unwrap(), None);
        assert_eq!(legacy.read("github.token").unwrap(), None);
        assert!(dir.marker().is_file());
    }
}

use std::collections::HashMap;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Once, OnceLock};
use std::time::{Duration, Instant};

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
const DENIAL_PAUSE: Duration = Duration::from_secs(5 * 60);

pub trait SecretBackend {
    fn read(&self, key: &str) -> CommandResult<Option<String>>;
    fn write(&self, key: &str, value: &str) -> CommandResult<()>;
    fn remove(&self, key: &str) -> CommandResult<()>;
}

pub trait SecretStore {
    fn get(&self, key: &str) -> CommandResult<Option<String>>;
    fn set(&self, key: &str, value: &str) -> CommandResult<()>;
    fn delete(&self, key: &str) -> CommandResult<()>;
}

impl<B: SecretBackend> SecretStore for B {
    fn get(&self, key: &str) -> CommandResult<Option<String>> {
        get_secret(self, key)
    }

    fn set(&self, key: &str, value: &str) -> CommandResult<()> {
        set_secret(self, key, value)
    }

    fn delete(&self, key: &str) -> CommandResult<()> {
        delete_secret(self, key)
    }
}

struct KeyringBackend {
    service: &'static str,
}

const CURRENT: KeyringBackend = KeyringBackend { service: SERVICE };
const LEGACY: KeyringBackend = KeyringBackend {
    service: LEGACY_IDENTIFIER,
};

static APP_STORE: OnceLock<CachedStore<KeyringBackend>> = OnceLock::new();

pub fn app_store() -> &'static (dyn SecretStore + Sync) {
    APP_STORE.get_or_init(|| CachedStore::new(CURRENT))
}

type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;

enum Slot {
    Unknown,
    Known {
        value: Option<String>,
        pieces: usize,
    },
    Denied {
        error: CommandError,
        since: Instant,
    },
}

impl fmt::Debug for Slot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Slot::Unknown => formatter.write_str("Unknown"),
            Slot::Known { value, pieces } => formatter
                .debug_struct("Known")
                .field("present", &value.is_some())
                .field("pieces", pieces)
                .finish(),
            Slot::Denied { since, .. } => formatter
                .debug_struct("Denied")
                .field("since", since)
                .finish(),
        }
    }
}

pub struct CachedStore<B> {
    inner: B,
    slots: Mutex<HashMap<String, Arc<Mutex<Slot>>>>,
    clock: Clock,
}

impl<B> fmt::Debug for CachedStore<B> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CachedStore")
            .field("slots", &*lock(&self.slots))
            .finish_non_exhaustive()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl<B: SecretBackend> CachedStore<B> {
    pub fn new(inner: B) -> Self {
        Self::with_clock(inner, Arc::new(Instant::now))
    }

    fn with_clock(inner: B, clock: Clock) -> Self {
        Self {
            inner,
            slots: Mutex::default(),
            clock,
        }
    }

    fn slot(&self, key: &str) -> Arc<Mutex<Slot>> {
        let mut slots = lock(&self.slots);
        Arc::clone(
            slots
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(Slot::Unknown))),
        )
    }

    fn known_pieces(&self, slot: &Slot, key: &str) -> CommandResult<usize> {
        match slot {
            Slot::Known { pieces, .. } => Ok(*pieces),
            _ => stored_pieces(&self.inner, key),
        }
    }

    #[cfg(test)]
    pub fn backend(&self) -> &B {
        &self.inner
    }
}

impl<B: SecretBackend> SecretStore for CachedStore<B> {
    fn get(&self, key: &str) -> CommandResult<Option<String>> {
        check_key(key)?;
        let slot = self.slot(key);
        let mut slot = lock(&slot);
        match &*slot {
            Slot::Known { value, .. } => return Ok(value.clone()),
            Slot::Denied { error, since }
                if (self.clock)().saturating_duration_since(*since) < DENIAL_PAUSE =>
            {
                return Err(error.clone())
            }
            _ => {}
        }
        match read_secret(&self.inner, key) {
            Ok((value, pieces)) => {
                *slot = Slot::Known {
                    value: value.clone(),
                    pieces,
                };
                Ok(value)
            }
            Err(error) => {
                *slot = if error.kind == ErrorKind::KeychainDenied {
                    Slot::Denied {
                        error: error.clone(),
                        since: (self.clock)(),
                    }
                } else {
                    Slot::Unknown
                };
                Err(error)
            }
        }
    }

    fn set(&self, key: &str, value: &str) -> CommandResult<()> {
        let pieces = slice_secret(key, value)?;
        let slot = self.slot(key);
        let mut slot = lock(&slot);
        let previous = self.known_pieces(&slot, key)?;
        write_value(&self.inner, key, value, &pieces)?;
        *slot = Slot::Known {
            value: Some(value.to_string()),
            pieces: pieces.len().max(previous),
        };
        drop_tails(&self.inner, key, pieces.len(), previous)?;
        *slot = Slot::Known {
            value: Some(value.to_string()),
            pieces: pieces.len(),
        };
        Ok(())
    }

    fn delete(&self, key: &str) -> CommandResult<()> {
        check_key(key)?;
        let slot = self.slot(key);
        let mut slot = lock(&slot);
        let previous = self.known_pieces(&slot, key)?;
        remove_pieces(&self.inner, key, previous)?;
        *slot = Slot::Known {
            value: None,
            pieces: 0,
        };
        Ok(())
    }
}

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

fn pieces_of(head: Option<&str>) -> usize {
    match head.map(classify) {
        None => 0,
        Some(Stored::Plain(_)) => 1,
        Some(Stored::Chunked { count, .. }) => count,
        Some(Stored::Corrupt) => MAX_CHUNKS,
    }
}

fn stored_pieces(backend: &dyn SecretBackend, key: &str) -> CommandResult<usize> {
    Ok(pieces_of(backend.read(key)?.as_deref()))
}

fn drop_tails(backend: &dyn SecretBackend, key: &str, from: usize, to: usize) -> CommandResult<()> {
    for index in from..to {
        backend.remove(&tail_key(key, index))?;
    }
    Ok(())
}

fn read_secret(backend: &dyn SecretBackend, key: &str) -> CommandResult<(Option<String>, usize)> {
    check_key(key)?;
    let head = backend.read(key)?;
    let pieces = pieces_of(head.as_deref());
    let Some(head) = head else {
        return Ok((None, pieces));
    };
    let value = match classify(&head) {
        Stored::Plain(value) => Some(value.to_string()),
        Stored::Corrupt => None,
        Stored::Chunked { count, first } => {
            let mut value = first.to_string();
            for index in 1..count {
                match backend.read(&tail_key(key, index))? {
                    Some(piece) => value.push_str(&piece),
                    None => return Ok((None, pieces)),
                }
            }
            Some(value)
        }
    };
    Ok((value, pieces))
}

pub fn get_secret(backend: &dyn SecretBackend, key: &str) -> CommandResult<Option<String>> {
    Ok(read_secret(backend, key)?.0)
}

fn slice_secret<'a>(key: &str, value: &'a str) -> CommandResult<Vec<&'a str>> {
    check_key(key)?;
    let pieces = split_chunks(value);
    if pieces.len() > MAX_CHUNKS {
        return Err(CommandError::new(
            ErrorKind::InvalidArgument,
            "secret too large",
        ));
    }
    Ok(pieces)
}

fn write_value(
    backend: &dyn SecretBackend,
    key: &str,
    value: &str,
    pieces: &[&str],
) -> CommandResult<()> {
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
    Ok(())
}

fn remove_pieces(backend: &dyn SecretBackend, key: &str, previous: usize) -> CommandResult<()> {
    drop_tails(backend, key, 1, previous)?;
    backend.remove(key)
}

pub fn set_secret(backend: &dyn SecretBackend, key: &str, value: &str) -> CommandResult<()> {
    let pieces = slice_secret(key, value)?;
    let previous = stored_pieces(backend, key)?;
    write_value(backend, key, value, &pieces)?;
    drop_tails(backend, key, pieces.len(), previous)
}

pub fn delete_secret(backend: &dyn SecretBackend, key: &str) -> CommandResult<()> {
    check_key(key)?;
    let previous = stored_pieces(backend, key)?;
    remove_pieces(backend, key, previous)
}

pub struct LegacyMarkers {
    pub done: PathBuf,
    pub previous: PathBuf,
}

fn copy_legacy_secrets(
    legacy: &dyn SecretBackend,
    current: &dyn SecretStore,
) -> CommandResult<usize> {
    let mut copied = 0;
    for key in ALLOWED_SECRET_KEYS {
        if current.get(key)?.is_some() {
            continue;
        }
        if let Some(value) = get_secret(legacy, key)? {
            current.set(key, &value)?;
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
    current: &dyn SecretStore,
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
        || match migrate_legacy_secrets(&LEGACY, app_store(), markers) {
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
        app_store().get(&key)
    })
    .await
}

#[tauri::command]
pub async fn secret_set(key: String, value: String) -> CommandResult<()> {
    ensure_known_key(&key)?;
    run_blocking(move || {
        ensure_legacy_migrated();
        app_store().set(&key, &value)
    })
    .await
}

#[tauri::command]
pub async fn secret_delete(key: String) -> CommandResult<()> {
    ensure_known_key(&key)?;
    run_blocking(move || {
        ensure_legacy_migrated();
        app_store().delete(&key)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::thread;

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

    struct ReadGate {
        key: &'static str,
        arrived: Mutex<Sender<()>>,
        release: Mutex<Receiver<()>>,
    }

    #[derive(Default)]
    struct CountingBackend {
        entries: Mutex<HashMap<String, String>>,
        reads: AtomicUsize,
        failing_reads: Mutex<Vec<ErrorKind>>,
        failing_writes: AtomicBool,
        failing_removes: AtomicBool,
        gate: Option<ReadGate>,
    }

    impl CountingBackend {
        fn with(entries: &[(&str, &str)]) -> Self {
            let backend = Self::default();
            for (key, value) in entries {
                set_secret(&backend, key, value).unwrap();
            }
            backend.reads.store(0, Ordering::SeqCst);
            backend
        }

        fn gated(key: &'static str, entries: &[(&str, &str)]) -> (Self, Receiver<()>, Sender<()>) {
            let (arrived, on_arrival) = channel();
            let (release, on_release) = channel();
            let backend = Self {
                gate: Some(ReadGate {
                    key,
                    arrived: Mutex::new(arrived),
                    release: Mutex::new(on_release),
                }),
                ..Self::with(entries)
            };
            (backend, on_arrival, release)
        }

        fn reads(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }

        fn fail_next_read(&self, kind: ErrorKind) {
            self.failing_reads.lock().unwrap().push(kind);
        }

        fn stored(&self, key: &str) -> Option<String> {
            self.entries.lock().unwrap().get(key).cloned()
        }
    }

    impl SecretBackend for CountingBackend {
        fn read(&self, key: &str) -> CommandResult<Option<String>> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if let Some(gate) = self.gate.as_ref().filter(|gate| gate.key == key) {
                let _ = gate.arrived.lock().unwrap().send(());
                let _ = gate.release.lock().unwrap().recv();
            }
            if let Some(kind) = self.failing_reads.lock().unwrap().pop() {
                return Err(CommandError::new(kind, "read failed"));
            }
            Ok(self.stored(key))
        }

        fn write(&self, key: &str, value: &str) -> CommandResult<()> {
            if self.failing_writes.load(Ordering::SeqCst) {
                return Err(CommandError::new(ErrorKind::Keychain, "write failed"));
            }
            self.entries
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn remove(&self, key: &str) -> CommandResult<()> {
            if self.failing_removes.load(Ordering::SeqCst) {
                return Err(CommandError::new(ErrorKind::Keychain, "remove failed"));
            }
            self.entries.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn manual_clock() -> (Clock, Arc<Mutex<Duration>>) {
        let base = Instant::now();
        let advanced = Arc::new(Mutex::new(Duration::ZERO));
        let reading = Arc::clone(&advanced);
        let clock: Clock = Arc::new(move || base + *reading.lock().unwrap());
        (clock, advanced)
    }

    #[test]
    fn repeated_reads_of_a_key_reach_the_keychain_once() {
        let store = CachedStore::new(CountingBackend::with(&[("github.token", "gho_abc")]));
        for _ in 0..5 {
            assert_eq!(
                store.get("github.token").unwrap().as_deref(),
                Some("gho_abc")
            );
        }
        assert_eq!(store.backend().reads(), 1);
    }

    #[test]
    fn a_missing_item_is_read_once() {
        let store = CachedStore::new(CountingBackend::default());
        for _ in 0..3 {
            assert_eq!(store.get("github.token").unwrap(), None);
        }
        assert_eq!(store.backend().reads(), 1);
    }

    #[test]
    fn two_keys_are_read_once_each() {
        let store = CachedStore::new(CountingBackend::with(&[
            ("github.token", "gho_abc"),
            ("microsoft.refresh-token", "m-rt"),
        ]));
        for _ in 0..3 {
            assert_eq!(
                store.get("github.token").unwrap().as_deref(),
                Some("gho_abc")
            );
            assert_eq!(
                store.get("microsoft.refresh-token").unwrap().as_deref(),
                Some("m-rt")
            );
        }
        assert_eq!(store.backend().reads(), 2);
    }

    #[test]
    fn set_updates_the_cache_without_reading_again() {
        let store = CachedStore::new(CountingBackend::with(&[("github.token", "gho_old")]));
        store.get("github.token").unwrap();
        store.set("github.token", "gho_new").unwrap();
        assert_eq!(
            store.get("github.token").unwrap().as_deref(),
            Some("gho_new")
        );
        assert_eq!(
            store.backend().stored("github.token").as_deref(),
            Some("gho_new")
        );
        assert_eq!(store.backend().reads(), 1);

        store.set("microsoft.refresh-token", "m-rt").unwrap();
        assert_eq!(store.backend().reads(), 2);
        assert_eq!(
            store.get("microsoft.refresh-token").unwrap().as_deref(),
            Some("m-rt")
        );
        assert_eq!(store.backend().reads(), 2);
    }

    #[test]
    fn delete_marks_the_key_absent_without_reading_again() {
        let store = CachedStore::new(CountingBackend::with(&[("github.token", "gho_abc")]));
        store.get("github.token").unwrap();
        store.delete("github.token").unwrap();
        assert_eq!(store.get("github.token").unwrap(), None);
        assert_eq!(store.backend().stored("github.token"), None);
        assert_eq!(store.backend().reads(), 1);
    }

    #[test]
    fn the_logical_key_is_cached_and_its_slices_stay_consistent() {
        let big = big_secret(5_000);
        let store = CachedStore::new(CountingBackend::with(&[("k", big.as_str())]));
        assert_eq!(store.get("k").unwrap().as_deref(), Some(big.as_str()));
        let first = store.backend().reads();
        assert_eq!(first, split_chunks(&big).len());
        assert_eq!(store.get("k").unwrap().as_deref(), Some(big.as_str()));
        store.set("k", &big_secret(1_500)).unwrap();
        assert_eq!(store.backend().entries.lock().unwrap().len(), 2);
        store.set("k", "curto").unwrap();
        assert_eq!(store.backend().entries.lock().unwrap().len(), 1);
        store.delete("k").unwrap();
        assert!(store.backend().entries.lock().unwrap().is_empty());
        assert_eq!(store.backend().reads(), first);
        assert_eq!(get_secret(store.backend(), "k").unwrap(), None);
    }

    #[test]
    fn concurrent_reads_of_one_key_share_a_single_keychain_read() {
        let (backend, arrived, release) =
            CountingBackend::gated("github.token", &[("github.token", "gho_abc"), ("k", "v")]);
        let store = CachedStore::new(backend);
        thread::scope(|scope| {
            let first = scope.spawn(|| store.get("github.token"));
            arrived.recv().unwrap();
            let others: Vec<_> = (0..4)
                .map(|_| scope.spawn(|| store.get("github.token")))
                .collect();
            assert_eq!(store.get("k").unwrap().as_deref(), Some("v"));
            thread::sleep(Duration::from_millis(50));
            drop(release);
            for run in std::iter::once(first).chain(others) {
                assert_eq!(run.join().unwrap().unwrap().as_deref(), Some("gho_abc"));
            }
        });
        assert_eq!(store.backend().reads(), 2);
    }

    #[test]
    fn a_denied_prompt_is_not_asked_again_for_five_minutes() {
        let (clock, advanced) = manual_clock();
        let store =
            CachedStore::with_clock(CountingBackend::with(&[("github.token", "gho_abc")]), clock);
        store.backend().fail_next_read(ErrorKind::KeychainDenied);
        for _ in 0..3 {
            assert_eq!(
                store.get("github.token").unwrap_err().kind,
                ErrorKind::KeychainDenied
            );
        }
        *advanced.lock().unwrap() = DENIAL_PAUSE - Duration::from_millis(1);
        assert_eq!(
            store.get("github.token").unwrap_err().kind,
            ErrorKind::KeychainDenied
        );
        assert_eq!(store.backend().reads(), 1);
        *advanced.lock().unwrap() = DENIAL_PAUSE;
        assert_eq!(
            store.get("github.token").unwrap().as_deref(),
            Some("gho_abc")
        );
        assert_eq!(
            store.get("github.token").unwrap().as_deref(),
            Some("gho_abc")
        );
        assert_eq!(store.backend().reads(), 2);
    }

    #[test]
    fn a_denial_does_not_pause_other_keys_or_an_explicit_save() {
        let store = CachedStore::new(CountingBackend::with(&[(
            "microsoft.refresh-token",
            "m-rt",
        )]));
        store.backend().fail_next_read(ErrorKind::KeychainDenied);
        assert!(store.get("github.token").is_err());
        assert_eq!(
            store.get("microsoft.refresh-token").unwrap().as_deref(),
            Some("m-rt")
        );
        store.set("github.token", "gho_new").unwrap();
        assert_eq!(
            store.get("github.token").unwrap().as_deref(),
            Some("gho_new")
        );
    }

    #[test]
    fn transient_keychain_errors_are_not_cached() {
        let store = CachedStore::new(CountingBackend::with(&[("github.token", "gho_abc")]));
        for kind in [ErrorKind::Keychain, ErrorKind::Io] {
            store.backend().fail_next_read(kind);
            assert_eq!(store.get("github.token").unwrap_err().kind, kind);
        }
        assert_eq!(
            store.get("github.token").unwrap().as_deref(),
            Some("gho_abc")
        );
        assert_eq!(store.backend().reads(), 3);
    }

    #[test]
    fn a_save_that_fails_after_the_new_value_landed_keeps_the_new_value() {
        let big = big_secret(5_000);
        let store = CachedStore::new(CountingBackend::with(&[("k", big.as_str())]));
        store.get("k").unwrap();
        store
            .backend()
            .failing_removes
            .store(true, Ordering::SeqCst);
        assert!(store.set("k", "curto").is_err());
        assert_eq!(store.get("k").unwrap().as_deref(), Some("curto"));
        assert_eq!(store.backend().stored("k").as_deref(), Some("curto"));
        store
            .backend()
            .failing_removes
            .store(false, Ordering::SeqCst);
        store.delete("k").unwrap();
        assert!(store.backend().entries.lock().unwrap().is_empty());
        assert_eq!(store.backend().reads(), split_chunks(&big).len());
    }

    #[test]
    fn a_failed_write_leaves_the_cache_untouched() {
        let store = CachedStore::new(CountingBackend::with(&[("github.token", "gho_old")]));
        store.get("github.token").unwrap();
        store.backend().failing_writes.store(true, Ordering::SeqCst);
        assert_eq!(
            store.set("github.token", "gho_new").unwrap_err().kind,
            ErrorKind::Keychain
        );
        assert_eq!(
            store.get("github.token").unwrap().as_deref(),
            Some("gho_old")
        );
        assert_eq!(store.backend().reads(), 1);
    }

    #[test]
    fn invalid_keys_are_refused_before_the_keychain() {
        let store = CachedStore::new(CountingBackend::default());
        assert!(store.get("a#1").is_err());
        assert!(store.set("", "x").is_err());
        assert!(store.delete("  ").is_err());
        assert_eq!(store.backend().reads(), 0);
    }

    #[test]
    fn debug_output_never_shows_a_cached_value() {
        let store = CachedStore::new(CountingBackend::with(&[("github.token", "gho_secret")]));
        store.get("github.token").unwrap();
        store.get("microsoft.refresh-token").unwrap();
        let shown = format!("{store:?}");
        assert!(shown.contains("github.token"), "{shown}");
        assert!(!shown.contains("gho_secret"), "{shown}");
    }

    #[test]
    fn migrated_secrets_are_written_through_the_cache() {
        let dir = MarkerDir::new("cached");
        let legacy = FakeBackend::default();
        set_secret(&legacy, "github.token", "gho_old").unwrap();
        let current = CachedStore::new(CountingBackend::default());
        assert_eq!(
            migrate_legacy_secrets(&legacy, &current, &dir.markers()).unwrap(),
            1
        );
        let reads = current.backend().reads();
        assert_eq!(reads, ALLOWED_SECRET_KEYS.len());
        assert_eq!(
            current.get("github.token").unwrap().as_deref(),
            Some("gho_old")
        );
        assert_eq!(current.get("microsoft.refresh-token").unwrap(), None);
        assert_eq!(current.backend().reads(), reads);
    }
}

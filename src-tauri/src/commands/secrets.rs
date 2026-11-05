use keyring::Entry;

use super::error::{CommandError, CommandResult, ErrorKind};

const SERVICE: &str = "com.mottu.devpulse";

pub fn classify_keyring_error(error: &keyring::Error) -> ErrorKind {
    match error {
        keyring::Error::NoStorageAccess(_) => ErrorKind::KeychainDenied,
        keyring::Error::PlatformFailure(inner) => {
            let text = inner.to_string().to_lowercase();
            let denied = ["-128", "-25293", "-25308", "user canceled", "user interaction", "access denied", "denied"]
                .iter()
                .any(|marker| text.contains(marker));
            if denied {
                ErrorKind::KeychainDenied
            } else {
                ErrorKind::Io
            }
        }
        _ => ErrorKind::Io,
    }
}

fn to_command_error(error: keyring::Error) -> CommandError {
    CommandError::new(classify_keyring_error(&error), error.to_string())
}

const CHUNK_BYTES: usize = 1_200;
const MAX_CHUNKS: usize = 64;
const HEADER_PREFIX: &str = "dp-chunked:v1:";

pub trait SecretBackend {
    fn read(&self, key: &str) -> CommandResult<Option<String>>;
    fn write(&self, key: &str, value: &str) -> CommandResult<()>;
    fn remove(&self, key: &str) -> CommandResult<()>;
}

struct KeyringBackend;

impl KeyringBackend {
    fn entry(key: &str) -> CommandResult<Entry> {
        Entry::new(SERVICE, key).map_err(to_command_error)
    }
}

impl SecretBackend for KeyringBackend {
    fn read(&self, key: &str) -> CommandResult<Option<String>> {
        match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(to_command_error(error)),
        }
    }

    fn write(&self, key: &str, value: &str) -> CommandResult<()> {
        Self::entry(key)?.set_password(value).map_err(to_command_error)
    }

    fn remove(&self, key: &str) -> CommandResult<()> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(to_command_error(error)),
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
    match rest.split_once(':').and_then(|(count, first)| Some((count.parse::<usize>().ok()?, first))) {
        Some((count, first)) if (1..=MAX_CHUNKS).contains(&count) => Stored::Chunked { count, first },
        _ => Stored::Corrupt,
    }
}

fn tail_key(key: &str, index: usize) -> String {
    format!("{key}#{index}")
}

fn check_key(key: &str) -> CommandResult<()> {
    if key.trim().is_empty() {
        return Err(CommandError::new(ErrorKind::InvalidArgument, "chave vazia"));
    }
    if key.contains('#') {
        return Err(CommandError::new(ErrorKind::InvalidArgument, "chave com caractere reservado"));
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
        return Err(CommandError::new(ErrorKind::InvalidArgument, "segredo grande demais"));
    }
    let previous = stored_pieces(backend, key)?;
    if pieces.len() == 1 && !value.starts_with(HEADER_PREFIX) {
        backend.write(key, value)?;
    } else {
        for (index, piece) in pieces.iter().enumerate().skip(1) {
            backend.write(&tail_key(key, index), piece)?;
        }
        backend.write(key, &format!("{HEADER_PREFIX}{}:{}", pieces.len(), pieces[0]))?;
    }
    drop_tails(backend, key, pieces.len(), previous)
}

pub fn delete_secret(backend: &dyn SecretBackend, key: &str) -> CommandResult<()> {
    check_key(key)?;
    let previous = stored_pieces(backend, key)?;
    drop_tails(backend, key, 1, previous)?;
    backend.remove(key)
}

#[tauri::command(async)]
pub fn secret_get(key: String) -> CommandResult<Option<String>> {
    get_secret(&KeyringBackend, &key)
}

#[tauri::command(async)]
pub fn secret_set(key: String, value: String) -> CommandResult<()> {
    set_secret(&KeyringBackend, &key, &value)
}

#[tauri::command(async)]
pub fn secret_delete(key: String) -> CommandResult<()> {
    delete_secret(&KeyringBackend, &key)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn no_storage_access_is_denied() {
        let error = keyring::Error::NoStorageAccess("bloqueado".into());
        assert_eq!(classify_keyring_error(&error), ErrorKind::KeychainDenied);
    }

    #[test]
    fn user_canceled_platform_failure_is_denied() {
        let error = keyring::Error::PlatformFailure("User canceled the operation. (-128)".into());
        assert_eq!(classify_keyring_error(&error), ErrorKind::KeychainDenied);
    }

    #[test]
    fn other_platform_failure_is_io() {
        let error = keyring::Error::PlatformFailure("disco cheio".into());
        assert_eq!(classify_keyring_error(&error), ErrorKind::Io);
    }

    #[test]
    fn empty_key_is_rejected_before_touching_the_keychain() {
        let error = secret_get("  ".into()).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidArgument);
    }

    const WINDOWS_BLOB_LIMIT: usize = 2_560;

    #[derive(Default)]
    struct FakeBackend {
        entries: RefCell<HashMap<String, String>>,
    }

    impl SecretBackend for FakeBackend {
        fn read(&self, key: &str) -> CommandResult<Option<String>> {
            Ok(self.entries.borrow().get(key).cloned())
        }

        fn write(&self, key: &str, value: &str) -> CommandResult<()> {
            if value.encode_utf16().count() * 2 > WINDOWS_BLOB_LIMIT {
                return Err(CommandError::new(ErrorKind::Io, "blob acima do limite do Credential Manager"));
            }
            self.entries.borrow_mut().insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn remove(&self, key: &str) -> CommandResult<()> {
            self.entries.borrow_mut().remove(key);
            Ok(())
        }
    }

    fn big_secret(len: usize) -> String {
        (0..len).map(|index| char::from(b'a' + (index % 26) as u8)).collect()
    }

    #[test]
    fn small_secrets_stay_a_single_plain_entry() {
        let backend = FakeBackend::default();
        set_secret(&backend, "github.token", "gho_abc").unwrap();
        assert_eq!(backend.entries.borrow().len(), 1);
        assert_eq!(backend.entries.borrow().get("github.token").unwrap(), "gho_abc");
        assert_eq!(get_secret(&backend, "github.token").unwrap().as_deref(), Some("gho_abc"));
    }

    #[test]
    fn a_5000_char_secret_is_split_and_reassembled() {
        let backend = FakeBackend::default();
        let secret = big_secret(5_000);
        set_secret(&backend, "k", &secret).unwrap();
        assert_eq!(get_secret(&backend, "k").unwrap().as_deref(), Some(secret.as_str()));
        let entries = backend.entries.borrow();
        assert!(entries.len() >= 5);
        assert!(entries.contains_key("k#1"));
        assert!(entries.values().all(|value| value.encode_utf16().count() * 2 <= WINDOWS_BLOB_LIMIT));
        assert!(entries.get("k").unwrap().starts_with(HEADER_PREFIX));
    }

    #[test]
    fn multibyte_secrets_split_on_char_boundaries() {
        let backend = FakeBackend::default();
        let secret: String = "aé€😀".repeat(900);
        set_secret(&backend, "k", &secret).unwrap();
        assert_eq!(get_secret(&backend, "k").unwrap().as_deref(), Some(secret.as_str()));
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
        assert_eq!(get_secret(&backend, "k").unwrap().as_deref(), Some(tricky.as_str()));
    }

    #[test]
    fn a_missing_or_corrupt_piece_reads_as_absent() {
        let backend = FakeBackend::default();
        set_secret(&backend, "k", &big_secret(5_000)).unwrap();
        backend.entries.borrow_mut().remove("k#2");
        assert_eq!(get_secret(&backend, "k").unwrap(), None);
        backend.entries.borrow_mut().insert("k".into(), format!("{HEADER_PREFIX}zzz:abc"));
        assert_eq!(get_secret(&backend, "k").unwrap(), None);
        delete_secret(&backend, "k").unwrap();
        assert!(backend.entries.borrow().is_empty());
    }

    #[test]
    fn keys_with_the_reserved_separator_are_rejected() {
        let backend = FakeBackend::default();
        assert_eq!(set_secret(&backend, "a#1", "x").unwrap_err().kind, ErrorKind::InvalidArgument);
        assert_eq!(get_secret(&backend, "").unwrap_err().kind, ErrorKind::InvalidArgument);
    }

    #[test]
    fn oversized_secrets_are_refused() {
        let backend = FakeBackend::default();
        let error = set_secret(&backend, "k", &big_secret(CHUNK_BYTES * MAX_CHUNKS + 1)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidArgument);
        assert!(backend.entries.borrow().is_empty());
    }

    #[test]
    fn splitting_never_exceeds_the_chunk_size() {
        let secret = big_secret(5_000);
        let pieces = split_chunks(&secret);
        assert!(pieces.iter().all(|piece| piece.len() <= CHUNK_BYTES));
        assert_eq!(pieces.concat().len(), 5_000);
    }
}

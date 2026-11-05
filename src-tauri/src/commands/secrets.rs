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

fn entry(key: &str) -> CommandResult<Entry> {
    if key.trim().is_empty() {
        return Err(CommandError::new(ErrorKind::InvalidArgument, "chave vazia"));
    }
    Entry::new(SERVICE, key).map_err(to_command_error)
}

#[tauri::command(async)]
pub fn secret_get(key: String) -> CommandResult<Option<String>> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(to_command_error(error)),
    }
}

#[tauri::command(async)]
pub fn secret_set(key: String, value: String) -> CommandResult<()> {
    entry(&key)?.set_password(&value).map_err(to_command_error)
}

#[tauri::command(async)]
pub fn secret_delete(key: String) -> CommandResult<()> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(to_command_error(error)),
    }
}

#[cfg(test)]
mod tests {
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
}

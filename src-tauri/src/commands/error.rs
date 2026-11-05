use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    KeychainDenied,
    Keychain,
    KeyringUnavailable,
    ClaudeCodeMissing,
    ClaudeExpired,
    CredentialMalformed,
    ProgramNotAllowed,
    ProgramNotFound,
    InvalidArgument,
    Policy,
    SpawnFailed,
    TooManyProcesses,
    Timeout,
    StateMismatch,
    ProviderError,
    Cancelled,
    Http,
    RateLimited,
    Tray,
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Error)]
#[error("{message}")]
pub struct CommandError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(rename = "retryAfterSecs", skip_serializing_if = "Option::is_none")]
    pub retry_after_secs: Option<Option<u64>>,
}

impl CommandError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after_secs: None,
        }
    }

    pub fn rate_limited(message: impl Into<String>, retry_after_secs: Option<u64>) -> Self {
        Self {
            kind: ErrorKind::RateLimited,
            message: message.into(),
            retry_after_secs: Some(retry_after_secs),
        }
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

impl From<std::io::Error> for CommandError {
    fn from(error: std::io::Error) -> Self {
        let kind = match error.kind() {
            std::io::ErrorKind::TimedOut => ErrorKind::Timeout,
            _ => ErrorKind::Io,
        };
        Self::new(kind, error.to_string())
    }
}

impl From<url::ParseError> for CommandError {
    fn from(error: url::ParseError) -> Self {
        Self::new(ErrorKind::InvalidArgument, error.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        Self::new(ErrorKind::Tray, error.to_string())
    }
}

impl From<tauri_plugin_http::reqwest::Error> for CommandError {
    fn from(error: tauri_plugin_http::reqwest::Error) -> Self {
        let kind = if error.is_timeout() {
            ErrorKind::Timeout
        } else {
            ErrorKind::Http
        };
        Self::new(kind, error.without_url().to_string())
    }
}

impl From<keyring::Error> for CommandError {
    fn from(error: keyring::Error) -> Self {
        Self::new(
            keyring_kind(&error, cfg!(target_os = "linux")),
            error.to_string(),
        )
    }
}

fn keyring_kind(error: &keyring::Error, linux: bool) -> ErrorKind {
    match error {
        keyring::Error::NoStorageAccess(inner) | keyring::Error::PlatformFailure(inner)
            if linux && is_secret_service_unavailable(&inner.to_string()) =>
        {
            ErrorKind::KeyringUnavailable
        }
        keyring::Error::NoStorageAccess(_) => ErrorKind::KeychainDenied,
        keyring::Error::PlatformFailure(inner) if is_denial(&inner.to_string()) => {
            ErrorKind::KeychainDenied
        }
        _ => ErrorKind::Keychain,
    }
}

fn is_secret_service_unavailable(text: &str) -> bool {
    let text = text.to_lowercase();
    [
        "no dbus session or secret service provider",
        "no result found",
        "org.freedesktop.secrets",
        "serviceunknown",
        "namehasnoowner",
        "noserver",
        "failed to connect",
        "autolaunch",
        "dbus error",
    ]
    .iter()
    .any(|marker| text.contains(marker))
}

fn is_denial(text: &str) -> bool {
    let text = text.to_lowercase();
    [
        "-128",
        "-25293",
        "-25308",
        "user canceled",
        "user interaction",
        "access denied",
        "denied",
    ]
    .iter()
    .any(|marker| text.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_in_snake_case() {
        let error = CommandError::new(ErrorKind::KeychainDenied, "denied");
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"kind":"keychain_denied","message":"denied"}"#
        );
    }

    #[test]
    fn rate_limited_always_carries_retry_after_secs_even_when_unknown() {
        assert_eq!(
            serde_json::to_string(&CommandError::rate_limited("slow-down", Some(30))).unwrap(),
            r#"{"kind":"rate_limited","message":"slow-down","retryAfterSecs":30}"#
        );
        assert_eq!(
            serde_json::to_string(&CommandError::rate_limited("slow-down", None)).unwrap(),
            r#"{"kind":"rate_limited","message":"slow-down","retryAfterSecs":null}"#
        );
    }

    #[test]
    fn new_kinds_keep_snake_case_names_the_frontend_reads() {
        let name = |kind| serde_json::to_string(&kind).unwrap();
        assert_eq!(name(ErrorKind::TooManyProcesses), r#""too_many_processes""#);
        assert_eq!(name(ErrorKind::ClaudeExpired), r#""claude_expired""#);
        assert_eq!(name(ErrorKind::Tray), r#""tray""#);
        assert_eq!(name(ErrorKind::Http), r#""http""#);
        assert_eq!(name(ErrorKind::Policy), r#""policy""#);
    }

    #[test]
    fn io_errors_convert_with_a_meaningful_kind() {
        let other: CommandError = std::io::Error::other("disco cheio").into();
        assert_eq!(other.kind, ErrorKind::Io);
        let slow: CommandError = std::io::Error::from(std::io::ErrorKind::TimedOut).into();
        assert_eq!(slow.kind, ErrorKind::Timeout);
    }

    #[test]
    fn keyring_failures_are_split_between_denied_and_keychain() {
        let kind = |error: keyring::Error| CommandError::from(error).kind;
        assert_eq!(
            kind(keyring::Error::NoStorageAccess("blocked".into())),
            ErrorKind::KeychainDenied
        );
        assert_eq!(
            kind(keyring::Error::PlatformFailure(
                "User canceled the operation. (-128)".into()
            )),
            ErrorKind::KeychainDenied
        );
        assert_eq!(
            kind(keyring::Error::PlatformFailure("disco cheio".into())),
            ErrorKind::Keychain
        );
        assert_eq!(
            kind(keyring::Error::TooLong("x".into(), 1)),
            ErrorKind::Keychain
        );
    }

    #[test]
    fn a_missing_secret_service_is_its_own_kind_only_on_linux() {
        let platform = |text: &str| keyring::Error::PlatformFailure(text.into());
        for text in [
            "No DBus session or Secret Service provider found",
            "DBus error: Unable to autolaunch a dbus-daemon without a $DISPLAY for X11",
            "DBus error: org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.secrets was not provided by any .service files",
            "DBus error: Failed to connect to socket /run/user/1000/bus: No such file or directory",
            "DBus error: org.freedesktop.DBus.Error.NoServer",
        ] {
            assert_eq!(keyring_kind(&platform(text), true), ErrorKind::KeyringUnavailable);
            assert_eq!(keyring_kind(&platform(text), false), ErrorKind::Keychain);
        }
        let no_default_collection =
            keyring::Error::NoStorageAccess("Secret Service: no result found".into());
        assert_eq!(
            keyring_kind(&no_default_collection, true),
            ErrorKind::KeyringUnavailable
        );
    }

    #[test]
    fn a_locked_or_dismissed_keyring_stays_a_denial_on_linux() {
        for text in [
            "Secret Service: object locked",
            "Secret Service: unlock prompt was dismissed",
        ] {
            let error = keyring::Error::NoStorageAccess(text.into());
            assert_eq!(keyring_kind(&error, true), ErrorKind::KeychainDenied);
        }
        let other = keyring::Error::PlatformFailure("Crypto error: bad padding".into());
        assert_eq!(keyring_kind(&other, true), ErrorKind::Keychain);
    }

    #[test]
    fn keyring_unavailable_keeps_the_snake_case_name_the_frontend_reads() {
        assert_eq!(
            serde_json::to_string(&ErrorKind::KeyringUnavailable).unwrap(),
            r#""keyring_unavailable""#
        );
    }

    #[test]
    fn display_shows_only_the_message() {
        assert_eq!(
            CommandError::new(ErrorKind::Io, "failed").to_string(),
            "failed"
        );
    }
}

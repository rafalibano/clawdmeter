use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    KeychainDenied,
    Keychain,
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
        let kind = match &error {
            keyring::Error::NoStorageAccess(_) => ErrorKind::KeychainDenied,
            keyring::Error::PlatformFailure(inner) if is_denial(&inner.to_string()) => {
                ErrorKind::KeychainDenied
            }
            _ => ErrorKind::Keychain,
        };
        Self::new(kind, error.to_string())
    }
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
        let error = CommandError::new(ErrorKind::KeychainDenied, "negado");
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"kind":"keychain_denied","message":"negado"}"#
        );
    }

    #[test]
    fn rate_limited_always_carries_retry_after_secs_even_when_unknown() {
        assert_eq!(
            serde_json::to_string(&CommandError::rate_limited("devagar", Some(30))).unwrap(),
            r#"{"kind":"rate_limited","message":"devagar","retryAfterSecs":30}"#
        );
        assert_eq!(
            serde_json::to_string(&CommandError::rate_limited("devagar", None)).unwrap(),
            r#"{"kind":"rate_limited","message":"devagar","retryAfterSecs":null}"#
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
            kind(keyring::Error::NoStorageAccess("bloqueado".into())),
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
    fn display_shows_only_the_message() {
        assert_eq!(
            CommandError::new(ErrorKind::Io, "falhou").to_string(),
            "falhou"
        );
    }
}

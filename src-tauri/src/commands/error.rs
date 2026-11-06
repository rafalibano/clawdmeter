use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    // A denied prompt settles the legacy migration (N6) and pauses keychain reads; the webview sees `keychain`.
    #[serde(rename = "keychain")]
    KeychainDenied,
    Keychain,
    ClaudeSigninRequired,
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
        let kind = if is_denial(&error) {
            ErrorKind::KeychainDenied
        } else {
            ErrorKind::Keychain
        };
        Self::new(kind, error.to_string())
    }
}

pub fn keychain_write_error(error: keyring::Error) -> CommandError {
    if is_refused_write(&error) {
        return CommandError::new(ErrorKind::KeychainDenied, error.to_string());
    }
    error.into()
}

#[cfg(target_os = "macos")]
const DENIAL_STATUSES: [i32; 3] = [-128, -25293, -25308];

#[cfg(target_os = "macos")]
const DUPLICATE_ITEM_STATUS: i32 = -25299;

#[cfg(target_os = "macos")]
fn platform_status(error: &keyring::Error) -> Option<i32> {
    match error {
        keyring::Error::PlatformFailure(inner) => inner
            .downcast_ref::<security_framework::base::Error>()
            .map(|status| status.code()),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn is_denial(error: &keyring::Error) -> bool {
    platform_status(error).is_some_and(|status| DENIAL_STATUSES.contains(&status))
}

#[cfg(target_os = "macos")]
fn is_refused_write(error: &keyring::Error) -> bool {
    // set_generic_password falls back to add when the lookup is refused, so the existing item answers "duplicate".
    platform_status(error) == Some(DUPLICATE_ITEM_STATUS)
}

#[cfg(not(target_os = "macos"))]
fn is_denial(error: &keyring::Error) -> bool {
    matches!(error, keyring::Error::PlatformFailure(inner) if is_denial_text(&inner.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn is_refused_write(_error: &keyring::Error) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
fn is_denial_text(text: &str) -> bool {
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
        let error = CommandError::new(ErrorKind::ClaudeSigninRequired, "sign in");
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"kind":"claude_signin_required","message":"sign in"}"#
        );
    }

    #[test]
    fn a_denied_keychain_reaches_the_webview_as_a_plain_keychain_error() {
        let name = |kind| serde_json::to_string(&kind).unwrap();
        assert_eq!(name(ErrorKind::KeychainDenied), r#""keychain""#);
        assert_eq!(name(ErrorKind::Keychain), r#""keychain""#);
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
        assert_eq!(
            name(ErrorKind::ClaudeSigninRequired),
            r#""claude_signin_required""#
        );
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
    fn keyring_failures_that_are_not_a_denial_stay_keychain_errors() {
        let kind = |error: keyring::Error| CommandError::from(error).kind;
        assert_eq!(
            kind(keyring::Error::NoStorageAccess("blocked".into())),
            ErrorKind::Keychain
        );
        assert_eq!(
            kind(keyring::Error::PlatformFailure("disco cheio".into())),
            ErrorKind::Keychain
        );
        assert_eq!(
            kind(keyring::Error::TooLong("x".into(), 1)),
            ErrorKind::Keychain
        );
        assert_eq!(
            keychain_write_error(keyring::Error::PlatformFailure("disco cheio".into())).kind,
            ErrorKind::Keychain
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn outside_macos_a_denial_is_recognized_by_its_text() {
        let kind =
            |text: &str| CommandError::from(keyring::Error::PlatformFailure(text.into())).kind;
        assert_eq!(
            kind("Access is denied. (os error 5)"),
            ErrorKind::KeychainDenied
        );
        assert_eq!(
            kind("User canceled the operation."),
            ErrorKind::KeychainDenied
        );
        assert_eq!(kind("Element not found."), ErrorKind::Keychain);
    }

    #[cfg(target_os = "macos")]
    fn keychain_status(code: i32) -> keyring::Error {
        keyring::Error::PlatformFailure(Box::new(security_framework::base::Error::from_code(code)))
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn on_macos_a_denial_is_recognized_by_its_status_code() {
        let kind = |code| CommandError::from(keychain_status(code)).kind;
        for code in [-128, -25293, -25308] {
            assert_eq!(kind(code), ErrorKind::KeychainDenied, "{code}");
        }
        for code in [-25299, -25291, -34018, -50] {
            assert_eq!(kind(code), ErrorKind::Keychain, "{code}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn on_macos_the_text_of_an_error_is_not_trusted_for_a_denial() {
        assert_eq!(
            CommandError::from(keyring::Error::PlatformFailure(
                "User canceled the operation. (-128)".into()
            ))
            .kind,
            ErrorKind::Keychain
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn on_macos_a_refused_lookup_inside_a_write_counts_as_a_denial() {
        let kind = |code| keychain_write_error(keychain_status(code)).kind;
        for code in [-25299, -128, -25293, -25308] {
            assert_eq!(kind(code), ErrorKind::KeychainDenied, "{code}");
        }
        assert_eq!(kind(-34018), ErrorKind::Keychain);
        assert_eq!(
            keychain_write_error(keyring::Error::NoStorageAccess(Box::new(
                security_framework::base::Error::from_code(-25291)
            )))
            .kind,
            ErrorKind::Keychain
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

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    KeychainDenied,
    ClaudeCodeMissing,
    CredentialMalformed,
    ProgramNotAllowed,
    ProgramNotFound,
    InvalidArgument,
    SpawnFailed,
    Timeout,
    StateMismatch,
    ProviderError,
    Cancelled,
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommandError {
    pub kind: ErrorKind,
    pub message: String,
}

impl CommandError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn io(error: impl std::fmt::Display) -> Self {
        Self::new(ErrorKind::Io, error.to_string())
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

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
}

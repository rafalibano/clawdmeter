use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::error::{CommandError, CommandResult, ErrorKind};

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCredentials {
    claude_ai_oauth: Option<StoredOauth>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredOauth {
    access_token: Option<String>,
    expires_at: Option<f64>,
    subscription_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCredential {
    pub access_token: String,
    pub expires_at: Option<u64>,
    pub subscription_type: Option<String>,
}

pub fn parse_credentials(raw: &str) -> CommandResult<ClaudeCredential> {
    let malformed =
        |detail: &str| CommandError::new(ErrorKind::CredentialMalformed, detail.to_string());
    let stored: StoredCredentials = serde_json::from_str(raw.trim())
        .map_err(|_| malformed("credencial do Claude Code não é um JSON válido"))?;
    let oauth = stored
        .claude_ai_oauth
        .ok_or_else(|| malformed("credencial sem claudeAiOauth"))?;
    let access_token = oauth
        .access_token
        .filter(|token| !token.is_empty())
        .ok_or_else(|| malformed("credencial sem accessToken"))?;
    Ok(ClaudeCredential {
        access_token,
        expires_at: oauth
            .expires_at
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(|value| value as u64),
        subscription_type: oauth.subscription_type,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub enum KeychainOutcome {
    Missing,
    Denied,
    Failed,
}

pub fn classify_security_failure(exit_code: Option<i32>, stderr: &str) -> KeychainOutcome {
    let text = stderr.to_lowercase();
    if exit_code == Some(44) || text.contains("could not be found") {
        return KeychainOutcome::Missing;
    }
    let denied_codes = [Some(36), Some(51), Some(128)];
    if denied_codes.contains(&exit_code)
        || text.contains("user canceled")
        || text.contains("user interaction is not allowed")
        || text.contains("denied")
    {
        return KeychainOutcome::Denied;
    }
    KeychainOutcome::Failed
}

pub fn credentials_file_path(home: Option<PathBuf>) -> Option<PathBuf> {
    home.map(|dir| dir.join(".claude").join(".credentials.json"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn read_credentials_file() -> CommandResult<Option<String>> {
    let Some(path) = credentials_file_path(home_dir()) else {
        return Ok(None);
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CommandError::io(error)),
    }
}

#[cfg(target_os = "macos")]
fn read_keychain() -> CommandResult<Option<String>> {
    let output = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
        .output()
        .map_err(CommandError::io)?;
    if output.status.success() {
        return Ok(Some(String::from_utf8_lossy(&output.stdout).into_owned()));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    match classify_security_failure(output.status.code(), &stderr) {
        KeychainOutcome::Missing => Ok(None),
        KeychainOutcome::Denied => Err(CommandError::new(
            ErrorKind::KeychainDenied,
            "acesso ao Keychain do Claude Code negado",
        )),
        KeychainOutcome::Failed => Err(CommandError::new(ErrorKind::Io, stderr.trim().to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
fn read_keychain() -> CommandResult<Option<String>> {
    Ok(None)
}

#[tauri::command(async)]
pub fn claude_credentials_read() -> CommandResult<ClaudeCredential> {
    let raw = match read_keychain()? {
        Some(raw) => Some(raw),
        None => read_credentials_file()?,
    };
    match raw {
        Some(raw) => parse_credentials(&raw),
        None => Err(CommandError::new(
            ErrorKind::ClaudeCodeMissing,
            "credencial do Claude Code não encontrada",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc","refreshToken":"sk-ant-ort01-xyz","expiresAt":1767225600000,"scopes":["user:inference"],"subscriptionType":"max"}}"#;

    #[test]
    fn parses_access_token_expiry_and_plan() {
        let credential = parse_credentials(VALID).unwrap();
        assert_eq!(credential.access_token, "sk-ant-oat01-abc");
        assert_eq!(credential.expires_at, Some(1_767_225_600_000));
        assert_eq!(credential.subscription_type.as_deref(), Some("max"));
    }

    #[test]
    fn never_exposes_the_refresh_token() {
        let credential = parse_credentials(VALID).unwrap();
        let json = serde_json::to_string(&credential).unwrap();
        assert!(!json.contains("refresh"));
        assert!(!json.contains("sk-ant-ort01-xyz"));
    }

    #[test]
    fn tolerates_missing_optional_fields() {
        let credential = parse_credentials(r#"{"claudeAiOauth":{"accessToken":"t"}}"#).unwrap();
        assert_eq!(credential.expires_at, None);
        assert_eq!(credential.subscription_type, None);
    }

    #[test]
    fn accepts_trailing_newline_from_security_cli() {
        assert!(parse_credentials(&format!("{VALID}\n")).is_ok());
    }

    #[test]
    fn rejects_invalid_json() {
        assert_eq!(
            parse_credentials("nao-json").unwrap_err().kind,
            ErrorKind::CredentialMalformed
        );
    }

    #[test]
    fn rejects_missing_oauth_block_and_empty_token() {
        assert_eq!(
            parse_credentials("{}").unwrap_err().kind,
            ErrorKind::CredentialMalformed
        );
        assert_eq!(
            parse_credentials(r#"{"claudeAiOauth":{"accessToken":""}}"#)
                .unwrap_err()
                .kind,
            ErrorKind::CredentialMalformed
        );
    }

    #[test]
    fn classifies_security_exit_codes() {
        assert_eq!(
            classify_security_failure(
                Some(44),
                "The specified item could not be found in the keychain."
            ),
            KeychainOutcome::Missing
        );
        assert_eq!(
            classify_security_failure(Some(51), "User canceled the operation."),
            KeychainOutcome::Denied
        );
        assert_eq!(
            classify_security_failure(Some(36), ""),
            KeychainOutcome::Denied
        );
        assert_eq!(
            classify_security_failure(Some(1), "boom"),
            KeychainOutcome::Failed
        );
    }

    #[test]
    fn builds_credentials_path_under_home() {
        let path = credentials_file_path(Some(PathBuf::from("/home/dev"))).unwrap();
        assert!(
            path.ends_with(".claude/.credentials.json")
                || path.ends_with(".claude\\.credentials.json")
        );
        assert_eq!(credentials_file_path(None), None);
    }
}

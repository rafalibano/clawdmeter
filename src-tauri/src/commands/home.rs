use std::ffi::OsString;
use std::path::PathBuf;

pub fn home_dir() -> Option<PathBuf> {
    home_from(std::env::var_os(home_variable()))
}

fn home_variable() -> &'static str {
    if cfg!(windows) {
        "USERPROFILE"
    } else {
        "HOME"
    }
}

fn home_from(value: Option<OsString>) -> Option<PathBuf> {
    value.filter(|value| !value.is_empty()).map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_missing_variable_has_no_home() {
        assert_eq!(home_from(None), None);
        assert_eq!(home_from(Some(OsString::new())), None);
        assert_eq!(
            home_from(Some("/Users/dev".into())),
            Some(PathBuf::from("/Users/dev"))
        );
    }

    #[test]
    fn reads_the_variable_of_the_current_os() {
        assert_eq!(
            home_variable(),
            if cfg!(windows) { "USERPROFILE" } else { "HOME" }
        );
    }
}

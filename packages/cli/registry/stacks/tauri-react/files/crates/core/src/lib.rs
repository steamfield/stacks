use serde::Serialize;
use specta::Type;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum InfoError {
    #[error("application name must not be empty")]
    EmptyName,
}

#[derive(Debug, Serialize, Type, PartialEq)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub os: String,
}

pub fn app_info(name: &str, version: &str) -> Result<AppInfo, InfoError> {
    if name.trim().is_empty() {
        return Err(InfoError::EmptyName);
    }
    Ok(AppInfo {
        name: name.to_owned(),
        version: version.to_owned(),
        os: std::env::consts::OS.to_owned(),
    })
}

#[derive(Debug, Clone, Serialize, Type, PartialEq)]
pub struct Tick {
    pub counter: u32,
    // Milliseconds since subscription, bounded to u32 (about 49 days).
    pub elapsed_ms: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_preserves_metadata_and_rejects_blank_names() {
        let info = app_info("Desktop", "dev").unwrap();
        assert_eq!(info.name, "Desktop");
        assert_eq!(info.version, "dev");
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(app_info("  ", "dev"), Err(InfoError::EmptyName));
    }
}

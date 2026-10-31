#[derive(Debug, serde::Serialize, specta::Type, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CommandError {
    #[error("Application metadata is unavailable.")]
    InvalidMetadata,
    #[error("Tick subscriptions are unavailable.")]
    StreamUnavailable,
}

impl From<core_app::InfoError> for CommandError {
    fn from(error: core_app::InfoError) -> Self {
        tracing::error!(%error, command = "app_info", "command failed");
        Self::InvalidMetadata
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_error_has_a_tagged_wire_shape() {
        let error = CommandError::from(core_app::InfoError::EmptyName);
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({ "kind": "invalid_metadata" })
        );
    }
}

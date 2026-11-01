//! The one error type the slug logic returns, and the stable code each
//! variant carries across to JavaScript.

/// Why a call failed.
///
/// `src/js.rs` turns each variant into a thrown JavaScript `Error` named
/// `SlugError` whose `code` is [`Error::code`], so callers branch on the code
/// rather than the message.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum Error {
    /// The input was empty or only whitespace.
    #[error("input is empty")]
    EmptyInput,
    /// The input held no letters or digits to build a slug from.
    #[error("input has no letters or digits")]
    EmptyResult,
    /// An option had the wrong type, an unknown name or a value out of range.
    #[error("invalid option{}: {reason}", field.as_ref().map(|f| format!(" {f}")).unwrap_or_default())]
    InvalidOption {
        /// The option's name as the caller spelled it, when known.
        field: Option<String>,
        /// What was wrong with it.
        reason: String,
    },
}

impl Error {
    /// The stable code JavaScript sees as `error.code`. Changing one breaks
    /// every caller that matches on it.
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::EmptyInput => "empty_input",
            Self::EmptyResult => "empty_result",
            Self::InvalidOption { .. } => "invalid_option",
        }
    }

    /// The option at fault, for `invalid_option` errors that know it.
    pub(crate) fn field(&self) -> Option<&str> {
        match self {
            Self::InvalidOption { field, .. } => field.as_deref(),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_has_a_stable_code() {
        let invalid = Error::InvalidOption {
            field: Some("maxLength".to_owned()),
            reason: "must be at least 1".to_owned(),
        };
        assert_eq!(Error::EmptyInput.code(), "empty_input");
        assert_eq!(Error::EmptyResult.code(), "empty_result");
        assert_eq!(invalid.code(), "invalid_option");
    }

    #[test]
    fn messages_name_the_option_when_known() {
        let known = Error::InvalidOption {
            field: Some("separator".to_owned()),
            reason: "must be one of - _ .".to_owned(),
        };
        assert_eq!(
            known.to_string(),
            "invalid option separator: must be one of - _ ."
        );
        assert_eq!(known.field(), Some("separator"));
        let unknown = Error::InvalidOption {
            field: None,
            reason: "expected an object".to_owned(),
        };
        assert_eq!(unknown.to_string(), "invalid option: expected an object");
        assert_eq!(Error::EmptyInput.field(), None);
    }
}

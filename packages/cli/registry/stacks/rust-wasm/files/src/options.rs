//! Options as JavaScript passes them, and the checked settings the slug logic
//! uses.

use serde::Deserialize;

use crate::Error;

/// The options object a caller passes, as decoded from JavaScript.
///
/// Every field is optional (an absent or `undefined` key takes the default).
/// The TypeScript shape is `SlugOptions` in `src/lib.rs`; keep the two and
/// [`Options::KEYS`] in step.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Options {
    /// The string between words: `-`, `_` or `.`.
    pub(crate) separator: Option<String>,
    /// The longest slug, in characters.
    pub(crate) max_length: Option<u32>,
}

/// Checked settings, built by [`Options::settings`] or [`Settings::default`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Settings {
    /// The character between words.
    pub(crate) separator: char,
    /// The longest slug, in characters.
    pub(crate) max_length: usize,
}

impl Settings {
    /// The separators a caller may choose.
    const SEPARATORS: [char; 3] = ['-', '_', '.'];
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            separator: '-',
            max_length: 64,
        }
    }
}

impl Options {
    /// Every key a caller may pass, as JavaScript spells it. serde-wasm-bindgen
    /// reads only the fields it knows and ignores the rest (even with
    /// `deny_unknown_fields`), so `src/js.rs` rejects any other key itself.
    pub(crate) const KEYS: [&str; 2] = ["separator", "maxLength"];

    /// Apply the defaults and check every value.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidOption`] naming the first field out of range.
    pub(crate) fn settings(&self) -> Result<Settings, Error> {
        let mut settings = Settings::default();
        if let Some(separator) = &self.separator {
            let mut chars = separator.chars();
            settings.separator = match (chars.next(), chars.next()) {
                (Some(ch), None) if Settings::SEPARATORS.contains(&ch) => ch,
                _ => {
                    return Err(Error::InvalidOption {
                        field: Some("separator".to_owned()),
                        reason: format!("must be one of - _ . (got {separator:?})"),
                    });
                }
            };
        }
        if let Some(max_length) = self.max_length {
            if max_length == 0 {
                return Err(Error::InvalidOption {
                    field: Some("maxLength".to_owned()),
                    reason: "must be at least 1".to_owned(),
                });
            }
            settings.max_length = max_length as usize;
        }
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_options_means_the_defaults() {
        assert_eq!(Options::default().settings(), Ok(Settings::default()));
    }

    #[test]
    fn accepts_each_listed_separator_and_a_positive_length() {
        for separator in ["-", "_", "."] {
            let options = Options {
                separator: Some(separator.to_owned()),
                max_length: Some(8),
            };
            let settings = options.settings().unwrap();
            assert_eq!(settings.separator.to_string(), separator);
            assert_eq!(settings.max_length, 8);
        }
    }

    #[test]
    fn rejects_values_out_of_range_naming_the_field() {
        let cases = [
            (Some("/"), None, "separator"),
            (Some("--"), None, "separator"),
            (Some(""), None, "separator"),
            (None, Some(0), "maxLength"),
        ];
        for (separator, max_length, field) in cases {
            let options = Options {
                separator: separator.map(str::to_owned),
                max_length,
            };
            let err = options.settings().unwrap_err();
            assert_eq!((err.code(), err.field()), ("invalid_option", Some(field)));
        }
    }
}

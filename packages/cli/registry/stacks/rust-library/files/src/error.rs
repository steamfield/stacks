//! The one error type the public API returns.

/// Why a value was rejected.
///
/// Every fallible function in this crate returns this type. It is
/// `#[non_exhaustive]`, so adding a variant is not a breaking change; match it
/// with a wildcard arm.
///
/// ```
/// use crate_name::{Error, Slug};
///
/// match Slug::parse("Hello") {
///     Err(Error::InvalidChar { ch, index }) => assert_eq!((ch, index), ('H', 0)),
///     other => unreachable!("{other:?}"),
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The input was the empty string.
    #[error("a slug can't be empty")]
    Empty,
    /// The input was longer than the rules allow.
    #[error("a slug is at most {max} bytes long, got {len}")]
    TooLong {
        /// The input's length in bytes.
        len: usize,
        /// The longest slug the rules accept.
        max: usize,
    },
    /// The input held a character other than `a-z`, `0-9` or `-`.
    #[error("invalid character {ch:?} at byte {index}; use a-z, 0-9 and '-'")]
    InvalidChar {
        /// The rejected character.
        ch: char,
        /// Its byte offset in the input.
        index: usize,
    },
    /// A `-` started or ended the input, or followed another `-`.
    #[error("misplaced '-' at byte {index}; a hyphen goes between two words")]
    MisplacedHyphen {
        /// The hyphen's byte offset in the input.
        index: usize,
    },
    /// [`Rules::with_max_len`](crate::Rules::with_max_len) was given zero.
    #[error("max_len must be at least 1")]
    ZeroMaxLen,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_name_the_offending_input() {
        let err = Error::InvalidChar { ch: '_', index: 3 };
        assert_eq!(
            err.to_string(),
            "invalid character '_' at byte 3; use a-z, 0-9 and '-'"
        );
        let err = Error::TooLong { len: 70, max: 64 };
        assert_eq!(err.to_string(), "a slug is at most 64 bytes long, got 70");
    }

    #[test]
    fn errors_are_thread_safe_values() {
        fn assert_traits<T: std::error::Error + Send + Sync + Clone + 'static>() {}
        assert_traits::<Error>();
    }
}

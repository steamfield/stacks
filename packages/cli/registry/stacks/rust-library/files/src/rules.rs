//! Validation settings: the crate's configuration, with checked defaults.

use crate::{Error, Slug};

/// The settings [`Slug`] validation uses.
///
/// [`Rules::default`] allows up to [`Rules::DEFAULT_MAX_LEN`] bytes, which is
/// what [`Slug::parse`] applies. Build other rules with
/// [`Rules::with_max_len`], which rejects a value that could accept nothing.
///
/// ```
/// use crate_name::Rules;
///
/// let rules = Rules::with_max_len(8)?;
/// assert_eq!(rules.max_len(), 8);
/// assert!(rules.parse("short").is_ok());
/// assert!(rules.parse("much-too-long").is_err());
/// # Ok::<(), crate_name::Error>(())
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Rules {
    max_len: usize,
}

impl Rules {
    /// The longest slug, in bytes, that the default rules accept.
    ///
    /// ```
    /// use crate_name::Rules;
    ///
    /// assert_eq!(Rules::default().max_len(), Rules::DEFAULT_MAX_LEN);
    /// ```
    pub const DEFAULT_MAX_LEN: usize = 64;

    /// Rules that accept slugs of up to `max_len` bytes.
    ///
    /// # Errors
    ///
    /// [`Error::ZeroMaxLen`] when `max_len` is zero.
    ///
    /// ```
    /// use crate_name::{Error, Rules};
    ///
    /// assert_eq!(Rules::with_max_len(0), Err(Error::ZeroMaxLen));
    /// assert!(Rules::with_max_len(16).is_ok());
    /// ```
    pub const fn with_max_len(max_len: usize) -> Result<Self, Error> {
        if max_len == 0 {
            return Err(Error::ZeroMaxLen);
        }
        Ok(Self { max_len })
    }

    /// The longest slug, in bytes, these rules accept.
    ///
    /// ```
    /// use crate_name::Rules;
    ///
    /// assert_eq!(Rules::with_max_len(12)?.max_len(), 12);
    /// # Ok::<(), crate_name::Error>(())
    /// ```
    #[must_use]
    pub const fn max_len(&self) -> usize {
        self.max_len
    }

    /// Check `input` against these rules and wrap it as a [`Slug`].
    ///
    /// A slug is one or more words of `a-z` and `0-9` joined by single
    /// hyphens, no longer than [`max_len`](Self::max_len).
    ///
    /// # Errors
    ///
    /// The first rule `input` breaks, checked in this order:
    /// [`Error::Empty`], [`Error::TooLong`], then [`Error::InvalidChar`] or
    /// [`Error::MisplacedHyphen`] for the first bad byte.
    ///
    /// ```
    /// use crate_name::{Error, Rules};
    ///
    /// let rules = Rules::default();
    /// assert_eq!(rules.parse("rust-2024")?.as_str(), "rust-2024");
    /// assert_eq!(rules.parse("a--b"), Err(Error::MisplacedHyphen { index: 2 }));
    /// # Ok::<(), crate_name::Error>(())
    /// ```
    pub fn parse(&self, input: &str) -> Result<Slug, Error> {
        self.check(input)?;
        Ok(Slug::new_unchecked(input.to_owned()))
    }

    /// The checks behind [`parse`](Self::parse), for callers that own the input.
    pub(crate) fn check(self, input: &str) -> Result<(), Error> {
        if input.is_empty() {
            return Err(Error::Empty);
        }
        if input.len() > self.max_len {
            return Err(Error::TooLong {
                len: input.len(),
                max: self.max_len,
            });
        }
        let mut previous = None;
        for (index, ch) in input.char_indices() {
            match ch {
                'a'..='z' | '0'..='9' => {}
                '-' if index > 0 && index + 1 < input.len() && previous != Some('-') => {}
                '-' => return Err(Error::MisplacedHyphen { index }),
                _ => return Err(Error::InvalidChar { ch, index }),
            }
            previous = Some(ch);
        }
        Ok(())
    }
}

impl Default for Rules {
    fn default() -> Self {
        Self {
            max_len: Self::DEFAULT_MAX_LEN,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_words_joined_by_single_hyphens() {
        let rules = Rules::default();
        for input in ["a", "rust", "rust-2024", "a-b-c", "0"] {
            assert_eq!(rules.parse(input).unwrap().as_str(), input);
        }
    }

    #[test]
    fn reports_the_first_rule_broken() {
        let rules = Rules::with_max_len(5).unwrap();
        let cases = [
            ("", Error::Empty),
            ("abcdef", Error::TooLong { len: 6, max: 5 }),
            ("-ab", Error::MisplacedHyphen { index: 0 }),
            ("ab-", Error::MisplacedHyphen { index: 2 }),
            ("a--b", Error::MisplacedHyphen { index: 2 }),
            ("aB", Error::InvalidChar { ch: 'B', index: 1 }),
            ("a b", Error::InvalidChar { ch: ' ', index: 1 }),
            ("é", Error::InvalidChar { ch: 'é', index: 0 }),
        ];
        for (input, expected) in cases {
            assert_eq!(rules.parse(input), Err(expected), "{input:?}");
        }
    }

    #[test]
    fn length_counts_bytes_before_characters_are_checked() {
        // 33 two-byte characters are 66 bytes, over the default 64.
        let input = "é".repeat(33);
        assert_eq!(
            Rules::default().parse(&input),
            Err(Error::TooLong { len: 66, max: 64 })
        );
    }

    #[test]
    fn zero_max_len_is_rejected() {
        assert_eq!(Rules::with_max_len(0), Err(Error::ZeroMaxLen));
        assert_eq!(Rules::with_max_len(1).unwrap().max_len(), 1);
    }
}

//! The validated `Slug` type and its conversions.

use std::fmt;
use std::str::FromStr;

use crate::{Error, Rules};

/// A lowercase, hyphen-separated identifier such as `rust-2024`.
///
/// A `Slug` always holds a valid value: the only ways to get one check the
/// input against [`Rules`]. With the `serde` feature it serializes as a string
/// and deserializing runs the same check.
///
/// ```
/// use crate_name::Slug;
///
/// let slug: Slug = "hello-world".parse()?;
/// assert_eq!(slug.to_string(), "hello-world");
/// assert!("Hello World".parse::<Slug>().is_err());
/// # Ok::<(), crate_name::Error>(())
/// ```
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(try_from = "String", into = "String")
)]
pub struct Slug(String);

impl Slug {
    /// Check `input` against the default [`Rules`].
    ///
    /// # Errors
    ///
    /// The first rule `input` breaks; see [`Rules::parse`].
    ///
    /// ```
    /// use crate_name::{Error, Slug};
    ///
    /// assert_eq!(Slug::parse("api-v2")?.as_str(), "api-v2");
    /// assert_eq!(Slug::parse(""), Err(Error::Empty));
    /// # Ok::<(), crate_name::Error>(())
    /// ```
    pub fn parse(input: &str) -> Result<Self, Error> {
        Rules::default().parse(input)
    }

    /// The slug as a string slice.
    ///
    /// ```
    /// use crate_name::Slug;
    ///
    /// assert_eq!(Slug::parse("docs")?.as_str(), "docs");
    /// # Ok::<(), crate_name::Error>(())
    /// ```
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Wrap a string [`Rules::parse`] has already checked.
    pub(crate) const fn new_unchecked(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for Slug {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for Slug {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl FromStr for Slug {
    type Err = Error;

    fn from_str(input: &str) -> Result<Self, Error> {
        Self::parse(input)
    }
}

impl TryFrom<&str> for Slug {
    type Error = Error;

    fn try_from(input: &str) -> Result<Self, Error> {
        Self::parse(input)
    }
}

impl TryFrom<String> for Slug {
    type Error = Error;

    fn try_from(input: String) -> Result<Self, Error> {
        Rules::default().check(&input)?;
        Ok(Self(input))
    }
}

impl From<Slug> for String {
    fn from(slug: Slug) -> Self {
        slug.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_conversion_applies_the_default_rules() {
        let long = "a".repeat(Rules::DEFAULT_MAX_LEN + 1);
        assert!(Slug::parse(&long).is_err());
        assert!(long.parse::<Slug>().is_err());
        assert!(Slug::try_from(long.as_str()).is_err());
        assert!(Slug::try_from(long).is_err());
    }

    #[test]
    fn converts_back_to_the_input_string() {
        let slug = Slug::try_from("release-notes".to_owned()).unwrap();
        assert_eq!(slug.as_ref(), "release-notes");
        assert_eq!(String::from(slug), "release-notes");
    }
}

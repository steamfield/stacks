//! The slug logic in plain Rust: no `wasm-bindgen` types, so native
//! `cargo test` covers all of it.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::{Error, Settings};

/// A slug and how it was built. JavaScript receives it as `SlugInfo`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SlugInfo {
    /// The slug itself.
    pub(crate) slug: String,
    /// The lowercased words the slug kept, in order.
    pub(crate) words: Vec<String>,
    /// Whether words or characters were dropped to fit the length limit.
    pub(crate) truncated: bool,
}

/// Build a slug from `input`: lowercase runs of letters and digits joined by
/// the separator, cut at a word boundary to fit the length limit.
///
/// # Errors
///
/// [`Error::EmptyInput`] for blank input, [`Error::EmptyResult`] when no
/// letters or digits remain.
pub(crate) fn describe(input: &str, settings: &Settings) -> Result<SlugInfo, Error> {
    if input.trim().is_empty() {
        return Err(Error::EmptyInput);
    }
    let all: Vec<String> = input
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect();
    let Some((first, rest)) = all.split_first() else {
        return Err(Error::EmptyResult);
    };

    // A first word longer than the limit is cut by characters; later words
    // are kept whole or dropped.
    let mut slug: String = first.chars().take(settings.max_length).collect();
    let mut words = vec![slug.clone()];
    let mut length = slug.chars().count();
    for word in rest {
        let added = 1 + word.chars().count();
        if length + added > settings.max_length {
            break;
        }
        slug.push(settings.separator);
        slug.push_str(word);
        words.push(word.clone());
        length += added;
    }
    let truncated = words.len() < all.len() || words[0] != *first;
    Ok(SlugInfo {
        slug,
        words,
        truncated,
    })
}

/// Hands out slugs that are unique among the ones it has given, as heading
/// anchors on one page must be: a repeat gets `-2`, then `-3`.
#[derive(Debug, Clone)]
pub(crate) struct UniqueSlugs {
    settings: Settings,
    taken: HashSet<String>,
    next_suffix: HashMap<String, u32>,
}

impl UniqueSlugs {
    /// An empty set using `settings` for every slug.
    pub(crate) fn new(settings: Settings) -> Self {
        Self {
            settings,
            taken: HashSet::new(),
            next_suffix: HashMap::new(),
        }
    }

    /// The slug for `input`, made unique among those already handed out.
    ///
    /// # Errors
    ///
    /// The errors of [`describe`].
    pub(crate) fn slug(&mut self, input: &str) -> Result<String, Error> {
        let base = describe(input, &self.settings)?.slug;
        if self.taken.insert(base.clone()) {
            return Ok(base);
        }
        let suffix = self.next_suffix.entry(base.clone()).or_insert(2);
        loop {
            let candidate = format!("{base}{}{suffix}", self.settings.separator);
            *suffix += 1;
            if self.taken.insert(candidate.clone()) {
                return Ok(candidate);
            }
        }
    }

    /// How many slugs have been handed out.
    pub(crate) fn len(&self) -> usize {
        self.taken.len()
    }

    /// Forget every slug handed out, keeping the settings.
    pub(crate) fn clear(&mut self) {
        self.taken.clear();
        self.next_suffix.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slug(input: &str) -> Result<String, Error> {
        describe(input, &Settings::default()).map(|info| info.slug)
    }

    #[test]
    fn joins_lowercased_words_with_the_separator() {
        let cases = [
            ("Hello, World!", "hello-world"),
            ("  Rust and   WebAssembly ", "rust-and-webassembly"),
            ("v2.0 release", "v2-0-release"),
            ("Crème Brûlée", "crème-brûlée"),
        ];
        for (input, expected) in cases {
            assert_eq!(slug(input).unwrap(), expected, "{input:?}");
        }
        let underscore = Settings {
            separator: '_',
            ..Settings::default()
        };
        assert_eq!(describe("a b", &underscore).unwrap().slug, "a_b");
    }

    #[test]
    fn rejects_blank_input_and_input_without_words() {
        assert_eq!(slug(""), Err(Error::EmptyInput));
        assert_eq!(slug(" \t"), Err(Error::EmptyInput));
        assert_eq!(slug("!!! ???"), Err(Error::EmptyResult));
    }

    #[test]
    fn cuts_at_a_word_boundary_and_reports_it() {
        let short = Settings {
            max_length: 9,
            ..Settings::default()
        };
        let info = describe("alpha beta gamma", &short).unwrap();
        assert_eq!(info.slug, "alpha");
        assert_eq!(info.words, ["alpha"]);
        assert!(info.truncated);

        let whole = describe("alpha beta", &Settings::default()).unwrap();
        assert_eq!(whole.words, ["alpha", "beta"]);
        assert!(!whole.truncated);
    }

    #[test]
    fn cuts_a_single_long_word_by_characters() {
        let tiny = Settings {
            max_length: 3,
            ..Settings::default()
        };
        let info = describe("éàüö", &tiny).unwrap();
        assert_eq!(info.slug, "éàü");
        assert!(info.truncated);
    }

    #[test]
    fn repeats_get_numbered_suffixes() {
        let mut unique = UniqueSlugs::new(Settings::default());
        assert_eq!(unique.slug("Intro").unwrap(), "intro");
        assert_eq!(unique.slug("intro").unwrap(), "intro-2");
        assert_eq!(unique.slug("Intro 2").unwrap(), "intro-2-2");
        assert_eq!(unique.slug("INTRO").unwrap(), "intro-3");
        assert_eq!(unique.len(), 4);
        unique.clear();
        assert_eq!(unique.len(), 0);
        assert_eq!(unique.slug("intro").unwrap(), "intro");
    }
}

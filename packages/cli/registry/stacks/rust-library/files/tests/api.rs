//! The public API as a dependent crate sees it: only items exported from the
//! crate root, used the way the README and docs say to use them.

use std::collections::BTreeSet;

use crate_name::{Error, Rules, Slug};

#[test]
fn parses_through_every_public_entry_point() {
    let rules = Rules::default();
    let from_rules = rules.parse("hello-world").unwrap();
    let from_parse = Slug::parse("hello-world").unwrap();
    let from_str: Slug = "hello-world".parse().unwrap();
    let from_try = Slug::try_from("hello-world").unwrap();
    assert_eq!(from_rules, from_parse);
    assert_eq!(from_parse, from_str);
    assert_eq!(from_str, from_try);
}

#[test]
fn errors_display_a_message_and_match_by_variant() {
    let err = Slug::parse("Bad Slug").unwrap_err();
    assert!(matches!(err, Error::InvalidChar { ch: 'B', index: 0 }));
    assert!(err.to_string().contains("a-z, 0-9"));
    let boxed: Box<dyn std::error::Error + Send + Sync> = Box::new(err);
    assert!(boxed.source().is_none());
}

#[test]
fn custom_rules_apply_their_own_limit() {
    let rules = Rules::with_max_len(4).unwrap();
    assert!(rules.parse("four").is_ok());
    assert_eq!(rules.parse("fives"), Err(Error::TooLong { len: 5, max: 4 }));
}

#[test]
fn slugs_order_and_hash_by_their_text() {
    let set: BTreeSet<Slug> = ["b", "a", "c-d"]
        .into_iter()
        .map(|s| Slug::parse(s).unwrap())
        .collect();
    let ordered: Vec<&str> = set.iter().map(Slug::as_str).collect();
    assert_eq!(ordered, ["a", "b", "c-d"]);
}

#[cfg(feature = "serde")]
#[test]
fn serde_round_trips_as_a_string_and_validates_on_the_way_in() {
    let slug = Slug::parse("from-json").unwrap();
    let json = serde_json::to_string(&slug).unwrap();
    assert_eq!(json, r#""from-json""#);
    let back: Slug = serde_json::from_str(&json).unwrap();
    assert_eq!(back, slug);
    let err = serde_json::from_str::<Slug>(r#""Not A Slug""#).unwrap_err();
    assert!(err.to_string().contains("invalid character"), "{err}");
}

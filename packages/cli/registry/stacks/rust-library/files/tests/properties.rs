//! Properties that hold for every input, checked with generated cases.

use proptest::prelude::*;

use crate_name::{Rules, Slug};

proptest! {
    #[test]
    fn a_valid_slug_displays_as_its_input(input in "[a-z0-9]{1,8}(-[a-z0-9]{1,8}){0,5}") {
        let slug = Slug::parse(&input).unwrap();
        prop_assert_eq!(slug.to_string(), input.clone());
        prop_assert_eq!(slug.to_string().parse::<Slug>().unwrap(), slug);
    }

    #[test]
    fn parsing_any_text_returns_the_input_or_an_error(input in any::<String>()) {
        if let Ok(slug) = Slug::parse(&input) {
            prop_assert_eq!(slug.as_str(), input.as_str());
        }
    }

    #[test]
    fn nothing_longer_than_max_len_is_accepted(max_len in 1usize..16, input in "[a-z-]{0,32}") {
        let rules = Rules::with_max_len(max_len).unwrap();
        if let Ok(slug) = rules.parse(&input) {
            prop_assert!(slug.as_str().len() <= max_len);
        }
    }
}

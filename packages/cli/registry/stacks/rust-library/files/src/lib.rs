// The README is the crate's front page on docs.rs, and its `rust` blocks run as
// doctests, so the example people copy first always compiles.
#![doc = include_str!("../README.md")]

mod error;
mod rules;
mod slug;

pub use error::Error;
pub use rules::Rules;
pub use slug::Slug;

//! The package's JavaScript API. Everything `#[wasm_bindgen]` lives in this
//! file, so the exports, their TypeScript types and the generated `.d.ts`
//! change together. Logic lives in plain Rust modules, tested natively.
//!
//! Doc comments on exported items are copied into `pkg/*.d.ts`, so they are
//! written for JavaScript callers.

use wasm_bindgen::prelude::*;

mod error;
mod js;
mod options;
mod slug;
// Two cfg attributes, not cfg(all(..)): clippy's unwrap allowance for tests
// only sees a plain cfg(test).
#[cfg(test)]
#[cfg(target_arch = "wasm32")]
mod web_tests;

// The Rust side is crate-private: the package's API is what JavaScript sees.
use error::Error;
use options::{Options, Settings};
use slug::{UniqueSlugs, describe};

// TypeScript for the shapes that cross the boundary as plain objects. Rust
// can't derive these, so they are written once here and named below with
// `typescript_type`; `src/options.rs` and `src/slug.rs` hold the Rust side.
#[wasm_bindgen(typescript_custom_section)]
const TYPES: &str = r#"
/** Options every slug function accepts. An unknown key is an `invalid_option` error. */
export interface SlugOptions {
  /** The string between words. Default `"-"`. */
  separator?: "-" | "_" | ".";
  /** The longest slug, in characters. Default 64; at least 1. */
  maxLength?: number;
}

/** A slug and how it was built. */
export interface SlugInfo {
  slug: string;
  /** The lowercased words the slug kept, in order. */
  words: string[];
  /** Whether words or characters were dropped to fit `maxLength`. */
  truncated: boolean;
}

/** The stable codes a `SlugError` carries. */
export type SlugErrorCode = "empty_input" | "empty_result" | "invalid_option";

/** What every function here throws: an `Error` named `"SlugError"`. */
export interface SlugError extends Error {
  name: "SlugError";
  code: SlugErrorCode;
  /** The option at fault, for some `invalid_option` errors. */
  field?: string;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// The `SlugOptions` object a caller passes.
    #[wasm_bindgen(typescript_type = "SlugOptions")]
    pub type SlugOptions;

    /// The `SlugInfo` object `slugInfo` returns.
    #[wasm_bindgen(typescript_type = "SlugInfo")]
    pub type SlugInfoObject;
}

/// Turn text into a URL slug: lowercase letters and digits joined by the
/// separator, cut at a word boundary to fit `maxLength`.
///
/// # Errors
///
/// Throws a `SlugError` with code `empty_input`, `empty_result` or
/// `invalid_option`.
#[wasm_bindgen]
pub fn slugify(input: &str, options: Option<SlugOptions>) -> Result<String, JsValue> {
    let settings = js::settings(options)?;
    Ok(describe(input, &settings)?.slug)
}

/// Like `slugify`, and also returns the words kept and whether the slug was
/// truncated.
///
/// # Errors
///
/// Throws a `SlugError` with code `empty_input`, `empty_result` or
/// `invalid_option`.
#[wasm_bindgen(js_name = slugInfo)]
pub fn slug_info(input: &str, options: Option<SlugOptions>) -> Result<SlugInfoObject, JsValue> {
    let settings = js::settings(options)?;
    js::to_js(&describe(input, &settings)?)
}

/// Hands out slugs unique among those it has given, as heading anchors on
/// one page need: a repeat gets `-2`, then `-3`. It holds WebAssembly memory,
/// so call `free()` when done, or declare it with `using`.
#[wasm_bindgen]
pub struct Slugger {
    inner: UniqueSlugs,
}

#[wasm_bindgen]
impl Slugger {
    /// A new, empty slugger whose slugs all use `options`.
    ///
    /// # Errors
    ///
    /// Throws a `SlugError` with code `invalid_option`.
    #[wasm_bindgen(constructor)]
    pub fn new(options: Option<SlugOptions>) -> Result<Self, JsValue> {
        Ok(Self {
            inner: UniqueSlugs::new(js::settings(options)?),
        })
    }

    /// The slug for `input`, made unique among those this slugger has given.
    ///
    /// # Errors
    ///
    /// Throws a `SlugError` with code `empty_input` or `empty_result`.
    pub fn slug(&mut self, input: &str) -> Result<String, JsValue> {
        Ok(self.inner.slug(input)?)
    }

    /// How many slugs this slugger has handed out.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn size(&self) -> usize {
        self.inner.len()
    }

    /// Forget every slug handed out, keeping the options.
    pub fn reset(&mut self) {
        self.inner.clear();
    }
}

//! The exports compiled to wasm32 and run in Node by `make test-wasm`
//! (`wasm-pack test --node`): JavaScript values in, thrown `SlugError`s out.
//! Native `cargo test` never compiles this module.

use js_sys::{JSON, Reflect};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_test::wasm_bindgen_test;

use crate::{SlugInfoObject, SlugOptions, Slugger, slug_info, slugify};

/// A JavaScript object from JSON text, typed as `SlugOptions`.
fn options(json: &str) -> SlugOptions {
    JSON::parse(json).unwrap().unchecked_into()
}

/// A property of a JavaScript object, as a string.
fn string(value: &JsValue, key: &str) -> Option<String> {
    Reflect::get(value, &key.into()).unwrap().as_string()
}

/// The thrown value's `name`, `code` and `field`.
fn thrown(err: &JsValue) -> (String, String, Option<String>) {
    let error = err.dyn_ref::<js_sys::Error>().expect("an Error instance");
    (
        String::from(error.name()),
        string(err, "code").unwrap(),
        string(err, "field"),
    )
}

#[wasm_bindgen_test]
fn slugify_takes_a_js_options_object() {
    assert_eq!(slugify("Hello, World!", None).unwrap(), "hello-world");
    let underscored = options(r#"{"separator":"_","maxLength":11}"#);
    assert_eq!(
        slugify("Hello brave new world", Some(underscored)).unwrap(),
        "hello_brave"
    );
}

#[wasm_bindgen_test]
fn errors_cross_as_slug_errors_with_codes() {
    let err = slugify("   ", None).unwrap_err();
    assert_eq!(
        thrown(&err),
        ("SlugError".into(), "empty_input".into(), None)
    );

    let err = slugify("text", Some(options(r#"{"maxLength":0}"#))).unwrap_err();
    let expected = (
        "SlugError".into(),
        "invalid_option".into(),
        Some("maxLength".into()),
    );
    assert_eq!(thrown(&err), expected);
}

#[wasm_bindgen_test]
fn unknown_and_mistyped_options_are_rejected() {
    // serde-wasm-bindgen ignores unknown keys; src/js.rs checks them first.
    let err = slugify("text", Some(options(r#"{"maxlength":10}"#))).unwrap_err();
    let (_, code, field) = thrown(&err);
    assert_eq!(
        (code.as_str(), field.as_deref()),
        ("invalid_option", Some("maxlength"))
    );

    for json in [
        r#"{"maxLength":"10"}"#,
        r#"{"maxLength":-1}"#,
        r#"{"maxLength":1.5}"#,
        r#""-""#,
    ] {
        let Err(err) = slugify("text", Some(options(json))) else {
            panic!("{json} was accepted");
        };
        assert_eq!(thrown(&err).1, "invalid_option", "{json}");
    }
}

#[wasm_bindgen_test]
fn slug_info_returns_a_plain_object() {
    let info: SlugInfoObject =
        slug_info("alpha beta gamma", Some(options(r#"{"maxLength":10}"#))).unwrap();
    let json = JSON::stringify(&info).unwrap();
    assert_eq!(
        String::from(json),
        r#"{"slug":"alpha-beta","words":["alpha","beta"],"truncated":true}"#
    );
}

#[wasm_bindgen_test]
fn slugger_keeps_state_across_calls() {
    let mut slugger = Slugger::new(None).unwrap();
    assert_eq!(slugger.slug("Intro").unwrap(), "intro");
    assert_eq!(slugger.slug("Intro").unwrap(), "intro-2");
    assert_eq!(slugger.size(), 2);
    slugger.reset();
    assert_eq!(slugger.size(), 0);
    let err = Slugger::new(Some(options(r#"{"separator":"/"}"#)))
        .err()
        .unwrap();
    assert_eq!(thrown(&err).2.as_deref(), Some("separator"));
}

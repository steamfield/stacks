//! The JavaScript boundary: decoding options, encoding results and turning
//! [`Error`] into a thrown `SlugError`. Exports stay in `src/lib.rs`; this
//! module exports nothing.

use js_sys::{Object, Reflect};
use serde::Serialize;
use wasm_bindgen::{JsCast, JsValue};

use crate::{Error, Options, Settings, SlugOptions};

/// The checked settings for an optional options object (`undefined` and
/// `null` both mean the defaults).
pub(crate) fn settings(options: Option<SlugOptions>) -> Result<Settings, Error> {
    let Some(options) = options else {
        return Ok(Settings::default());
    };
    let value = JsValue::from(options);
    if let Some(object) = value.dyn_ref::<Object>() {
        let unknown = Object::keys(object)
            .iter()
            .filter_map(|key| key.as_string())
            .find(|key| !Options::KEYS.contains(&key.as_str()));
        if let Some(key) = unknown {
            return Err(Error::InvalidOption {
                reason: format!(
                    "unknown option; expected one of {}",
                    Options::KEYS.join(", ")
                ),
                field: Some(key),
            });
        }
    }
    let options: Options =
        serde_wasm_bindgen::from_value(value).map_err(|err| Error::InvalidOption {
            field: None,
            reason: err.to_string(),
        })?;
    options.settings()
}

/// A Rust value as the JavaScript type `T` its TypeScript declaration names,
/// built as plain objects and arrays (not Maps) so callers read fields
/// directly.
pub(crate) fn to_js<T: JsCast>(value: &impl Serialize) -> Result<T, JsValue> {
    let serializer = serde_wasm_bindgen::Serializer::json_compatible();
    Ok(value.serialize(&serializer)?.unchecked_into())
}

/// Every error crosses as a real `Error` (with a stack), named `SlugError`,
/// with a stable `code` and, for options, the `field` at fault.
impl From<Error> for JsValue {
    fn from(err: Error) -> Self {
        let js = js_sys::Error::new(&err.to_string());
        js.set_name("SlugError");
        // Reflect::set fails only on a frozen object or a proxy, and a fresh
        // Error is neither; if it ever did, the caller still gets the message.
        let _ = Reflect::set(&js, &"code".into(), &err.code().into());
        if let Some(field) = err.field() {
            let _ = Reflect::set(&js, &"field".into(), &field.into());
        }
        js.into()
    }
}

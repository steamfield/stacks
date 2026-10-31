use std::io::Write;

use crate::config::Config;
use crate::error::AppError;
use crate::output::Output;

/// `config show`: the effective configuration, as `key = value` lines or JSON.
pub fn show(config: &Config, output: Output, out: &mut dyn Write) -> Result<(), AppError> {
    tracing::debug!(greeting = %config.greeting, "showing effective configuration");
    let human = format!(
        "greeting = {:?}\njson = {}\nverbose = {}\nno-color = {}",
        config.greeting, config.json, config.verbose, config.no_color
    );
    output.result(out, config, &human)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_output_lists_every_setting() {
        let mut out = Vec::new();
        show(&Config::default(), Output::default(), &mut out).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with("greeting = \"Hello, world!\"\n"), "{text}");
        assert!(text.contains("no-color = false"));
    }

    #[test]
    fn json_output_uses_the_config_file_keys() {
        let mut out = Vec::new();
        show(
            &Config::default(),
            Output {
                json: true,
                color: false,
            },
            &mut out,
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(value["greeting"], "Hello, world!");
        assert_eq!(value["no-color"], false);
    }
}

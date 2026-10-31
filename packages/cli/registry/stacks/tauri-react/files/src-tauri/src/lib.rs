use anyhow::Context;
use tauri::Manager;

mod commands;
mod error;
mod streams;

pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        .commands(tauri_specta::collect_commands![
            commands::app_info,
            commands::subscribe_ticks
        ])
        .error_handling(tauri_specta::ErrorHandlingMode::Result)
}

pub fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_new(
                std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
            )
            .context("parse RUST_LOG")?,
        )
        .with_writer(std::io::stderr)
        .try_init()
        .map_err(|error| anyhow::anyhow!("initialize tracing: {error}"))?;
    let builder = specta_builder();
    tauri::Builder::default()
        .manage(streams::TickStreams::default())
        .invoke_handler(builder.invoke_handler())
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                webview
                    .state::<streams::TickStreams>()
                    .cancel(webview.label());
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<streams::TickStreams>()
                    .cancel(window.label());
            }
        })
        .run(tauri::generate_context!())
        .context("run desktop application")
}

#[cfg(test)]
mod tests {
    #[test]
    fn exporter_contains_commands_channel_and_tagged_error() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("bindings with spaces.ts");
        super::specta_builder()
            .export(specta_typescript::Typescript::default(), &path)
            .unwrap();
        let text = std::fs::read_to_string(path).unwrap();
        assert!(text.contains("appInfo:"));
        assert!(text.contains("Channel<Tick>"));
        assert!(text.contains("invalid_metadata"));
        assert!(text.contains("elapsed_ms: number"));
    }
}

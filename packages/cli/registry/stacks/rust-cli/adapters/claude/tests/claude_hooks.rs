//! The Claude Code guard hook, run the way Claude Code runs it: `bash <hook>`
//! with the tool payload on stdin, from the project root.

use std::io::{self, Write};
use std::path::Path;
use std::process::{Command, Output, Stdio};

const ROOT: &str = env!("CARGO_MANIFEST_DIR");
const HOOK: &str = ".claude/hooks/guard-cargo-generated.sh";

/// Run the hook on a Write of `file`.
fn run_hook(file: &str) -> io::Result<Output> {
    let payload = serde_json::json!({
        "tool_name": "Write",
        "tool_input": { "file_path": file, "content": "" },
    });
    let mut child = Command::new("bash")
        .arg(Path::new(ROOT).join(HOOK))
        .env("CLAUDE_PROJECT_DIR", ROOT)
        .current_dir(ROOT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("no stdin"))?
        .write_all(payload.to_string().as_bytes())?;
    child.wait_with_output()
}

fn has_jq() -> bool {
    Command::new("jq")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success())
}

#[test]
fn cargo_output_is_denied_and_sources_are_allowed() {
    // The deny reason, or None when the hook allows the write.
    let decision = |file: &str| -> Option<String> {
        let out = run_hook(file).unwrap();
        assert!(out.status.success(), "{file}: {:?}", out.status);
        if out.stdout.is_empty() {
            return None;
        }
        let response: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        let hook = &response["hookSpecificOutput"];
        assert_eq!(hook["permissionDecision"], "deny", "{file}");
        let reason = hook["permissionDecisionReason"].as_str().unwrap();
        Some(reason.to_owned())
    };
    if !has_jq() {
        // Without jq the guard steps aside rather than guess at the payload.
        assert_eq!(decision("Cargo.lock"), None);
        return;
    }
    let absolute = format!("{ROOT}/Cargo.lock");
    let dotted = format!("{ROOT}/src/../Cargo.lock");
    let denied = [
        "Cargo.lock",
        "crates/core/Cargo.lock",
        "target/debug/build.rs",
        &absolute,
        &dotted,
    ];
    for file in denied {
        let reason = decision(file).unwrap_or_else(|| panic!("{file} was allowed"));
        assert!(reason.contains("cargo"), "{file}: {reason}");
    }
    let allowed = [
        "Cargo.toml",
        "src/main.rs",
        "tests/target.rs",
        "docs/Cargo.lock.md",
        "/elsewhere/Cargo.lock",
    ];
    for file in allowed {
        assert_eq!(decision(file), None, "{file}");
    }
}

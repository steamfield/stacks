//! The Claude Code guard hook, run the way Claude Code runs it: `bash <hook>`
//! with the tool payload on stdin, from the project root.

use std::io::{self, Write};
use std::path::Path;
use std::process::{Command, Output, Stdio};

const ROOT: &str = env!("CARGO_MANIFEST_DIR");
const HOOK: &str = ".claude/hooks/guard-cargo.sh";

/// Run the hook on one tool call.
fn run_hook(payload: &serde_json::Value) -> io::Result<Output> {
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

/// The deny reason, or None when the hook allows the call.
fn decision(payload: &serde_json::Value) -> io::Result<Option<String>> {
    let out = run_hook(payload)?;
    if !out.status.success() {
        return Err(io::Error::other(format!("hook exited {:?}", out.status)));
    }
    if out.stdout.is_empty() {
        return Ok(None);
    }
    let response: serde_json::Value = serde_json::from_slice(&out.stdout)?;
    let hook = &response["hookSpecificOutput"];
    if hook["permissionDecision"] != "deny" {
        return Err(io::Error::other(format!("unexpected response {response}")));
    }
    Ok(hook["permissionDecisionReason"].as_str().map(str::to_owned))
}

fn write(file: &str) -> serde_json::Value {
    serde_json::json!({
        "tool_name": "Write",
        "tool_input": { "file_path": file, "content": "" },
    })
}

fn bash(command: &str) -> serde_json::Value {
    serde_json::json!({ "tool_name": "Bash", "tool_input": { "command": command } })
}

fn has_jq() -> bool {
    Command::new("jq")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success())
}

#[test]
fn cargo_output_is_denied_and_sources_are_allowed() {
    if !has_jq() {
        // Without jq the guard steps aside rather than guess at the payload.
        assert_eq!(decision(&write("Cargo.lock")).unwrap(), None);
        return;
    }
    let absolute = format!("{ROOT}/Cargo.lock");
    let dotted = format!("{ROOT}/src/../Cargo.lock");
    let denied = [
        "Cargo.lock",
        "crates/core/Cargo.lock",
        "target/package/demo-0.1.0/src/lib.rs",
        &absolute,
        &dotted,
    ];
    for file in denied {
        let reason = decision(&write(file))
            .unwrap()
            .unwrap_or_else(|| panic!("{file} was allowed"));
        assert!(reason.contains("cargo"), "{file}: {reason}");
    }
    let allowed = [
        "Cargo.toml",
        "src/lib.rs",
        "tests/target.rs",
        "docs/Cargo.lock.md",
        "/elsewhere/Cargo.lock",
    ];
    for file in allowed {
        assert_eq!(decision(&write(file)).unwrap(), None, "{file}");
    }
}

#[test]
fn test_runs_that_skip_doctests_are_denied() {
    if !has_jq() {
        return;
    }
    let denied = [
        "cargo test --all-targets",
        "cargo test --all-features --all-targets",
        "cargo +stable test --all-targets",
        "make fmt && cargo test --all-targets 2>&1 | tail",
    ];
    for command in denied {
        let reason = decision(&bash(command))
            .unwrap()
            .unwrap_or_else(|| panic!("{command} was allowed"));
        assert!(reason.contains("doctests"), "{command}: {reason}");
    }
    let allowed = [
        "cargo test",
        "cargo test --all-features",
        "cargo test --doc",
        "cargo clippy --all-targets --all-features -- -D warnings",
        "cargo check --all-targets && cargo test",
        "make test",
    ];
    for command in allowed {
        assert_eq!(decision(&bash(command)).unwrap(), None, "{command}");
    }
}

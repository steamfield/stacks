//! The Claude Code guard hook, run the way Claude Code runs it: `bash <hook>`
//! with the tool payload on stdin, from the project root.

use std::io::{self, Write};
use std::path::Path;
use std::process::{Command, Output, Stdio};

const ROOT: &str = env!("CARGO_MANIFEST_DIR");
const HOOK: &str = ".claude/hooks/guard-tui.sh";

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
fn generated_files_are_denied_and_sources_are_allowed() {
    if !has_jq() {
        // Without jq the guard steps aside rather than guess at the payload.
        assert_eq!(decision(&write("Cargo.lock")).unwrap(), None);
        return;
    }
    let absolute = format!("{ROOT}/src/snapshots/list.snap");
    let dotted = format!("{ROOT}/src/../Cargo.lock");
    let denied = [
        ("src/snapshots/list.snap", "make snapshots"),
        ("src/snapshots/detail.snap.new", "make snapshots"),
        (absolute.as_str(), "make snapshots"),
        ("Cargo.lock", "cargo"),
        (dotted.as_str(), "cargo"),
        ("target/debug/build.rs", "cargo"),
    ];
    for (file, fix) in denied {
        let reason = decision(&write(file))
            .unwrap()
            .unwrap_or_else(|| panic!("{file} was allowed"));
        assert!(reason.contains(fix), "{file}: {reason}");
    }
    let allowed = [
        "Cargo.toml",
        "src/ui.rs",
        "src/snapshots.md",
        "tests/target.rs",
        "/elsewhere/Cargo.lock",
    ];
    for file in allowed {
        assert_eq!(decision(&write(file)).unwrap(), None, "{file}");
    }
}

#[test]
fn fake_terminals_are_denied_and_checks_are_allowed() {
    if !has_jq() {
        return;
    }
    let denied = [
        "script -q /dev/null ./target/release/app",
        "unbuffer cargo run",
        "make build && tmux new-session -d ./target/release/app",
        "echo $(screen -ls)",
    ];
    for command in denied {
        let reason = decision(&bash(command))
            .unwrap()
            .unwrap_or_else(|| panic!("{command} was allowed"));
        assert!(reason.contains("--no-tui"), "{command}: {reason}");
    }
    let allowed = [
        "make test",
        "cargo test ui::",
        "./target/release/app --json </dev/null",
        "cat scripts/release.sh",
        "git commit -m 'screenshot of the list'",
    ];
    for command in allowed {
        assert_eq!(decision(&bash(command)).unwrap(), None, "{command}");
    }
}

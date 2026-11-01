//! The Claude Code guard hook, run the way Claude Code runs it: `bash <hook>`
//! with the tool payload on stdin, from the project root. Native only:
//! wasm32 can't start a process.
#![cfg(not(target_arch = "wasm32"))]

use std::io::{self, Write};
use std::path::Path;
use std::process::{Command, Output, Stdio};

const ROOT: &str = env!("CARGO_MANIFEST_DIR");
const HOOK: &str = ".claude/hooks/guard-rust-wasm.sh";

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
        assert_eq!(decision(&write("pkg/index.js")).unwrap(), None);
        return;
    }
    let absolute = format!("{ROOT}/pkg/demo.d.ts");
    let dotted = format!("{ROOT}/src/../Cargo.lock");
    let denied = [
        "pkg/demo_bg.wasm",
        "target/npm/demo-0.1.0.tgz",
        "Cargo.lock",
        "consumer/bun.lock",
        "consumer/node_modules/demo/demo.d.ts",
        &absolute,
        &dotted,
    ];
    for file in denied {
        assert!(
            decision(&write(file)).unwrap().is_some(),
            "{file} was allowed"
        );
    }
    let allowed = [
        "src/lib.rs",
        "Cargo.toml",
        "consumer/package.json",
        "consumer/test/package.test.ts",
        "docs/pkg/notes.md",
        "/elsewhere/pkg/demo.js",
    ];
    for file in allowed {
        assert_eq!(decision(&write(file)).unwrap(), None, "{file}");
    }
}

#[test]
fn wrong_commands_are_denied_with_the_fix() {
    if !has_jq() {
        return;
    }
    // Each denied command, and a word its reason must contain.
    let denied = [
        ("bun test", "make test-js"),
        ("cd consumer && bun test", "make test-js"),
        ("CI=1 bun test test/", "make test-js"),
        ("wasm-pack publish", "maintainer"),
        ("wasm-pack publish --access public pkg", "maintainer"),
        ("wasm-pack login", "maintainer"),
        ("cargo install wasm-bindgen-cli", "Cargo.lock"),
        ("cargo install --locked wasm-bindgen-cli", "Cargo.lock"),
        ("cargo binstall wasm-bindgen-cli@0.2.0", "Cargo.lock"),
    ];
    for (command, word) in denied {
        let reason = decision(&bash(command))
            .unwrap()
            .unwrap_or_else(|| panic!("{command} was allowed"));
        assert!(reason.contains(word), "{command}: {reason}");
    }
    let allowed = [
        "make test-js",
        "cd consumer && bun run test",
        "bun install --frozen-lockfile",
        "wasm-pack build --release --target bundler --out-dir pkg",
        "wasm-pack test --node",
        "cargo install --locked wasm-pack",
        "git commit -m 'stop running bun test'",
    ];
    for command in allowed {
        assert_eq!(decision(&bash(command)).unwrap(), None, "{command}");
    }
}

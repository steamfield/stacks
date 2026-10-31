use anyhow::Context;

fn main() -> anyhow::Result<()> {
    let path = std::env::args_os().nth(1).context("pass an output path")?;
    desktop_shell::specta_builder()
        .export(specta_typescript::Typescript::default(), &path)
        .context("export command bindings")?;
    let text = std::fs::read_to_string(&path).context("read exported bindings")?;
    let normalized = text
        .trim_end()
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    std::fs::write(&path, normalized).context("normalize exported bindings")
}

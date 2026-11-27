import { afterEach, expect, test } from "vitest";
import { runCli, terminal } from "../helpers/cli";
import { hit, options, searched } from "../helpers/search-command";
import { workspace } from "../helpers/verify";
import { bundled } from "./helpers/bundled";

const space = workspace();
afterEach(() => space.release());

test("SaaS with Postgres and auth ranks a web app ahead of the mobile stack", async () => {
  const { value } = await searched("postgres auth for a saas", options(space.dir(), bundled), [
    "--local",
    "--limit",
    "20",
  ]);
  expect([
    "cloudflare-react-router",
    "django",
    "react-router",
    "python-react",
    "nextjs",
    "sveltekit",
  ]).toContain(value.stacks[0]?.id);
  expect(hit(value.stacks, "mobile-expo").penalties).toContainEqual({
    kind: "productKind",
    request: "saas (web-app)",
    entry: "mobile-app, fullstack, api",
  });
});

test("an add request does not show stacks matched only by its constraint", async () => {
  const opts = options(space.dir(), bundled);
  const { value } = await searched("add authentication", opts, ["--local"]);
  for (const id of ["python-react", "mobile-expo"])
    expect(value.stacks.map((hit) => hit.id)).not.toContain(id);
  const text = await runCli(["search", "add authentication", "--local"], opts);
  expect(text.status, text.stderr).toBe(0);
  expect(text.stderr).toBe("");
  expect(text.stdout).toMatch(
    /Next: confirm with the user before using a weak match; then stacks show clerk, then stacks add clerk\./,
  );
});

test("TUI exclusions name the matched rule in JSON, agent and human output", async () => {
  const opts = options(space.dir(), bundled);
  const request = "a cli with a good TUI experience";
  // Several TUI stacks now rank above the CLI stacks, so widen past the default five.
  const { value } = await searched(request, opts, ["--local", "--limit", "20"]);
  for (const id of ["go-cli", "typescript-cli"])
    expect(hit(value.stacks, id).penalties).toContainEqual({
      kind: "notFor",
      request: "TUI",
      entry: "a terminal user interface",
    });
  for (const host of [{}, terminal]) {
    const text = await runCli(["search", request, "--local"], {
      ...opts,
      host: { ...opts?.host, ...host },
    });
    expect(text.status, text.stderr).toBe(0);
    expect(text.stderr).toBe("");
    expect(text.stdout.replace(/\s+/g, " ")).toContain(
      "Penalties: notFor (TUI; entry: a terminal user interface)",
    );
  }
});

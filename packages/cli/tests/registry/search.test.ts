import { afterEach, expect, test } from "vitest";
import { hit, options, searched } from "../helpers/search-command";
import { workspace } from "../helpers/verify";
import { bundled } from "./helpers/bundled";

const space = workspace();
afterEach(() => space.release());
const ios = "an iOS health app";

test("iOS beats incidental body health matches [4.5c#1]", async () => {
  const { value } = await searched(ios, options(space.dir(), bundled), ["--limit", "20"]);
  expect(value).toMatchObject({ ranking: "local", noStrongMatch: false });
  expect(value.understood.platforms).toEqual(["ios"]);
  expect(value.understood.unmatched).toEqual(["health"]);
  expect(value.stacks[0]).toMatchObject({ id: "ios-swiftui", tier: "strong" });
  const iosMatch = expect.objectContaining({
    field: "platforms",
    matched: "ios",
    from: expect.stringMatching(/ios/i),
  });
  expect(hit(value.stacks, "ios-swiftui").why).toContainEqual(iosMatch);
  // Several stacks ship iOS apps; a stack is strong only through the iOS platform, never "health".
  for (const row of value.stacks.filter((row) => row.tier === "strong"))
    expect(row.why, row.id).toContainEqual(iosMatch);
});

test("Python penalizes CLI languages, sign-in names auth, and go live is not Go [4.5c#8a]", async () => {
  const opts = options(space.dir(), bundled);
  const python = (await searched("a command line tool in Python", opts, ["--limit", "20"])).value;
  expect(python.understood.languages).toEqual(["python"]);
  expect(python.stacks[0]).toMatchObject({ id: "python-cli", tier: "strong" });
  for (const id of ["go-cli", "rust-cli", "typescript-cli"]) {
    expect(hit(python.stacks, id).penalties).toContainEqual(
      expect.objectContaining({ kind: "language" }),
    );
    expect(hit(python.stacks, id).tier).not.toBe("strong");
  }
  const auth = (await searched("sign-in for my mobile app", opts)).value;
  expect(auth.fragments[0]?.id).toBe("clerk");
  expect(hit(auth.fragments, "clerk").why).toContainEqual(
    expect.objectContaining({ field: "capabilities", matched: "auth" }),
  );
  expect(
    (await searched("ready to go live with my blog", opts)).value.understood.languages,
  ).toEqual([]);
});

test("overlapping vocabulary categories and TUI exclusions remain visible [4.5c#8b]", async () => {
  const opts = options(space.dir(), bundled);
  const go = (await searched("go cli", opts)).value;
  expect(go.stacks[0]).toMatchObject({ id: "go-cli", tier: "strong" });
  expect(go.stacks[0]?.why).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: "languages", matched: "go" }),
      expect.objectContaining({ field: "platforms", matched: "cli" }),
    ]),
  );
  const tui = (await searched("a cli with a good TUI experience", opts, ["--limit", "20"])).value;
  expect(tui.stacks[0]).toMatchObject({ id: "go-tui", tier: "strong" });
  for (const id of ["go-cli", "python-cli", "rust-cli", "typescript-cli"]) {
    const row = hit(tui.stacks, id);
    expect(row.penalties).toContainEqual(expect.objectContaining({ kind: "notFor" }));
    expect(row.tier).not.toBe("strong");
  }
  expect(tui.noStrongMatch).toBe(false);
});

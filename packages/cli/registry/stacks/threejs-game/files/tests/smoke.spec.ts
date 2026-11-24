/**
 * Smoke tests for the built game, run on desktop Chromium and a phone: it renders on WebGL2, loads
 * physics, keeps progress across a reload, reaches the same world from the same input on every
 * project, and answers the on-screen touch controls.
 */
import { expect, test } from "./support/fixture.ts";
import { parseInput } from "./support/scenario.ts";

/**
 * `debugState().worldHash` after walking forward to the first orb and then right for a while. The
 * hash covers logic state only (the player, the orbs, the clock), never Rapier's crates, so it does
 * not depend on when physics finished loading. Every browser project must compute the same number.
 * A change to the logic changes it: rerun, read the new value from the failure and update it here.
 */
const WALK_HASH = 3572786564;

test("starts on WebGL2, loads physics, and keeps progress across a reload", async ({ game }) => {
  await game.open();
  expect(await game.renderer()).toBe("webgl2");
  expect(await game.summary()).toMatchObject({ physics: "ready", orbs: "0/6" });

  await game.play(parseInput("forward*50"));
  expect(await game.summary()).toMatchObject({ orbs: "1/6" });
  expect((await game.events()).map((e) => e.type)).toContain("save.written");

  await game.open();
  expect(await game.summary()).toMatchObject({ orbs: "1/6" });
});

test("the same walk reaches the same world on every browser", async ({ game }) => {
  await game.open();
  await game.play(parseInput("forward*50 right*40 jump _*30"));
  expect(await game.state()).toMatchObject({ worldHash: WALK_HASH });
});

test("on-screen controls move the player @touch", async ({ game }) => {
  await game.open();
  await game.touch("forward", 30);
  expect(await game.summary()).toMatchObject({ player: { z: -2.5 } });
});

test("a player opening the page lands in the game with no start button", async ({ game, page }) => {
  // No test flag: this is what a player gets from a link.
  await page.goto(game.path);
  await page.waitForFunction(
    () => window.__game?.ready === true || (window.__game?.errors.length ?? 0) > 0,
  );
  expect(await page.evaluate(() => window.__game?.errors)).toEqual([]);
  await expect(page.locator("[data-game-start]")).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
});

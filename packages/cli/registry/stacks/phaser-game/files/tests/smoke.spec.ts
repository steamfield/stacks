/**
 * Smoke tests every browser project runs (desktop Chromium, a phone and WebKit): the game starts on
 * WebGL, plays, saves, and computes the same world hash from the same input everywhere.
 */
import { hold, TITLE_TO_PLAY } from "../scenarios/kit.ts";
import { expect, test } from "./support/fixture.ts";

/**
 * `debugState().worldHash` after `WALL_JUMP_RUN` from the spawn: running, a held jump over the
 * wall, landing and running on. Every browser project must compute this same number, so a change
 * that makes logic depend on the engine or the browser fails here. Change it only together with a
 * deliberate change to the level or the physics.
 */
const WALL_JUMP_HASH = 3862550510;

/** The opening of `complete-level`: run to the wall, jump it holding right, and run on a little. */
const WALL_JUMP_RUN = [hold("right", 180), hold(["right", "jump"], 20), hold("right", 60)];

test("starts on WebGL, plays, and offers Continue after a reload", async ({ game }) => {
  await game.open();
  expect(await game.renderer()).toBe("webgl");
  expect(await game.summary()).toMatchObject({ scene: "title" });

  await game.play([...TITLE_TO_PLAY, hold("right", 120)]);
  expect(await game.summary()).toMatchObject({ scene: "play", coins: "1/9" });
  expect((await game.events()).map((e) => e.type)).toContain("save.written");

  await game.open();
  expect(await game.state()).toMatchObject({
    scene: "title",
    menu: { options: ["Continue", "New game"] },
  });
  await game.play(TITLE_TO_PLAY);
  expect(await game.summary()).toMatchObject({ scene: "play", coins: "1/9" });
});

test("the same input reaches the same world hash on every browser", async ({ game }) => {
  await game.open({ scene: "play" });
  await game.play(WALL_JUMP_RUN);
  expect(await game.state()).toMatchObject({ world: { tick: 260 }, worldHash: WALL_JUMP_HASH });
});

test("on-screen controls start the game and move the player @touch", async ({ game }) => {
  await game.open();
  await game.touch("jump", 1);
  await game.advance(2);
  await game.touch("right", 60);
  expect(await game.summary()).toMatchObject({ scene: "play", player: { tile: [7, 9] } });
});

test("a player opening the link lands in the game with no start button", async ({ game, page }) => {
  // No test flag: this is what a player gets from a shared link.
  await page.goto(game.path);
  await page.waitForFunction(
    () => window.__game?.ready === true || (window.__game?.errors.length ?? 0) > 0,
  );
  expect(await page.evaluate(() => window.__game?.errors)).toEqual([]);
  await expect(page.locator("[data-game-start]")).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
});

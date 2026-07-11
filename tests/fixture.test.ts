import { expect, test } from "bun:test";
import { join } from "node:path";

import {
  listFixtureIds,
  loadFixture,
  resolveFixtureIds,
} from "../src/fixtures/load";

const fixturesRoot = join(import.meta.dir, "..", "fixtures");

test("loads the public player iterator fixture without exposing its oracle in the prompt", async () => {
  const fixture = await loadFixture(fixturesRoot, "gmod.player-iterator.v1");
  expect(fixture.prompt.includes("player.Iterator")).toBeFalse();
  expect(fixture.prompt.includes("Iterator")).toBeFalse();
  expect(fixture.prompt).toMatch(/Garry's Mod/);
  expect(fixture.oracle.expectedPrimitive).toContain("player.Iterator");
  expect(fixture.scoring).toEqual({
    kind: "plugin",
    plugin: "player-iterator",
  });
});

test("lists and resolves the public suite", async () => {
  const ids = await listFixtureIds(fixturesRoot);
  expect(ids.length).toBeGreaterThanOrEqual(5);
  expect(ids).toContain("gmod.hook-add.v1");

  const all = await resolveFixtureIds(fixturesRoot, ["all"]);
  expect(all).toEqual(ids);
});

test("rejects path escape attempts when loading fixtures", async () => {
  await expect(loadFixture(fixturesRoot, "../secret")).rejects.toThrow();
});

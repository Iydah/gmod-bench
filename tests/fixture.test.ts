import { expect, test } from "bun:test";
import { join } from "node:path";

import {
  listFixtureIds,
  loadFixture,
  loadFixtures,
  resolveFixtureIds,
} from "../src/fixtures/load";

const fixturesRoot = join(import.meta.dir, "..", "fixtures");

/**
 * Answer tokens that must never appear in a fixture prompt — naming the answer
 * lets a model score by copying the question instead of recalling GLua. Naive
 * "before" idioms (e.g. player.GetAll, draw.DrawText) are allowed; only the
 * primitive the scorer rewards is forbidden.
 */
const FORBIDDEN_IN_PROMPT: Record<string, string[]> = {
  "gmod.player-iterator.v1": ["player.Iterator"],
  "gmod.ents-iterator.v1": ["ents.Iterator"],
  "gmod.ents-iterator-readonly.v1": ["ents.Iterator"],
  "gmod.perf.ents-iterator.v1": ["ents.Iterator"],
  "gmod.perf.disttosqr.v1": ["DistToSqr"],
  "gmod.perf.darkrpvar.v1": ["getDarkRPVar"],
  "gmod.spatial-maintained-set.v1": ["DistToSqr", "OnEntityCreated"],
  "gmod.networkvar-entity-state.v1": ["NetworkVar", "SetupDataTables"],
  "gmod.prediction-one-shot-effect.v1": [
    "IsFirstTimePredicted",
    "SetNextPrimaryFire",
    "util.Effect",
  ],
  "gmod.perf.find-ents-near.v1": ["FindInBox", "FindInCone", "FindInSphere"],
  "gmod.perf.pairs-ipairs-for.v1": ["ipairs", "numeric for"],
  "gmod.perf.hook-once.v1": ["with all players"],
  "gmod.perf.setdrawcolor-split.v1": ["r,g,b", "r, g, b"],
  "gmod.perf.surface-text.v1": ["surface.SetFont", "surface.DrawText"],
  "gmod.perf.angle-zero.v1": [":Zero()"],
};

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

test("no fixture prompt leaks the answer primitive it is scored on", async () => {
  const ids = await listFixtureIds(fixturesRoot);
  const fixtures = await loadFixtures(fixturesRoot, ids);
  const leaks: string[] = [];
  for (const fixture of fixtures) {
    const forbidden = FORBIDDEN_IN_PROMPT[fixture.id];
    if (!forbidden) continue;
    for (const token of forbidden) {
      if (fixture.prompt.includes(token)) {
        leaks.push(`${fixture.id} prompt contains answer token "${token}"`);
      }
    }
  }
  expect(leaks).toEqual([]);
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

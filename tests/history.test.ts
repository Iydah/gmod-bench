import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { AttemptRecord } from "../src/core/types";
import { loadCompletedAttemptKeys } from "../src/run/history";

const root = join(import.meta.dir, ".tmp-history");
afterEach(() => rm(root, { recursive: true, force: true }));

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    fixtureId: "gmod.a.v1",
    adapterId: "openrouter",
    model: "model/a",
    attemptIndex: 1,
    status: "pass",
    detail: "ok",
    finalResponse: "answer",
    durationMs: 1,
    version: "1",
    fixtureVersion: 1,
    rubricVersion: "1",
    promptHash: "hash-a",
    ...overrides,
  };
}

async function writeRun(
  name: string,
  attempts: AttemptRecord[],
  completed = true,
): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await Bun.write(
    join(dir, "run.json"),
    JSON.stringify({ schemaVersion: 3, attempts }),
  );
  await Bun.write(
    join(dir, "metadata.json"),
    JSON.stringify(completed ? { completedAt: "2026-07-10T12:00:00Z" } : {}),
  );
}

test("loads only exact compatible attempts from finished non-checkpoint runs", async () => {
  await writeRun("finished", [
    attempt(),
    attempt({ model: "model/b" }),
    attempt({
      fixtureId: "gmod.timeout.v1",
      status: "timeout",
      model: "model/a",
      promptHash: "hash-timeout",
    }),
  ]);
  await writeRun("incomplete", [attempt()], false);
  await writeRun("checkpoint-1", [attempt()]);
  await mkdir(join(root, "broken"), { recursive: true });
  await Bun.write(join(root, "broken", "run.json"), "not json");

  const expected = [
    {
      fixtureId: "gmod.a.v1",
      adapterId: "openrouter" as const,
      model: "model/a",
      attemptIndex: 1,
      fixtureVersion: 1,
      rubricVersion: "1",
      promptHash: "hash-a",
    },
    {
      fixtureId: "gmod.a.v1",
      adapterId: "openrouter" as const,
      model: "model/c",
      attemptIndex: 1,
      fixtureVersion: 1,
      rubricVersion: "1",
      promptHash: "hash-a",
    },
    {
      fixtureId: "gmod.a.v1",
      adapterId: "openrouter" as const,
      model: "model/b",
      attemptIndex: 1,
      fixtureVersion: 2,
      rubricVersion: "1",
      promptHash: "hash-a",
    },
  ];

  const result = await loadCompletedAttemptKeys(root, expected);
  expect([...result.keys]).toEqual([
    "openrouter\u0000model/a\u0000gmod.a.v1\u00001",
  ]);
  expect(result.runsScanned).toBe(1);
  expect(result.skippedRuns).toBe(3);

  const timeoutExpected = [
    {
      fixtureId: "gmod.timeout.v1",
      adapterId: "openrouter" as const,
      model: "model/a",
      attemptIndex: 1,
      fixtureVersion: 1,
      rubricVersion: "1",
      promptHash: "hash-timeout",
    },
  ];
  expect(
    (await loadCompletedAttemptKeys(root, timeoutExpected, "scored")).keys.size,
  ).toBe(0);
  expect(
    (await loadCompletedAttemptKeys(root, timeoutExpected, "all")).keys.size,
  ).toBe(1);
});

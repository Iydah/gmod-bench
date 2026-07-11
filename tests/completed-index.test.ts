import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  rebuildCompletedSlotIndex,
  readCompletedSlotIndex,
} from "../src/run/completed-index";

const root = join(import.meta.dir, ".tmp-completed-index");
afterEach(() => rm(root, { recursive: true, force: true }));

test("rebuilds a deterministic completed-slot cache from finished runs", async () => {
  const run = join(root, "runs", "run-a");
  await mkdir(run, { recursive: true });
  await Bun.write(
    join(run, "metadata.json"),
    JSON.stringify({ completedAt: "done" }),
  );
  await Bun.write(
    join(run, "run.json"),
    JSON.stringify({
      schemaVersion: 3,
      attempts: [
        {
          fixtureId: "gmod.a.v1",
          adapterId: "openrouter",
          model: "m",
          attemptIndex: 1,
          status: "pass",
          detail: "ok",
          finalResponse: "a",
          durationMs: 1,
          version: "api",
          fixtureVersion: 1,
          rubricVersion: "1",
          promptHash: "h",
        },
      ],
    }),
  );

  const result = await rebuildCompletedSlotIndex(join(root, "runs"));
  expect(result.entries).toBe(1);
  expect(
    (await readCompletedSlotIndex(join(root, "runs"))).map(
      (entry) => entry.runId,
    ),
  ).toEqual(["run-a"]);
});

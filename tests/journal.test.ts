import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { AttemptRecord } from "../src/core/types";
import { createRunJournal, loadRunJournal } from "../src/run/journal";

const root = join(import.meta.dir, ".tmp-journal");
afterEach(() => rm(root, { recursive: true, force: true }));

function attempt(index: number, detail = "ok"): AttemptRecord {
  return {
    fixtureId: `gmod.${index}.v1`,
    adapterId: "openrouter",
    model: "model/a",
    attemptIndex: 1,
    status: "pass",
    detail,
    finalResponse: "answer",
    durationMs: index,
    version: "api",
    fixtureVersion: 1,
    rubricVersion: "1",
    promptHash: `hash-${index}`,
  };
}

test("journals concurrent attempts durably and recovers the newest duplicate", async () => {
  const journal = await createRunJournal(root, {
    runId: "run-a",
    startedAt: "start",
    requestedFixtureIds: ["all"],
    plannedSlots: 2,
  });
  await Promise.all([
    journal.append(attempt(1, "old")),
    journal.append(attempt(2)),
    journal.append(attempt(1, "new")),
  ]);
  await journal.flush();

  const recovered = await loadRunJournal(journal.directory);
  expect(recovered.startedAt).toBe("start");
  expect(recovered.attempts).toHaveLength(2);
  expect(
    recovered.attempts.find((item) => item.fixtureId === "gmod.1.v1")?.detail,
  ).toBe("new");

  await journal.remove();
  expect(
    await Bun.file(join(journal.directory, "plan.json")).exists(),
  ).toBeFalse();
});

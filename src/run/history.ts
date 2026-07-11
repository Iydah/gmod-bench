import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { attemptKey } from "./plan";
import { parseResumeArtifact, type ExpectedAttemptIdentity } from "./resume";
import { SCORED_STATUSES } from "../core/types";
import {
  completedSlotIndexPath,
  readCompletedSlotIndex,
} from "./completed-index";

export interface CompletedAttemptHistory {
  keys: Set<string>;
  runsScanned: number;
  skippedRuns: number;
}

/** Reads compatible attempts from finished canonical runs without trusting unrelated artifacts. */
export async function loadCompletedAttemptKeys(
  artifactRoot: string,
  expected: readonly ExpectedAttemptIdentity[],
  policy: "scored" | "all" = "all",
): Promise<CompletedAttemptHistory> {
  const root = resolve(artifactRoot);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return { keys: new Set(), runsScanned: 0, skippedRuns: 0 };
  }

  const keys = new Set<string>();
  const expectedByKey = new Map(
    expected.map((identity) => [attemptKey(identity), identity]),
  );
  if (await Bun.file(completedSlotIndexPath(root)).exists()) {
    const entries = await readCompletedSlotIndex(root);
    for (const entry of entries) {
      if (
        policy === "scored" &&
        !SCORED_STATUSES.includes(
          entry.status as (typeof SCORED_STATUSES)[number],
        )
      )
        continue;
      const key = attemptKey(entry);
      const current = expectedByKey.get(key);
      if (
        current &&
        entry.fixtureVersion === current.fixtureVersion &&
        entry.rubricVersion === current.rubricVersion &&
        entry.promptHash === current.promptHash
      )
        keys.add(key);
    }
    return {
      keys,
      runsScanned: new Set(entries.map((entry) => entry.runId)).size,
      skippedRuns: 0,
    };
  }
  let runsScanned = 0;
  let skippedRuns = 0;

  for (const name of names.sort()) {
    if (name.startsWith(".") || /checkpoint/i.test(name)) {
      skippedRuns += 1;
      continue;
    }
    try {
      const metadataFile = Bun.file(join(root, name, "metadata.json"));
      const runFile = Bun.file(join(root, name, "run.json"));
      if (!(await metadataFile.exists()) || !(await runFile.exists())) {
        skippedRuns += 1;
        continue;
      }
      const metadata = (await metadataFile.json()) as { completedAt?: unknown };
      if (
        typeof metadata.completedAt !== "string" ||
        metadata.completedAt.length === 0
      ) {
        skippedRuns += 1;
        continue;
      }
      const artifact = parseResumeArtifact(await runFile.json());
      for (const attempt of artifact.attempts) {
        if (
          policy === "scored" &&
          !SCORED_STATUSES.includes(
            attempt.status as (typeof SCORED_STATUSES)[number],
          )
        )
          continue;
        const key = attemptKey(attempt);
        const current = expectedByKey.get(key);
        if (
          current &&
          attempt.fixtureVersion === current.fixtureVersion &&
          attempt.rubricVersion === current.rubricVersion &&
          attempt.promptHash === current.promptHash
        ) {
          keys.add(key);
        }
      }
      runsScanned += 1;
    } catch {
      skippedRuns += 1;
    }
  }

  return { keys, runsScanned, skippedRuns };
}

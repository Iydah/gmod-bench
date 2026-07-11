import { appendFile, mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { removePathBestEffort } from "../core/isolation";
import type { AttemptRecord } from "../core/types";
import { parseResumeArtifact } from "./resume";

export interface RunJournalPlan {
  runId: string;
  startedAt: string;
  requestedFixtureIds: string[];
  plannedSlots: number;
}

export interface LoadedRunJournal extends RunJournalPlan {
  attempts: AttemptRecord[];
}

export interface RunJournal {
  directory: string;
  append(attempt: AttemptRecord): Promise<void>;
  flush(): Promise<void>;
  remove(): Promise<void>;
}

function attemptKey(
  attempt: Pick<
    AttemptRecord,
    "adapterId" | "model" | "fixtureId" | "attemptIndex"
  >,
): string {
  return `${attempt.adapterId}\0${attempt.model ?? ""}\0${attempt.fixtureId}\0${attempt.attemptIndex}`;
}

function safeRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(runId))
    throw new Error(`Invalid run id: ${runId}`);
  return runId;
}

function contained(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, ...segments);
  if (!path.startsWith(`${resolvedRoot}${sep}`))
    throw new Error(`Journal path escapes root: ${path}`);
  return path;
}

export async function createRunJournal(
  root: string,
  plan: RunJournalPlan,
): Promise<RunJournal> {
  const journalRoot = resolve(root, ".in-progress");
  const directory = contained(journalRoot, safeRunId(plan.runId));
  await mkdir(directory, { recursive: true });
  await Bun.write(
    join(directory, "plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  const attemptsPath = join(directory, "attempts.jsonl");
  let pending = Promise.resolve();

  return {
    directory,
    append(attempt) {
      pending = pending.then(() =>
        appendFile(attemptsPath, `${JSON.stringify(attempt)}\n`, "utf8"),
      );
      return pending;
    },
    async flush() {
      await pending;
    },
    async remove() {
      await pending;
      await removePathBestEffort(directory);
    },
  };
}

export async function loadRunJournal(
  directory: string,
): Promise<LoadedRunJournal> {
  const plan = (await Bun.file(
    join(directory, "plan.json"),
  ).json()) as RunJournalPlan;
  safeRunId(plan.runId);
  if (
    typeof plan.startedAt !== "string" ||
    !Array.isArray(plan.requestedFixtureIds) ||
    !Number.isInteger(plan.plannedSlots)
  ) {
    throw new Error("Run journal plan is malformed.");
  }
  const attemptsFile = Bun.file(join(directory, "attempts.jsonl"));
  const values: unknown[] = [];
  if (await attemptsFile.exists()) {
    for (const line of (await attemptsFile.text()).split(/\r?\n/)) {
      if (line.trim()) values.push(JSON.parse(line));
    }
  }
  const parsed = parseResumeArtifact({ schemaVersion: 3, attempts: values });
  const byKey = new Map<string, AttemptRecord>();
  for (const attempt of parsed.attempts)
    byKey.set(attemptKey(attempt), attempt);
  return { ...plan, attempts: [...byKey.values()] };
}

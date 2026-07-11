import { readdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AttemptRecord } from "../core/types";
import { parseResumeArtifact } from "./resume";

export interface CompletedSlotIndexEntry {
  runId: string;
  fixtureId: string;
  adapterId: AttemptRecord["adapterId"];
  model: string | null;
  attemptIndex: number;
  status: AttemptRecord["status"];
  fixtureVersion?: number;
  rubricVersion?: string;
  promptHash?: string;
}

export function completedSlotIndexPath(artifactRoot: string): string {
  return join(resolve(artifactRoot), ".completed-slots.jsonl");
}

export async function readCompletedSlotIndex(
  artifactRoot: string,
): Promise<CompletedSlotIndexEntry[]> {
  const file = Bun.file(completedSlotIndexPath(artifactRoot));
  if (!(await file.exists())) return [];
  const entries: CompletedSlotIndexEntry[] = [];
  for (const line of (await file.text()).split(/\r?\n/)) {
    if (!line.trim()) continue;
    entries.push(JSON.parse(line) as CompletedSlotIndexEntry);
  }
  return entries;
}

export async function rebuildCompletedSlotIndex(
  artifactRoot: string,
): Promise<{ entries: number; path: string }> {
  const root = resolve(artifactRoot);
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    // The write below creates the first empty index once the root exists.
  }
  const entries: CompletedSlotIndexEntry[] = [];
  for (const runId of names.sort()) {
    if (runId.startsWith(".") || /checkpoint/i.test(runId)) continue;
    try {
      const metadata = (await Bun.file(
        join(root, runId, "metadata.json"),
      ).json()) as { completedAt?: unknown };
      if (typeof metadata.completedAt !== "string") continue;
      const artifact = parseResumeArtifact(
        await Bun.file(join(root, runId, "run.json")).json(),
      );
      for (const attempt of artifact.attempts) {
        entries.push({
          runId,
          fixtureId: attempt.fixtureId,
          adapterId: attempt.adapterId,
          model: attempt.model,
          attemptIndex: attempt.attemptIndex,
          status: attempt.status,
          ...(attempt.fixtureVersion !== undefined
            ? { fixtureVersion: attempt.fixtureVersion }
            : {}),
          ...(attempt.rubricVersion !== undefined
            ? { rubricVersion: attempt.rubricVersion }
            : {}),
          ...(attempt.promptHash !== undefined
            ? { promptHash: attempt.promptHash }
            : {}),
        });
      }
    } catch {
      continue;
    }
  }
  entries.sort((a, b) =>
    `${a.adapterId}\0${a.model ?? ""}\0${a.fixtureId}\0${a.attemptIndex}\0${a.runId}`.localeCompare(
      `${b.adapterId}\0${b.model ?? ""}\0${b.fixtureId}\0${b.attemptIndex}\0${b.runId}`,
    ),
  );
  const path = completedSlotIndexPath(root);
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  await Bun.write(
    temporary,
    entries.map((entry) => JSON.stringify(entry)).join("\n") +
      (entries.length ? "\n" : ""),
  );
  await rename(temporary, path);
  return { entries: entries.length, path };
}

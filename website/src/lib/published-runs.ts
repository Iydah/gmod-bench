import archive from "../data/runs.json";

export type PublishedRun = (typeof archive.runs)[number];

const RUNS_BY_ID = new Map<string, PublishedRun>(
  archive.runs.map((run) => [run.runId, run]),
);

export function getPublishedRun(runId: string): PublishedRun | undefined {
  return RUNS_BY_ID.get(runId);
}

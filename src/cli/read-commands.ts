import { join, resolve } from "node:path";

import { getAdapter, type CapabilityReport } from "../adapters";
import {
  BunModelsHttpClient,
  fetchFreeOpenRouterModels,
} from "../adapters/openrouter-models";
import { inspectAdapters } from "../core/doctor";
import {
  clearQuarantine,
  defaultQuarantinePath,
  formatQuarantineReport,
  loadQuarantineStore,
  pruneExpiredQuarantine,
  saveQuarantineStore,
} from "../core/model-quarantine";
import type { RunArtifact } from "../core/types";
import { listFixtureIds, loadFixtures } from "../fixtures/load";
import { renderModelCompare } from "../report/compare";
import { renderMarkdownReport } from "../report/markdown";
import type { CompareArgs, DoctorArgs, QuarantineArgs } from "./args";
import type { BenchPaths, CommandRuntime } from "./runtime";
import { defaultCommandRuntime } from "./runtime";

export async function executeQuarantine(
  args: QuarantineArgs,
  paths: BenchPaths,
): Promise<string> {
  const storePath = defaultQuarantinePath(paths.projectRoot);
  const store = await loadQuarantineStore(storePath);
  pruneExpiredQuarantine(store);
  if (!args.clear) return formatQuarantineReport(store);

  const removed = clearQuarantine(store, args.clearModel);
  await saveQuarantineStore(storePath, store);
  if (args.clearModel) {
    return removed > 0
      ? `Cleared quarantine for \`${args.clearModel}\`.`
      : `No quarantine entry for \`${args.clearModel}\`.`;
  }
  return removed > 0
    ? `Cleared ${removed} quarantined free model(s).`
    : "Quarantine was already empty.";
}

export async function executeDoctor(
  args: DoctorArgs,
  runtime: CommandRuntime = defaultCommandRuntime(),
): Promise<CapabilityReport[]> {
  return inspectAdapters(
    args.runners.map((runner) => getAdapter(runner)),
    runtime.doctorExecutor,
    runtime.env ?? process.env,
  );
}

export async function executeList(paths: BenchPaths): Promise<string> {
  const ids = await listFixtureIds(paths.fixturesRoot);
  if (ids.length === 0) return "No fixtures found.";
  const fixtures = await loadFixtures(paths.fixturesRoot, ids);
  const rows = fixtures.map(
    (fixture) =>
      `| \`${fixture.id}\` | ${fixture.title} | ${fixture.scoring.kind} |`,
  );
  return [
    `**${fixtures.length} fixtures**`,
    "",
    "| Fixture | Title | Scoring |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

export async function executeListModels(
  _freeOnly: boolean,
  runtime: CommandRuntime = defaultCommandRuntime(),
): Promise<string> {
  const client = runtime.modelsHttpClient ?? new BunModelsHttpClient();
  const catalog = await fetchFreeOpenRouterModels(
    client,
    (runtime.env ?? process.env).OPENROUTER_API_KEY?.trim(),
  );
  if (catalog.freeModels.length === 0) {
    return "No free text chat models found on OpenRouter right now.";
  }

  const rows = catalog.freeModels.map((model) => {
    const efforts = model.reasoning?.supported_efforts?.join(", ") ?? "—";
    return `| \`${model.id}\` | ${model.name.replace(/\|/g, "\\|")} | ${efforts} |`;
  });
  const slotRows = catalog.slots.map(
    (slot) =>
      `| \`${slot.slotId}\` | \`${slot.modelId}\` | ${slot.reasoningEffort ?? "—"} |`,
  );
  return [
    `# OpenRouter free text chat models (${catalog.freeModels.length} models → ${catalog.slots.length} slots)`,
    "",
    `Fetched: ${catalog.fetchedAt}`,
    "",
    "Reasoning models expand into one slot per effort (`model@high`, `model@medium`, …).",
    "",
    "Use with:",
    "```",
    "bun run bench run --fixture all --runners openrouter --openrouter-free",
    "# or: --model openrouter=:free",
    "# or pin one effort: --model openrouter=openai/gpt-oss-20b:free@high",
    "```",
    "",
    "| Model id | Name | Efforts |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Expanded slots (what a free suite runs)",
    "",
    "| Slot | API model | Effort |",
    "| --- | --- | --- |",
    ...slotRows,
    "",
  ].join("\n");
}

function asRunArtifact(value: unknown): RunArtifact {
  if (typeof value !== "object" || value === null) {
    throw new Error("Run artifact has an unsupported schema.");
  }
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== 2 && schemaVersion !== 3) {
    throw new Error(
      `Run artifact schemaVersion ${String(schemaVersion)} is unsupported (expected 2 or 3).`,
    );
  }
  return value as RunArtifact;
}

async function resolveRunJsonPath(runPath: string): Promise<string> {
  const resolved = resolve(runPath);
  if (resolved.endsWith("run.json")) return resolved;
  const directoryArtifact = join(resolved, "run.json");
  return (await Bun.file(directoryArtifact).exists())
    ? directoryArtifact
    : resolved;
}

export async function executeReport(runPath: string): Promise<string> {
  const jsonPath = await resolveRunJsonPath(runPath);
  const file = Bun.file(jsonPath);
  if (!(await file.exists()))
    throw new Error(`Run artifact does not exist: ${jsonPath}`);
  return renderMarkdownReport(asRunArtifact(JSON.parse(await file.text())));
}

export async function executeCompare(args: CompareArgs): Promise<string> {
  const jsonPath = await resolveRunJsonPath(args.runPath);
  const file = Bun.file(jsonPath);
  if (!(await file.exists()))
    throw new Error(`Run artifact does not exist: ${jsonPath}`);
  return renderModelCompare(
    asRunArtifact(JSON.parse(await file.text())),
    args.models[0],
    args.models[1],
  );
}

export function formatDoctorReport(
  reports: readonly CapabilityReport[],
): string {
  const rows = reports.map(
    (report) =>
      `| ${report.adapterId} | ${report.status} | ${report.version ?? "—"} | ${report.reason} |`,
  );
  return [
    "| Adapter | Capability | Version | Detail |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

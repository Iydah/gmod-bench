import { join, resolve } from "node:path";

import type { AdapterId, CapabilityReport, StrictAdapter } from "../adapters";
import {
  BunModelsHttpClient,
  expandOpenRouterModelList,
  fetchFreeOpenRouterModels,
  listContainsFreeSentinel,
  type ReasoningMeta,
} from "../adapters/openrouter-models";
import { parseModelSlot } from "../adapters/openrouter-slots";
import { fixtureMeta } from "../core/attempt-meta";
import type { AttemptRecord, BenchmarkFixture } from "../core/types";
import { resolveModelsForRunner, type BenchConfig } from "../cli/config";
import type { RunArgs } from "../cli/args";
import type { CommandRuntime } from "../cli/runtime";
import {
  parseResumeArtifact,
  selectCompatibleAttempts,
  type ExpectedAttemptIdentity,
} from "./resume";
import { loadRunJournal } from "./journal";

export interface ScheduledAttempt {
  adapter: StrictAdapter;
  capability: CapabilityReport;
  fixture: BenchmarkFixture;
  model?: string;
  attemptIndex: number;
  slotId: string;
  supportedParameters?: readonly string[];
}

export interface ResolvedModelLists {
  modelLists: Map<AdapterId, Array<string | undefined>>;
  supportedParametersByModel: Map<string, string[]>;
}

export interface LoadedResume {
  path: string;
  attempts: AttemptRecord[];
  startedAt?: string;
}

function reportFor(
  adapterId: AdapterId,
  reports: readonly CapabilityReport[],
): CapabilityReport {
  const report = reports.find((candidate) => candidate.adapterId === adapterId);
  if (!report)
    throw new Error(
      `Doctor did not return a capability report for ${adapterId}.`,
    );
  return report;
}

export async function resolveModelLists(
  adapters: readonly StrictAdapter[],
  models: RunArgs["models"],
  config: BenchConfig,
  runtime: CommandRuntime,
): Promise<ResolvedModelLists> {
  const env = runtime.env ?? process.env;
  const resolved = new Map<AdapterId, Array<string | undefined>>();
  let supportedParametersByModel = new Map<string, string[]>();
  const hasOpenRouter = adapters.some((adapter) => adapter.id === "openrouter");
  const openRouterRaw = hasOpenRouter
    ? resolveModelsForRunner("openrouter", models, config).filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const needsFreeCatalog =
    hasOpenRouter &&
    (listContainsFreeSentinel(openRouterRaw) || openRouterRaw.length === 0);
  let freeSlots: Awaited<
    ReturnType<typeof fetchFreeOpenRouterModels>
  >["slots"] = [];
  let reasoningByModel = new Map<string, ReasoningMeta | null>();

  if (hasOpenRouter) {
    try {
      const client = runtime.modelsHttpClient ?? new BunModelsHttpClient();
      const catalog = await fetchFreeOpenRouterModels(
        client,
        env.OPENROUTER_API_KEY?.trim(),
      );
      freeSlots = catalog.slots;
      reasoningByModel = catalog.reasoningByModel;
      supportedParametersByModel = catalog.supportedParametersByModel;
      if (needsFreeCatalog && catalog.freeModels.length === 0) {
        throw new Error("OpenRouter returned zero free text chat models.");
      }
    } catch (error) {
      if (needsFreeCatalog) throw error;
      runtime.log?.(
        `[gmod-bench] OpenRouter catalog unavailable; continuing with explicit paid model ids (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  for (const adapter of adapters) {
    const raw = resolveModelsForRunner(adapter.id, models, config);
    if (adapter.id === "openrouter") {
      const expanded = expandOpenRouterModelList(
        raw.map((entry) => entry ?? ":free"),
        freeSlots,
        reasoningByModel,
      );
      if (expanded.length === 0)
        throw new Error("OpenRouter model list expanded to zero models.");
      resolved.set(adapter.id, expanded);
    } else {
      resolved.set(adapter.id, raw);
    }
  }

  return { modelLists: resolved, supportedParametersByModel };
}

export function buildSchedule(
  fixtures: readonly BenchmarkFixture[],
  adapters: readonly StrictAdapter[],
  reports: readonly CapabilityReport[],
  modelLists: Map<AdapterId, Array<string | undefined>>,
  supportedParametersByModel: Map<string, string[]>,
  repeat: number,
): ScheduledAttempt[] {
  const schedule: ScheduledAttempt[] = [];
  for (const adapter of adapters) {
    const capability = reportFor(adapter.id, reports);
    for (const model of modelLists.get(adapter.id) ?? [undefined]) {
      const apiModelId = model ? parseModelSlot(model).modelId : undefined;
      const supportedParameters = apiModelId
        ? supportedParametersByModel.get(apiModelId)
        : undefined;
      for (const fixture of fixtures) {
        for (let attemptIndex = 1; attemptIndex <= repeat; attemptIndex += 1) {
          schedule.push({
            adapter,
            capability,
            fixture,
            ...(model ? { model } : {}),
            ...(supportedParameters ? { supportedParameters } : {}),
            attemptIndex,
            slotId: `${adapter.id}-${(model ?? "default").replace(/[^A-Za-z0-9._-]/g, "_")}-${fixture.id}-${attemptIndex}`,
          });
        }
      }
    }
  }
  return schedule;
}

export function attemptKey(
  attempt: Pick<
    AttemptRecord,
    "fixtureId" | "adapterId" | "model" | "attemptIndex"
  >,
): string {
  return `${attempt.adapterId}\0${attempt.model ?? ""}\0${attempt.fixtureId}\0${attempt.attemptIndex}`;
}

export function expectedIdentity(
  slot: ScheduledAttempt,
): ExpectedAttemptIdentity {
  const meta = fixtureMeta(slot.fixture);
  return {
    fixtureId: slot.fixture.id,
    adapterId: slot.adapter.id,
    model: slot.model ?? null,
    attemptIndex: slot.attemptIndex,
    ...meta,
  };
}

export function selectResumeAttempts(
  prior: readonly AttemptRecord[],
  schedule: readonly ScheduledAttempt[],
): AttemptRecord[] {
  return selectCompatibleAttempts(prior, schedule.map(expectedIdentity));
}

export async function loadResumeAttempts(
  resumeFrom: string,
): Promise<LoadedResume> {
  const resolved = resolve(resumeFrom);
  const journalPlan = Bun.file(join(resolved, "plan.json"));
  if (!resolved.endsWith("run.json") && (await journalPlan.exists())) {
    const journal = await loadRunJournal(resolved);
    return {
      path: resolved,
      attempts: journal.attempts,
      startedAt: journal.startedAt,
    };
  }
  const jsonPath = resolved.endsWith("run.json")
    ? resolved
    : join(resolved, "run.json");
  const file = Bun.file(jsonPath);
  if (!(await file.exists()))
    throw new Error(`Resume file not found: ${jsonPath}`);
  const artifact = parseResumeArtifact(JSON.parse(await file.text()));
  return {
    path: jsonPath,
    attempts: artifact.attempts,
    ...(artifact.startedAt ? { startedAt: artifact.startedAt } : {}),
  };
}

import { getAdapter, type AdapterId, type StrictAdapter } from "../adapters";
import { isOpenRouterFreeModelId } from "../adapters/openrouter-limits";
import { inspectAdapters } from "../core/doctor";
import {
  applyQuarantineUpdates,
  defaultQuarantinePath,
  filterQuarantinedModels,
  isNoResponseAttempt,
  loadQuarantineStore,
  MIN_CONSECUTIVE_NO_RESPONSE_TO_SKIP,
  planQuarantineFromAttempts,
  pruneExpiredQuarantine,
  quarantineModelKey,
  saveQuarantineStore,
} from "../core/model-quarantine";
import { mapPool } from "../core/pool";
import { runStrictAttempt } from "../core/runner";
import { summarizeAttempts } from "../core/summary";
import { fixtureMeta } from "../core/attempt-meta";
import type { AttemptRecord, RunArtifact } from "../core/types";
import { loadFixtures, resolveFixtureIds } from "../fixtures/load";
import { loadCompletedAttemptKeys } from "../run/history";
import { createRunJournal } from "../run/journal";
import { finalizeRun } from "../run/finalize";
import { buildOpenRouterFreeLimiter } from "../run/openrouter-quota";
import {
  attemptKey,
  buildSchedule,
  expectedIdentity,
  loadResumeAttempts,
  resolveModelLists,
  selectResumeAttempts,
} from "../run/plan";
import type { RunArgs } from "./args";
import { filterDisabledModels, loadBenchConfig } from "./config";
import type { BenchPaths, CommandRuntime, RunCommandResult } from "./runtime";
import { defaultCommandRuntime } from "./runtime";

export {
  executeCompare,
  executeDoctor,
  executeList,
  executeListModels,
  executeQuarantine,
  executeReport,
  formatDoctorReport,
} from "./read-commands";
export { defaultBenchPaths, defaultCommandRuntime } from "./runtime";
export type { BenchPaths, CommandRuntime, RunCommandResult } from "./runtime";
export { formatOpenRouterQuotaNote } from "../run/openrouter-quota";

function selectedAdapters(runners: readonly AdapterId[]): StrictAdapter[] {
  return runners.map((runner) => getAdapter(runner));
}

export async function executeRun(
  args: RunArgs,
  paths: BenchPaths,
  runtime: CommandRuntime = defaultCommandRuntime(),
): Promise<RunCommandResult> {
  const config = await loadBenchConfig(paths.configPath);
  const configFile = Bun.file(paths.configPath);
  const configText = (await configFile.exists())
    ? await configFile.text()
    : "<defaults>";
  const configHash = new Bun.CryptoHasher("sha256")
    .update(configText)
    .digest("hex");
  const fixtureIds = await resolveFixtureIds(
    paths.fixturesRoot,
    args.fixtureIds,
  );
  const fixtures = await loadFixtures(paths.fixturesRoot, fixtureIds);
  const adapters = selectedAdapters(args.runners);
  const reports = await inspectAdapters(
    adapters,
    runtime.doctorExecutor,
    runtime.env ?? process.env,
  );
  const repeat = args.repeat ?? config.defaultRepeat;
  const timeoutMs = (args.timeoutSeconds ?? config.timeoutSeconds) * 1_000;
  /** True when user passed --concurrency (vs config/default). */
  const concurrencyExplicit = args.concurrency !== undefined;
  const concurrency = args.concurrency ?? config.concurrency;
  const runId = runtime.createRunId();
  const log = runtime.log ?? (() => undefined);
  const now = runtime.now();

  const resumed = args.resumeFrom
    ? await loadResumeAttempts(args.resumeFrom)
    : null;
  const startedAt = resumed?.startedAt ?? runtime.now().toISOString();
  const { modelLists, supportedParametersByModel } = await resolveModelLists(
    adapters,
    args.models,
    config,
    runtime,
  );

  // Free models that never returned text are skipped for ~7 days (see model-quarantine).
  const quarantinePath = defaultQuarantinePath(paths.projectRoot);
  const quarantineStore = await loadQuarantineStore(quarantinePath);
  const pruned = pruneExpiredQuarantine(quarantineStore, now);
  if (pruned > 0) {
    await saveQuarantineStore(quarantinePath, quarantineStore);
    log(`[gmod-bench] quarantine: expired ${pruned} free model(s)`);
  }

  const openrouterList = modelLists.get("openrouter");
  if (openrouterList) {
    // Config denylist (known-bad / not useful for GLua) — permanent until you remove the entry.
    const disabled = config.runners.openrouter?.disabledModels;
    const denylisted = filterDisabledModels(openrouterList, disabled);
    if (denylisted.skipped.length > 0) {
      log(
        `[gmod-bench] disabledModels: skipping ${denylisted.skipped.length} slot(s) — ${denylisted.skipped
          .slice(0, 8)
          .join(", ")}${denylisted.skipped.length > 8 ? ", …" : ""}`,
      );
    }

    const { kept, skipped } = filterQuarantinedModels(
      denylisted.kept,
      quarantineStore,
      now,
    );
    if (skipped.length > 0) {
      log(
        `[gmod-bench] quarantine: skipping ${skipped.length} free model(s) until their until-date — ${skipped
          .slice(0, 6)
          .map((s) => s.model)
          .join(", ")}${skipped.length > 6 ? ", …" : ""}`,
      );
      for (const item of skipped.slice(0, 8)) {
        log(
          `[gmod-bench]   skip ${item.model} until ${item.until} (${item.reason})`,
        );
      }
    }
    if (kept.length === 0 && openrouterList.length > 0) {
      throw new Error(
        "All selected OpenRouter models are disabled or quarantined. " +
          "Edit runners.openrouter.disabledModels in config, or `bun run bench quarantine --clear`.",
      );
    }
    modelLists.set("openrouter", kept);
  }

  const fullSchedule = buildSchedule(
    fixtures,
    adapters,
    reports,
    modelLists,
    supportedParametersByModel,
    repeat,
  );
  const priorAttempts = resumed
    ? selectResumeAttempts(resumed.attempts, fullSchedule)
    : [];
  const priorKeys = new Set(
    priorAttempts.map((attempt) => attemptKey(attempt)),
  );
  if (resumed) {
    log(
      `[gmod-bench] resume: selected ${priorAttempts.length} compatible attempt(s) from ${resumed.path}; ignored ${resumed.attempts.length - priorAttempts.length} outside the current schedule`,
    );
  }
  const useHistory = !args.rerunAll && args.fixtureSelection !== "explicit-ids";
  const history = useHistory
    ? await loadCompletedAttemptKeys(
        paths.artifactRoot,
        fullSchedule.map(expectedIdentity),
        args.historyPolicy,
      )
    : { keys: new Set<string>(), runsScanned: 0, skippedRuns: 0 };
  if (useHistory) {
    log(
      `[gmod-bench] history: found ${history.keys.size} compatible completed slot(s) across ${history.runsScanned} finished run(s); skipped ${history.skippedRuns} non-finished/invalid run(s)`,
    );
  }
  const completedKeys = new Set([...priorKeys, ...history.keys]);
  const schedule = completedKeys.size
    ? fullSchedule.filter((slot) => {
        const key = attemptKey({
          adapterId: slot.adapter.id,
          model: slot.model ?? null,
          fixtureId: slot.fixture.id,
          attemptIndex: slot.attemptIndex,
        });
        return !completedKeys.has(key);
      })
    : fullSchedule;
  if (priorKeys.size > 0) {
    log(
      `[gmod-bench] resume: ${fullSchedule.length - schedule.length} slot(s) already done, ${schedule.length} remaining of ${fullSchedule.length}`,
    );
  }
  if (history.keys.size > 0) {
    log(
      `[gmod-bench] history: ${fullSchedule.length - schedule.length} total slot(s) already complete, ${schedule.length} remaining of ${fullSchedule.length}`,
    );
  }
  if (schedule.length === 0) {
    return {
      kind: "no-work",
      message:
        "No benchmark slots need running. Use --rerun-all to rerun the selected suite, or pass explicit --fixture IDs for a targeted rerun.",
    };
  }
  const openrouterModels = modelLists.get("openrouter") ?? [];
  log(
    `[gmod-bench] run ${runId}: ${fixtures.length} fixture(s) × ${schedule.length} attempt(s) to run, concurrency=${concurrency}, timeout=${timeoutMs}ms`,
  );
  if (openrouterModels.length > 0) {
    log(
      `[gmod-bench] openrouter slots (${openrouterModels.length}): ${openrouterModels.slice(0, 12).join(", ")}${openrouterModels.length > 12 ? ", …" : ""}`,
    );
  }

  const { limiter: freeRateLimiter } = await buildOpenRouterFreeLimiter(
    schedule,
    config,
    runtime.env ?? process.env,
    log,
  );

  // Concurrency is server rate-limit limited, not "RAM vibes".
  // - OpenRouter :free → 20 RPM hard (https://openrouter.ai/docs/api/reference/limits)
  // - agy / Gemini → project RPM from AI Studio; paid Tier 1 is typically ~150–300 RPM
  //   (https://ai.google.dev/gemini-api/docs/rate-limits — exact numbers in your AI Studio project)
  //   At ~10s/request, 150 RPM ≈ floor(150 * 10 / 60) = 25 parallel slots (capped at 32).
  const freeCount = schedule.filter(
    (slot) =>
      slot.adapter.id === "openrouter" &&
      slot.model &&
      isOpenRouterFreeModelId(slot.model),
  ).length;
  const paidCount = schedule.filter(
    (slot) =>
      slot.adapter.id === "openrouter" &&
      slot.model &&
      !isOpenRouterFreeModelId(slot.model),
  ).length;
  const freeHeavy = freeCount > 0 && freeCount >= paidCount;
  const agyOnly =
    schedule.length > 0 && schedule.every((slot) => slot.adapter.id === "agy");
  /** Paid Gemini Tier-1 floor (~150 RPM). Free API is ~5–15 RPM — use --concurrency 2–4 if you hit 429s. */
  const GEMINI_TIER1_RPM = 150;
  const AGY_AVG_REQUEST_SECONDS = 10;
  const AGY_RATE_LIMIT_CONCURRENCY = Math.min(
    32,
    Math.max(8, Math.floor((GEMINI_TIER1_RPM * AGY_AVG_REQUEST_SECONDS) / 60)),
  ); // → 25

  let effectiveConcurrency = concurrency;
  if (freeHeavy) {
    effectiveConcurrency = Math.min(concurrency, 4);
    if (effectiveConcurrency !== concurrency) {
      log(
        `[gmod-bench] free-heavy OpenRouter: concurrency ${concurrency} → ${effectiveConcurrency} (OpenRouter :free = 20 RPM)`,
      );
    }
  } else if (agyOnly && !concurrencyExplicit) {
    // User/config left a low default (e.g. 2) — push to Gemini paid Tier-1 RPM ceiling.
    effectiveConcurrency = AGY_RATE_LIMIT_CONCURRENCY;
    log(
      `[gmod-bench] agy-only: concurrency ${concurrency} → ${effectiveConcurrency} (Gemini paid Tier1 ~${GEMINI_TIER1_RPM} RPM @ ~${AGY_AVG_REQUEST_SECONDS}s/req; AI Studio sets your real caps)`,
    );
  } else if (agyOnly && concurrencyExplicit) {
    log(
      `[gmod-bench] agy-only: using --concurrency ${effectiveConcurrency} (your override; Gemini RPM is the real ceiling)`,
    );
  } else if (paidCount > 0 && freeCount === 0) {
    log(
      `[gmod-bench] paid-only OpenRouter: free RPM/RPD limiter off (${paidCount} slot(s), concurrency=${effectiveConcurrency})`,
    );
  } else if (freeCount > 0 && paidCount > 0) {
    log(
      `[gmod-bench] mixed free+paid OpenRouter: limiter on :free only (${freeCount} free / ${paidCount} paid)`,
    );
  }

  /** Free models that failed with no text this run — remaining fixtures are skipped (no HTTP). */
  const deadFreeModels = new Set<string>();
  const consecutiveNoResponseCount = new Map<string, number>();
  const journal = await createRunJournal(paths.artifactRoot, {
    runId,
    startedAt,
    requestedFixtureIds: args.fixtureIds,
    plannedSlots: fullSchedule.length,
  });

  let completed = 0;
  const attempts = await mapPool(
    schedule,
    effectiveConcurrency,
    async (slot) => {
      const label = `${slot.adapter.id}${slot.model ? `/${slot.model}` : ""} @ ${slot.fixture.id} #${slot.attemptIndex}`;
      log(`[gmod-bench] start  (${completed + 1}/${schedule.length}) ${label}`);

      const freeKey =
        slot.adapter.id === "openrouter" &&
        slot.model &&
        isOpenRouterFreeModelId(slot.model)
          ? quarantineModelKey(slot.model)
          : null;

      if (freeKey && deadFreeModels.has(freeKey)) {
        completed += 1;
        const attempt: AttemptRecord = {
          fixtureId: slot.fixture.id,
          adapterId: slot.adapter.id,
          model: slot.model ?? null,
          attemptIndex: slot.attemptIndex,
          status: "protocol_error",
          detail: `Skipped: free model produced no text earlier in this run (will quarantine after run if pattern holds).`,
          finalResponse: null,
          durationMs: 0,
          version: slot.capability.version,
          ...fixtureMeta(slot.fixture),
        };
        await journal.append(attempt);
        log(
          `[gmod-bench] done   (${completed}/${schedule.length}) ${label} → protocol_error 0ms — skipped dead free model`,
        );
        return attempt;
      }

      const attempt = await runStrictAttempt(
        {
          adapter: slot.adapter,
          capability: slot.capability,
          fixture: slot.fixture,
          runId: `${runId}-${slot.slotId}`,
          parentRunId: runId,
          scratchRoot: paths.scratchRoot,
          attemptIndex: slot.attemptIndex,
          keepRaw: args.keepRaw,
          ...(slot.model ? { model: slot.model } : {}),
          timeoutMs,
          env: runtime.env ?? process.env,
          ...(freeRateLimiter ? { freeRateLimiter } : {}),
          ...(slot.supportedParameters
            ? { supportedParameters: slot.supportedParameters }
            : {}),
          responseCache: repeat === 1,
          log,
        },
        { process: runtime.processExecutor, http: runtime.httpExecutor },
      );
      await journal.append(attempt);

      if (freeKey) {
        if (isNoResponseAttempt(attempt)) {
          const count = (consecutiveNoResponseCount.get(freeKey) ?? 0) + 1;
          consecutiveNoResponseCount.set(freeKey, count);
          if (
            count >= MIN_CONSECUTIVE_NO_RESPONSE_TO_SKIP &&
            !deadFreeModels.has(freeKey)
          ) {
            deadFreeModels.add(freeKey);
            log(
              `[gmod-bench] quarantine(run): ${freeKey} — ${count} consecutive no-response failures; skipping rest of suite for this model`,
            );
          }
        } else {
          consecutiveNoResponseCount.set(freeKey, 0);
          deadFreeModels.delete(freeKey);
        }
      }

      completed += 1;
      const usageBits = attempt.usage
        ? ` tokens=${attempt.usage.promptTokens ?? "?"}/${attempt.usage.completionTokens ?? "?"}${
            attempt.usage.reasoningTokens !== undefined
              ? ` reason=${attempt.usage.reasoningTokens}`
              : ""
          } total=${attempt.usage.totalTokens ?? "?"} cached=${attempt.usage.cachedTokens ?? 0}${
            attempt.usage.cost !== undefined
              ? ` cost=${attempt.usage.cost}`
              : ""
          } src=${attempt.usage.source ?? "?"}`
        : "";
      const sizeBits =
        attempt.answerBytes !== undefined
          ? ` bytes=${attempt.answerBytes}`
          : "";
      log(
        `[gmod-bench] done   (${completed}/${schedule.length}) ${label} → ${attempt.status} ${attempt.durationMs}ms${usageBits}${sizeBits} — ${attempt.detail}`,
      );
      return attempt;
    },
  );

  const completedAt = runtime.now().toISOString();
  // Prefer newer attempts when the same key appears in both prior + fresh results.
  const mergedByKey = new Map<string, AttemptRecord>();
  for (const attempt of priorAttempts) {
    mergedByKey.set(attemptKey(attempt), attempt);
  }
  for (const attempt of attempts) {
    mergedByKey.set(attemptKey(attempt), attempt);
  }
  const mergedAttempts = [...mergedByKey.values()];

  const quarantineUpdates = planQuarantineFromAttempts(mergedAttempts, {
    runId,
    now: runtime.now(),
  });
  if (quarantineUpdates.length > 0) {
    applyQuarantineUpdates(quarantineStore, quarantineUpdates);
    await saveQuarantineStore(quarantinePath, quarantineStore);
    log(
      `[gmod-bench] quarantine: recorded ${quarantineUpdates.length} free model(s) for ~7 days`,
    );
    for (const update of quarantineUpdates) {
      log(`[gmod-bench]   + ${update.modelId} until ${update.entry.until}`);
    }
  }

  const artifact: RunArtifact = {
    schemaVersion: 3,
    runId,
    fixtureIds,
    startedAt,
    completedAt,
    repeat,
    concurrency: effectiveConcurrency,
    attempts: mergedAttempts,
    summary: summarizeAttempts(mergedAttempts),
    execution: {
      requestedFixtureIds: args.fixtureIds,
      fixtureSelection: args.fixtureSelection,
      rerunAll: args.rerunAll,
      historyPolicy: args.historyPolicy,
      plannedSlots: fullSchedule.length,
      scheduledSlots: schedule.length,
      resumedSlots: priorAttempts.length,
      historicalSlotsSkipped: history.keys.size,
      configHash,
    },
  };
  const artifactPaths = await finalizeRun(
    artifact,
    args.keepRaw,
    paths,
    config,
    journal,
    log,
  );

  return { kind: "completed", artifact, paths: artifactPaths };
}

export type { AttemptRecord };

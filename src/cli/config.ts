import { adapterIds, type AdapterId } from "../adapters";
import { parseModelSlot } from "../adapters/openrouter-slots";

const adapterIdSet = new Set<string>(adapterIds);

export interface RunnerConfig {
  /** Single model override (CLI runners). */
  model?: string;
  /** Multi-model list (preferred for OpenRouter benchmarking). */
  models?: string[];
  /**
   * OpenRouter free-model (:free) RPM override. Official default is 20 even with ≥$10 credits.
   * Paid non-:free models are not rate-limited by this field.
   */
  freeRpm?: number;
  /**
   * OpenRouter free-model RPD override.
   * Official: 50 without ≥$10 credits, **1000 with ≥$10 credits**.
   * Omit to auto-detect from GET /api/v1/key (is_free_tier).
   */
  freeRpd?: number;
  /**
   * Model ids (or base ids without @effort) to skip for this runner.
   * Example: `"openai/gpt-oss-20b:free"` disables `@high`/`@medium`/`@low` slots too.
   * Use for known-bad free endpoints or models that never produce useful GLua answers.
   */
  disabledModels?: string[];
}

export interface BenchConfig {
  defaultRepeat: number;
  timeoutSeconds: number;
  concurrency: number;
  runners: Partial<Record<AdapterId, RunnerConfig>>;
  storage?: {
    r2?: { enabled: boolean; bucket: string; publicBaseUrl: string };
  };
}

const defaultConfig: BenchConfig = {
  defaultRepeat: 1,
  timeoutSeconds: 120,
  /** Safe default; free :free models are further gated to ≤20 RPM by the rate limiter. */
  concurrency: 2,
  runners: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedNumber(
  value: unknown,
  field: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}.`);
  }

  return value;
}

function parseRunnerConfig(
  adapterId: string,
  options: Record<string, unknown>,
): RunnerConfig {
  if (options.model !== undefined && typeof options.model !== "string") {
    throw new Error(`Runner model for ${adapterId} must be a string.`);
  }
  if (options.models !== undefined) {
    if (
      !Array.isArray(options.models) ||
      !options.models.every(
        (entry) => typeof entry === "string" && entry.length > 0,
      )
    ) {
      throw new Error(
        `Runner models for ${adapterId} must be an array of non-empty strings.`,
      );
    }
  }

  const config: RunnerConfig = {};
  if (typeof options.model === "string" && options.model.length > 0) {
    config.model = options.model;
  }
  if (Array.isArray(options.models)) {
    config.models = options.models as string[];
  }
  if (options.freeRpm !== undefined) {
    if (
      typeof options.freeRpm !== "number" ||
      !Number.isInteger(options.freeRpm) ||
      options.freeRpm < 1 ||
      options.freeRpm > 60
    ) {
      throw new Error(
        `Runner freeRpm for ${adapterId} must be an integer between 1 and 60.`,
      );
    }
    config.freeRpm = options.freeRpm;
  }
  if (options.freeRpd !== undefined) {
    if (
      typeof options.freeRpd !== "number" ||
      !Number.isInteger(options.freeRpd) ||
      options.freeRpd < 1 ||
      options.freeRpd > 10_000
    ) {
      throw new Error(
        `Runner freeRpd for ${adapterId} must be an integer between 1 and 10000.`,
      );
    }
    config.freeRpd = options.freeRpd;
  }
  if (options.disabledModels !== undefined) {
    if (
      !Array.isArray(options.disabledModels) ||
      !options.disabledModels.every(
        (entry) => typeof entry === "string" && entry.length > 0,
      )
    ) {
      throw new Error(
        `Runner disabledModels for ${adapterId} must be an array of non-empty strings.`,
      );
    }
    config.disabledModels = options.disabledModels as string[];
  }
  return config;
}

/**
 * Drop model slots that match a denylist entry.
 * Base ids (no @effort) match every effort of that model.
 */
export function filterDisabledModels(
  models: readonly (string | undefined)[],
  disabled: readonly string[] | undefined,
): { kept: Array<string | undefined>; skipped: string[] } {
  if (!disabled || disabled.length === 0) {
    return { kept: [...models], skipped: [] };
  }

  const exactDisabled = new Set(disabled);
  const disabledBases = new Set(
    disabled
      .map(parseModelSlot)
      .filter((slot) => slot.reasoningEffort === undefined)
      .map((slot) => slot.modelId),
  );

  const kept: Array<string | undefined> = [];
  const skipped: string[] = [];
  for (const model of models) {
    if (!model) {
      kept.push(model);
      continue;
    }
    const slot = parseModelSlot(model);
    if (exactDisabled.has(model) || disabledBases.has(slot.modelId)) {
      skipped.push(model);
      continue;
    }
    kept.push(model);
  }
  return { kept, skipped };
}

function parseRunners(value: unknown): BenchConfig["runners"] {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("runners must be an object.");
  }

  const runners: BenchConfig["runners"] = {};
  for (const [adapterId, options] of Object.entries(value)) {
    if (!adapterIdSet.has(adapterId) || !isRecord(options)) {
      throw new Error(`Invalid runner configuration: ${adapterId}`);
    }
    runners[adapterId as AdapterId] = parseRunnerConfig(adapterId, options);
  }

  return runners;
}

export async function loadBenchConfig(path: string): Promise<BenchConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { ...defaultConfig, runners: {} };
  }

  const parsed: unknown = JSON.parse(await file.text());
  if (!isRecord(parsed)) {
    throw new Error("Benchmark configuration must be a JSON object.");
  }

  return {
    defaultRepeat: readBoundedNumber(
      parsed.defaultRepeat,
      "defaultRepeat",
      defaultConfig.defaultRepeat,
      20,
    ),
    timeoutSeconds: readBoundedNumber(
      parsed.timeoutSeconds,
      "timeoutSeconds",
      defaultConfig.timeoutSeconds,
      600,
    ),
    concurrency: readBoundedNumber(
      parsed.concurrency,
      "concurrency",
      defaultConfig.concurrency,
      32,
    ),
    runners: parseRunners(parsed.runners),
    ...(isRecord(parsed.storage) && isRecord(parsed.storage.r2)
      ? {
          storage: {
            r2: {
              enabled: parsed.storage.r2.enabled === true,
              bucket:
                typeof parsed.storage.r2.bucket === "string"
                  ? parsed.storage.r2.bucket
                  : "",
              publicBaseUrl:
                typeof parsed.storage.r2.publicBaseUrl === "string"
                  ? parsed.storage.r2.publicBaseUrl
                  : "",
            },
          },
        }
      : {}),
  };
}

/**
 * Resolve the model list for one adapter: CLI overrides win, then config models/model.
 *
 * OpenRouter with nothing configured defaults to `:free` (zero-cost public path).
 * Paid leaderboards set explicit model ids in config/CLI — those skip the free RPM/RPD limiter.
 * You can mix `":free"` and paid ids in the same list.
 */
export function resolveModelsForRunner(
  adapterId: AdapterId,
  cliModels: Partial<Record<AdapterId, string[]>>,
  config: BenchConfig,
): Array<string | undefined> {
  const fromCli = cliModels[adapterId];
  if (fromCli && fromCli.length > 0) {
    return [...new Set(fromCli)];
  }

  const runner = config.runners[adapterId];
  if (runner?.models && runner.models.length > 0) {
    return [...new Set(runner.models)];
  }
  if (runner?.model) {
    return [runner.model];
  }

  // Public default: free OpenRouter catalog. Opt into paid via config/CLI model ids.
  if (adapterId === "openrouter") {
    return [":free"];
  }

  return [undefined];
}

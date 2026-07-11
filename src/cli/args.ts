import { adapterIds, type AdapterId } from "../adapters";

const adapterIdSet = new Set<string>(adapterIds);
const maxRepeat = 20;
const maxTimeoutSeconds = 600;
const maxConcurrency = 32;

export interface DoctorArgs {
  command: "doctor";
  runners: AdapterId[];
}

export interface ListArgs {
  command: "list";
}

export interface ListModelsArgs {
  command: "list-models";
  /** Only free text chat models (OpenRouter catalog). */
  freeOnly: boolean;
}

export interface RunArgs {
  command: "run";
  fixtureIds: string[];
  fixtureSelection: "implicit-all" | "explicit-all" | "explicit-ids";
  rerunAll: boolean;
  historyPolicy: "scored" | "all";
  runners: AdapterId[];
  repeat?: number;
  timeoutSeconds?: number;
  concurrency?: number;
  /** Explicit model overrides: adapter -> one or more models (OpenRouter often multi). */
  models: Partial<Record<AdapterId, string[]>>;
  /** Expand OpenRouter to every free text chat model. */
  openrouterFree: boolean;
  /** Capture raw stdout/stderr (default true). Disable with --no-keep-raw. */
  keepRaw: boolean;
  /**
   * Path to an existing run.json (or run directory). Completed attempts are kept and
   * matching schedule slots are skipped so a free suite can continue after a crash.
   */
  resumeFrom?: string;
}

export interface ReportArgs {
  command: "report";
  runPath: string;
}

export interface QuarantineArgs {
  command: "quarantine";
  /** Clear all entries, or one model id if set with --clear. */
  clear: boolean;
  clearModel?: string;
}

export interface CompareArgs {
  command: "compare";
  runPath: string;
  models: [string, string];
}

export interface VerifyArgs {
  command: "verify";
  all: boolean;
  runPath?: string;
}
export interface RebuildExportsArgs {
  command: "rebuild-exports";
  runPath: string;
}
export interface RebuildIndexArgs {
  command: "rebuild-index";
}

export type ParsedCliArgs =
  | DoctorArgs
  | ListArgs
  | ListModelsArgs
  | RunArgs
  | ReportArgs
  | QuarantineArgs
  | CompareArgs
  | VerifyArgs
  | RebuildExportsArgs
  | RebuildIndexArgs;

function isAdapterId(value: string): value is AdapterId {
  return adapterIdSet.has(value);
}

function requireValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function parseRunners(value: string): AdapterId[] {
  const runners = value.split(",").filter(Boolean);
  if (runners.length === 0) {
    throw new Error("--runners requires at least one adapter.");
  }

  const unique = [...new Set(runners)];
  const verified: AdapterId[] = [];
  for (const runner of unique) {
    if (!isAdapterId(runner)) {
      throw new Error(`Unknown adapter: ${runner}`);
    }
    verified.push(runner);
  }

  return verified;
}

function parseBoundedInteger(
  value: string,
  flag: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${flag} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return parsed;
}

function parseModel(value: string): [AdapterId, string] {
  const separator = value.indexOf("=");
  const adapter = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (separator < 1 || !model || !isAdapterId(adapter)) {
    throw new Error(
      "--model must use adapter=model and name a supported adapter.",
    );
  }

  return [adapter, model];
}

function parseFixtures(value: string): string[] {
  const fixtures = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (fixtures.length === 0) {
    throw new Error("--fixture requires at least one id (or `all`).");
  }
  return fixtures;
}

function parseDoctor(args: readonly string[]): DoctorArgs {
  let runners = [...adapterIds];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--runners") {
      throw new Error(`Unknown doctor option: ${args[index]}`);
    }
    runners = parseRunners(requireValue(args, index, "--runners"));
    index += 1;
  }

  return { command: "doctor", runners };
}

function parseListModels(args: readonly string[]): ListModelsArgs {
  let freeOnly = false;
  for (const flag of args) {
    if (flag === "--free") {
      freeOnly = true;
      continue;
    }
    throw new Error(`Unknown list-models option: ${flag}`);
  }

  return { command: "list-models", freeOnly };
}

function parseRun(args: readonly string[]): RunArgs {
  let fixtureIds: string[] | null = null;
  let runners = [...adapterIds];
  let runnersExplicit = false;
  let repeat: number | undefined;
  let timeoutSeconds: number | undefined;
  let concurrency: number | undefined;
  let keepRaw = true;
  let openrouterFree = false;
  let rerunAll = false;
  let historyPolicy: "scored" | "all" = "scored";
  let resumeFrom: string | undefined;
  const models: Partial<Record<AdapterId, string[]>> = {};

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--keep-raw") {
      keepRaw = true;
      continue;
    }
    if (flag === "--no-keep-raw") {
      keepRaw = false;
      continue;
    }
    if (flag === "--openrouter-free") {
      openrouterFree = true;
      continue;
    }
    if (flag === "--rerun-all") {
      rerunAll = true;
      continue;
    }

    const value = requireValue(args, index, flag ?? "option");
    if (flag === "--fixture") {
      fixtureIds = parseFixtures(value);
    } else if (flag === "--runners") {
      runners = parseRunners(value);
      runnersExplicit = true;
    } else if (flag === "--repeat") {
      repeat = parseBoundedInteger(value, "--repeat", 1, maxRepeat);
    } else if (flag === "--timeout-seconds") {
      timeoutSeconds = parseBoundedInteger(
        value,
        "--timeout-seconds",
        1,
        maxTimeoutSeconds,
      );
    } else if (flag === "--concurrency") {
      concurrency = parseBoundedInteger(
        value,
        "--concurrency",
        1,
        maxConcurrency,
      );
    } else if (flag === "--model") {
      const [adapter, model] = parseModel(value);
      const existing = models[adapter] ?? [];
      existing.push(model);
      models[adapter] = existing;
    } else if (flag === "--resume-from") {
      resumeFrom = value;
    } else if (flag === "--history-policy") {
      if (value !== "scored" && value !== "all")
        throw new Error("--history-policy must be scored or all.");
      historyPolicy = value;
    } else {
      throw new Error(`Unknown run option: ${flag}`);
    }
    index += 1;
  }

  const fixtureSelection = fixtureIds
    ? fixtureIds.length === 1 && fixtureIds[0] === "all"
      ? "explicit-all"
      : "explicit-ids"
    : "implicit-all";
  fixtureIds ??= ["all"];

  if (openrouterFree) {
    // Convenience: alone it targets only OpenRouter. With --runners, keep the selection and inject free models.
    if (!runnersExplicit) {
      runners = ["openrouter"];
    } else if (!runners.includes("openrouter")) {
      runners = [...runners, "openrouter"];
    }
    const existing = models.openrouter ?? [];
    if (!existing.includes(":free") && !existing.includes("free")) {
      models.openrouter = [":free", ...existing];
    }
  }

  return {
    command: "run",
    fixtureIds,
    fixtureSelection,
    rerunAll,
    historyPolicy,
    runners,
    ...(repeat ? { repeat } : {}),
    ...(timeoutSeconds ? { timeoutSeconds } : {}),
    ...(concurrency ? { concurrency } : {}),
    models,
    openrouterFree,
    keepRaw,
    ...(resumeFrom ? { resumeFrom } : {}),
  };
}

function parseReport(args: readonly string[]): ReportArgs {
  if (args.length !== 2 || args[0] !== "--run") {
    throw new Error("report requires --run <path>.");
  }

  return { command: "report", runPath: args[1] ?? "" };
}

function parseQuarantine(args: readonly string[]): QuarantineArgs {
  let clear = false;
  let clearModel: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--clear") {
      clear = true;
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        clearModel = next;
        index += 1;
      }
      continue;
    }
    throw new Error(`Unknown quarantine option: ${arg}`);
  }
  return {
    command: "quarantine",
    clear,
    ...(clearModel ? { clearModel } : {}),
  };
}

function parseCompare(args: readonly string[]): CompareArgs {
  let runPath: string | undefined;
  const models: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--run") {
      runPath = requireValue(args, index, "--run");
      index += 1;
      continue;
    }
    if (flag === "--model") {
      models.push(requireValue(args, index, "--model"));
      index += 1;
      continue;
    }
    throw new Error(`Unknown compare option: ${flag}`);
  }
  if (!runPath) {
    throw new Error("compare requires --run <path-to-run.json-or-dir>.");
  }
  if (models.length !== 2) {
    throw new Error(
      'compare requires exactly two --model filters, e.g. --model "Pro (Low)" --model "Pro (High)".',
    );
  }
  return { command: "compare", runPath, models: [models[0]!, models[1]!] };
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const [command, ...args] = argv;
  if (command === "doctor") {
    return parseDoctor(args);
  }
  if (command === "list") {
    if (args.length > 0) {
      throw new Error("list does not accept options.");
    }
    return { command: "list" };
  }
  if (command === "list-models") {
    return parseListModels(args);
  }
  if (command === "run") {
    return parseRun(args);
  }
  if (command === "report") {
    return parseReport(args);
  }
  if (command === "quarantine") {
    return parseQuarantine(args);
  }
  if (command === "compare") {
    return parseCompare(args);
  }
  if (command === "verify") {
    if (args.length === 1 && args[0] === "--all") return { command, all: true };
    if (args.length === 2 && args[0] === "--run")
      return { command, all: false, runPath: args[1]! };
    throw new Error("verify requires --all or --run <path>.");
  }
  if (command === "rebuild-exports") {
    if (args.length === 2 && args[0] === "--run")
      return { command, runPath: args[1]! };
    throw new Error("rebuild-exports requires --run <path>.");
  }
  if (command === "rebuild-index") {
    if (args.length === 0) return { command };
    throw new Error("rebuild-index does not accept options.");
  }

  throw new Error(
    "Usage: gmod-bench <doctor|list|list-models|run|report|quarantine|compare|verify|rebuild-exports|rebuild-index> ...",
  );
}

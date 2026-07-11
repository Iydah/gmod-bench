import type { AdapterId } from "../adapters/types";

export type ScoreStatus = "pass" | "partial" | "incorrect" | "protocol_error";

/** Runtime attempt outcomes. `unsupported` = adapter ineligible; `trace_error` = unparseable wire format. */
export type AttemptStatus =
  | ScoreStatus
  | "policy_violation"
  | "timeout"
  | "unavailable"
  | "unsupported"
  | "trace_error";

export const SCORED_STATUSES = [
  "pass",
  "partial",
  "incorrect",
] as const satisfies readonly AttemptStatus[];

export interface ResponseContract {
  codeFenceLanguage: string;
  reasonPrefix: string;
  maxReasonLines: number;
  minCandidateLoops: number;
  maxCandidateLoops: number;
  maxAnswerBytes: number;
}

export interface FixtureOracle {
  expectedPrimitive: string;
  sourceUrls: string[];
  verifiedAt: string;
  rubricVersion: string;
}

export interface PluginScoringDefinition {
  kind: "plugin";
  plugin: string;
}

export interface RegexScoringDefinition {
  kind: "regex";
  /** Patterns match against the fenced code body only (not the reason line). */
  passPatterns: string[];
  partialPatterns: string[];
  incorrectPatterns: string[];
}

export type ScoringDefinition =
  PluginScoringDefinition | RegexScoringDefinition;

export interface BenchmarkFixture {
  id: string;
  version: number;
  title: string;
  prompt: string;
  responseContract: ResponseContract;
  oracle: FixtureOracle;
  scoring: ScoringDefinition;
}

export interface ScoreResult {
  status: ScoreStatus;
  detail: string;
}

export interface RawOutput {
  stdout: string;
  stderr: string;
}

/**
 * Token/cost/provider accounting when the runner reports it.
 * OpenRouter fills native tokenizer counts + cost; CLIs may only get estimates.
 */
export interface AttemptUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Reasoning/thinking tokens when the provider splits them out. */
  reasoningTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  audioTokens?: number;
  /** Provider-reported credit cost (OpenRouter). */
  cost?: number;
  upstreamInferenceCost?: number;
  generationId?: string;
  finishReason?: string;
  nativeFinishReason?: string;
  /** Model id actually used (after routing/fallback). */
  providerModel?: string;
  /**
   * How counts were obtained:
   * - provider: response.usage / generation stats
   * - estimated: client-side heuristic (e.g. chars/4) when the runner exposes no usage
   */
  source?: "provider" | "estimated";
}

export interface AttemptRecord {
  fixtureId: string;
  adapterId: AdapterId;
  model: string | null;
  attemptIndex: number;
  status: AttemptStatus;
  detail: string;
  /** Graded answer text when available (including oversize / bad-format bodies for audit). */
  finalResponse: string | null;
  /** Wall-clock duration for the attempt (includes retries for HTTP). */
  durationMs: number;
  /** ISO timestamp when the attempt started (client clock). */
  startedAt?: string;
  /** ISO timestamp when the attempt finished (client clock). */
  completedAt?: string;
  /** UTF-8 byte length of finalResponse when present. */
  answerBytes?: number;
  /** Character length of finalResponse when present. */
  answerChars?: number;
  /** HTTP status of the last provider response (HTTP adapters). */
  httpStatus?: number;
  /** Process exit code (CLI adapters). */
  exitCode?: number | null;
  /** Number of HTTP tries including the first (retries counted). */
  httpAttempts?: number;
  version: string | null;
  /** Fixture JSON version at scoring time. */
  fixtureVersion?: number;
  /** Oracle rubric version at scoring time. */
  rubricVersion?: string;
  /** sha256 prefix of fixture prompt (detect silent prompt drift). */
  promptHash?: string;
  usage?: AttemptUsage;
  rawOutput?: RawOutput;
}

export interface GroupScore {
  fixtureId: string;
  adapterId: AdapterId;
  model: string | null;
  attempts: number;
  passCount: number;
  /** True when at least one of the K attempts passed. */
  passAtK: boolean;
  bestStatus: AttemptStatus;
  /** Mean of pass=1 / partial=0.5 / incorrect=0 over scored attempts in the group (null if none scored). */
  meanScore: number | null;
  /** Scored attempts in this group (pass/partial/incorrect). */
  scoredAttempts: number;
}

export interface StatusCounts {
  pass: number;
  partial: number;
  incorrect: number;
  protocol_error: number;
  policy_violation: number;
  timeout: number;
  unavailable: number;
  unsupported: number;
  trace_error: number;
  scored: number;
}

export interface RunSummary {
  statusCounts: StatusCounts;
  groups: GroupScore[];
  /** pass@k overall: groups that scored at least one pass / groups with any scored attempt */
  passAtKRate: string;
  /** Mean of group meanScore over groups with ≥1 scored attempt. */
  overallMeanScore: number | null;
}

/** Aggregated usage/timing across all attempts in a run. */
export interface RunUsageTotals {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  /** Sum of provider-reported costs (OpenRouter). */
  cost: number;
  upstreamInferenceCost: number;
  /** Attempts that included any token counts (provider or estimated). */
  attemptsWithUsage: number;
  /** Attempts whose token counts came from the provider. */
  providerUsageAttempts: number;
  /** Attempts whose token counts were client-estimated. */
  estimatedUsageAttempts: number;
  /** Mean wall duration of attempts (ms). */
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  /** Sum of attempt wall durations (ms). */
  totalDurationMs: number;
  /** Sum of graded answer UTF-8 sizes when present. */
  totalAnswerBytes: number;
}

export interface RunMetadata {
  schemaVersion: 3;
  runId: string;
  startedAt: string;
  completedAt: string;
  repeat: number;
  concurrency: number;
  fixtureIds: string[];
  fixtureCount: number;
  attemptCount: number;
  adapters: string[];
  models: string[];
  keepRaw: boolean;
  /** Wall clock seconds. */
  durationSeconds: number;
  /** Token/cost/timing rollups for the whole run. */
  usageTotals?: RunUsageTotals;
  execution?: RunExecutionProvenance;
}

export interface RunExecutionProvenance {
  requestedFixtureIds: string[];
  fixtureSelection: "implicit-all" | "explicit-all" | "explicit-ids";
  rerunAll: boolean;
  historyPolicy: "all" | "scored";
  plannedSlots: number;
  scheduledSlots: number;
  resumedSlots: number;
  historicalSlotsSkipped: number;
  configHash: string;
}

export interface RunArtifact {
  /** v3 adds provenance fields + richer summary; v2 still readable by compare/report. */
  schemaVersion: 2 | 3;
  runId: string;
  fixtureIds: string[];
  startedAt: string;
  completedAt: string;
  repeat: number;
  concurrency: number;
  attempts: AttemptRecord[];
  summary: RunSummary;
  /** Present on v3 writes. */
  metadata?: RunMetadata;
  execution?: RunExecutionProvenance;
}

import { adapterIds, type AdapterId } from "../adapters";
import type {
  AttemptRecord,
  AttemptStatus,
  AttemptUsage,
  RawOutput,
} from "../core/types";

const adapterIdSet = new Set<string>(adapterIds);
const attemptStatusSet = new Set<AttemptStatus>([
  "pass",
  "partial",
  "incorrect",
  "protocol_error",
  "policy_violation",
  "timeout",
  "unavailable",
  "unsupported",
  "trace_error",
]);
const usageNumberFields = [
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "reasoningTokens",
  "cachedTokens",
  "cacheWriteTokens",
  "audioTokens",
  "cost",
  "upstreamInferenceCost",
] as const satisfies readonly (keyof AttemptUsage)[];
const usageStringFields = [
  "generationId",
  "finishReason",
  "nativeFinishReason",
  "providerModel",
] as const satisfies readonly (keyof AttemptUsage)[];

export interface ResumeArtifact {
  schemaVersion: 2 | 3;
  attempts: AttemptRecord[];
  startedAt?: string;
}

export interface ExpectedAttemptIdentity {
  fixtureId: string;
  adapterId: AdapterId;
  model: string | null;
  attemptIndex: number;
  fixtureVersion: number;
  rubricVersion: string;
  promptHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Resume attempt ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new Error(`Resume attempt ${field} must be a string.`);
  return value;
}

function requiredNumber(
  record: Record<string, unknown>,
  field: string,
  integer = false,
): number {
  const value = record[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(
      `Resume attempt ${field} must be a non-negative${integer ? " integer" : " number"}.`,
    );
  }
  return value;
}

function optionalNumber(
  record: Record<string, unknown>,
  field: string,
  integer = false,
): number | undefined {
  if (record[field] === undefined) return undefined;
  return requiredNumber(record, field, integer);
}

function parseUsage(value: unknown): AttemptUsage | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw new Error("Resume attempt usage must be an object.");
  const usage: AttemptUsage = {};
  for (const field of usageNumberFields) {
    const parsed = optionalNumber(value, field);
    if (parsed !== undefined) usage[field] = parsed;
  }
  for (const field of usageStringFields) {
    const parsed = optionalString(value, field);
    if (parsed !== undefined) usage[field] = parsed;
  }
  if (value.source !== undefined) {
    if (value.source !== "provider" && value.source !== "estimated") {
      throw new Error("Resume attempt usage.source is invalid.");
    }
    usage.source = value.source;
  }
  return usage;
}

function parseRawOutput(value: unknown): RawOutput | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value.stdout !== "string" ||
    typeof value.stderr !== "string"
  ) {
    throw new Error(
      "Resume attempt rawOutput must contain string stdout and stderr fields.",
    );
  }
  return { stdout: value.stdout, stderr: value.stderr };
}

function parseAttempt(value: unknown): AttemptRecord {
  if (!isRecord(value)) throw new Error("Resume attempt must be an object.");
  const adapterId = requiredString(value, "adapterId");
  if (!adapterIdSet.has(adapterId))
    throw new Error(`Resume attempt adapterId is invalid: ${adapterId}`);
  const status = requiredString(value, "status") as AttemptStatus;
  if (!attemptStatusSet.has(status))
    throw new Error(`Resume attempt status is invalid: ${status}`);
  const model = value.model;
  if (model !== null && typeof model !== "string")
    throw new Error("Resume attempt model must be a string or null.");
  const attemptIndex = requiredNumber(value, "attemptIndex", true);
  if (attemptIndex < 1)
    throw new Error("Resume attempt attemptIndex must be a positive integer.");
  const finalResponse = value.finalResponse;
  if (finalResponse !== null && typeof finalResponse !== "string") {
    throw new Error("Resume attempt finalResponse must be a string or null.");
  }
  const version = value.version;
  if (version !== null && typeof version !== "string")
    throw new Error("Resume attempt version must be a string or null.");
  const usage = parseUsage(value.usage);
  const rawOutput = parseRawOutput(value.rawOutput);
  const startedAt = optionalString(value, "startedAt");
  const completedAt = optionalString(value, "completedAt");
  const answerBytes = optionalNumber(value, "answerBytes", true);
  const answerChars = optionalNumber(value, "answerChars", true);
  const httpStatus = optionalNumber(value, "httpStatus", true);
  const exitCode =
    value.exitCode === null ? null : optionalNumber(value, "exitCode", true);
  const httpAttempts = optionalNumber(value, "httpAttempts", true);
  const fixtureVersion = optionalNumber(value, "fixtureVersion", true);
  const rubricVersion = optionalString(value, "rubricVersion");
  const promptHash = optionalString(value, "promptHash");

  return {
    fixtureId: requiredString(value, "fixtureId"),
    adapterId: adapterId as AdapterId,
    model,
    attemptIndex,
    status,
    detail: requiredString(value, "detail"),
    finalResponse,
    durationMs: requiredNumber(value, "durationMs"),
    version,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(answerBytes !== undefined ? { answerBytes } : {}),
    ...(answerChars !== undefined ? { answerChars } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(httpAttempts !== undefined ? { httpAttempts } : {}),
    ...(fixtureVersion !== undefined ? { fixtureVersion } : {}),
    ...(rubricVersion !== undefined ? { rubricVersion } : {}),
    ...(promptHash !== undefined ? { promptHash } : {}),
    ...(usage ? { usage } : {}),
    ...(rawOutput ? { rawOutput } : {}),
  };
}

export function parseResumeArtifact(value: unknown): ResumeArtifact {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 2 && value.schemaVersion !== 3)
  ) {
    throw new Error("Resume artifact schemaVersion must be 2 or 3.");
  }
  if (!Array.isArray(value.attempts))
    throw new Error("Resume artifact attempts must be an array.");
  const startedAt = value.startedAt;
  if (startedAt !== undefined && typeof startedAt !== "string") {
    throw new Error("Resume artifact startedAt must be a string.");
  }
  return {
    schemaVersion: value.schemaVersion,
    attempts: value.attempts.map(parseAttempt),
    ...(typeof startedAt === "string" ? { startedAt } : {}),
  };
}

function logicalKey(
  value: Pick<
    AttemptRecord,
    "adapterId" | "model" | "fixtureId" | "attemptIndex"
  >,
): string {
  return `${value.adapterId}\0${value.model ?? ""}\0${value.fixtureId}\0${value.attemptIndex}`;
}

export function selectCompatibleAttempts(
  prior: readonly AttemptRecord[],
  expected: readonly ExpectedAttemptIdentity[],
): AttemptRecord[] {
  const expectedByKey = new Map(
    expected.map((identity) => [logicalKey(identity), identity]),
  );
  const selected: AttemptRecord[] = [];
  for (const attempt of prior) {
    const current = expectedByKey.get(logicalKey(attempt));
    if (!current) continue;
    if (
      attempt.fixtureVersion !== current.fixtureVersion ||
      attempt.rubricVersion !== current.rubricVersion ||
      attempt.promptHash !== current.promptHash
    ) {
      throw new Error(
        `Resume attempt provenance does not match the current fixture: ${logicalKey(attempt)}`,
      );
    }
    selected.push(attempt);
  }
  return selected;
}

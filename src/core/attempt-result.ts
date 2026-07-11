import { Buffer } from "node:buffer";

import type { CapabilityReport, StrictAdapter } from "../adapters/types";
import { estimateUsageFromTexts, fixtureMeta, utf8Bytes } from "./attempt-meta";
import type { SlidingWindowRateLimiter } from "./rate-limit";
import { collectEnvironmentSecrets, redactText } from "./redaction";
import { scoreFixtureAnswer } from "../scoring";
import type {
  AttemptRecord,
  AttemptUsage,
  BenchmarkFixture,
  RawOutput,
} from "./types";

export const defaultTimeoutMs = 120_000;
export const defaultMaxOutputBytes = 64 * 1024;

export interface StrictAttemptOptions {
  adapter: StrictAdapter;
  capability: CapabilityReport;
  fixture: BenchmarkFixture;
  /** Unique id for workspace isolation (per attempt). */
  runId: string;
  /**
   * Stable parent run id for OpenRouter session_id sticky routing across fixtures.
   * Defaults to runId when omitted.
   */
  parentRunId?: string;
  scratchRoot: string;
  attemptIndex: number;
  model?: string;
  keepRaw?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  /** Shared free-model limiter (OpenRouter :free only). */
  freeRateLimiter?: SlidingWindowRateLimiter;
  log?: (message: string) => void;
  /** OpenRouter catalog supported_parameters for request shaping. */
  supportedParameters?: readonly string[];
  /** Provider response cache policy. Repeated benchmark samples disable it. */
  responseCache?: boolean;
  /** Deterministic clock/sleep seam for deadline tests. */
  runtime?: AttemptRuntime;
}

export interface AttemptRuntime {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

export const defaultAttemptRuntime: AttemptRuntime = {
  nowMs: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function normalizeFinalResponse(response: string): string {
  try {
    const parsed: unknown = JSON.parse(response);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as { answer?: unknown }).answer === "string"
    ) {
      return (parsed as { answer: string }).answer;
    }
  } catch {
    // Non-schema adapters return the answer text directly.
  }

  return response;
}

export function rawOutput(
  stdout: string,
  stderr: string,
  env: NodeJS.ProcessEnv,
): RawOutput {
  const secrets = collectEnvironmentSecrets(env);
  return {
    stdout: redactText(stdout, secrets),
    stderr: redactText(stderr, secrets),
  };
}

function hasTokenCounts(usage: AttemptUsage | undefined): boolean {
  return (
    usage?.promptTokens !== undefined ||
    usage?.completionTokens !== undefined ||
    usage?.totalTokens !== undefined
  );
}

/**
 * Attach timing, answer size, process/HTTP metadata, and token usage.
 * Provider usage wins when present; otherwise estimate from prompt + answer.
 */
export function finalizeAttempt(
  options: StrictAttemptOptions,
  attempt: AttemptRecord,
  timing: { startedAt: string; completedAt?: string },
  extras: {
    exitCode?: number | null;
    httpStatus?: number;
    httpAttempts?: number;
    usage?: AttemptUsage;
  } = {},
): AttemptRecord {
  const completedAt = timing.completedAt ?? new Date().toISOString();
  const finalResponse = attempt.finalResponse;
  let usage = extras.usage ?? attempt.usage;

  if (!hasTokenCounts(usage)) {
    const estimated = estimateUsageFromTexts(
      options.fixture.prompt,
      finalResponse,
    );
    usage = usage
      ? {
          ...estimated,
          ...usage,
          promptTokens: usage.promptTokens ?? estimated.promptTokens,
          completionTokens:
            usage.completionTokens ?? estimated.completionTokens,
          totalTokens: usage.totalTokens ?? estimated.totalTokens,
          source: "estimated",
        }
      : estimated;
  }

  return {
    ...attempt,
    startedAt: timing.startedAt,
    completedAt,
    ...(finalResponse != null
      ? {
          answerBytes: utf8Bytes(finalResponse),
          answerChars: finalResponse.length,
        }
      : {}),
    ...(extras.exitCode !== undefined ? { exitCode: extras.exitCode } : {}),
    ...(extras.httpStatus !== undefined
      ? { httpStatus: extras.httpStatus }
      : {}),
    ...(extras.httpAttempts !== undefined
      ? { httpAttempts: extras.httpAttempts }
      : {}),
    ...(usage ? { usage } : {}),
  };
}

export function baseAttempt(
  options: StrictAttemptOptions,
  status: AttemptRecord["status"],
  detail: string,
  durationMs = 0,
  finalResponse: string | null = null,
): AttemptRecord {
  const meta = fixtureMeta(options.fixture);
  return {
    fixtureId: options.fixture.id,
    adapterId: options.adapter.id,
    model: options.model ?? null,
    attemptIndex: options.attemptIndex,
    status,
    detail,
    finalResponse,
    durationMs,
    version: options.capability.version,
    fixtureVersion: meta.fixtureVersion,
    rubricVersion: meta.rubricVersion,
    promptHash: meta.promptHash,
  };
}

export function withOptionalRaw(
  attempt: AttemptRecord,
  saved: RawOutput | undefined,
): AttemptRecord {
  return saved ? { ...attempt, rawOutput: saved } : attempt;
}

export function scoreAnswer(
  options: StrictAttemptOptions,
  answer: string,
  durationMs: number,
  savedRaw?: RawOutput,
  usage?: AttemptRecord["usage"],
): AttemptRecord {
  // Always retain the model text for audit — even when the contract fails.
  if (
    Buffer.byteLength(answer, "utf8") >
    options.fixture.responseContract.maxAnswerBytes
  ) {
    return withOptionalRaw(
      {
        ...baseAttempt(
          options,
          "protocol_error",
          `Final response exceeds fixture byte cap of ${options.fixture.responseContract.maxAnswerBytes}.`,
          durationMs,
          answer,
        ),
        ...(usage ? { usage } : {}),
      },
      savedRaw,
    );
  }

  const score = scoreFixtureAnswer(options.fixture, answer);
  return withOptionalRaw(
    {
      ...baseAttempt(options, score.status, score.detail, durationMs, answer),
      ...(usage ? { usage } : {}),
    },
    savedRaw,
  );
}

import type { HttpAdapter } from "../adapters/types";
import { isCliAdapter, isHttpAdapter } from "../adapters/types";
import { materializeOpenRouterHeaders } from "../adapters/openrouter";
import { isOpenRouterFreeModelId } from "../adapters/openrouter-limits";
import { parseRetryAfterSeconds, type HttpExecutor } from "./http";
import type { ProcessExecutor } from "./process";
import type { AttemptRecord, AttemptUsage } from "./types";
import {
  baseAttempt,
  defaultAttemptRuntime,
  defaultMaxOutputBytes,
  defaultTimeoutMs,
  finalizeAttempt,
  normalizeFinalResponse,
  rawOutput,
  scoreAnswer,
  withOptionalRaw,
  type StrictAttemptOptions,
} from "./attempt-result";
import { runCliAttempt } from "./cli-attempt";

export type { AttemptRuntime, StrictAttemptOptions } from "./attempt-result";

export interface AttemptExecutors {
  process: ProcessExecutor;
  http: HttpExecutor;
}

const retryableHttpStatuses = new Set([429, 502, 503]);
/**
 * Max HTTP tries per attempt.
 * Free models: fail fast on 429 (1 retry) so we don't burn the day quota hammering one dead endpoint.
 * Paid / non-free: allow a few more for transient 502s.
 */
const httpMaxAttemptsFree = 2;
const httpMaxAttemptsPaid = 4;

function isRetryableHttpStatus(statusCode: number | null): boolean {
  return statusCode !== null && retryableHttpStatuses.has(statusCode);
}

function backoffMsForAttempt(
  attempt: number,
  statusCode: number | null,
  headers: Record<string, string>,
): number {
  // attempt is 1-based retry index after the first failure
  const exponential = Math.min(90_000, 5_000 * 2 ** (attempt - 1)); // 5s, 10s, 20s, 40s, 80s, 90s
  if (statusCode === 429) {
    const fromHeader =
      parseRetryAfterSeconds(headers, Math.ceil(exponential / 1_000)) * 1_000;
    // Prefer server Retry-After; never wait less than the exponential floor.
    return Math.max(fromHeader, exponential) + Math.floor(Math.random() * 750);
  }
  return exponential + Math.floor(Math.random() * 500);
}

async function runHttpAttempt(
  options: StrictAttemptOptions,
  adapter: HttpAdapter,
  executor: HttpExecutor,
): Promise<AttemptRecord> {
  const env = options.env ?? process.env;
  const runtime = options.runtime ?? defaultAttemptRuntime;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const attemptStartedMs = runtime.nowMs();
  const deadlineMs = attemptStartedMs + timeoutMs;
  const elapsedMs = (): number =>
    Math.max(0, Math.round(runtime.nowMs() - attemptStartedMs));
  const remainingMs = (): number =>
    Math.max(0, Math.floor(deadlineMs - runtime.nowMs()));
  const log = options.log ?? (() => undefined);
  const startedAt = new Date().toISOString();
  const model = options.model?.trim();
  if (!model) {
    return finalizeAttempt(
      options,
      baseAttempt(
        options,
        "unsupported",
        "HTTP adapters require an explicit model (for example --model openrouter=openai/gpt-4o-mini).",
      ),
      { startedAt },
    );
  }

  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (adapter.id === "openrouter" && !apiKey) {
    return finalizeAttempt(
      options,
      baseAttempt(options, "unavailable", "OPENROUTER_API_KEY is not set."),
      { startedAt },
    );
  }

  const useFreeLimiter =
    adapter.id === "openrouter" &&
    isOpenRouterFreeModelId(model) &&
    options.freeRateLimiter;
  if (useFreeLimiter && options.freeRateLimiter) {
    const slot = await options.freeRateLimiter.acquire(remainingMs());
    if (slot === "daily_exhausted") {
      return finalizeAttempt(
        options,
        baseAttempt(
          options,
          "protocol_error",
          "OpenRouter free-model daily request cap reached (50 without ≥$10 credits, 1000 with). Wait for UTC day reset or use paid model ids.",
        ),
        { startedAt },
      );
    }
    if (slot === "timeout" || remainingMs() === 0) {
      return finalizeAttempt(
        options,
        baseAttempt(
          options,
          "timeout",
          "HTTP attempt deadline expired while waiting for a rate-limit slot.",
          elapsedMs(),
        ),
        { startedAt },
      );
    }
  }

  const request = adapter.buildRequest({
    prompt: options.fixture.prompt,
    model,
    maxAnswerBytes: options.fixture.responseContract.maxAnswerBytes,
    // Sticky session is keyed by the parent run + model, not the per-attempt workspace id.
    runId: options.parentRunId ?? options.runId,
    ...(options.responseCache !== undefined
      ? { responseCache: options.responseCache }
      : {}),
    ...(options.supportedParameters
      ? { supportedParameters: options.supportedParameters }
      : {}),
  });

  const headers =
    adapter.id === "openrouter" && apiKey
      ? materializeOpenRouterHeaders(request.headers, apiKey)
      : request.headers;

  let httpAttempts = 1;
  let output = await executor.run(
    { ...request, headers },
    {
      timeoutMs: Math.max(1, remainingMs()),
      maxOutputBytes: options.maxOutputBytes ?? defaultMaxOutputBytes,
    },
  );

  const freeModel =
    adapter.id === "openrouter" && isOpenRouterFreeModelId(model);
  // Free :free endpoints: do not thrash one rate-limited/broken model — move on after one short retry.
  // 429 on free = "this model is not available to us right now", not "keep poking".
  const maxAttempts = freeModel ? httpMaxAttemptsFree : httpMaxAttemptsPaid;

  for (
    let attempt = 1;
    attempt < maxAttempts &&
    output.kind === "completed" &&
    isRetryableHttpStatus(output.statusCode);
    attempt += 1
  ) {
    // Free 429: single short wait then give up (saves quota for models that still work).
    const delayMs =
      freeModel && output.statusCode === 429
        ? 2_000 + Math.floor(Math.random() * 500)
        : backoffMsForAttempt(attempt, output.statusCode, output.headers);
    log(
      `[gmod-bench] retry  ${model} HTTP ${output.statusCode} attempt ${attempt + 1}/${maxAttempts} after ${delayMs}ms`,
    );
    if (delayMs >= remainingMs()) {
      const savedRaw =
        options.keepRaw === false ? undefined : rawOutput(output.body, "", env);
      return finalizeAttempt(
        options,
        withOptionalRaw(
          baseAttempt(
            options,
            "timeout",
            "HTTP attempt deadline would expire during retry backoff.",
            elapsedMs(),
          ),
          savedRaw,
        ),
        { startedAt },
        {
          ...(output.statusCode !== null
            ? { httpStatus: output.statusCode }
            : {}),
          httpAttempts,
        },
      );
    }
    if (useFreeLimiter && options.freeRateLimiter) {
      const completedPause = await options.freeRateLimiter.pause(
        delayMs,
        `HTTP ${output.statusCode}`,
        remainingMs(),
      );
      if (!completedPause) {
        const savedRaw =
          options.keepRaw === false
            ? undefined
            : rawOutput(output.body, "", env);
        return finalizeAttempt(
          options,
          withOptionalRaw(
            baseAttempt(
              options,
              "timeout",
              "HTTP attempt deadline expired during retry backoff.",
              elapsedMs(),
            ),
            savedRaw,
          ),
          { startedAt },
          {
            ...(output.statusCode !== null
              ? { httpStatus: output.statusCode }
              : {}),
            httpAttempts,
          },
        );
      }
    } else {
      await runtime.sleep(delayMs);
    }
    if (useFreeLimiter && options.freeRateLimiter) {
      const slot = await options.freeRateLimiter.acquire(remainingMs());
      if (slot === "daily_exhausted") {
        return finalizeAttempt(
          options,
          baseAttempt(
            options,
            "protocol_error",
            "OpenRouter free-model daily request cap reached during retries.",
          ),
          { startedAt },
          {
            ...(output.statusCode !== null
              ? { httpStatus: output.statusCode }
              : {}),
            httpAttempts,
          },
        );
      }
      if (slot === "timeout") {
        return finalizeAttempt(
          options,
          baseAttempt(
            options,
            "timeout",
            "HTTP attempt deadline expired waiting for a retry rate-limit slot.",
            elapsedMs(),
          ),
          { startedAt },
          {
            ...(output.statusCode !== null
              ? { httpStatus: output.statusCode }
              : {}),
            httpAttempts,
          },
        );
      }
    }
    if (remainingMs() === 0) {
      const savedRaw =
        options.keepRaw === false ? undefined : rawOutput(output.body, "", env);
      return finalizeAttempt(
        options,
        withOptionalRaw(
          baseAttempt(
            options,
            "timeout",
            "HTTP attempt deadline expired before retry.",
            elapsedMs(),
          ),
          savedRaw,
        ),
        { startedAt },
        {
          ...(output.statusCode !== null
            ? { httpStatus: output.statusCode }
            : {}),
          httpAttempts,
        },
      );
    }
    output = await executor.run(
      { ...request, headers },
      {
        timeoutMs: Math.max(1, remainingMs()),
        maxOutputBytes: options.maxOutputBytes ?? defaultMaxOutputBytes,
      },
    );
    httpAttempts += 1;
  }

  if (freeModel && output.kind === "completed" && output.statusCode === 429) {
    log(
      `[gmod-bench] skip   ${model} — free endpoint rate-limited; not thrashing further`,
    );
  }

  output = { ...output, durationMs: elapsedMs() };
  const savedRaw =
    options.keepRaw === false ? undefined : rawOutput(output.body, "", env);
  const finish = (
    attempt: AttemptRecord,
    usage?: AttemptUsage,
  ): AttemptRecord =>
    finalizeAttempt(
      options,
      attempt,
      { startedAt },
      {
        ...(output.statusCode !== null
          ? { httpStatus: output.statusCode }
          : {}),
        httpAttempts,
        ...(usage ? { usage } : {}),
      },
    );

  if (output.kind === "timeout") {
    return finish(
      withOptionalRaw(
        baseAttempt(
          options,
          "timeout",
          "HTTP request exceeded the attempt timeout.",
          output.durationMs,
        ),
        savedRaw,
      ),
    );
  }
  if (output.outputLimited) {
    return finish(
      withOptionalRaw(
        baseAttempt(
          options,
          "protocol_error",
          "HTTP response exceeded the output cap.",
          output.durationMs,
        ),
        savedRaw,
      ),
    );
  }

  const trace = adapter.parseResponse(output.statusCode ?? 0, output.body);
  const usage =
    "usage" in trace ? (trace as { usage?: AttemptUsage }).usage : undefined;
  if (trace.status !== "complete") {
    return finish(
      withOptionalRaw(
        {
          ...baseAttempt(
            options,
            trace.status,
            trace.detail,
            output.durationMs,
          ),
          ...(usage ? { usage } : {}),
        },
        savedRaw,
      ),
      usage,
    );
  }
  if (!trace.finalResponse) {
    return finish(
      withOptionalRaw(
        {
          ...baseAttempt(
            options,
            "protocol_error",
            "HTTP response completed without a final answer.",
            output.durationMs,
          ),
          ...(usage ? { usage } : {}),
        },
        savedRaw,
      ),
      usage,
    );
  }

  return finish(
    scoreAnswer(
      options,
      normalizeFinalResponse(trace.finalResponse),
      output.durationMs,
      savedRaw,
      usage,
    ),
    usage,
  );
}

export async function runStrictAttempt(
  options: StrictAttemptOptions,
  executors: AttemptExecutors,
): Promise<AttemptRecord> {
  const startedAt = new Date().toISOString();

  if (options.capability.status !== "strict") {
    return finalizeAttempt(
      options,
      baseAttempt(
        options,
        options.capability.status,
        options.capability.reason,
      ),
      { startedAt },
    );
  }

  if (isCliAdapter(options.adapter)) {
    return runCliAttempt(options, options.adapter, executors.process);
  }
  if (isHttpAdapter(options.adapter)) {
    return runHttpAttempt(options, options.adapter, executors.http);
  }

  return finalizeAttempt(
    options,
    baseAttempt(options, "unsupported", "Unknown adapter kind."),
    { startedAt },
  );
}

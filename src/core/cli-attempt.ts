import type { CliAdapter } from "../adapters/types";
import { createRestrictedEnvironment } from "./environment";
import { createAttemptWorkspace } from "./isolation";
import type { ProcessExecutor } from "./process";
import type { AttemptRecord, AttemptUsage } from "./types";
import {
  baseAttempt,
  defaultMaxOutputBytes,
  defaultTimeoutMs,
  finalizeAttempt,
  normalizeFinalResponse,
  rawOutput,
  scoreAnswer,
  withOptionalRaw,
  type StrictAttemptOptions,
} from "./attempt-result";

export async function runCliAttempt(
  options: StrictAttemptOptions,
  adapter: CliAdapter,
  executor: ProcessExecutor,
): Promise<AttemptRecord> {
  const env = options.env ?? process.env;
  const startedAt = new Date().toISOString();
  const workspace = await createAttemptWorkspace(
    options.scratchRoot,
    options.runId,
  );
  try {
    const spec = adapter.createInvocation({
      prompt: options.fixture.prompt,
      workspace: workspace.path,
      schemaPath: workspace.schemaPath,
      policyPath: workspace.policyPath,
      ...(options.model ? { model: options.model } : {}),
    });
    const output = await executor.run(spec, {
      cwd: workspace.path,
      env: createRestrictedEnvironment(adapter.id, workspace.path, env),
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? defaultMaxOutputBytes,
    });
    // Default: always capture raw CLI wire for audit (disable with --no-keep-raw).
    const savedRaw =
      options.keepRaw === false
        ? undefined
        : rawOutput(output.stdout, output.stderr, env);
    const finish = (
      attempt: AttemptRecord,
      usage?: AttemptUsage,
    ): AttemptRecord =>
      finalizeAttempt(
        options,
        attempt,
        { startedAt },
        {
          exitCode: output.exitCode,
          ...(usage ? { usage } : {}),
        },
      );

    if (output.kind === "timeout") {
      return finish(
        withOptionalRaw(
          baseAttempt(
            options,
            "timeout",
            "CLI exceeded the attempt timeout.",
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
            "CLI exceeded the output cap.",
            output.durationMs,
          ),
          savedRaw,
        ),
      );
    }
    if (output.exitCode !== 0) {
      return finish(
        withOptionalRaw(
          baseAttempt(
            options,
            "protocol_error",
            "CLI exited without a valid strict response.",
            output.durationMs,
          ),
          savedRaw,
        ),
      );
    }

    const trace = adapter.parseTrace(output.stdout, output.stderr);
    const usage =
      "usage" in trace ? (trace as { usage?: AttemptUsage }).usage : undefined;
    if (trace.status !== "complete") {
      return finish(
        withOptionalRaw(
          baseAttempt(options, trace.status, trace.detail, output.durationMs),
          savedRaw,
        ),
        usage,
      );
    }
    if (!trace.finalResponse) {
      return finish(
        withOptionalRaw(
          baseAttempt(
            options,
            "protocol_error",
            "Trace completed without a final response.",
            output.durationMs,
          ),
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
  } finally {
    // Never let scratch cleanup kill the pool (Windows EBUSY under high concurrency).
    try {
      await workspace.cleanup();
    } catch {
      // removePathBestEffort already swallows lock errors; any residual is non-fatal.
    }
  }
}

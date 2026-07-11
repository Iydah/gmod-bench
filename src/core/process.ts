import { Buffer } from "node:buffer";
import type { InvocationSpec } from "../adapters/types";

export interface ProcessRunOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ProcessOutput {
  kind: "completed" | "timeout";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  outputLimited: boolean;
}

export interface ProcessExecutor {
  run(spec: InvocationSpec, options: ProcessRunOptions): Promise<ProcessOutput>;
}

interface CapturedPipe {
  text: string;
  exceeded: boolean;
}

async function capturePipe(
  stream: ReadableStream<Uint8Array> | null,
  maxOutputBytes: number,
  onLimit: () => void,
): Promise<CapturedPipe> {
  if (!stream) {
    return { text: "", exceeded: false };
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let exceeded = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const available = maxOutputBytes - size;
      if (available <= 0 || value.byteLength > available) {
        if (available > 0) {
          chunks.push(value.subarray(0, available));
        }
        exceeded = true;
        onLimit();
        await reader.cancel();
        break;
      }

      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return { text: decoder.decode(Buffer.concat(chunks)), exceeded };
}

export class BunProcessExecutor implements ProcessExecutor {
  async run(
    spec: InvocationSpec,
    options: ProcessRunOptions,
  ): Promise<ProcessOutput> {
    const startedAt = performance.now();
    const child = Bun.spawn([spec.command, ...spec.args], {
      cwd: options.cwd,
      env: options.env,
      stdout: "pipe",
      stderr: "pipe",
    });

    let outputLimited = false;
    const stopForLimit = () => {
      outputLimited = true;
      child.kill();
    };
    const stdout = capturePipe(
      child.stdout,
      options.maxOutputBytes,
      stopForLimit,
    );
    const stderr = capturePipe(
      child.stderr,
      options.maxOutputBytes,
      stopForLimit,
    );
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    const exitCode = await child.exited;
    clearTimeout(timeout);
    const [capturedStdout, capturedStderr] = await Promise.all([
      stdout,
      stderr,
    ]);

    return {
      kind: timedOut ? "timeout" : "completed",
      exitCode: timedOut ? null : exitCode,
      stdout: capturedStdout.text,
      stderr: capturedStderr.text,
      durationMs: Math.round(performance.now() - startedAt),
      outputLimited:
        outputLimited || capturedStdout.exceeded || capturedStderr.exceeded,
    };
  }
}

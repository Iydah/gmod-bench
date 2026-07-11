import { Buffer } from "node:buffer";

import type { HttpRequestSpec } from "../adapters/types";

export interface HttpRunOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface HttpOutput {
  kind: "completed" | "timeout";
  statusCode: number | null;
  body: string;
  durationMs: number;
  outputLimited: boolean;
  /** Response headers (lowercase keys) when available. */
  headers: Record<string, string>;
}

export interface HttpExecutor {
  run(spec: HttpRequestSpec, options: HttpRunOptions): Promise<HttpOutput>;
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

async function readBoundedBody(
  response: Response,
  maxOutputBytes: number,
): Promise<{ body: string; outputLimited: boolean }> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxOutputBytes) {
    await response.body?.cancel();
    return { body: "", outputLimited: true };
  }
  if (!response.body) {
    return { body: "", outputLimited: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return {
          body: decoder.decode(Buffer.concat(chunks)),
          outputLimited: false,
        };
      }
      const available = maxOutputBytes - size;
      if (value.byteLength > available || available === 0) {
        if (available > 0) chunks.push(value.subarray(0, available));
        await reader.cancel();
        return {
          body: decoder.decode(Buffer.concat(chunks)),
          outputLimited: true,
        };
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Parse Retry-After as seconds (numeric or HTTP-date). */
export function parseRetryAfterSeconds(
  headers: Record<string, string>,
  fallbackSeconds: number,
): number {
  const raw = headers["retry-after"];
  if (!raw) {
    return fallbackSeconds;
  }
  const asInt = Number(raw);
  if (Number.isFinite(asInt) && asInt >= 0) {
    // Free-model 429s can ask for a full minute; allow up to 5 minutes.
    return Math.min(Math.max(asInt, 1), 300);
  }
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) {
    const seconds = Math.ceil((when - Date.now()) / 1_000);
    return Math.min(Math.max(seconds, 1), 300);
  }
  return fallbackSeconds;
}

export class BunHttpExecutor implements HttpExecutor {
  constructor(
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}

  async run(
    spec: HttpRequestSpec,
    options: HttpRunOptions,
  ): Promise<HttpOutput> {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await this.fetcher(spec.url, {
        method: spec.method,
        headers: spec.headers,
        body: spec.body,
        signal: controller.signal,
      });

      const headers = headerMap(response.headers);
      const captured = await readBoundedBody(response, options.maxOutputBytes);

      return {
        kind: "completed",
        statusCode: response.status,
        body: captured.body,
        durationMs: Math.round(performance.now() - startedAt),
        outputLimited: captured.outputLimited,
        headers,
      };
    } catch (error) {
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError");
      if (aborted) {
        return {
          kind: "timeout",
          statusCode: null,
          body: "",
          durationMs: Math.round(performance.now() - startedAt),
          outputLimited: false,
          headers: {},
        };
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        kind: "completed",
        statusCode: 0,
        body: JSON.stringify({ error: { message } }),
        durationMs: Math.round(performance.now() - startedAt),
        outputLimited: false,
        headers: {},
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

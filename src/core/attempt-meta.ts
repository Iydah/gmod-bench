import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type { AttemptUsage, BenchmarkFixture } from "./types";

/** Short stable hash of the fixture prompt (reproducibility / drift detection). */
export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 16);
}

/** UTF-8 byte length. */
export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Rough token estimate when a runner does not report usage (CLIs).
 * ~4 chars/token is a common English/code heuristic — marked source=estimated.
 */
export function estimateTokensFromText(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export type EstimatedAttemptUsage = AttemptUsage &
  Required<
    Pick<
      AttemptUsage,
      "promptTokens" | "completionTokens" | "totalTokens" | "source"
    >
  >;

export function estimateUsageFromTexts(
  prompt: string,
  answer: string | null,
): EstimatedAttemptUsage {
  const promptTokens = estimateTokensFromText(prompt);
  const completionTokens = answer ? estimateTokensFromText(answer) : 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    source: "estimated",
  };
}

export function fixtureMeta(fixture: BenchmarkFixture): {
  fixtureVersion: number;
  rubricVersion: string;
  promptHash: string;
} {
  return {
    fixtureVersion: fixture.version,
    rubricVersion: fixture.oracle.rubricVersion,
    promptHash: hashPrompt(fixture.prompt),
  };
}

/** Numeric score for consistency metrics: pass=1, partial=0.5, incorrect=0, else null (unscored). */
export function attemptNumericScore(status: string): number | null {
  if (status === "pass") return 1;
  if (status === "partial") return 0.5;
  if (status === "incorrect") return 0;
  return null;
}

/** Safe path segment for model/fixture folders. */
export function safePathSegment(value: string, max = 80): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const safe =
    cleaned.length > 0 && cleaned !== "." && cleaned !== ".."
      ? cleaned
      : "unknown";
  return safe.slice(0, max);
}

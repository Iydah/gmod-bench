import type { AttemptUsage } from "../../core/types";
import type { TraceParseResult } from "../types";
import {
  eventContainsTool,
  isRecord,
  parseJsonLines,
  result,
  text,
  type JsonRecord,
} from "./shared";

export interface OpenCodeParseResult extends TraceParseResult {
  usage?: AttemptUsage;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function extractUsageFromPart(part: JsonRecord): AttemptUsage | undefined {
  const tokens = part.tokens;
  if (!isRecord(tokens)) {
    return undefined;
  }
  const promptTokens = readNumber(tokens.input);
  const completionTokens = readNumber(tokens.output);
  const reasoningTokens = readNumber(tokens.reasoning);
  const totalTokens = readNumber(tokens.total);
  let cachedTokens: number | undefined;
  if (isRecord(tokens.cache)) {
    const read = readNumber(tokens.cache.read) ?? 0;
    const write = readNumber(tokens.cache.write) ?? 0;
    cachedTokens =
      read + write > 0 ? read + write : readNumber(tokens.cache.read);
  }
  const cost = readNumber(part.cost);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  return {
    source: "provider",
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined
      ? { totalTokens }
      : {
          totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0),
        }),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

function errorDetail(event: JsonRecord): string {
  if (isRecord(event.error)) {
    if (isRecord(event.error.data) && text(event.error.data.message)) {
      return text(event.error.data.message) as string;
    }
    return (
      text(event.error.message) ?? text(event.error.name) ?? "unknown error"
    );
  }
  return text(event.message) ?? "unknown error";
}

/**
 * OpenCode `run --format json` emits JSONL event lines:
 * step_start / text / step_finish / error / tool-like parts.
 * We require exactly one non-empty text answer and reject tool activity.
 */
export function parseOpenCodeTrace(
  stdout: string,
  _stderr: string,
): OpenCodeParseResult {
  const events = parseJsonLines(stdout);
  if (!events) {
    return result("trace_error", "opencode did not emit valid JSONL.");
  }
  return parseEvents(events);
}

function parseEvents(events: JsonRecord[]): OpenCodeParseResult {
  const answers: string[] = [];
  let usage: AttemptUsage | undefined;
  let lastError: string | undefined;

  for (const event of events) {
    const type = text(event.type);

    if (type === "error") {
      lastError = errorDetail(event);
      // Keep scanning — some runs emit soft errors then still answer.
      continue;
    }

    if (eventContainsTool(event)) {
      const failed = result(
        "policy_violation",
        "OpenCode emitted a tool event.",
      );
      return usage ? { ...failed, usage } : failed;
    }

    const part = isRecord(event.part) ? event.part : null;
    if (part && hasToolishPart(part)) {
      const failed = result(
        "policy_violation",
        `OpenCode emitted tool part: ${text(part.type) ?? "unknown"}.`,
      );
      return usage ? { ...failed, usage } : failed;
    }

    if (type === "text" || (part && text(part.type) === "text")) {
      const body = part ? text(part.text) : text(event.text);
      if (body && body.trim().length > 0) {
        answers.push(body);
      }
      continue;
    }

    if (type === "step_finish" || (part && text(part.type) === "step-finish")) {
      if (part) {
        usage = extractUsageFromPart(part) ?? usage;
      }
      continue;
    }

    if (
      type === "step_start" ||
      type === "step-start" ||
      (part && ["step_start", "step-start"].includes(text(part.type) ?? ""))
    ) {
      continue;
    }

    const failed = result(
      "trace_error",
      `Unknown OpenCode trace event: ${type ?? "missing type"}.`,
    );
    return usage ? { ...failed, usage } : failed;
  }

  if (answers.length === 0) {
    const detail = lastError
      ? `OpenCode returned no answer text; error: ${lastError}`
      : "OpenCode returned no answer text.";
    const failed = result("protocol_error", detail);
    return usage ? { ...failed, usage } : failed;
  }

  // Concatenate multi-part text in order (rare); prefer last non-empty chunk if model streamed revisions.
  const finalText =
    answers.length === 1 ? answers[0]! : answers[answers.length - 1]!;
  const complete = result(
    "complete",
    "OpenCode returned one assistant text payload.",
    finalText,
  );
  return usage ? { ...complete, usage } : complete;
}

function hasToolishPart(part: JsonRecord): boolean {
  const type = text(part.type)?.toLowerCase() ?? "";
  if (!type) return false;
  if (
    type === "text" ||
    type === "step-start" ||
    type === "step-finish" ||
    type === "step_start" ||
    type === "step_finish"
  ) {
    return false;
  }
  if (type === "reasoning" || type === "thinking" || type === "reason") {
    return false;
  }
  return /(tool|command|shell|mcp|function|web_search|bash|file)/.test(type);
}

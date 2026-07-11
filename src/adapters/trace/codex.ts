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

export interface CodexParseResult extends TraceParseResult {
  usage?: AttemptUsage;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Pull usage from turn.completed when Codex reports it. */
export function extractCodexUsage(event: JsonRecord): AttemptUsage | undefined {
  const usageRaw = event.usage;
  if (!isRecord(usageRaw)) {
    return undefined;
  }

  const promptTokens =
    readNumber(usageRaw.input_tokens) ?? readNumber(usageRaw.prompt_tokens);
  const completionTokens =
    readNumber(usageRaw.output_tokens) ??
    readNumber(usageRaw.completion_tokens);
  const cachedTokens =
    readNumber(usageRaw.cached_input_tokens) ??
    readNumber(usageRaw.cached_tokens);
  const reasoningTokens =
    readNumber(usageRaw.reasoning_output_tokens) ??
    readNumber(usageRaw.reasoning_tokens);
  const totalTokens =
    readNumber(usageRaw.total_tokens) ??
    (promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    reasoningTokens === undefined &&
    cachedTokens === undefined
  ) {
    return undefined;
  }

  return {
    source: "provider",
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
  };
}

function errorDetail(event: JsonRecord): string {
  const message =
    text(event.message) ??
    (isRecord(event.error) ? text(event.error.message) : null) ??
    text(event.error) ??
    text(event.detail) ??
    text(event.reason);
  if (message) {
    return message;
  }
  try {
    return JSON.stringify(event).slice(0, 240);
  } catch {
    return "unknown error payload";
  }
}

/** Event types that are ambient / non-answer and safe to ignore. */
const IGNORED_TYPES = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "session.created",
  "session.updated",
  "token.usage",
  "agent.reasoning",
  "item.started",
  "item.updated",
]);

const IGNORED_ITEM_TYPES = new Set([
  "reasoning",
  "analysis",
  "todo_list",
  "plan",
  "thought",
  // Transport fallback warnings (e.g. WebSocket 403 → HTTPS) — not a model answer.
  "error",
]);

function parseEvents(events: JsonRecord[]): CodexParseResult {
  const answers: string[] = [];
  let usage: AttemptUsage | undefined;
  let transportError: string | undefined;

  for (const event of events) {
    const type = text(event.type);

    // Hard failures only when the whole turn dies without a usable answer.
    if (type === "turn.failed" || type === "thread.failed") {
      const failed = result(
        "protocol_error",
        `Codex error: ${errorDetail(event)}`,
      );
      return usage ? { ...failed, usage } : failed;
    }

    // Top-level error is often a transient transport notice; remember it, keep parsing for an answer.
    if (type === "error") {
      transportError = errorDetail(event);
      continue;
    }

    if (type === "turn.completed") {
      usage = extractCodexUsage(event) ?? usage;
      continue;
    }

    if (type && IGNORED_TYPES.has(type)) {
      continue;
    }

    if (eventContainsTool(event)) {
      const failed = result("policy_violation", "Codex emitted a tool event.");
      return usage ? { ...failed, usage } : failed;
    }

    const item = event.item;
    if (type === "item.completed" && isRecord(item)) {
      const itemType = text(item.type);
      if (itemType && IGNORED_ITEM_TYPES.has(itemType)) {
        // item.type=error is usually WS→HTTPS fallback noise; keep a note.
        if (itemType === "error") {
          transportError = text(item.message) ?? transportError;
        }
        continue;
      }
      if (itemType === "agent_message") {
        const answer = text(item.text);
        if (!answer) {
          const failed = result(
            "trace_error",
            "Codex agent-message event has no text.",
          );
          return usage ? { ...failed, usage } : failed;
        }
        answers.push(answer);
        continue;
      }
      // Unknown item type — fail closed so we don't silently accept tools.
      const failed = result(
        "trace_error",
        `Unknown Codex item type: ${itemType ?? "missing"}.`,
      );
      return usage ? { ...failed, usage } : failed;
    }

    // Unknown top-level event with no answer yet.
    if (type) {
      const failed = result(
        "trace_error",
        `Unknown Codex trace event: ${type}.`,
      );
      return usage ? { ...failed, usage } : failed;
    }
  }

  if (answers.length !== 1) {
    const detail =
      answers.length === 0 && transportError
        ? `Codex emitted 0 final answers; transport/error: ${transportError}`
        : `Codex emitted ${answers.length} final answers; expected one.`;
    const failed = result("protocol_error", detail);
    return usage ? { ...failed, usage } : failed;
  }

  const complete = result(
    "complete",
    "Codex trace contains one final answer.",
    answers[0] ?? null,
  );
  return usage ? { ...complete, usage } : complete;
}

export function parseCodexTrace(
  stdout: string,
  _stderr: string,
): CodexParseResult {
  const events = parseJsonLines(stdout);
  if (!events) {
    return result("trace_error", "codex did not emit valid JSONL.");
  }

  return parseEvents(events);
}

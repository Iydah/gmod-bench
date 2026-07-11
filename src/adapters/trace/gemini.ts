import type { TraceParseResult } from "../types";
import {
  eventContainsTool,
  isRecord,
  parseJsonLines,
  result,
  text,
  type JsonRecord,
} from "./shared";

/**
 * Gemini CLI stream-json is version-dependent. We accept a small, reviewed set of
 * final-answer envelopes and fail closed on anything else.
 */
function extractAnswer(event: JsonRecord): string | null | "skip" | "invalid" {
  const type = text(event.type) ?? text(event.event);

  if (
    type === "result" ||
    type === "response" ||
    type === "final" ||
    type === "message"
  ) {
    const direct =
      text(event.result) ??
      text(event.response) ??
      text(event.text) ??
      text(event.content);
    if (direct) {
      return direct;
    }

    const content = event.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const part of content) {
        if (typeof part === "string") {
          parts.push(part);
          continue;
        }
        if (isRecord(part) && text(part.text)) {
          parts.push(text(part.text) as string);
          continue;
        }
        if (isRecord(part) && hasToolishPart(part)) {
          return "invalid";
        }
      }
      return parts.length > 0 ? parts.join("") : "invalid";
    }

    if (isRecord(event.message)) {
      const messageText =
        text(event.message.content) ?? text(event.message.text);
      if (messageText) {
        return messageText;
      }
    }

    return "invalid";
  }

  if (type === "error") {
    return "invalid";
  }

  // Progress / keepalive style events
  if (
    type === "init" ||
    type === "start" ||
    type === "system" ||
    type === "user" ||
    type === "thought" ||
    type === "progress" ||
    type === "tool_call" ||
    type === "tool_response"
  ) {
    return "skip";
  }

  return "invalid";
}

function hasToolishPart(part: JsonRecord): boolean {
  const type = text(part.type);
  return type !== null && /(tool|function|call|mcp)/i.test(type);
}

function parseEvents(events: JsonRecord[]): TraceParseResult {
  const answers: string[] = [];

  for (const event of events) {
    if (eventContainsTool(event)) {
      return result("policy_violation", "gemini emitted a tool event.");
    }

    const extracted = extractAnswer(event);
    if (extracted === "skip") {
      continue;
    }
    if (extracted === "invalid" || extracted === null) {
      return result(
        "trace_error",
        `Unknown or incomplete gemini trace event: ${text(event.type) ?? "missing type"}.`,
      );
    }
    answers.push(extracted);
  }

  if (answers.length === 0) {
    return result(
      "protocol_error",
      "gemini emitted no final answers; expected one.",
    );
  }
  if (answers.length > 1) {
    // Prefer the last complete answer (streaming UIs often re-emit).
    const last = answers[answers.length - 1] ?? null;
    if (answers.every((answer) => answer === last)) {
      return result(
        "complete",
        "gemini trace contains one final answer.",
        last,
      );
    }
    return result(
      "protocol_error",
      `gemini emitted ${answers.length} contradictory final answers.`,
    );
  }

  return result(
    "complete",
    "gemini trace contains one final answer.",
    answers[0] ?? null,
  );
}

export function parseGeminiTrace(
  stdout: string,
  _stderr: string,
): TraceParseResult {
  const events = parseJsonLines(stdout);
  if (!events) {
    // Some Gemini builds emit a single JSON object instead of JSONL.
    try {
      const value: unknown = JSON.parse(stdout);
      if (isRecord(value)) {
        return parseEvents([value]);
      }
    } catch {
      // fall through
    }
    return result("trace_error", "gemini did not emit valid JSONL or JSON.");
  }

  return parseEvents(events);
}

import type { TraceParseResult } from "../types";
import {
  assistantText,
  eventContainsTool,
  parseJsonLines,
  result,
  text,
  type JsonRecord,
} from "./shared";

function parseEvents(events: JsonRecord[], label: string): TraceParseResult {
  const answers: string[] = [];
  const assistantAnswers: string[] = [];
  for (const event of events) {
    if (eventContainsTool(event)) {
      return result("policy_violation", `${label} emitted a tool event.`);
    }

    const type = text(event.type);
    if (type === "system" || type === "user") {
      continue;
    }

    if (type === "assistant") {
      const answer = assistantText(event);
      if (answer === "invalid") {
        return result(
          "trace_error",
          `${label} assistant event has an unknown content shape.`,
        );
      }
      if (answer !== null) {
        assistantAnswers.push(answer);
      }
      continue;
    }

    if (type === "result" && text(event.subtype) !== "error") {
      const answer = text(event.result);
      if (!answer) {
        return result("trace_error", `${label} result event has no text.`);
      }
      answers.push(answer);
      continue;
    }

    return result(
      "trace_error",
      `Unknown ${label} trace event: ${type ?? "missing type"}.`,
    );
  }

  if (answers.length !== 1) {
    return result(
      "protocol_error",
      `${label} emitted ${answers.length} final answers; expected one.`,
    );
  }

  if (assistantAnswers.length > 1) {
    return result(
      "protocol_error",
      `${label} emitted multiple assistant answers before its final result.`,
    );
  }

  const answer = answers[0] ?? null;
  if (assistantAnswers.length === 1 && assistantAnswers[0] !== answer) {
    return result(
      "protocol_error",
      `${label} assistant response disagrees with its final result.`,
    );
  }

  return result(
    "complete",
    `${label} trace contains one final answer.`,
    answer,
  );
}

export function parseClaudeTrace(
  stdout: string,
  _stderr: string,
): TraceParseResult {
  const events = parseJsonLines(stdout);
  if (!events) {
    return result("trace_error", "claude did not emit valid JSONL.");
  }

  return parseEvents(events, "claude");
}

/** Grok streaming-json uses a Claude-compatible result envelope when tools are denied. */
export function parseGrokTrace(
  stdout: string,
  _stderr: string,
): TraceParseResult {
  const events = parseJsonLines(stdout);
  if (!events) {
    return result("trace_error", "grok did not emit valid JSONL.");
  }

  return parseEvents(events, "grok");
}

import type { TraceParseResult } from "../types";
import { result } from "./shared";

/**
 * Antigravity (`agy`) print mode emits plain text (optionally with a trailing
 * "Summary of work" section). No structured event stream yet.
 */
export function parseAgyTrace(
  stdout: string,
  stderr: string,
): TraceParseResult {
  let text = stdout.trim();
  if (!text) {
    const err = stderr.trim();
    if (err) {
      return result(
        "protocol_error",
        `agy produced no stdout (${err.slice(0, 200)})`,
      );
    }
    return result("protocol_error", "agy produced an empty response.");
  }

  // Drop agent post-ambles that appear in some print-mode replies.
  text = text.replace(/\n\*\*Summary of work:\*\*[\s\S]*$/i, "").trim();
  text = text.replace(/\n##\s*Summary[\s\S]*$/i, "").trim();

  // Tool/agent chatter in the answer body is not a clean answer-only contract.
  if (/\b(Running tool|Tool call|web_search|mcp__)\b/i.test(text)) {
    return result(
      "policy_violation",
      "agy response appears to include tool/agent activity.",
    );
  }

  if (!text) {
    return result(
      "protocol_error",
      "agy response was empty after stripping summary chrome.",
    );
  }

  return result("complete", "Parsed agy print-mode final text.", text);
}

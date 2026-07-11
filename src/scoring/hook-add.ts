import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";

/** Grades Hook.Add registration (identifier + callback), not bare hook.Call. */
export function scoreHookAddAnswer(response: ValidatedResponse): ScoreResult {
  const { code } = response;

  if (/\bhook\.Call\s*\(/.test(code) && !/\bhook\.Add\s*\(/.test(code)) {
    return {
      status: "incorrect",
      detail: "hook.Call runs hooks; registration uses hook.Add.",
    };
  }

  if (
    /\bhook\.Add\s*\(\s*["'][^"']+["']\s*,\s*["'][^"']+["']\s*,\s*(function\b|[A-Za-z_][\w.]*)/.test(
      code,
    )
  ) {
    return { status: "pass", detail: "Registers a named hook with hook.Add." };
  }

  if (/\bhook\.Add\s*\(/.test(code)) {
    return {
      status: "partial",
      detail: "Mentions hook.Add but the call shape is incomplete.",
    };
  }

  return {
    status: "incorrect",
    detail: "Does not register a hook with hook.Add.",
  };
}

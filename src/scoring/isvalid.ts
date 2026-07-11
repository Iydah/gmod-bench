import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";

/** Grades entity validity checks — IsValid is the GMod-safe predicate. */
export function scoreIsValidAnswer(response: ValidatedResponse): ScoreResult {
  const { code } = response;

  if (/\bIsValid\s*\(/.test(code)) {
    return {
      status: "pass",
      detail: "Uses IsValid for entity/object validity.",
    };
  }

  if (/\b(?:IsPlayer|IsNPC|IsWorld)\s*\(/.test(code)) {
    return {
      status: "partial",
      detail: "Uses a type predicate, not a general validity check.",
    };
  }

  if (/~=\s*nil|==\s*nil|!=\s*null/.test(code)) {
    return {
      status: "incorrect",
      detail: "nil checks are insufficient for invalid Source entities.",
    };
  }

  return { status: "incorrect", detail: "Does not use IsValid." };
}

import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

export function scorePredictionEffect(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  if (
    /if\s+not\s+IsFirstTimePredicted\s*\(\s*\)\s+then\s+return\s+end/.test(code)
  ) {
    return {
      status: "incorrect",
      detail:
        "Guards the whole attack, preventing predicted state updates on replay.",
    };
  }
  const state = code.search(/SetNextPrimaryFire\s*\(/);
  const guard = code.search(/if\s+IsFirstTimePredicted\s*\(\s*\)\s+then/);
  const effect = code.search(/util\.Effect\s*\(/);
  if (state >= 0 && guard > state && effect > guard) {
    return {
      status: "pass",
      detail:
        "Updates predicted state every pass and gates only the one-shot effect.",
    };
  }
  if (effect >= 0 && /IsFirstTimePredicted/.test(code))
    return {
      status: "partial",
      detail:
        "Uses the prediction guard, but its scope is not the required one-shot-only shape.",
    };
  return {
    status: "incorrect",
    detail: "Does not separate predicted state from the one-shot effect.",
  };
}

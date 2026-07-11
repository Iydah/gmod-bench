import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { countCalls, stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreHotHook(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const hookIndex = code.search(/hook\.Add\s*\(/);
  if (hookIndex < 0 || !/HUDPaint/.test(response.code))
    return { status: "incorrect", detail: "Does not register HUDPaint." };
  const before = code.slice(0, hookIndex);
  const callback = code.slice(hookIndex);
  if (
    /\bMaterial\s*\(|\bColor\s*\(/.test(callback) ||
    countCalls(callback, /\bLocalPlayer\s*\(/g) > 1 ||
    countCalls(callback, /:Health\s*\(/g) > 1
  ) {
    return {
      status: "incorrect",
      detail:
        "Allocates stable resources or repeats entity/value lookups in the per-frame callback.",
    };
  }
  if (
    /\bMaterial\s*\(/.test(before) &&
    /\bColor\s*\(/.test(before) &&
    countCalls(callback, /\bLocalPlayer\s*\(/g) === 1 &&
    /IsValid\s*\(/.test(callback) &&
    countCalls(callback, /:Health\s*\(/g) === 1
  ) {
    return {
      status: "pass",
      detail:
        "Caches stable render resources and derives per-frame values once.",
    };
  }
  return {
    status: "partial",
    detail:
      "HUDPaint is present but one or more hot-path reuse requirements are unclear.",
  };
}

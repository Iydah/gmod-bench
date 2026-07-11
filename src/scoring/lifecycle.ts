import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreHookLifecycle(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  if (/hook\.Add\s*\([^,]+,\s*[A-Za-z_]\w*\s*,/.test(code)) {
    return {
      status: "pass",
      detail:
        "Uses an object hook identifier so invalid objects are removed automatically.",
    };
  }
  if (/hook\.Add\s*\(/.test(code) && /hook\.Remove\s*\(/.test(code)) {
    return {
      status: "pass",
      detail: "Pairs hook registration with explicit removal.",
    };
  }
  if (/hook\.Add\s*\(/.test(code))
    return {
      status: "partial",
      detail:
        "Registers a hook without a proven lifecycle owner or removal path.",
    };
  return {
    status: "incorrect",
    detail: "Does not register the entity-owned hook.",
  };
}

export function scoreDelayedValidity(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const timer = code.search(/timer\.Simple\s*\(/);
  const callbackValidity = code.search(/IsValid\s*\(/);
  const removal = code.search(/:Remove\s*\(/);
  if (timer >= 0 && callbackValidity > timer && removal > callbackValidity) {
    return {
      status: "pass",
      detail: "Revalidates the captured entity inside the delayed callback.",
    };
  }
  if (timer >= 0 && removal > timer)
    return {
      status: "incorrect",
      detail: "Delayed callback can use an entity that became invalid.",
    };
  return {
    status: "incorrect",
    detail: "Does not implement the one-shot delayed removal.",
  };
}

export function scoreIteratorReadonly(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  if (
    /table\.(?:remove|insert|sort|Empty|Merge|Add)\s*\(/i.test(code) ||
    /select\s*\(\s*2\s*,\s*ents\.Iterator/.test(code)
  ) {
    return {
      status: "incorrect",
      detail:
        "Mutates or exposes the shared cached table behind ents.Iterator.",
    };
  }
  if (
    /for\s+[^\n]+\s+in\s+ents\.Iterator\s*\(\s*\)\s+do/.test(code) &&
    /wanted\s*\(/.test(code) &&
    /use\s*\(/.test(code)
  ) {
    return {
      status: "pass",
      detail:
        "Processes ents.Iterator results directly without mutating its cache.",
    };
  }
  return {
    status: "incorrect",
    detail: "Does not use ents.Iterator as a direct read-only iterator.",
  };
}

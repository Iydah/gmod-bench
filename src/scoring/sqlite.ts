import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreSqliteTypedWrite(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  if (/sql\.Query\s*\([^)]*\.\./.test(code)) {
    return {
      status: "incorrect",
      detail: "Builds SQL by concatenating untrusted text.",
    };
  }
  const typed = /sql\.QueryTyped\s*\(/.test(code);
  const handled =
    /==\s*false|~=\s*true/.test(code) && /sql\.LastError\s*\(/.test(code);
  if (typed && handled)
    return {
      status: "pass",
      detail:
        "Uses typed parameter binding and handles query failure explicitly.",
    };
  if (typed)
    return {
      status: "partial",
      detail: "Uses typed binding but does not handle a false query result.",
    };
  return {
    status: "incorrect",
    detail: "Does not use sql.QueryTyped for untrusted text.",
  };
}

export function scoreSqliteBatch(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const bounded =
    /math\.min\s*\(\s*#\s*rows\s*,\s*500\s*\)|for\s+\w+\s*=\s*1\s*,\s*500/.test(
      code,
    );
  const transaction =
    /sql\.Begin\s*\(/.test(code) && /sql\.Commit\s*\(/.test(code);
  const typed = /sql\.QueryTyped\s*\(/.test(code);
  if (bounded && transaction && typed)
    return {
      status: "pass",
      detail: "Uses one bounded transaction with typed row writes.",
    };
  if (transaction && typed)
    return {
      status: "partial",
      detail: "Uses a typed transaction but does not prove the 500-row bound.",
    };
  return {
    status: "incorrect",
    detail:
      "Does not combine bounded writes, typed binding, and one transaction.",
  };
}

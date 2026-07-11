import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

/** Detects explicit query-error handling in any common idiom. */
function handlesError(code: string): boolean {
  const checksResult =
    /==\s*false/.test(code) ||
    /~=\s*true/.test(code) ||
    /if\s+not\s+\w+\s+then/.test(code);
  return checksResult && /sql\.LastError\s*\(/.test(code);
}

export function scoreSqliteTypedWrite(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const typed = /sql\.QueryTyped\s*\(/.test(code);
  const escaped = /sql\.SQLStr\s*\(/.test(code);
  const concatQuery = /sql\.Query\s*\([^)]*\.\.[^)]*\)/.test(code);

  // Injection: builds a query by concatenation without any escaping and without
  // the parameterized API. sql.SQLStr'd concatenation is safe, so its presence
  // (or QueryTyped) clears this. This is what the old scorer got wrong — it
  // flagged *all* concatenation, including properly escaped sql.SQLStr output.
  if (concatQuery && !escaped && !typed) {
    return {
      status: "incorrect",
      detail: "Builds SQL by concatenating untrusted text without escaping.",
    };
  }

  const handled = handlesError(code);

  // Preferred: sql.QueryTyped parameter binding + explicit error handling.
  if (typed && handled) {
    return {
      status: "pass",
      detail:
        "Uses typed parameter binding and handles query failure explicitly.",
    };
  }
  // Safe but not the preferred API (sql.SQLStr), or preferred API without the
  // required error handling — both partially satisfy the prompt.
  if (typed) {
    return {
      status: "partial",
      detail: "Uses typed binding but does not handle a false query result.",
    };
  }
  if (escaped) {
    return {
      status: "partial",
      detail: handled
        ? "Safely escapes with sql.SQLStr but does not use the preferred sql.QueryTyped."
        : "Escapes with sql.SQLStr but does not handle a query error explicitly.",
    };
  }
  return {
    status: "incorrect",
    detail: "Does not safely bind or escape untrusted text.",
  };
}

export function scoreSqliteBatch(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  // Any expression that caps the write at 500 rows: math.min(#rows, 500),
  // for i = 1, 500, for i = 1, math.min(#rows, 500), or `#rows > 500` guards.
  const bounded =
    /math\.min\s*\([^)]*\b500\b[^)]*\)/.test(code) ||
    /for\s+\w+\s*=\s*1\s*,\s*(?:500|math\.min\s*\([^)]*\b500\b)/.test(code) ||
    /#\s*rows\s*(?:>|>=)\s*500|500\s*(?:<|<=)\s*#\s*rows/.test(code);
  const transaction =
    /sql\.Begin\s*\(/.test(code) && /sql\.Commit\s*\(/.test(code);
  const typed = /sql\.QueryTyped\s*\(/.test(code);
  const rawConcat =
    /sql\.Query\s*\([^)]*\.\.[^)]*\)/.test(code) &&
    !/sql\.SQLStr\s*\(/.test(code);

  if (rawConcat) {
    return {
      status: "incorrect",
      detail: "Concatenates untrusted row data instead of binding parameters.",
    };
  }
  if (bounded && transaction && typed) {
    return {
      status: "pass",
      detail: "Uses one bounded transaction with typed row writes.",
    };
  }
  if (transaction && typed) {
    return {
      status: "partial",
      detail: "Uses a typed transaction but does not prove the 500-row bound.",
    };
  }
  return {
    status: "incorrect",
    detail:
      "Does not combine bounded writes, typed binding, and one transaction with the built-in sql library.",
  };
}

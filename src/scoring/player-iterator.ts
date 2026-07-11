import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";

/**
 * All-player traversal (Facepunch wiki + gmod-lua-performance).
 *
 * Pass: `player.Iterator()`, or one cached `player.GetAll()` + numeric `for i = 1, #t`.
 * Incorrect: allocation-based `ipairs`/`pairs`, uncached GetAll, wrong player
 * set, early exit, or mutating the Iterator cache.
 */
export function scorePlayerIteratorAnswer(
  response: ValidatedResponse,
): ScoreResult {
  const { code } = response;

  if (/player\.(GetHumans|GetBots)\s*\(/.test(code)) {
    return {
      status: "incorrect",
      detail: "The recommendation changes the set of visited players.",
    };
  }

  if (
    /select\s*\(\s*2\s*,\s*player\.Iterator\s*\(/.test(code) &&
    /table\.(Add|insert|Insert)/i.test(code)
  ) {
    return {
      status: "incorrect",
      detail:
        "The iterator cache must not be mutated as a shared player table.",
    };
  }

  if (/\b(?:break|return|goto)\b/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "The replacement must visit every player without early loop exit.",
    };
  }

  if (
    /^\s*for\s+[A-Za-z_][\w]*\s*,\s*[A-Za-z_][\w]*\s+in\s+player\.Iterator\s*\(\s*\)\s+do\b/m.test(
      code,
    )
  ) {
    return {
      status: "pass",
      detail: "Uses player.Iterator() (wiki-recommended Lua-cached iterator).",
    };
  }

  if (/\bplayer\.Iterator\s*\(/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "player.Iterator returns index first and player second; bind both loop values.",
    };
  }

  if (hasCachedNumericPlayerLoop(code)) {
    return {
      status: "pass",
      detail: "Uses a cached player.GetAll() table with a numeric for-loop.",
    };
  }

  if (/\bpairs\s*\(/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "Keeps pairs() rather than Iterator or a cached numeric for-loop.",
    };
  }

  if (/ipairs\s*\(\s*player\.GetAll\s*\(\s*\)\s*\)/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "ipairs is better than pairs, but player.GetAll() still allocates; use player.Iterator() or one cached numeric # loop.",
    };
  }

  if (/player\.GetAll\s*\(/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "Uses player.GetAll() without the accepted cached numeric # loop.",
    };
  }

  return {
    status: "incorrect",
    detail:
      "Does not use player.Iterator() or a cached numeric for-loop over players.",
  };
}

/** One cached GetAll result, then `for i = 1, #plys do`; permits a local function alias. */
function hasCachedNumericPlayerLoop(code: string): boolean {
  const getAllAlias =
    /\blocal\s+([A-Za-z_][\w]*)\s*=\s*player\.GetAll\b(?!\s*\()/.exec(
      code,
    )?.[1];
  const getAllCall = getAllAlias
    ? `${escapeRegExp(getAllAlias)}\\s*\\(\\s*\\)`
    : String.raw`player\.GetAll\s*\(\s*\)`;
  const assign = new RegExp(
    String.raw`(?:local\s+)?([A-Za-z_][\w]*)\s*=\s*${getAllCall}`,
  ).exec(code);
  const tableName = assign?.[1];
  if (!tableName) {
    return false;
  }

  const numericFor = new RegExp(
    String.raw`for\s+[A-Za-z_][\w]*\s*=\s*1\s*,\s*#\s*${escapeRegExp(tableName)}\s+do`,
    "m",
  );
  if (!numericFor.test(code)) {
    return false;
  }

  const calls = getAllAlias
    ? code.match(
        new RegExp(String.raw`\b${escapeRegExp(getAllAlias)}\s*\(`, "g"),
      )
    : code.match(/player\.GetAll\s*\(/g);
  return (calls ?? []).length === 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

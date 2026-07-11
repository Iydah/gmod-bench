import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaComments, stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreSpatialCache(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const structural = stripLuaComments(response.code);
  const thinkIndex = structural.search(/hook\.Add\s*\(\s*["']Think["']/);
  const hot = thinkIndex >= 0 ? code.slice(thinkIndex) : "";
  if (/ents\.(?:Iterator|GetAll|FindByClass)\s*\(/.test(hot)) {
    return {
      status: "incorrect",
      detail: "Scans global entity state inside the repeated Think path.",
    };
  }
  const seeded = /ents\.FindByClass\s*\(/.test(
    code.slice(0, Math.max(0, thinkIndex)),
  );
  const maintained =
    /OnEntityCreated/.test(response.code) &&
    /EntityRemoved/.test(response.code);
  const keyedLoop = /for\s+\w+\s+in\s+pairs\s*\(\s*tracked\s*\)/.test(code);
  const squared =
    /:DistToSqr\s*\(/.test(code) && /radius\s*\*\s*radius/.test(code);
  if (seeded && maintained && keyedLoop && squared && thinkIndex >= 0) {
    return {
      status: "pass",
      detail:
        "Seeds and maintains an addon set, then uses squared distance in Think.",
    };
  }
  if (maintained && keyedLoop && squared)
    return {
      status: "partial",
      detail:
        "Maintains the hot set but does not seed already-existing entities.",
    };
  return {
    status: "incorrect",
    detail: "Does not provide the complete maintained-set spatial design.",
  };
}

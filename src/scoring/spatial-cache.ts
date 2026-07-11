import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaComments, stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreSpatialCache(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const structural = stripLuaComments(response.code);
  const thinkIndex = structural.search(/hook\.Add\s*\(\s*["']Think["']/);
  const hot = thinkIndex >= 0 ? code.slice(thinkIndex) : "";

  // The whole point: the per-tick path must not re-scan global entity state.
  if (/ents\.(?:Iterator|GetAll|FindByClass|FindInSphere)\s*\(/.test(hot)) {
    return {
      status: "incorrect",
      detail: "Scans global entity state inside the repeated Think path.",
    };
  }

  // Seeded at load: an ents.FindByClass before the Think hook to capture
  // entities that already exist.
  const seeded = /ents\.FindByClass\s*\(/.test(
    code.slice(0, Math.max(0, thinkIndex)),
  );
  const maintained =
    /OnEntityCreated/.test(response.code) &&
    /EntityRemoved/.test(response.code);

  // A keyed-set iteration in the hot path — the set may be named anything.
  const keyedLoop = /for\s+\w+\s+in\s+pairs\s*\(\s*\w+\s*\)/.test(hot || code);

  // Squared distance compared against a squared radius, written any correct way:
  // radius * radius, r * r, a precomputed RADIUS_SQR/…_SQUARED, or radius ^ 2.
  const squaredThreshold =
    /\w+\s*\*\s*\w+/.test(code) ||
    /\bsqr\b|squared|_sqr\b/i.test(code) ||
    /\^\s*2\b/.test(code);
  const squared = /:DistToSqr\s*\(/.test(hot || code) && squaredThreshold;

  if (seeded && maintained && keyedLoop && squared && thinkIndex >= 0) {
    return {
      status: "pass",
      detail:
        "Seeds and maintains an addon set, then uses squared distance in Think.",
    };
  }
  if (maintained && keyedLoop && squared) {
    return {
      status: "partial",
      detail:
        "Maintains the hot set but does not seed already-existing entities.",
    };
  }
  return {
    status: "incorrect",
    detail: "Does not provide the complete maintained-set spatial design.",
  };
}

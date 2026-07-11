import type { ScoreResult } from "../core/types";
import { stripLuaComments } from "./code-patterns";
import type { ValidatedResponse } from "./response-contract";

export function scorePreventiveSpawnLimit(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaComments(response.code);
  if (/PlayerSpawnedProp/.test(code) || /ent\s*:\s*Remove\s*\(/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "Removes an already-created prop instead of denying this prop spawn before creation.",
    };
  }
  if (/return\s+true\b/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "Returns true for allowed spawns, which can short-circuit later hook handlers.",
    };
  }

  // Concept checks — accept any per-player key (ply object, SteamID, or a
  // player field) and any fixed-window form (resetAt/nextReset, floor(CurTime)).
  const perPlayerState =
    /\w+\s*\[\s*ply\b/.test(code) ||
    /\w+\s*\[\s*ply\s*:\s*SteamID/.test(code) ||
    /\w+\s*\[\s*id\b/.test(code) ||
    /\bply\.\w+/.test(code);
  // A one-second fixed window: floor(CurTime()) buckets, or reset = now + 1.
  const window =
    /math\.floor\s*\(\s*CurTime/.test(code) ||
    /(?:now|CurTime\s*\(\s*\))\s*\+\s*1\b/.test(code) ||
    /reset\w*\s*=\s*[^\r\n]*\+\s*1\b/.test(code);
  // The spec limit is 10/sec, so require ~10 (accept the >10 / >=10 / >=11
  // boundary variants) — a wrong cap like 100 is a wrong answer.
  const rejectOverBudget =
    /\w*count\w*\s*(?:>=|>)\s*1[01]\b\s*then\s+return\s+false/i.test(code) ||
    /(?:>=|>)\s*1[01]\b[\s\S]{0,30}?then\s+return\s+false/.test(code);
  const increment = /\w*count\w*\s*=\s*[^\r\n]*count\w*\s*\+\s*1/i.test(code);
  const cleanup =
    /hook\.Add\s*\(\s*["']PlayerDisconnected["']/.test(code) &&
    (/\[\s*(?:ply|id)\b[^\]]*\]\s*=\s*nil/.test(code) ||
      /\bply\.\w+\s*=\s*nil/.test(code));
  const concepts = {
    hook: /hook\.Add\s*\(\s*["']PlayerSpawnProp["']/.test(code),
    perPlayerState,
    window,
    rejectOverBudget,
    increment,
    cleanup,
  };
  const missing = Object.entries(concepts)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  if (missing.length === 0) {
    return {
      status: "pass",
      detail:
        "Denies only over-budget prop spawns before creation and cleans per-player state.",
    };
  }
  if (concepts.hook && /return\s+false/.test(code)) {
    return {
      status: "partial",
      detail: `Pre-spawn throttle is missing: ${missing.join(", ")}.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement preventative per-player prop throttling.",
  };
}

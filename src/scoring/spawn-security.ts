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

  const requirements = [
    /hook\.Add\s*\(\s*["']PlayerSpawnProp["']/,
    /CurTime\s*\(\s*\)/,
    /\[\s*ply\s*\]/,
    /resetAt\s*=\s*now\s*\+\s*1/,
    /count\s*>=?\s*10\s*then\s+return\s+false/,
    /count\s*=\s*(?:state\.)?count\s*\+\s*1|state\.count\s*=\s*state\.count\s*\+\s*1/,
    /hook\.Add\s*\(\s*["']PlayerDisconnected["']/,
    /\[\s*ply\s*\]\s*=\s*nil/,
  ];
  const matched = requirements.filter((pattern) => pattern.test(code)).length;
  if (matched === requirements.length) {
    return {
      status: "pass",
      detail:
        "Denies only over-budget prop spawns before creation and cleans per-player state.",
    };
  }
  if (/PlayerSpawnProp/.test(code) && /return\s+false/.test(code)) {
    return {
      status: "partial",
      detail: `Pre-spawn hook satisfies ${matched}/${requirements.length} throttling checks.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement preventative per-player prop throttling.",
  };
}

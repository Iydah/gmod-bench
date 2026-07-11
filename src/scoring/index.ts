import type {
  BenchmarkFixture,
  ScoreResult,
  ScoringDefinition,
} from "../core/types";
import { scoreDataRootConfinement } from "./file-security";
import { scoreHookAddAnswer } from "./hook-add";
import { scoreHotHook } from "./hot-hook";
import { scoreIsValidAnswer } from "./isvalid";
import {
  scoreDelayedValidity,
  scoreHookLifecycle,
  scoreIteratorReadonly,
} from "./lifecycle";
import { scoreNetEfficiency, scoreNetworkVarState } from "./net-efficiency";
import { scoreNetSecurity } from "./net-security";
import {
  scoreBoundedDecompression,
  scorePerPlayerNetBudget,
} from "./net-bounds";
import { scorePlayerIteratorAnswer } from "./player-iterator";
import {
  scoreAngleZero,
  scoreConfigVariable,
  scoreDarkRpVar,
  scoreEntityClassIterator,
  scoreEntityIterator,
  scoreFindPlayersNear,
  scoreHudPaintCache,
  scoreHookOnce,
  scoreLocalPlayerCache,
  scoreLocalSqlite,
  scoreSteamIdCache,
} from "./performance-contracts";
import { scorePredictionEffect } from "./prediction";
import { scoreRealmLoading } from "./realm-loading";
import { scoreSpatialCache } from "./spatial-cache";
import { scorePreventiveSpawnLimit } from "./spawn-security";
import { scoreShopNpc } from "./shop-npc";
import { scoreSqliteBatch, scoreSqliteTypedWrite } from "./sqlite";
import {
  scoreBoundedChunkTransfer,
  scoreTransferCleanup,
} from "./transfer-security";
import {
  validateResponseContract,
  type ValidatedResponse,
} from "./response-contract";
import { stripLuaComments } from "./code-patterns";

type PluginScorer = (answer: ValidatedResponse) => ScoreResult;

/**
 * Register semantic scorers here. Fixture JSON references the key via scoring.plugin.
 * Keep each scorer in its own module — do not grow a central conditional.
 */
const pluginScorers: Readonly<Record<string, PluginScorer>> = {
  "player-iterator": scorePlayerIteratorAnswer,
  "entity-class-iterator": scoreEntityClassIterator,
  "entity-iterator": scoreEntityIterator,
  "find-players-near": scoreFindPlayersNear,
  "angle-zero": scoreAngleZero,
  "localplayer-cache": scoreLocalPlayerCache,
  "hudpaint-cache": scoreHudPaintCache,
  "hook-once": scoreHookOnce,
  "config-variable": scoreConfigVariable,
  "steamid-cache": scoreSteamIdCache,
  darkrpvar: scoreDarkRpVar,
  "local-sqlite": scoreLocalSqlite,
  "hook-add": scoreHookAddAnswer,
  isvalid: scoreIsValidAnswer,
  "net-security": scoreNetSecurity,
  "net-efficiency": scoreNetEfficiency,
  "networkvar-state": scoreNetworkVarState,
  "hot-hook": scoreHotHook,
  "hook-lifecycle": scoreHookLifecycle,
  "delayed-validity": scoreDelayedValidity,
  "iterator-readonly": scoreIteratorReadonly,
  "spatial-cache": scoreSpatialCache,
  "realm-loading": scoreRealmLoading,
  "prediction-effect": scorePredictionEffect,
  "sqlite-typed-write": scoreSqliteTypedWrite,
  "sqlite-batch": scoreSqliteBatch,
  "bounded-decompression": scoreBoundedDecompression,
  "preventive-spawn-limit": scorePreventiveSpawnLimit,
  "per-player-net-budget": scorePerPlayerNetBudget,
  "bounded-chunk-transfer": scoreBoundedChunkTransfer,
  "transfer-cleanup": scoreTransferCleanup,
  "data-root-confinement": scoreDataRootConfinement,
  "shop-npc": scoreShopNpc,
};

function matchesAny(target: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(target));
}

function scoreRegexFixture(
  fixture: BenchmarkFixture,
  validated: ValidatedResponse,
): ScoreResult {
  if (fixture.scoring.kind !== "regex") {
    throw new Error("Expected a regex scoring definition.");
  }

  // Match against fenced code only so reason text cannot inflate pass rates.
  const code = stripLuaComments(validated.code);

  if (matchesAny(code, fixture.scoring.passPatterns)) {
    return { status: "pass", detail: "Matched a pass pattern." };
  }
  if (matchesAny(code, fixture.scoring.incorrectPatterns)) {
    return {
      status: "incorrect",
      detail: "Matched an incorrect-answer pattern.",
    };
  }
  if (matchesAny(code, fixture.scoring.partialPatterns)) {
    return { status: "partial", detail: "Matched a partial-answer pattern." };
  }

  return {
    status: "incorrect",
    detail: "Did not match a fixture answer pattern.",
  };
}

export function validateScoringDefinition(scoring: ScoringDefinition): void {
  if (scoring.kind === "plugin" && !pluginScorers[scoring.plugin]) {
    throw new Error(`No registered scorer exists for ${scoring.plugin}.`);
  }
}

export function scoreFixtureAnswer(
  fixture: BenchmarkFixture,
  answer: string,
): ScoreResult {
  const validated = validateResponseContract(fixture.responseContract, answer);
  if ("status" in validated) {
    return validated;
  }

  if (fixture.scoring.kind === "regex") {
    return scoreRegexFixture(fixture, validated);
  }

  const scorer = pluginScorers[fixture.scoring.plugin];
  if (!scorer) {
    return {
      status: "protocol_error",
      detail: `No registered scorer exists for ${fixture.scoring.plugin}.`,
    };
  }

  return scorer(validated);
}

export { validateResponseContract };
export type { ValidatedResponse };

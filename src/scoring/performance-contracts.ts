import type { ScoreResult } from "../core/types";
import { stripLuaComments } from "./code-patterns";
import type { ValidatedResponse } from "./response-contract";

function codeOf(response: ValidatedResponse): string {
  return stripLuaComments(response.code);
}

function iteratorEntityVariable(
  code: string,
  namespace: "ents" | "player",
): string | null {
  const match = new RegExp(
    String.raw`\bfor\s+[A-Za-z_][\w]*\s*,\s*([A-Za-z_][\w]*)\s+in\s+${namespace}\.Iterator\s*\(\s*\)\s+do\b`,
  ).exec(code);
  return match?.[1] ?? null;
}

export function scoreEntityClassIterator(
  response: ValidatedResponse,
): ScoreResult {
  const code = codeOf(response);
  if (/ents\.FindByClass\s*\(\s*["']prop_physics["']\s*\)/.test(code)) {
    return {
      status: "pass",
      detail: "Uses the class-selective entity primitive.",
    };
  }
  if (/ents\.Iterator\s*\(\s*[^)]/.test(code)) {
    return {
      status: "incorrect",
      detail: "ents.Iterator does not accept a class filter argument.",
    };
  }
  const entity = iteratorEntityVariable(code, "ents");
  if (!entity) {
    return {
      status: "incorrect",
      detail:
        "ents.Iterator must bind the entity from its second iterator value.",
    };
  }
  const classCheck = new RegExp(
    String.raw`\b${entity}\s*:\s*GetClass\s*\(\s*\)\s*==\s*["']prop_physics["']`,
  );
  return classCheck.test(code)
    ? { status: "pass", detail: "Iterates entities and filters prop_physics." }
    : {
        status: "incorrect",
        detail: "The iterator answer does not filter for prop_physics.",
      };
}

export function scoreEntityIterator(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  if (iteratorEntityVariable(code, "ents")) {
    return {
      status: "pass",
      detail: "Uses ents.Iterator with index and entity bindings.",
    };
  }
  if (/ents\.Iterator\s*\(/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "ents.Iterator must bind the entity from its second iterator value.",
    };
  }
  if (/ents\.GetAll\s*\(|ipairs\s*\(\s*ents/.test(code)) {
    return {
      status: "partial",
      detail: "Builds an entity table instead of using the iterator.",
    };
  }
  return {
    status: "incorrect",
    detail: "Does not provide a valid all-entity traversal.",
  };
}

export function scoreFindPlayersNear(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  const hasDistance = /(DistToSqr|Distance|DistTo)\s*\(/.test(code);
  if (/player\.Iterator\s*\(/.test(code)) {
    if (!iteratorEntityVariable(code, "player")) {
      return {
        status: "incorrect",
        detail:
          "player.Iterator must bind the player from its second iterator value.",
      };
    }
    return hasDistance
      ? {
          status: "pass",
          detail: "Iterates players and applies a distance test.",
        }
      : {
          status: "partial",
          detail: "Iterates players without the required distance test.",
        };
  }
  if (/player\.GetAll\s*\(/.test(code)) {
    return hasDistance
      ? { status: "pass", detail: "Checks only players with a distance test." }
      : {
          status: "partial",
          detail: "Gets players without the required distance test.",
        };
  }
  if (/FindInSphere[\s\S]*IsPlayer|IsPlayer[\s\S]*FindInSphere/.test(code)) {
    return {
      status: "incorrect",
      detail: "Scans nearby entities and filters players.",
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the player-only radius query.",
  };
}

export function scoreAngleZero(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  if (/\bangle_zero\s*[:.]/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "The shared angle_zero value must remain read-only and has no Copy method.",
    };
  }
  if (/\breturn\s+[A-Za-z_][\w]*\s*:\s*Zero\s*\(\s*\)/.test(code)) {
    return {
      status: "incorrect",
      detail: "Angle:Zero mutates in place and does not return the Angle.",
    };
  }
  if (/\bangle_zero\b/.test(code)) {
    return {
      status: "pass",
      detail: "Reuses the documented read-only zero Angle.",
    };
  }
  if (/\b[A-Za-z_][\w]*\s*:\s*Zero\s*\(\s*\)/.test(code)) {
    return {
      status: "pass",
      detail: "Resets an owned reusable Angle in place.",
    };
  }
  if (/\bAngle\s*\(\s*(?:0\s*,\s*0\s*,\s*0\s*)?\)/.test(code)) {
    return {
      status: "partial",
      detail: "Reuses an Angle but misses angle_zero or Angle:Zero().",
    };
  }
  return {
    status: "incorrect",
    detail: "Does not reuse a documented zero-Angle primitive.",
  };
}

export function scoreLocalPlayerCache(
  response: ValidatedResponse,
): ScoreResult {
  let code = codeOf(response);
  const alias = /\blocal\s+([A-Za-z_][\w]*)\s*=\s*LocalPlayer\b(?!\s*\()/.exec(
    code,
  )?.[1];
  if (alias) {
    code = code.replace(
      new RegExp(String.raw`\b${alias}\s*\(`, "g"),
      "LocalPlayer(",
    );
  }
  const calls = (code.match(/\bLocalPlayer\s*\(\s*\)/g) ?? []).length;
  if (calls === 0) {
    return { status: "incorrect", detail: "Does not obtain the local player." };
  }
  if (/\bInitPostEntity\b[\s\S]*=\s*LocalPlayer\s*\(\s*\)/.test(code)) {
    return {
      status: "pass",
      detail: "Caches the LocalPlayer result when it becomes valid.",
    };
  }
  if (/\b([A-Za-z_][\w]*)\s*=\s*\1\s+or\s+LocalPlayer\s*\(\s*\)/.test(code)) {
    return { status: "pass", detail: "Memoizes the LocalPlayer result." };
  }
  if (
    /\b([A-Za-z_][\w]*)\s*=\s*IsValid\s*\(\s*\1\s*\)\s+and\s+\1\s+or\s+LocalPlayer\s*\(/.test(
      code,
    )
  ) {
    return {
      status: "pass",
      detail: "Keeps the cached player while valid and refreshes on demand.",
    };
  }
  const cacheAssignment =
    /\b(?:local\s+)?([A-Za-z_][\w]*)\s*=\s*LocalPlayer\s*\(\s*\)/.exec(code);
  const cachedName = cacheAssignment?.[1];
  const hotHookIndex = code.search(
    /hook\.Add\s*\(\s*["'](?:Think|Tick|HUDPaint)["']/,
  );
  const declarationIndex = cachedName
    ? code.search(new RegExp(String.raw`\blocal\s+${cachedName}\b`))
    : -1;
  const assignmentIndex = cacheAssignment?.index ?? -1;
  const declaredOutsideHotHook =
    hotHookIndex < 0 ||
    (declarationIndex >= 0 && declarationIndex < hotHookIndex) ||
    (assignmentIndex >= 0 && assignmentIndex < hotHookIndex);
  if (
    cachedName &&
    declaredOutsideHotHook &&
    (new RegExp(String.raw`\bIsValid\s*\(\s*${cachedName}\s*\)`).test(code) ||
      new RegExp(String.raw`\b${cachedName}\s*:\s*IsValid\s*\(\s*\)`).test(
        code,
      ) ||
      new RegExp(
        String.raw`\b${cachedName}\s*=\s*IsValid\s*\(\s*${cachedName}\s*\)\s+and\s+${cachedName}\s+or\s+LocalPlayer\s*\(`,
      ).test(code))
  ) {
    return {
      status: "pass",
      detail:
        "Keeps a durable LocalPlayer result and refreshes it only when invalid.",
    };
  }
  if (/\blocal\s+LocalPlayer\s*=\s*LocalPlayer\b/.test(code)) {
    return {
      status: "partial",
      detail: "Caches only the function and still calls it on the hot path.",
    };
  }
  return {
    status: "partial",
    detail: "Calls LocalPlayer without a proven durable result cache.",
  };
}

export function scoreHudPaintCache(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  const healthCalls = (code.match(/:\s*Health\s*\(\s*\)/g) ?? []).length;
  if (!/\bLocalPlayer\s*\(\s*\)/.test(code)) {
    return {
      status: "incorrect",
      detail: "Does not show the LocalPlayer health path.",
    };
  }
  if (
    healthCalls === 1 &&
    /\blocal\s+[A-Za-z_][\w]*\s*=\s*[^\n]*:\s*Health\s*\(/.test(code)
  ) {
    return {
      status: "pass",
      detail: "Reads Health once per paint and reuses the local value.",
    };
  }
  return healthCalls > 0
    ? {
        status: "partial",
        detail: "Still performs repeated or uncached Health work.",
      }
    : { status: "incorrect", detail: "Does not read player health." };
}

export function scoreConfigVariable(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  if (/=\s*[A-Za-z_][\w]*\.[A-Za-z_][\w]*\.[A-Za-z_][\w]*/.test(code)) {
    return {
      status: "partial",
      detail: "Caches a nested setting instead of declaring the setting flat.",
    };
  }
  if (
    /\blocal\s+[A-Za-z_][\w]*\s*=\s*(?:["']|[-+]?\d|true\b|false\b|Color\s*\(|Vector\s*\(|Angle\s*\()/.test(
      code,
    )
  ) {
    return {
      status: "pass",
      detail: "Declares the frequently read setting as a flat local.",
    };
  }
  return {
    status: "incorrect",
    detail: "Does not show a flat setting declaration.",
  };
}

export function scoreSteamIdCache(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  if (
    /function\s+[A-Za-z_][\w]*\s*:\s*SteamID\s*\(|\.SteamID\s*=\s*function/.test(
      code,
    )
  ) {
    return {
      status: "partial",
      detail: "Caches the value by globally replacing Player:SteamID.",
    };
  }
  if (
    /:\s*SteamID\s*\(\s*\)/.test(code) &&
    /(\[[^\]]+\]|\.__?[A-Za-z_][\w]*)/.test(code)
  ) {
    return {
      status: "pass",
      detail: "Caches SteamID per player without replacing the core method.",
    };
  }
  return /:\s*SteamID\s*\(\s*\)/.test(code)
    ? {
        status: "partial",
        detail: "Calls SteamID without a proven cache hit path.",
      }
    : { status: "incorrect", detail: "Does not implement SteamID caching." };
}

export function scoreDarkRpVar(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  const preferred = /:\s*getDarkRPVar\s*\(/.test(code);
  const nw = /:\s*GetNW2?String\s*\(/.test(code);
  if (preferred && !nw)
    return { status: "pass", detail: "Uses getDarkRPVar for the job value." };
  if (preferred || nw)
    return {
      status: "partial",
      detail: "Executes the slower NW lookup path as well.",
    };
  return { status: "incorrect", detail: "Does not use the DarkRP job API." };
}

export function scoreLocalSqlite(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  if (/(^|[^.\w])SQLStr\s*\(/m.test(code)) {
    return {
      status: "incorrect",
      detail: "Calls nonexistent global SQLStr instead of sql.SQLStr.",
    };
  }
  if (/\bsql\.(?:Query|QueryRow|QueryValue|QueryTyped)\s*\(/.test(code)) {
    return { status: "pass", detail: "Uses the local SQLite API." };
  }
  if (/mysqloo|mysql\.|tmysql/i.test(code)) {
    return {
      status: "partial",
      detail: "Uses remote MySQL for a single-server workload.",
    };
  }
  return {
    status: "incorrect",
    detail: "Does not show a valid local SQLite query.",
  };
}

export function scoreHookOnce(response: ValidatedResponse): ScoreResult {
  const code = codeOf(response);
  const batched = /hook\.Run\s*\([^\n)]*(?:player\.GetAll|players|plys)/.test(
    code,
  );
  const activePerPlayerDispatch =
    /\bfor\b[\s\S]{0,300}?\bdo\b[\s\S]{0,300}?hook\.Run\s*\(/.test(code) &&
    !/\blocal\s+function\b[\s\S]{0,300}?\bfor\b[\s\S]{0,300}?hook\.Run\s*\(/.test(
      code,
    );
  if (batched && activePerPlayerDispatch) {
    return {
      status: "incorrect",
      detail: "Still executes hook.Run inside an active per-player loop.",
    };
  }
  if (batched) {
    return {
      status: "pass",
      detail: "Dispatches the custom hook once with the player collection.",
    };
  }
  return /hook\.Run\s*\(/.test(code)
    ? {
        status: "partial",
        detail: "Uses hook.Run without a proven batched player dispatch.",
      }
    : { status: "incorrect", detail: "Does not dispatch the custom hook." };
}

import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreRealmLoading(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const distributed = /if\s+SERVER\s+then[\s\S]*AddCSLuaFile\s*\(/.test(code);
  const included = /include\s*\(/.test(code);
  const authoritative =
    /if\s+SERVER\s+then[\s\S]*ApplyDamage[\s\S]*:TakeDamage\s*\(/.test(code);
  const authorized = /:(?:IsAdmin|IsSuperAdmin)\s*\(/.test(code);
  if (distributed && included && authoritative && authorized) {
    return {
      status: "pass",
      detail:
        "Distributes and includes shared code while keeping mutation authorized on the server.",
    };
  }
  if (distributed && included)
    return {
      status: "partial",
      detail:
        "Loading is correct, but server authority or caller authorization is incomplete.",
    };
  return {
    status: "incorrect",
    detail:
      "Does not show the required shared loading and server-authoritative action.",
  };
}

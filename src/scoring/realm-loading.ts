import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreRealmLoading(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const distributed = /AddCSLuaFile\s*\(/.test(code);
  const included = /include\s*\(/.test(code);
  // Server-authoritative damage, however the realm is enforced: ApplyDamage in
  // an `if SERVER then` block, or an early `if not SERVER/if CLIENT` return.
  const authoritative =
    /:TakeDamage\s*\(/.test(code) &&
    (/if\s+SERVER\s+then[\s\S]*ApplyDamage[\s\S]*:TakeDamage\s*\(/.test(code) ||
      /function\s+ApplyDamage[\s\S]*?(?:if\s+not\s+SERVER\s+then\s+return|if\s+CLIENT\s+then\s+return|if\s+SERVER\s+then)[\s\S]*?:TakeDamage/.test(
        code,
      ));
  // "Checks the player": either an authorization (admin) or a validity check
  // on the acting player before the damage is applied.
  const authorized =
    /[:.](?:IsAdmin|IsSuperAdmin)\s*\(/.test(code) ||
    /ApplyDamage[\s\S]*?(?:IsValid\s*\(\s*\w+\s*\)|:IsPlayer\s*\()[\s\S]*?:TakeDamage/.test(
      code,
    );
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

import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreNetSecurity(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  if (/net\.Receive\s*\([^,]+,\s*function\s*\(\s*\)/.test(code)) {
    return {
      status: "incorrect",
      detail: "Trusts a client-supplied entity as the authenticated caller.",
    };
  }

  const requirements = [
    /net\.Receive\s*\(/,
    /function\s*\(\s*\w+\s*,\s*\w+\s*\)/,
    /\blen\s*>\s*\d+/,
    /:(?:IsAdmin|IsSuperAdmin)\s*\(/,
    /CurTime\s*\(\s*\)/,
    /net\.ReadEntity\s*\(/,
    /net\.ReadUInt\s*\(\s*8\s*\)/,
    /IsValid\s*\(/,
    /:GetOwner\s*\(\s*\)\s*~=\s*\w+/,
    /\bpower\s*>\s*100/,
    /:SetPower\s*\(\s*power\s*\)/,
  ];
  const matched = requirements.filter((pattern) => pattern.test(code)).length;
  if (matched === requirements.length) {
    return {
      status: "pass",
      detail:
        "Bounds size and rate, authorizes callback ply and owner, validates entity and value.",
    };
  }
  if (/net\.Receive\s*\(/.test(code) && /:SetPower\s*\(/.test(code)) {
    return {
      status: "partial",
      detail: `Receiver includes ${matched}/${requirements.length} required trust-boundary checks.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the bounded authorized receiver.",
  };
}

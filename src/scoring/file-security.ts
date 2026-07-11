import type { ScoreResult } from "../core/types";
import { stripLuaComments } from "./code-patterns";
import type { ValidatedResponse } from "./response-contract";

export function scoreDataRootConfinement(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaComments(response.code);
  if (
    /file\.(?:Read|Open)\s*\(\s*(?:path|name)\s*,\s*["'](?:GAME|MOD|BASE_PATH|LUA)["']/.test(
      code,
    )
  ) {
    return {
      status: "incorrect",
      detail: "Uses an attacker-selected path outside the required DATA root.",
    };
  }

  const requirements = [
    /net\.Receive\s*\(/,
    /\blen\s*>\s*520/,
    /:(?:IsAdmin|IsSuperAdmin)\s*\(/,
    /net\.ReadString\s*\(/,
    /#\s*name\s*>\s*64\b/,
    /string\.match\s*\(\s*name\s*,\s*["']\^\[%w_\.-\]\+\$["']\s*\)/,
    /name\s*==\s*["']\.["']\s+or\s+name\s*==\s*["']\.\.["']/,
    /["']myaddon\/uploads\/["']\s*\.\./,
    /file\.Open\s*\(\s*path\s*,\s*["']rb["']\s*,\s*["']DATA["']\s*\)/,
    /if\s+not\s+handle\s+then\s+return/,
    /handle\s*:\s*Read\s*\(\s*65536\s*\)/,
    /handle\s*:\s*Close\s*\(/,
    /consume\s*\(\s*data\s*\)/,
  ];
  const matched = requirements.filter((pattern) => pattern.test(code)).length;
  if (matched === requirements.length) {
    return {
      status: "pass",
      detail:
        "Builds a fixed DATA-subtree path from one bounded safe segment and performs a bounded closed read.",
    };
  }
  if (/file\.(?:Read|Open)\s*\(/.test(code)) {
    return {
      status: "partial",
      detail: `File receiver satisfies ${matched}/${requirements.length} confinement checks.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the confined bounded DATA-file read.",
  };
}

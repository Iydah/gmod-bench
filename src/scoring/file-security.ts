import type { ScoreResult } from "../core/types";
import { stripLuaComments } from "./code-patterns";
import type { ValidatedResponse } from "./response-contract";

/**
 * Score a confined, bounded DATA-file read by concept. Variable names (handle
 * vs f, path inline vs stored) and the exact whitelist spelling
 * (^[%w_.-]+$ vs ^[a-zA-Z0-9_%.%-]+$) vary between correct answers; the
 * confinement requirements do not. A missing "." / ".." traversal guard is a
 * real gap and correctly holds the answer at partial.
 */
export function scoreDataRootConfinement(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaComments(response.code);

  // Reading from a non-DATA search path is an out-of-root escape.
  if (
    /file\.(?:Read|Open)\s*\([^,)]+,\s*(?:["'][^"']*["']\s*,\s*)?["'](?:GAME|MOD|BASE_PATH|LUA)["']/.test(
      code,
    )
  ) {
    return {
      status: "incorrect",
      detail: "Uses an attacker-selected path outside the required DATA root.",
    };
  }

  const concepts = {
    superadmin: /[:.](?:IsSuperAdmin|IsAdmin)\s*\(/.test(code),
    readsName: /net\.ReadString\s*\(/.test(code),
    lengthBound: /#\s*\w+\s*(?:>|>=)\s*(?:64|65)\b/.test(code),
    // An anchored whitelist match, any equivalent character-class spelling.
    whitelist:
      /string\.(?:match|find)\s*\(\s*\w+\s*,\s*["']\^\[[^\]]*\]\+\$["']/.test(
        code,
      ),
    // Explicit traversal rejection — the whitelist alone can still admit "..".
    traversalReject: /==\s*["']\.\.?["']/.test(code),
    // Path confined to the fixed subtree.
    confinedPath: /["']myaddon\/uploads\/["']\s*\.\./.test(code),
    // Open under the DATA search path (r or rb).
    dataOpen:
      /file\.Open\s*\([^,]+,\s*["']r[b]?["']\s*,\s*["']DATA["']\s*\)/.test(
        code,
      ),
    nilCheck: /if\s+not\s+\w+\s+then\s+return/.test(code),
    boundedRead: /[:.]Read\s*\(\s*\d+\s*\)/.test(code),
    closes: /[:.]Close\s*\(/.test(code),
    consumes: /consume\s*\(/.test(code),
  };
  const missing = Object.entries(concepts)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  if (missing.length === 0) {
    return {
      status: "pass",
      detail:
        "Builds a fixed DATA-subtree path from one bounded safe segment and performs a bounded closed read.",
    };
  }
  if (/file\.Open\s*\(/.test(code)) {
    return {
      status: "partial",
      detail: `File receiver is missing: ${missing.join(", ")}.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the confined bounded DATA-file read.",
  };
}

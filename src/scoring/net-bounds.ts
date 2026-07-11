import type { ScoreResult } from "../core/types";
import { stripLuaComments, stripLuaCommentsAndStrings } from "./code-patterns";
import type { ValidatedResponse } from "./response-contract";

function occursBefore(code: string, earlier: RegExp, later: RegExp): boolean {
  const earlierIndex = code.search(earlier);
  const laterIndex = code.search(later);
  return earlierIndex >= 0 && laterIndex >= 0 && earlierIndex < laterIndex;
}

function countMatches(code: string, patterns: readonly RegExp[]): number {
  return patterns.filter((pattern) => pattern.test(code)).length;
}

export function scoreBoundedDecompression(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const readData = /net\.ReadData\s*\(/;
  const pool = /util\.AddNetworkString\s*\(/;
  const receive = /net\.Receive\s*\(/;

  // Accept the caps written any equivalent way: 32768 or 32*1024, 262144 or
  // 256*1024. Models legitimately use either literal form.
  const compressedCap = /32768|32\s*\*\s*1024|1024\s*\*\s*32/;
  const decompressedCap = /262144|256\s*\*\s*1024|1024\s*\*\s*256/;

  // Compressed-size bound before the read. Accept every correct phrasing:
  //   len > MAX * 8 / len / 8 > MAX   (bit- or byte-based, MAX literal or const)
  //   local bytes = len / 8 ... bytes > 32768
  // i.e. any comparison ahead of net.ReadData that involves `len` or the cap.
  const readIndex = code.search(readData);
  const preRead = readIndex >= 0 ? code.slice(0, readIndex) : code;
  const cmp = "(?:<=|<|>=|>)";
  const inputBounded =
    new RegExp(`\\blen\\b[^\\r\\n]{0,40}${cmp}`).test(preRead) ||
    new RegExp(`${cmp}[^\\r\\n]{0,40}\\blen\\b`).test(preRead) ||
    new RegExp(
      `\\w+\\s*${cmp}\\s*(?:${compressedCap.source}|[A-Z_][A-Z0-9_]*)`,
    ).test(preRead) ||
    new RegExp(`${cmp}\\s*[^\\r\\n]{0,20}?(?:${compressedCap.source})`).test(
      preRead,
    );

  // util.Decompress MUST pass a second (maxSize) argument — the wiki warns that
  // omitting it allows a decompression bomb. A one-arg call is unsafe.
  const decompressCall = /util\.Decompress\s*\(\s*[^,()]+,\s*[^)]+\)/.test(
    code,
  );
  const decompressUnbounded = /util\.Decompress\s*\(\s*[^,()]+\)/.test(code);
  const decompressCapped = decompressCall && decompressedCap.test(code);

  // Validity guard before consume, in any idiom: `if not d`, `if d`,
  // `if type(d) == "string"`, `if isstring(d)`, `d ~= ""`. Checked on
  // comment-stripped-but-string-kept code so `== "string"` / `~= ""` survive.
  const structural = stripLuaComments(response.code);
  const validated =
    /if\s+not\s+\w+\s+then/.test(structural) ||
    /if\s+\w+\s+then/.test(structural) ||
    /type\s*\(\s*\w+\s*\)\s*==/.test(structural) ||
    /isstring\s*\(/.test(structural) ||
    /\w+\s*~=\s*["']["']/.test(structural);

  const admin = /:(?:IsAdmin|IsSuperAdmin)\s*\(/.test(code);
  const consumes = /consume\s*\(\s*\w+\s*\)/.test(code);
  const pooledBeforeReceiver = occursBefore(code, pool, receive);

  const core = [
    pool.test(code),
    receive.test(code),
    admin,
    inputBounded,
    readData.test(code),
    decompressCapped,
    validated,
    consumes,
  ];
  const matched =
    countMatches(code, [
      compressedCap,
      decompressedCap,
      /function\s*\(\s*\w+\s*,\s*\w+\s*\)/,
    ]) + core.filter(Boolean).length;

  // Unsafe: decompress without a size cap is a bomb regardless of anything else.
  if (decompressUnbounded && !decompressCall) {
    return {
      status: "incorrect",
      detail: "Decompresses untrusted data without the required maxSize.",
    };
  }
  // Unsafe: reads the payload without first bounding the compressed size.
  if (readData.test(code) && !inputBounded) {
    return {
      status: "incorrect",
      detail: "Reads an unbounded untrusted payload before proving its size.",
    };
  }
  if (core.every(Boolean) && pooledBeforeReceiver && readIndex >= 0) {
    return {
      status: "pass",
      detail:
        "Bounds compressed input before reading and caps decompressed output before use.",
    };
  }
  if (receive.test(code) && readData.test(code)) {
    return {
      status: "partial",
      detail: `Payload receiver satisfies ${matched}/11 bounded-decompression checks.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the bounded compressed-payload receiver.",
  };
}

export function scorePerPlayerNetBudget(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const structural = stripLuaComments(response.code);
  const firstRead = /net\.Read(?:Entity|String|Data|UInt|Int|Table|Type)\s*\(/;
  const pool = /util\.AddNetworkString\s*\(/;
  const receive = /net\.Receive\s*\(/;

  // Reject over-budget before parsing — count/tokens/attempts vs a limit, on a
  // table entry (states[ply].count) OR a per-player field (ply.Count).
  // The spec limit is 20/window — require the literal 20 or a named constant,
  // so a wrong cap like 200 fails.
  const rateReject =
    /\w*(?:count|tokens|attempts|requests)\w*\s*(?:>=|>)\s*(?:20\b|[A-Za-z_]{3,})\s*then\s+return/i;
  // Per-player state, keyed however: states[ply], budgets[ply:SteamID64()],
  // or fields on the player entity (ply.MyAddon_Count).
  const perPlayerState =
    /\w+\s*\[\s*ply\b/.test(code) ||
    /\w+\s*\[\s*ply\s*:\s*SteamID/.test(code) ||
    /\bply\.\w+/.test(code);
  // A fixed time window: resetAt/nextReset, or floor(CurTime()) bucketing.
  const window =
    /CurTime\s*\(\s*\)/.test(code) &&
    (/reset\w*/i.test(code) ||
      /window/i.test(code) ||
      /math\.floor\s*\(\s*CurTime/.test(code) ||
      /CurTime\s*\(\s*\)\s*\+/.test(code));
  const increment =
    /\w*(?:count|tokens|attempts|requests)\w*\s*=\s*[^\r\n]*(?:count|tokens|attempts|requests)?\w*\s*\+\s*1/i.test(
      code,
    );
  const cleanup =
    /PlayerDisconnected/.test(structural) &&
    (/\[\s*ply\b[^\]]*\]\s*=\s*nil/.test(code) ||
      /\bply\.\w+\s*=\s*nil/.test(code));

  const concepts = {
    pool: pool.test(code),
    receiver:
      /function\s*\(\s*\w+\s*,\s*\w+\s*\)/.test(code) && receive.test(code),
    lenBound: /\blen\s*(?:>|>=)\s*64/.test(code),
    perPlayerState,
    window,
    rateReject: rateReject.test(code),
    increment,
    readsEntity: /net\.ReadEntity\s*\(/.test(code),
    validates: /IsValid\s*\(/.test(code),
    perform: /perform\s*\(\s*\w+\s*\)/.test(code),
    cleanup,
  };
  const rateBeforeRead = occursBefore(code, rateReject, firstRead);
  const pooledBeforeReceiver = occursBefore(code, pool, receive);
  const missing = Object.entries(concepts)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  // A single shared counter is the real anti-pattern the fixture rejects.
  if (
    /local\s+(?:count|requests|tokens)\s*=\s*0/.test(code) &&
    !perPlayerState
  ) {
    return {
      status: "incorrect",
      detail: "Uses one shared counter instead of a per-player abuse budget.",
    };
  }
  if (missing.length === 0 && rateBeforeRead && pooledBeforeReceiver) {
    return {
      status: "pass",
      detail:
        "Applies a bounded per-player time window before parsing and cleans sender state.",
    };
  }
  if (receive.test(code) && concepts.perform && perPlayerState) {
    return {
      status: "partial",
      detail: `Per-player receiver is missing: ${missing.join(", ") || "correct ordering"}.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the bounded per-player receiver budget.",
  };
}

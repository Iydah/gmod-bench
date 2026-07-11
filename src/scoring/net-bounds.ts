import type { ScoreResult } from "../core/types";
import { stripLuaCommentsAndStrings } from "./code-patterns";
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
  const inputBound = /\blen\s*>\s*[A-Z_\w]+\s*\*\s*8|\blen\s*\/\s*8\s*>/;
  const readData = /net\.ReadData\s*\(/;
  const pool = /util\.AddNetworkString\s*\(/;
  const receive = /net\.Receive\s*\(/;
  const requirements = [
    /32768/,
    /262144/,
    pool,
    receive,
    /function\s*\(\s*len\s*,\s*\w+\s*\)/,
    inputBound,
    /:(?:IsAdmin|IsSuperAdmin)\s*\(/,
    /net\.ReadData\s*\(\s*len\s*\/\s*8/,
    /util\.Decompress\s*\(\s*\w+\s*,\s*[A-Z_\w]+\s*\)/,
    /if\s+not\s+\w+\s+then\s+return/,
    /consume\s*\(\s*\w+\s*\)/,
  ];
  const matched = countMatches(code, requirements);
  const boundedBeforeRead = occursBefore(code, inputBound, readData);
  const pooledBeforeReceiver = occursBefore(code, pool, receive);

  if (
    matched === requirements.length &&
    boundedBeforeRead &&
    pooledBeforeReceiver
  ) {
    return {
      status: "pass",
      detail:
        "Bounds compressed input before reading and caps decompressed output before use.",
    };
  }
  if (/util\.Decompress\s*\(\s*[^,()]+\s*\)/.test(code)) {
    return {
      status: "incorrect",
      detail: "Decompresses untrusted data without the required maxSize.",
    };
  }
  if (readData.test(code) && (!inputBound.test(code) || matched < 5)) {
    return {
      status: "incorrect",
      detail: "Reads an unbounded untrusted payload before proving its size.",
    };
  }
  if (/net\.Receive\s*\(/.test(code) && readData.test(code)) {
    return {
      status: "partial",
      detail: `Payload receiver satisfies ${matched}/${requirements.length} bounded-decompression checks.`,
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
  const firstRead = /net\.Read(?:Entity|String|Data|UInt|Int|Table|Type)\s*\(/;
  const rateReject = /(?:count|tokens)\s*>=?\s*(?:LIMIT|20)\b\s*then\s+return/;
  const pool = /util\.AddNetworkString\s*\(/;
  const receive = /net\.Receive\s*\(/;
  const requirements = [
    pool,
    receive,
    /function\s*\(\s*len\s*,\s*\w+\s*\)/,
    /\blen\s*>\s*64/,
    /(?:budgets|states|limits|windows)\s*\[\s*ply\s*\]/,
    /CurTime\s*\(\s*\)/,
    /resetAt/,
    /resetAt\s*=\s*now\s*\+\s*1/,
    rateReject,
    /(?:count|tokens)\s*=\s*(?:state\.)?(?:count|tokens)\s*\+\s*1|state\.(?:count|tokens)\s*=\s*state\.(?:count|tokens)\s*\+\s*1/,
    /hook\.Add\s*\(/,
    /(?:budgets|states|limits|windows)\s*\[\s*ply\s*\]\s*=\s*nil/,
    /net\.ReadEntity\s*\(/,
    /IsValid\s*\(/,
    /perform\s*\(\s*\w+\s*\)/,
  ];
  const matched = countMatches(code, requirements);
  const rateBeforeRead = occursBefore(code, rateReject, firstRead);
  const pooledBeforeReceiver = occursBefore(code, pool, receive);

  if (
    matched === requirements.length &&
    rateBeforeRead &&
    pooledBeforeReceiver
  ) {
    return {
      status: "pass",
      detail:
        "Applies a bounded per-player time window before parsing and cleans sender state.",
    };
  }
  if (/local\s+(?:count|requests)\s*=\s*0/.test(code)) {
    return {
      status: "incorrect",
      detail: "Uses one shared counter instead of a per-player abuse budget.",
    };
  }
  if (/net\.Receive\s*\(/.test(code) && /CurTime\s*\(/.test(code)) {
    return {
      status: "partial",
      detail: `Receiver satisfies ${matched}/${requirements.length} per-player budget checks.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the bounded per-player receiver budget.",
  };
}

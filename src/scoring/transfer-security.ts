import type { ScoreResult } from "../core/types";
import { stripLuaComments, stripLuaCommentsAndStrings } from "./code-patterns";
import type { ValidatedResponse } from "./response-contract";

function before(code: string, earlier: RegExp, later: RegExp): boolean {
  const earlierIndex = code.search(earlier);
  const laterIndex = code.search(later);
  return earlierIndex >= 0 && laterIndex >= 0 && earlierIndex < laterIndex;
}

export function scoreBoundedChunkTransfer(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const readData = /net\.ReadData\s*\(/;
  const sizeBound = /size\s*>\s*MAX_CHUNK_BYTES/;
  const totalBound = /totalBytes\s*\+\s*size\s*>\s*MAX_TOTAL_BYTES/;
  const remainingBound = /size\s*>\s*(?:bytesLeft|net\.BytesLeft\s*\(\s*\))/;
  const messageBound =
    /len\s*>\s*\(?\s*32\s*\+\s*16\s*\+\s*16\s*\+\s*MAX_CHUNK_BYTES\s*\*\s*8\s*\)?/;
  const pool = /util\.AddNetworkString\s*\(/;
  const receive = /net\.Receive\s*\(/;
  const requirements = [
    /MAX_CHUNKS\s*,\s*MAX_CHUNK_BYTES\s*,\s*MAX_TOTAL_BYTES\s*=\s*64\s*,\s*24000\s*,\s*1048576/,
    pool,
    receive,
    messageBound,
    /net\.ReadUInt\s*\(\s*32\s*\)/,
    /net\.ReadUInt\s*\(\s*16\s*\)/,
    /transfers\s*\[\s*ply\s*\]/,
    /transfer\.id\s*~=\s*id/,
    /index\s*<\s*1/,
    /index\s*>\s*(?:MAX_CHUNKS|transfer\.totalChunks)/,
    sizeBound,
    /net\.BytesLeft\s*\(\s*\)/,
    remainingBound,
    /transfer\.received\s*\[\s*index\s*\]/,
    totalBound,
    readData,
    /transfer\.received\s*\[\s*index\s*\]\s*=\s*true/,
    /transfer\.chunks\s*\[\s*index\s*\]\s*=\s*data/,
    /transfer\.totalBytes\s*=\s*transfer\.totalBytes\s*\+\s*size/,
    /transfer\.lastActivity\s*=\s*CurTime\s*\(/,
  ];
  const matched = requirements.filter((pattern) => pattern.test(code)).length;
  const boundsBeforeRead =
    before(code, messageBound, /net\.ReadUInt\s*\(/) &&
    before(code, sizeBound, readData) &&
    before(code, remainingBound, readData) &&
    before(code, totalBound, readData);
  const pooledBeforeReceiver = before(code, pool, receive);

  if (
    matched === requirements.length &&
    boundsBeforeRead &&
    pooledBeforeReceiver
  ) {
    return {
      status: "pass",
      detail:
        "Authenticates transfer state and bounds indices, duplicates, chunk bytes, and aggregate bytes before storing.",
    };
  }
  if (
    matched >= Math.ceil(requirements.length / 2) &&
    /net\.ReadData\s*\(\s*size\s*\)/.test(code)
  ) {
    return {
      status: "partial",
      detail: `Chunk receiver satisfies ${matched}/${requirements.length} state and size checks.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the bounded sender-owned chunk receiver.",
  };
}

export function scoreTransferCleanup(response: ValidatedResponse): ScoreResult {
  const code = stripLuaComments(response.code);
  const requirements = [
    /local\s+function\s+(?:cancel|cleanup)\w*\s*\(/i,
    /hook\.Add\s*\(\s*["']PlayerDisconnected["']/,
    /timer\.Create\s*\(\s*[^,]+\s*,\s*1\s*,\s*0\s*,/,
    /CurTime\s*\(\s*\)/,
    /lastActivity/,
    /lastActivity\s*>\s*30/,
    /for\s+\w+\s*,\s*\w+\s+in\s+pairs\s*\(/,
    /IsValid\s*\(\s*transfer\.peer\s*\)/,
    /notifyCancelled\s*\(\s*transfer\.peer\s*\)/,
    /transfers\s*\[\s*transfer\.peer\s*\]\s*=\s*nil/,
    /transfers\s*\[\s*ply\s*\]\s*=\s*nil/,
  ];
  const matched = requirements.filter((pattern) => pattern.test(code)).length;
  if (matched === requirements.length) {
    return {
      status: "pass",
      detail:
        "Centralizes two-peer cleanup and invokes it for disconnects and inactivity timeouts.",
    };
  }
  if (/PlayerDisconnected/.test(code) && /\[\s*ply\s*\]\s*=\s*nil/.test(code)) {
    return {
      status: "partial",
      detail: `Cleanup satisfies ${matched}/${requirements.length} disconnect and timeout requirements.`,
    };
  }
  return {
    status: "incorrect",
    detail:
      "Does not clean transfer state across disconnect and timeout paths.",
  };
}

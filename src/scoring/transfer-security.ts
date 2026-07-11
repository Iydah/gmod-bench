import type { ScoreResult } from "../core/types";
import { stripLuaComments, stripLuaCommentsAndStrings } from "./code-patterns";
import type { ValidatedResponse } from "./response-contract";

function before(code: string, earlier: RegExp, later: RegExp): boolean {
  const earlierIndex = code.search(earlier);
  const laterIndex = code.search(later);
  return earlierIndex >= 0 && laterIndex >= 0 && earlierIndex < laterIndex;
}

/**
 * Score a bounded, sender-owned chunk receiver by concept. The prompt fixes the
 * interface (transfers[ply], id/index/size, the 64/24000/1048576 limits), but a
 * correct answer may write those limits as inline literals or named constants,
 * and track received chunks as a set or a counter — all accepted here.
 */
export function scoreBoundedChunkTransfer(
  response: ValidatedResponse,
): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  const readData = /net\.ReadData\s*\(/;
  const pool = /util\.AddNetworkString\s*\(/;
  const receive = /net\.Receive\s*\(/;

  // Bounds accepted as a named constant OR the literal from the spec.
  const sizeBound = /\bsize\s*>\s*(?:MAX_CHUNK_BYTES|24000)\b/;
  const totalBound =
    /\btotalBytes\s*\+\s*size\s*>\s*(?:MAX_TOTAL_BYTES|1048576)\b|\bsize\s*\+\s*[\w.]*totalBytes\s*>\s*(?:MAX_TOTAL_BYTES|1048576)\b/;
  const remainingBound =
    /\bsize\s*>\s*(?:[\w.]*bytesLeft|net\.BytesLeft\s*\(\s*\))/i;
  const indexBound =
    /\bindex\s*<\s*1\b|\bindex\s*<=\s*0\b/.test(code) &&
    /\bindex\s*>\s*(?:MAX_CHUNKS|transfer\.totalChunks|64)\b/.test(code);

  const concepts = {
    pool: pool.test(code),
    receiver: receive.test(code),
    // The spec limits (64 chunks / 24000 bytes / 1048576 total) must appear —
    // whether inline or as named-constant values — so a wrong cap is caught.
    caps:
      /\b64\b/.test(code) && /\b24000\b/.test(code) && /\b1048576\b/.test(code),
    readsId: /net\.ReadUInt\s*\(\s*32\s*\)/.test(code),
    readsIndexSize:
      (code.match(/net\.ReadUInt\s*\(\s*16\s*\)/g) ?? []).length >= 2,
    ownsTransfer:
      /transfers\s*\[\s*ply\b/.test(code) &&
      /transfer\.id\s*~=\s*id/.test(code),
    indexBound,
    sizeBound: sizeBound.test(code),
    remainingBound: remainingBound.test(code),
    dupGuard:
      /transfer\.(?:received|chunks)\s*\[\s*index\s*\]\s*then\s+return/.test(
        code,
      ) || /if\s+transfer\.(?:received|chunks)\s*\[\s*index\s*\]/.test(code),
    totalBound: totalBound.test(code),
    readsData: readData.test(code),
    storesChunk: /transfer\.chunks\s*\[\s*index\s*\]\s*=\s*data/.test(code),
    tracksTotal:
      /transfer\.totalBytes\s*=\s*[^\r\n]*(?:\+\s*size|size\s*\+)/.test(code),
    lastActivity: /transfer\.lastActivity\s*=\s*CurTime\s*\(/.test(code),
  };
  const missing = Object.entries(concepts)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const boundsBeforeRead =
    before(code, sizeBound, readData) &&
    before(code, remainingBound, readData) &&
    before(code, totalBound, readData);
  const pooledBeforeReceiver = before(code, pool, receive);

  if (missing.length === 0 && boundsBeforeRead && pooledBeforeReceiver) {
    return {
      status: "pass",
      detail:
        "Authenticates transfer state and bounds indices, duplicates, chunk bytes, and aggregate bytes before storing.",
    };
  }
  // Partial only when the receiver authenticates the transfer AND bounds the
  // read somehow — an unbounded `chunks[i] = net.ReadData(size)` is incorrect.
  if (
    concepts.receiver &&
    concepts.readsData &&
    concepts.ownsTransfer &&
    (concepts.sizeBound || concepts.remainingBound || concepts.totalBound)
  ) {
    return {
      status: "partial",
      detail: `Chunk receiver is missing: ${missing.join(", ") || "correct ordering"}.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the bounded sender-owned chunk receiver.",
  };
}

/**
 * Score two-peer transfer cleanup by concept — the timeout may be written as
 * `now - lastActivity >= 30` or `lastActivity > 30`, and the peer may be a
 * local or `transfer.peer`.
 */
export function scoreTransferCleanup(response: ValidatedResponse): ScoreResult {
  const code = stripLuaComments(response.code);
  const timeout =
    /lastActivity\s*(?:>|>=)\s*30\b/.test(code) ||
    /(?:CurTime\s*\(\s*\)|now|currentTime)\s*-\s*[\w.]*lastActivity\s*(?:>|>=)\s*30\b/.test(
      code,
    ) ||
    /[\w.]*lastActivity\s*\+\s*30\s*(?:<|<=)\s*(?:CurTime\s*\(\s*\)|now|currentTime)/.test(
      code,
    );
  const concepts = {
    cancelFn: /local\s+function\s+(?:cancel|cleanup|remove)\w*\s*\(/i.test(
      code,
    ),
    disconnectHook: /hook\.Add\s*\(\s*["']PlayerDisconnected["']/.test(code),
    timer: /timer\.Create\s*\(\s*[^,]+,\s*1\s*,\s*0\s*,/.test(code),
    curTime: /CurTime\s*\(\s*\)/.test(code),
    timeout,
    iterates: /for\s+\w+\s*,\s*\w+\s+in\s+pairs\s*\(/.test(code),
    validatesPeer: /IsValid\s*\(\s*(?:transfer\.peer|peer)\s*\)/.test(code),
    notifiesPeer: /notifyCancelled\s*\(\s*(?:transfer\.peer|peer)\s*\)/.test(
      code,
    ),
    removesPeer: /transfers\s*\[\s*(?:transfer\.peer|peer)\s*\]\s*=\s*nil/.test(
      code,
    ),
    removesSelf: /transfers\s*\[\s*ply\s*\]\s*=\s*nil/.test(code),
  };
  const missing = Object.entries(concepts)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  if (missing.length === 0) {
    return {
      status: "pass",
      detail:
        "Centralizes two-peer cleanup and invokes it for disconnects and inactivity timeouts.",
    };
  }
  if (
    concepts.disconnectHook &&
    /transfers\s*\[\s*\w+\s*\]\s*=\s*nil/.test(code)
  ) {
    return {
      status: "partial",
      detail: `Cleanup is missing: ${missing.join(", ")}.`,
    };
  }
  return {
    status: "incorrect",
    detail:
      "Does not clean transfer state across disconnect and timeout paths.",
  };
}

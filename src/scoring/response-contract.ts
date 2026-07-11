import { Buffer } from "node:buffer";

import type { ResponseContract, ScoreResult } from "../core/types";

export interface ValidatedResponse {
  answer: string;
  code: string;
  reason: string;
}

function protocolError(detail: string): ScoreResult {
  return { status: "protocol_error", detail };
}

/** Count top-level loop statements (`for` / `while`). Used by fixture response contracts. */
function countCandidateLoops(code: string): number {
  return code.split(/\r?\n/).filter((line) => /^\s*(?:for|while)\b/.test(line))
    .length;
}

function hasMalformedFunctionIdentifier(code: string): boolean {
  const declarations = code.matchAll(
    /\b(?:local\s+)?function\s+([^\r\n(]+)\s*\(/g,
  );
  for (const declaration of declarations) {
    const name = declaration[1]?.trim() ?? "";
    if (!/^[A-Za-z_][\w]*(?:[.:][A-Za-z_][\w]*)*$/.test(name)) {
      return true;
    }
  }
  return false;
}

export function validateResponseContract(
  contract: ResponseContract,
  answer: string,
): ValidatedResponse | ScoreResult {
  if (Buffer.byteLength(answer, "utf8") > contract.maxAnswerBytes) {
    return protocolError(
      `Answer exceeds the ${contract.maxAnswerBytes}-byte limit.`,
    );
  }

  const match =
    /^```([^\r\n]*)\r?\n([\s\S]*?)\r?\n```\s*\r?\n([\s\S]*?)\s*$/.exec(answer);
  if (!match) {
    return protocolError(
      "Answer must contain exactly one fenced code block followed by a reason.",
    );
  }

  const fenceLanguage = match[1]?.trim();
  const code = match[2] ?? "";
  const reasonLines = (match[3] ?? "").trim().split(/\r?\n/);
  if (fenceLanguage !== contract.codeFenceLanguage) {
    return protocolError(
      `Answer must use a ${contract.codeFenceLanguage} code fence.`,
    );
  }
  if (
    reasonLines.length === 0 ||
    reasonLines.length > contract.maxReasonLines ||
    reasonLines.some((line) => line.trim().length === 0)
  ) {
    return protocolError(
      `Answer must contain 1 through ${contract.maxReasonLines} non-empty reason lines.`,
    );
  }

  const firstReason = reasonLines[0] ?? "";
  if (
    !firstReason.startsWith(contract.reasonPrefix) ||
    firstReason.slice(contract.reasonPrefix.length).trim().length === 0
  ) {
    return protocolError(
      `Answer must begin its reason with ${contract.reasonPrefix}`,
    );
  }

  const loopCount = countCandidateLoops(code);
  if (
    loopCount < contract.minCandidateLoops ||
    loopCount > contract.maxCandidateLoops
  ) {
    return protocolError(
      `Answer must contain ${contract.minCandidateLoops} through ${contract.maxCandidateLoops} candidate loops.`,
    );
  }
  if (hasMalformedFunctionIdentifier(code)) {
    return protocolError(
      "Answer contains a malformed Lua function identifier.",
    );
  }

  return { answer, code, reason: reasonLines.join("\n") };
}

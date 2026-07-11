import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

export function scoreNetEfficiency(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  if (/net\.WriteTable\s*\(|net\.Broadcast\s*\(/.test(code)) {
    return {
      status: "incorrect",
      detail:
        "Uses a generic table payload or broadcasts beyond affected recipients.",
    };
  }
  const compact =
    /net\.WriteUInt\s*\(\s*state\s*,\s*3\s*\)/.test(code) &&
    /net\.WriteUInt\s*\(\s*amount\s*,\s*10\s*\)/.test(code);
  const targeted = /net\.Send\s*\(\s*recipients\s*\)/.test(code);
  const pooled = /util\.AddNetworkString\s*\(/.test(code);
  if (compact && targeted && pooled)
    return {
      status: "pass",
      detail: "Uses bounded bit widths and targeted recipient fanout.",
    };
  if (compact && targeted)
    return {
      status: "partial",
      detail:
        "Payload and fanout are compact, but load-time pooling is not shown.",
    };
  return {
    status: "incorrect",
    detail:
      "Does not use compact typed fields with targeted net.Send recipients.",
  };
}

export function scoreNetworkVarState(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);
  if (
    /SetupDataTables\s*\(/.test(code) &&
    /:NetworkVar\s*\(\s*[^,]+,\s*[^)]+\)/.test(code) &&
    /"Int"|'Int'/.test(response.code) &&
    /"Power"|'Power'/.test(response.code)
  ) {
    return {
      status: "pass",
      detail: "Defines Power with Entity:NetworkVar in SetupDataTables.",
    };
  }
  if (/:SetNW2?Int\s*\(/.test(code))
    return {
      status: "partial",
      detail: "Uses NW/NW2 state instead of the predicted datatable primitive.",
    };
  return {
    status: "incorrect",
    detail: "Does not define the integer Power datatable variable.",
  };
}

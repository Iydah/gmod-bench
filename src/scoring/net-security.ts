import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaCommentsAndStrings } from "./code-patterns";

/**
 * Score a secured, owner-authorized net receiver by concept, not by one
 * reference implementation's exact variable names. Real DarkRP code varies
 * (CPPI vs GetOwner ownership, clamp vs reject bounds, per-player fields vs a
 * table for throttling) — all are correct and must pass.
 */
export function scoreNetSecurity(response: ValidatedResponse): ScoreResult {
  const code = stripLuaCommentsAndStrings(response.code);

  // Trusting a client-supplied caller (empty callback params) is the classic
  // exploit the wiki warns about — never authoritative.
  if (/net\.Receive\s*\([^,]+,\s*function\s*\(\s*\)/.test(code)) {
    return {
      status: "incorrect",
      detail: "Trusts a client-supplied entity as the authenticated caller.",
    };
  }

  const hasReceiver = /net\.Receive\s*\(/.test(code);
  const admin = /[:.](?:IsAdmin|IsSuperAdmin)\s*\(/.test(code);
  // Ownership: query the owner (native or CPPI) and compare to the sender.
  const ownership =
    /(?:[:.](?:GetOwner|CPPIGetOwner))\s*\([\s\S]{0,80}?(?:~=|==)/.test(code) ||
    /\bowner\w*\s*(?:~=|==)/.test(code);
  // Value bound: reject over-max OR clamp into range — both are safe. The clamp
  // subject may be a variable or an inline net.ReadUInt(...) expression.
  const valueBound =
    /(?:>|>=)\s*100\s+then\s+return/.test(code) ||
    /math\.Clamp\s*\([^,]+,\s*0\s*,\s*100\s*\)/.test(code);
  const validatesEntity = /IsValid\s*\(/.test(code);
  const appliesAction = /[:.]SetPower\s*\(/.test(code);
  // Anti-abuse: a per-player time throttle or a message-size bound before work.
  const spamBound =
    /CurTime\s*\(\s*\)/.test(code) || /\blen\s*(?:>|>=)\s*\d+/.test(code);

  const authorized = admin && ownership;
  if (
    authorized &&
    valueBound &&
    validatesEntity &&
    appliesAction &&
    spamBound
  ) {
    return {
      status: "pass",
      detail:
        "Bounds size/rate, authorizes the callback ply and entity owner, validates the entity and value.",
    };
  }
  if (hasReceiver && appliesAction && (admin || ownership)) {
    const missing = [
      admin ? "" : "admin check",
      ownership ? "" : "owner check",
      valueBound ? "" : "value bound",
      spamBound ? "" : "rate/size bound",
    ].filter(Boolean);
    return {
      status: "partial",
      detail: `Receiver applies the action but is missing: ${missing.join(", ") || "an equivalent trust-boundary check"}.`,
    };
  }
  return {
    status: "incorrect",
    detail: "Does not implement the bounded, owner-authorized receiver.",
  };
}

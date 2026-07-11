import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaComments, stripLuaCommentsAndStrings } from "./code-patterns";

interface Capability {
  name: string;
  passed: boolean;
  /** Hardening capabilities are only required for a `pass`, never for a `partial`. */
  hardening?: boolean;
  /** A capability that does not apply to this design (e.g. cleanup for a stateless shop). */
  notApplicable?: boolean;
}

/**
 * Slice from the interaction handler to end of code. GMod exposes two canonical
 * ways to react to a player pressing Use on a scripted entity/NPC:
 *   - `function ENT:Use(activator, caller)`  (base_gmodentity style)
 *   - `function ENT:AcceptInput(name, activator, caller)` guarding `name == "Use"`
 *     (base_ai style — this is what the official NPC Shop tutorial uses).
 * Accept either so the scorer measures intent, not one addon's house style.
 */
function interactionHandler(
  code: string,
  structural: string,
): { body: string; structuralBody: string; index: number } {
  const useIndex = code.search(/function\s+ENT:Use\s*\(/);
  if (useIndex >= 0) {
    return {
      body: code.slice(useIndex),
      structuralBody: structural.slice(useIndex),
      index: useIndex,
    };
  }
  const inputIndex = code.search(/function\s+ENT:AcceptInput\s*\(/);
  if (inputIndex >= 0) {
    return {
      body: code.slice(inputIndex),
      structuralBody: structural.slice(inputIndex),
      index: inputIndex,
    };
  }
  return { body: "", structuralBody: "", index: -1 };
}

function receiverBody(code: string): string {
  const start = code.search(/net\.Receive\s*\(/);
  return start < 0 ? "" : code.slice(start);
}

function beforeFirstRead(receiver: string): string {
  const read = receiver.search(/net\.Read\w*\s*\(/);
  return read < 0 ? receiver : receiver.slice(0, read);
}

/** A `local item = CATALOG[id]` server-side lookup, whether written on one line or two. */
function serverItemLookup(
  receiver: string,
): { itemVar: string; bits: number } | undefined {
  const inline = receiver.match(
    /(\w+)\s*=\s*(\w+)\s*\[\s*net\.ReadUInt\s*\(\s*(\d+)\s*\)\s*\]/,
  );
  if (inline) {
    return { itemVar: inline[1]!, bits: Number(inline[3]) };
  }
  const idRead = receiver.match(/(\w+)\s*=\s*net\.ReadUInt\s*\(\s*(\d+)\s*\)/);
  if (!idRead) return undefined;
  const idVar = idRead[1]!;
  const bits = Number(idRead[2]);
  const lookup = receiver.match(
    new RegExp(`(\\w+)\\s*=\\s*(\\w+)\\s*\\[\\s*${idVar}\\s*\\]`),
  );
  if (!lookup) return undefined;
  return { itemVar: lookup[1]!, bits };
}

/** Server re-validates the money it charges against a server-owned price. */
function checksAffordability(structuralReceiver: string): boolean {
  // `ply:canAfford(price)` is the recommended DarkRP helper (also guards < 0).
  if (/[:.]canAfford\s*\(/.test(structuralReceiver)) return true;
  // A direct money read compared to a price is equally valid.
  const money =
    /getDarkRPVar\s*\(\s*["']money["']\s*\)|[:.]getMoney\s*\(\s*\)|[:.]getDarkRPVar\s*\(\s*["']money["']\s*\)/;
  const comparison =
    /(getDarkRPVar\s*\(\s*["']money["']\s*\)|[:.]getMoney\s*\(\s*\))\s*(?:<|<=|>=|>)|(?:<|<=|>=|>)\s*[^\r\n]{0,40}?(getDarkRPVar\s*\(\s*["']money["']\s*\)|[:.]getMoney\s*\(\s*\))/;
  return money.test(structuralReceiver) && comparison.test(structuralReceiver);
}

function formatResult(capabilities: readonly Capability[]): ScoreResult {
  const applies = (capability: Capability) => !capability.notApplicable;
  const core = capabilities.filter((c) => !c.hardening && applies(c));
  const hardening = capabilities.filter((c) => c.hardening && applies(c));
  const passedCore = core.filter((c) => c.passed).map((c) => c.name);
  const missingCore = core.filter((c) => !c.passed).map((c) => c.name);
  const passedHard = hardening.filter((c) => c.passed).map((c) => c.name);
  const missingHard = hardening.filter((c) => !c.passed).map((c) => c.name);

  const detail = [
    `Core ${passedCore.length}/${core.length}: ${passedCore.join(", ") || "none"}.`,
    missingCore.length > 0
      ? `Missing core: ${missingCore.join(", ")}.`
      : "Missing core: none.",
    `Hardening ${passedHard.length}/${hardening.length}: ${passedHard.join(", ") || "none"}.`,
    missingHard.length > 0
      ? `Missing hardening: ${missingHard.join(", ")}.`
      : "Missing hardening: none.",
  ].join(" ");

  // A shop that trusts the client or misses a correctness concept is not usable.
  if (missingCore.length > 0) return { status: "incorrect", detail };
  // Correct and safe, but not production-hardened against spoofed/spam buys.
  if (missingHard.length > 0) return { status: "partial", detail };
  return { status: "pass", detail };
}

/** Score independent shop-system capabilities without exposing them in the fixture prompt. */
export function scoreShopNpc(response: ValidatedResponse): ScoreResult {
  const structural = stripLuaComments(response.code);
  const code = stripLuaCommentsAndStrings(response.code);
  const receiver = receiverBody(code);
  const structuralReceiver = receiverBody(structural);
  const preRead = beforeFirstRead(receiver);
  const handler = interactionHandler(code, structural);
  const useBody = handler.body;

  // --- Safety disqualifiers: never trust the client for identity or price. ---
  const readsEntity = /net\.ReadEntity\s*\(/.test(receiver);
  const clientPrice =
    /(?:price|cost|money|amount)\s*=\s*net\.Read\w*\s*\(/i.test(receiver);
  const broadcastsMenu = /net\.Broadcast\s*\(/.test(useBody);

  // --- Interaction: a player-guarded Use/AcceptInput handler. ---
  const handlesUse =
    handler.index >= 0 &&
    // AcceptInput must actually branch on the "Use" input.
    (/function\s+ENT:Use\s*\(/.test(code) ||
      /["']Use["']/.test(handler.structuralBody));
  const interaction = handlesUse && /[:.]IsPlayer\s*\(/.test(useBody);

  // --- Targeted open: menu goes to the interacting player, pooled at load. ---
  const firstPool = code.search(/util\.AddNetworkString\s*\(/);
  const receiveIndex = code.search(/net\.Receive\s*\(/);
  const pooledAtLoad =
    firstPool >= 0 &&
    (handler.index < 0 || firstPool < handler.index) &&
    (receiveIndex < 0 || firstPool < receiveIndex);
  const targetedOpen =
    pooledAtLoad &&
    /net\.Start\s*\(/.test(useBody) &&
    /net\.Send\s*\(/.test(useBody) &&
    !broadcastsMenu;

  // --- Server-authoritative item: compact id -> server catalog -> validated. ---
  const lookup = serverItemLookup(receiver);
  const itemVar = lookup?.itemVar;
  const serverAuthoritative =
    !readsEntity &&
    !clientPrice &&
    Boolean(lookup) &&
    (lookup?.bits ?? 99) <= 16;
  const itemValidated = Boolean(
    itemVar &&
    (new RegExp(`if\\s+not\\s+${itemVar}\\s+then`).test(receiver) ||
      new RegExp(`if\\s+${itemVar}\\s*==\\s*nil`).test(receiver) ||
      new RegExp(`${itemVar}\\s+or\\s+return`).test(receiver)),
  );

  // --- Affordability + purchase order: charge server price, then grant. ---
  const affordability = checksAffordability(structuralReceiver);
  const deduction = structuralReceiver.search(/[:.]addMoney\s*\(\s*-/);
  const grant = structuralReceiver.search(
    /[:.]Give\s*\(|\.grant\s*\(|\.apply\s*\(|\.onBuy\s*\(|\.onPurchase\s*\(|DarkRP\.createEntity\s*\(|ents\.Create\s*\(/,
  );
  const purchaseOrder = deduction >= 0 && grant > deduction;

  // --- Hardening: what makes it production-safe against a hostile client. ---
  // The BUY net message can be sent from anywhere at any time, so the server
  // must re-check proximity and throttle it — the open handler's Use proximity
  // (engine-enforced) does not cover the separate buy message.
  //
  // This tests the *security* concept (re-validate the buyer's location), not
  // the perf idiom: DistToSqr and Distance are equivalent here (a one-shot buy
  // handler — the sqrt cost is sub-nanosecond per OverlordAkise's benchmarks),
  // so accept either. The DistToSqr-vs-Distance perf idiom is its own fixture.
  const distanceCheck =
    /:(?:DistToSqr|Distance)\s*\([^\r\n]*\)\s*(?:<=|<|>=|>)/i;
  const helper = code.match(
    /local\s+function\s+(\w+)\s*\([^)]*\)[\s\S]{0,500}?:(?:DistToSqr|Distance)\s*\([^\r\n]*\)\s*(?:<=|<|>=|>)[\s\S]{0,120}?end/,
  );
  const helperName =
    helper && distanceCheck.test(helper[0]) ? helper[1] : undefined;
  // Must be re-checked in the buy receiver — the Use handler's proximity is
  // engine-enforced and does not cover the separately-sendable buy packet.
  const helperCalledInBuyPath = helperName
    ? new RegExp(`\\b${helperName}\\s*\\(`).test(receiver)
    : false;
  const directDistanceInReceiver = receiver
    .split(/\r?\n/)
    .some((line) => distanceCheck.test(line));
  const proximity = helperCalledInBuyPath || directDistanceInReceiver;

  const firstRead = receiver.search(/net\.Read\w*\s*\(/);
  const counter = "(?:count|tokens|attempts|requests|calls|uses|n)";
  const budgetState = preRead.match(
    new RegExp(`local\\s+(\\w+)\\s*=\\s*\\w+\\s*\\[\\s*\\w+\\s*\\]`),
  );
  const budgetVar = budgetState?.[1];
  const limitCheck = budgetVar
    ? preRead.search(
        new RegExp(
          `${budgetVar}\\.${counter}\\s*>=?\\s*\\w+\\s*then\\s*return`,
        ),
      )
    : -1;
  const increment = budgetVar
    ? preRead.search(
        new RegExp(
          `${budgetVar}\\.${counter}\\s*=\\s*${budgetVar}\\.${counter}\\s*\\+\\s*1`,
        ),
      )
    : -1;
  const rateLimit =
    Boolean(budgetVar) &&
    /CurTime\s*\(\s*\)/.test(preRead) &&
    limitCheck >= 0 &&
    increment > limitCheck &&
    (firstRead < 0 || increment < firstRead);

  const payloadBound = /\blen\s*(?:==|~=|<=|<|>|>=)\s*\d+/.test(preRead);

  // --- Lifecycle cleanup: only required when the shop keeps per-player state. ---
  const sessionAssign = useBody.match(/(\w+)\s*\[\s*\w+\s*\]\s*=\s*\{/);
  const sessionTable = sessionAssign?.[1];
  const stateful = Boolean(sessionTable) || Boolean(budgetVar);
  const disconnectCleanup =
    /hook\.Add\s*\([^)]*PlayerDisconnected[\s\S]{0,600}?\[\s*\w+\s*\]\s*=\s*nil/.test(
      structural,
    );

  const capabilities: Capability[] = [
    { name: "interaction", passed: interaction },
    { name: "targeted-open", passed: targetedOpen },
    { name: "server-authoritative", passed: serverAuthoritative },
    { name: "item-validation", passed: itemValidated },
    { name: "affordability", passed: affordability },
    { name: "purchase-order", passed: purchaseOrder },
    { name: "no-client-authority", passed: !readsEntity && !clientPrice },
    { name: "no-broadcast-menu", passed: !broadcastsMenu },
    { name: "proximity", passed: proximity, hardening: true },
    { name: "rate-limit", passed: rateLimit, hardening: true },
    { name: "payload-bound", passed: payloadBound, hardening: true },
    {
      name: "lifecycle-cleanup",
      passed: disconnectCleanup,
      hardening: true,
      notApplicable: !stateful,
    },
  ];

  return formatResult(capabilities);
}

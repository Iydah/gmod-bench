import type { ScoreResult } from "../core/types";
import type { ValidatedResponse } from "./response-contract";
import { stripLuaComments, stripLuaCommentsAndStrings } from "./code-patterns";

interface Capability {
  name: string;
  passed: boolean;
}

function functionBody(code: string, name: string): string {
  const start = code.search(
    new RegExp(`function\\s+${name.replace(".", "\\.")}\\s*\\(`),
  );
  return start < 0 ? "" : code.slice(start);
}

function receiverBody(code: string): string {
  const start = code.search(/net\.Receive\s*\(/);
  return start < 0 ? "" : code.slice(start);
}

function beforeFirstRead(receiver: string): string {
  const read = receiver.search(/net\.Read\w*\s*\(/);
  return read < 0 ? receiver : receiver.slice(0, read);
}

function formatResult(
  capabilities: readonly Capability[],
  unsafe: string[],
): ScoreResult {
  const passed = capabilities
    .filter((capability) => capability.passed)
    .map(({ name }) => name);
  const missing = capabilities
    .filter((capability) => !capability.passed)
    .map(({ name }) => name);
  const detail = [
    `Passed ${passed.length}/${capabilities.length}: ${passed.join(", ") || "none"}.`,
    missing.length > 0 ? `Missing: ${missing.join(", ")}.` : "Missing: none.",
    unsafe.length > 0 ? `Unsafe: ${unsafe.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (unsafe.length > 0 || passed.length < 6)
    return { status: "incorrect", detail };
  if (missing.length > 0) return { status: "partial", detail };
  return { status: "pass", detail };
}

/** Score independent shop-system capabilities without exposing them in the fixture prompt. */
export function scoreShopNpc(response: ValidatedResponse): ScoreResult {
  const structural = stripLuaComments(response.code);
  const code = stripLuaCommentsAndStrings(response.code);
  const receiver = receiverBody(code);
  const receiverStructural = receiverBody(structural);
  const preRead = beforeFirstRead(receiver);
  const useBody = functionBody(code, "ENT:Use");

  const callback = receiver.match(
    /net\.Receive\s*\([^,]+,\s*function\s*\(\s*(\w+)\s*,\s*(\w+)\s*\)/,
  );
  const sender = callback?.[2] ?? "ply";
  const useState = useBody.match(/(\w+)\s*\[\s*(\w+)\s*\]\s*=\s*\{[^}]*\}/);
  const sessionTable = useState?.[1];
  const sessionUsed = sessionTable
    ? new RegExp(`\\b${sessionTable}\\s*\\[\\s*${sender}\\s*\\]`).test(receiver)
    : false;

  const squaredThreshold =
    /:DistToSqr\s*\([^\r\n]*\)\s*(?:<=|<)\s*(?:\w*(?:sqr|squared)\w*|\w+\s*\*\s*\w+|\d+\s*\*\s*\d+)/i;
  const helper = code.match(
    /local\s+function\s+(\w+)\s*\([^)]*\)[\s\S]{0,500}?:DistToSqr\s*\([^\r\n]*\)\s*(?:<=|<)[\s\S]{0,100}?end/,
  );
  const helperUsesSquaredThreshold = Boolean(
    helper && squaredThreshold.test(helper[0]),
  );
  const helperName = helperUsesSquaredThreshold ? helper?.[1] : undefined;
  const distanceCalls = helperName
    ? (response.code.match(new RegExp(`\\b${helperName}\\s*\\(`, "g"))
        ?.length ?? 0)
    : 0;
  const directDistanceChecks = code
    .split(/\r?\n/)
    .filter((line) => squaredThreshold.test(line)).length;

  const firstRead = receiver.search(/net\.Read\w*\s*\(/);
  const budgetState = preRead.match(
    new RegExp(`local\\s+(\\w+)\\s*=\\s*\\w+\\s*\\[\\s*${sender}\\s*\\]`),
  );
  const budgetVar = budgetState?.[1];
  const limitCheck = budgetVar
    ? preRead.search(
        new RegExp(
          `${budgetVar}\\.(?:count|tokens|attempts|requests)\\s*>=?\\s*\\w+\\s*then\\s*return`,
        ),
      )
    : -1;
  const increment = budgetVar
    ? preRead.search(
        new RegExp(
          `${budgetVar}\\.(?:count|tokens|attempts|requests)\\s*=\\s*${budgetVar}\\.(?:count|tokens|attempts|requests)\\s*\\+\\s*1`,
        ),
      )
    : -1;
  const perPlayerBudget =
    Boolean(budgetVar) &&
    /CurTime\s*\(\s*\)/.test(preRead) &&
    limitCheck >= 0 &&
    increment > limitCheck &&
    (firstRead < 0 || increment < firstRead);

  const itemRead = receiver.match(
    /(\w+)\s*=\s*(\w+)\s*\[\s*net\.ReadUInt\s*\(\s*(\d+)\s*\)\s*\]/,
  );
  const itemVar = itemRead?.[1];
  const priceVar = receiver.match(/local\s+(\w+)\s*=\s*(\w+)\.price/);
  const price = priceVar?.[1];
  const grantCall = itemVar
    ? receiver.search(
        new RegExp(`\\b${itemVar}\\.grant\\s*\\(\\s*${sender}\\s*\\)`),
      )
    : -1;
  const deduction = price
    ? receiver.search(
        new RegExp(`\\b${sender}:addMoney\\s*\\(\\s*-\\s*${price}\\s*\\)`),
      )
    : -1;

  const readsEntity = /net\.ReadEntity\s*\(/.test(receiver);
  const clientPrice = /(?:price|cost|money)\s*=\s*net\.Read\w*\s*\(/i.test(
    receiver,
  );
  const broadcastsMenu = /net\.Broadcast\s*\(/.test(useBody);
  const firstPool = code.search(/util\.AddNetworkString\s*\(/);
  const useIndex = code.search(/function\s+ENT:Use\s*\(/);
  const receiveIndex = code.search(/net\.Receive\s*\(/);
  const pooledAtLoad =
    firstPool >= 0 &&
    useIndex >= 0 &&
    receiveIndex >= 0 &&
    firstPool < useIndex &&
    firstPool < receiveIndex;
  const disconnectCleanup = sessionTable
    ? new RegExp(
        `hook\\.Add\\s*\\([^)]*PlayerDisconnected[\\s\\S]{0,500}?${sessionTable}\\s*\\[\\s*\\w+\\s*\\]\\s*=\\s*nil`,
      ).test(structural)
    : false;
  const entityCleanup = sessionTable
    ? new RegExp(
        `hook\\.Add\\s*\\([^)]*EntityRemoved[\\s\\S]{0,800}?pairs\\s*\\(\\s*${sessionTable}\\s*\\)[\\s\\S]{0,500}?${sessionTable}\\s*\\[\\s*\\w+\\s*\\]\\s*=\\s*nil`,
      ).test(structural)
    : false;
  const unsafe = [
    readsEntity || clientPrice ? "client-authority" : "",
    broadcastsMenu ? "broadcast-menu" : "",
  ].filter(Boolean);

  const capabilities: Capability[] = [
    {
      name: "interaction",
      passed:
        /function\s+ENT:Use\s*\(/.test(code) &&
        /:IsPlayer\s*\(/.test(useBody) &&
        Boolean(sessionTable && sessionUsed),
    },
    {
      name: "callback-player",
      passed: Boolean(callback && new RegExp(`\\b${sender}\\b`).test(receiver)),
    },
    {
      name: "client-authority",
      passed: !readsEntity && !clientPrice && Boolean(itemRead),
    },
    {
      name: "payload-bound",
      passed: /\blen\s*(?:==|~=|<=|<|>|>=)\s*\d+/.test(preRead),
    },
    {
      name: "distance",
      passed: distanceCalls >= 3 || directDistanceChecks >= 2,
    },
    {
      name: "session-expiry",
      passed:
        /CurTime\s*\(\s*\)\s*\+\s*(?:\w+|\d+)/.test(useBody) &&
        /(?:expires|expiry|expire|validUntil|timeout)\w*\s*(?:<|>|<=|>=)\s*(?:now|CurTime\s*\(\s*\))|(?:now|CurTime\s*\(\s*\))\s*(?:<|>|<=|>=)\s*[\w.]*(?:expires|expiry|expire|validUntil|timeout)/i.test(
          receiver,
        ),
    },
    { name: "rate-limit", passed: perPlayerBudget },
    {
      name: "server-catalog",
      passed:
        Boolean(itemRead) &&
        Number(itemRead?.[3]) <= 16 &&
        Boolean(
          itemVar &&
          new RegExp(`isfunction\\s*\\(\\s*${itemVar}\\.grant\\s*\\)`).test(
            receiver,
          ),
        ) &&
        Boolean(
          itemVar &&
          new RegExp(`if\\s+not\\s+${itemVar}\\s+then\\s+return`).test(
            receiver,
          ),
        ),
    },
    {
      name: "affordability",
      passed: Boolean(
        price &&
        new RegExp(
          `getDarkRPVar\\s*\\([^)]*\\)\\s*<\\s*${price}\\s+then\\s+return`,
        ).test(receiverStructural),
      ),
    },
    {
      name: "purchase-order",
      passed: deduction >= 0 && grantCall > deduction,
    },
    {
      name: "targeted-networking",
      passed:
        pooledAtLoad &&
        /net\.Start\s*\(/.test(useBody) &&
        /net\.Send\s*\(/.test(useBody) &&
        !broadcastsMenu,
    },
    {
      name: "lifecycle-compatibility",
      passed:
        /SetUseType\s*\(\s*SIMPLE_USE\s*\)/.test(code) &&
        disconnectCleanup &&
        entityCleanup &&
        Boolean(
          sessionTable &&
          new RegExp(`${sessionTable}\\s*\\[`).test(receiverStructural),
        ),
    },
  ];

  return formatResult(capabilities, unsafe);
}

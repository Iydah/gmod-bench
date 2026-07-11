import { expect, test } from "bun:test";

import {
  applyQuarantineUpdates,
  clearQuarantine,
  emptyQuarantineStore,
  filterQuarantinedModels,
  isModelQuarantined,
  isNoResponseAttempt,
  planQuarantineFromAttempts,
  pruneExpiredQuarantine,
  quarantineModelKey,
} from "../src/core/model-quarantine";
import type { AttemptRecord } from "../src/core/types";

function attempt(
  partial: Partial<AttemptRecord> & Pick<AttemptRecord, "model" | "status">,
): AttemptRecord {
  return {
    fixtureId: "gmod.x.v1",
    adapterId: "openrouter",
    attemptIndex: 1,
    detail: "x",
    finalResponse: null,
    durationMs: 1,
    version: "openrouter-api",
    ...partial,
  };
}

test("quarantine keys strip @effort slots", () => {
  expect(quarantineModelKey("openai/gpt-oss-20b:free@high")).toBe(
    "openai/gpt-oss-20b:free",
  );
});

test("no-response means empty final text with transport/protocol failure", () => {
  expect(
    isNoResponseAttempt(
      attempt({
        model: "a:free",
        status: "protocol_error",
        finalResponse: null,
      }),
    ),
  ).toBeTrue();
  expect(
    isNoResponseAttempt(
      attempt({ model: "a:free", status: "timeout", finalResponse: null }),
    ),
  ).toBeTrue();
  expect(
    isNoResponseAttempt(
      attempt({
        model: "a:free",
        status: "incorrect",
        finalResponse: "```lua\nx\n```\nReason: y",
      }),
    ),
  ).toBeFalse();
  expect(
    isNoResponseAttempt(
      attempt({
        model: "a:free",
        status: "protocol_error",
        finalResponse: "malformed but present",
      }),
    ),
  ).toBeFalse();
  // Oversize answer still returned tokens — not a dead endpoint
  expect(
    isNoResponseAttempt(
      attempt({
        model: "a:free",
        status: "protocol_error",
        finalResponse: null,
        usage: { promptTokens: 10, completionTokens: 500 },
      }),
    ),
  ).toBeFalse();
});

test("plans 7-day quarantine only for free models with zero text answers", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  const attempts: AttemptRecord[] = [
    attempt({
      model: "dead/model:free",
      status: "protocol_error",
      fixtureId: "a",
    }),
    attempt({
      model: "dead/model:free",
      status: "protocol_error",
      fixtureId: "b",
    }),
    attempt({ model: "dead/model:free", status: "timeout", fixtureId: "c" }),
    attempt({
      model: "alive/model:free",
      status: "protocol_error",
      fixtureId: "a",
    }),
    attempt({
      model: "alive/model:free",
      status: "partial",
      fixtureId: "b",
      finalResponse:
        "```lua\nfor _ in player.Iterator() do end\n```\nReason: ok",
    }),
    attempt({ model: "paid/model", status: "protocol_error", fixtureId: "a" }),
    attempt({ model: "paid/model", status: "protocol_error", fixtureId: "b" }),
    attempt({ model: "paid/model", status: "protocol_error", fixtureId: "c" }),
    attempt({ model: "sparse:free", status: "protocol_error", fixtureId: "a" }),
  ];

  const updates = planQuarantineFromAttempts(attempts, {
    runId: "run-1",
    now,
    minAttempts: 3,
  });
  expect(updates.map((u) => u.modelId)).toEqual(["dead/model:free"]);
  expect(Date.parse(updates[0]!.entry.until)).toBe(
    Date.parse("2026-07-17T12:00:00.000Z"),
  );
});

test("filter skips quarantined free models and keeps paid", () => {
  const store = emptyQuarantineStore();
  applyQuarantineUpdates(store, [
    {
      modelId: "dead/model:free",
      entry: {
        until: "2099-01-01T00:00:00.000Z",
        reason: "dead",
        quarantinedAt: "2026-07-10T00:00:00.000Z",
      },
    },
  ]);

  const { kept, skipped } = filterQuarantinedModels(
    [
      "dead/model:free",
      "dead/model:free@high",
      "ok/model:free",
      "openai/gpt-4o-mini",
    ],
    store,
    new Date("2026-07-10T00:00:00.000Z"),
  );

  expect(skipped.map((s) => s.model)).toEqual([
    "dead/model:free",
    "dead/model:free@high",
  ]);
  expect(kept).toEqual(["ok/model:free", "openai/gpt-4o-mini"]);
  expect(isModelQuarantined(store, "dead/model:free@low")).toBeTrue();
});

test("prune and clear remove entries", () => {
  const store = emptyQuarantineStore();
  store.entries["old:free"] = {
    until: "2000-01-01T00:00:00.000Z",
    reason: "expired",
    quarantinedAt: "1999-01-01T00:00:00.000Z",
  };
  store.entries["keep:free"] = {
    until: "2099-01-01T00:00:00.000Z",
    reason: "active",
    quarantinedAt: "2026-07-10T00:00:00.000Z",
  };

  expect(
    pruneExpiredQuarantine(store, new Date("2026-07-10T00:00:00.000Z")),
  ).toBe(1);
  expect(store.entries["old:free"]).toBeUndefined();
  expect(clearQuarantine(store, "keep:free")).toBe(1);
  expect(Object.keys(store.entries)).toHaveLength(0);
});

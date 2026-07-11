import { describe, expect, test } from "bun:test";

import {
  buildVerifiedRanking,
  type VerifiedAttempt,
} from "../src/report/verified-ranking";

function attempt(
  runId: string,
  fixtureId: string,
  status: VerifiedAttempt["status"],
  finalResponse: string | null = status === "protocol_error" ? null : "answer",
): VerifiedAttempt {
  return {
    runId,
    fixtureId,
    adapterId: "codex",
    model: "model@high",
    status,
    finalResponse,
  };
}

describe("verified ranking", () => {
  test("averages verified runs within each fixture before weighting fixtures", () => {
    const rows = buildVerifiedRanking(
      [
        attempt("old", "a", "incorrect"),
        attempt("new", "a", "pass"),
        attempt("new", "b", "pass"),
      ],
      new Map([["codex\0model@high", new Set(["a", "b"])]]),
    );

    expect(rows[0]).toMatchObject({
      fixtureScore: 0.75,
      evidenceAttempts: 3,
      scheduledAttempts: 3,
      verifiedRunCount: 2,
      fixtureCoverage: 1,
    });
  });

  test("excludes harness failures but counts malformed model output as zero", () => {
    const rows = buildVerifiedRanking(
      [
        attempt("one", "a", "pass"),
        attempt("two", "a", "protocol_error", null),
        attempt("one", "b", "partial"),
        attempt("two", "b", "protocol_error", "not strict"),
        attempt("one", "c", "timeout", null),
        attempt("two", "c", "protocol_error", "(from log; body not captured)"),
      ],
      new Map([["codex\0model@high", new Set(["a", "b", "c"])]]),
    );

    expect(rows[0]).toMatchObject({
      fixtureScore: 0.625,
      evidenceAttempts: 3,
      scheduledAttempts: 6,
      harnessFailures: 3,
      modelFormatFailures: 1,
      fixtureCoverage: 2 / 3,
    });
  });

  test("returns bounded uncertainty and retains low-coverage evidence", () => {
    const rows = buildVerifiedRanking(
      [attempt("one", "a", "pass")],
      new Map([["codex\0model@high", new Set(["a", "b", "c", "d"])]]),
    );

    expect(rows[0]!.scoreIntervalLow).toBeGreaterThanOrEqual(0);
    expect(rows[0]!.scoreIntervalHigh).toBeLessThanOrEqual(1);
    expect(rows[0]!.scoreIntervalLow).toBeLessThan(rows[0]!.fixtureScore);
    expect(rows[0]!.fixtureCoverage).toBe(0.25);
  });
});

import { expect, test } from "bun:test";

import type { AttemptRecord } from "../src/core/types";
import {
  parseResumeArtifact,
  selectCompatibleAttempts,
  type ExpectedAttemptIdentity,
} from "../src/run/resume";

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    fixtureId: "gmod.player-iterator.v1",
    adapterId: "openrouter",
    model: "openai/gpt-4o-mini",
    attemptIndex: 1,
    status: "pass",
    detail: "ok",
    finalResponse: "answer",
    durationMs: 10,
    version: "api",
    fixtureVersion: 1,
    rubricVersion: "1",
    promptHash: "abc",
    ...overrides,
  };
}

test("resume parser rejects hostile and malformed attempts", () => {
  const hostile = {
    schemaVersion: 3,
    attempts: [{ ...attempt(), adapterId: "../../outside" }],
  };
  expect(() => parseResumeArtifact(hostile)).toThrow("adapterId");
  expect(() =>
    parseResumeArtifact({
      schemaVersion: 3,
      attempts: [{ ...attempt(), attemptIndex: -1 }],
    }),
  ).toThrow("attemptIndex");
  expect(() =>
    parseResumeArtifact({
      schemaVersion: 3,
      attempts: [{ ...attempt(), rawOutput: { stdout: 1 } }],
    }),
  ).toThrow("rawOutput");
});

test("resume selection excludes out-of-schedule attempts", () => {
  const expected: ExpectedAttemptIdentity[] = [
    {
      fixtureId: "gmod.player-iterator.v1",
      adapterId: "openrouter",
      model: "openai/gpt-4o-mini",
      attemptIndex: 1,
      fixtureVersion: 1,
      rubricVersion: "1",
      promptHash: "abc",
    },
  ];
  const selected = selectCompatibleAttempts(
    [
      attempt(),
      attempt({ fixtureId: "gmod.other.v1" }),
      attempt({ adapterId: "claude", model: "sonnet" }),
    ],
    expected,
  );
  expect(selected).toEqual([attempt()]);
});

test("resume selection rejects provenance drift for a matching slot", () => {
  const expected: ExpectedAttemptIdentity[] = [
    {
      fixtureId: "gmod.player-iterator.v1",
      adapterId: "openrouter",
      model: "openai/gpt-4o-mini",
      attemptIndex: 1,
      fixtureVersion: 2,
      rubricVersion: "2",
      promptHash: "def",
    },
  ];
  expect(() => selectCompatibleAttempts([attempt()], expected)).toThrow(
    "provenance",
  );
});

import { expect, test } from "bun:test";

import { scoreFixtureAnswer } from "../src/scoring";
import type { BenchmarkFixture } from "../src/core/types";

const genericFixture: BenchmarkFixture = {
  id: "gmod.generic-example.v1",
  version: 1,
  title: "Generic example",
  prompt: "Question",
  responseContract: {
    codeFenceLanguage: "lua",
    reasonPrefix: "Reason:",
    maxReasonLines: 1,
    minCandidateLoops: 1,
    maxCandidateLoops: 1,
    maxAnswerBytes: 2048,
  },
  oracle: {
    expectedPrimitive: "native.iterator",
    sourceUrls: ["https://example.test"],
    verifiedAt: "2026-07-10",
    rubricVersion: "1",
  },
  scoring: {
    kind: "regex",
    passPatterns: ["native\\.iterator"],
    partialPatterns: ["fallback\\.iterator"],
    incorrectPatterns: ["deprecated\\.iterator"],
  },
};

function response(code: string): string {
  return [
    "```lua",
    code,
    "```",
    "Reason: This is the required replacement.",
  ].join("\n");
}

test("scores future regex fixtures without registering new production code", () => {
  expect(
    scoreFixtureAnswer(
      genericFixture,
      response("for _, item in native.iterator() do\nend"),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      genericFixture,
      response("for _, item in fallback.iterator() do\nend"),
    ).status,
  ).toBe("partial");
  expect(
    scoreFixtureAnswer(
      genericFixture,
      response("for _, item in deprecated.iterator() do\nend"),
    ).status,
  ).toBe("incorrect");
});

test("regex patterns match code only, not the reason line", () => {
  const sneaky: BenchmarkFixture = {
    ...genericFixture,
    scoring: {
      kind: "regex",
      passPatterns: ["native\\.iterator"],
      partialPatterns: [],
      incorrectPatterns: [],
    },
  };

  // Reason mentions the pass phrase but code does not — must not pass.
  const answer = [
    "```lua",
    "for _, item in other() do",
    "end",
    "```",
    "Reason: use native.iterator always",
  ].join("\n");
  expect(scoreFixtureAnswer(sneaky, answer).status).toBe("incorrect");
});

test("regex fixtures ignore API names that appear only in Lua comments", () => {
  const answerWithComparisonComment = response(
    [
      "-- deprecated.iterator() is the slower comparison",
      "for _, item in native.iterator() do",
      "end",
    ].join("\n"),
  );

  expect(
    scoreFixtureAnswer(genericFixture, answerWithComparisonComment).status,
  ).toBe("pass");
});

test("regex fixtures pass a correct solution that also demonstrates the slower comparison", () => {
  const comparison = response(
    [
      "local slower = deprecated.iterator()",
      "for _, item in native.iterator() do",
      "end",
    ].join("\n"),
  );

  expect(scoreFixtureAnswer(genericFixture, comparison).status).toBe("pass");
});

test("enforces the declared response contract before regex classification", () => {
  const multipleCandidates = response(
    [
      "for _, item in native.iterator() do",
      "end",
      "for _, item in native.iterator() do",
      "end",
    ].join("\n"),
  );

  expect(
    scoreFixtureAnswer(genericFixture, "Use native.iterator.").status,
  ).toBe("protocol_error");
  expect(scoreFixtureAnswer(genericFixture, multipleCandidates).status).toBe(
    "protocol_error",
  );
});

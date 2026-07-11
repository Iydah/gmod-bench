import { expect, test } from "bun:test";

import {
  estimateTokensFromText,
  estimateUsageFromTexts,
  hashPrompt,
  utf8Bytes,
} from "../src/core/attempt-meta";

test("estimates tokens with chars/4 heuristic", () => {
  expect(estimateTokensFromText("")).toBe(0);
  expect(estimateTokensFromText("abcd")).toBe(1);
  expect(estimateTokensFromText("abcdefgh")).toBe(2);
  expect(estimateTokensFromText("abc")).toBe(1);
});

test("estimateUsageFromTexts marks source estimated", () => {
  const usage = estimateUsageFromTexts("prompt text here!!", "answer body");
  expect(usage.source).toBe("estimated");
  expect(usage.promptTokens).toBeGreaterThan(0);
  expect(usage.completionTokens).toBeGreaterThan(0);
  expect(usage.totalTokens).toBe(
    (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
  );

  const emptyAnswer = estimateUsageFromTexts("hello", null);
  expect(emptyAnswer.completionTokens).toBe(0);
  expect(emptyAnswer.totalTokens).toBe(emptyAnswer.promptTokens);
});

test("utf8Bytes counts multi-byte characters", () => {
  expect(utf8Bytes("a")).toBe(1);
  expect(utf8Bytes("é")).toBe(2);
  expect(utf8Bytes("你好")).toBe(6);
});

test("hashPrompt is stable and short", () => {
  const a = hashPrompt("same prompt");
  const b = hashPrompt("same prompt");
  const c = hashPrompt("other");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a).toHaveLength(16);
});

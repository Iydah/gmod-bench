import { expect, test } from "bun:test";

import {
  expandFreeModelsWithReasoning,
  expandModelToReasoningSlots,
  parseModelSlot,
} from "../src/adapters/openrouter-slots";
import { expandOpenRouterModelList } from "../src/adapters/openrouter-models";
import {
  OPENROUTER_DEFAULT_MAX_TOKENS,
  OPENROUTER_REASONING_MAX_TOKENS,
  buildOpenRouterRequestBody,
} from "../src/adapters/openrouter";

test("parses model@effort slots", () => {
  expect(parseModelSlot("openai/gpt-oss-20b:free@high")).toEqual({
    slotId: "openai/gpt-oss-20b:free@high",
    modelId: "openai/gpt-oss-20b:free",
    reasoningEffort: "high",
  });
  expect(parseModelSlot("openai/gpt-oss-20b:free").modelId).toBe(
    "openai/gpt-oss-20b:free",
  );
});

test("expands mandatory reasoning models into all efforts", () => {
  const slots = expandModelToReasoningSlots("openai/gpt-oss-20b:free", {
    mandatory: true,
    supported_efforts: ["high", "medium", "low"],
    default_effort: "medium",
  });
  expect(slots.map((slot) => slot.slotId)).toEqual([
    "openai/gpt-oss-20b:free@high",
    "openai/gpt-oss-20b:free@medium",
    "openai/gpt-oss-20b:free@low",
  ]);
});

test("free list expansion includes effort slots", () => {
  const freeSlots = expandFreeModelsWithReasoning([
    {
      id: "openai/gpt-oss-20b:free",
      reasoning: { supported_efforts: ["high", "low"] },
    },
    { id: "meta-llama/llama-3.2-3b-instruct:free" },
  ]);
  expect(freeSlots.map((slot) => slot.slotId)).toEqual([
    "openai/gpt-oss-20b:free@high",
    "openai/gpt-oss-20b:free@low",
    "meta-llama/llama-3.2-3b-instruct:free",
  ]);

  const expanded = expandOpenRouterModelList([":free"], freeSlots);
  expect(expanded).toContain("openai/gpt-oss-20b:free@high");
  expect(expanded).toContain("meta-llama/llama-3.2-3b-instruct:free");
});

test("reasoning slots raise max_tokens and set reasoning.exclude", () => {
  const body = buildOpenRouterRequestBody({
    prompt: "q",
    model: "openai/gpt-oss-20b:free@high",
    maxAnswerBytes: 2048,
    runId: "r1",
  });
  expect(body.model).toBe("openai/gpt-oss-20b:free");
  expect(body.max_tokens).toBe(OPENROUTER_REASONING_MAX_TOKENS);
  expect(body.reasoning).toEqual({ effort: "high", exclude: true });
  expect(body.session_id).toContain("@high");

  const plain = buildOpenRouterRequestBody({
    prompt: "q",
    model: "meta-llama/llama-3.2-3b-instruct:free",
    maxAnswerBytes: 2048,
  });
  expect(plain.max_tokens).toBe(OPENROUTER_DEFAULT_MAX_TOKENS);
  expect(plain.reasoning).toBeUndefined();
});

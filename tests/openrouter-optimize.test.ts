import { expect, test } from "bun:test";

import {
  OPENROUTER_BENCHMARK_SEED,
  OPENROUTER_SYSTEM_PROMPT,
  buildOpenRouterHeaders,
  buildOpenRouterRequestBody,
  openrouterAdapter,
} from "../src/adapters/openrouter";
import {
  extractOpenRouterUsage,
  parseOpenRouterResponse,
} from "../src/adapters/trace/openrouter";

test("OpenRouter body uses plain string messages, seed, and sticky session", () => {
  const body = buildOpenRouterRequestBody({
    prompt: "fixture question",
    model: "meta-llama/llama-3.2-3b-instruct:free",
    maxAnswerBytes: 2048,
    runId: "run-abc",
  });

  expect(body.temperature).toBe(0);
  expect(body.top_p).toBe(1);
  expect(body.seed).toBe(OPENROUTER_BENCHMARK_SEED);
  expect(body.stream).toBe(false);
  expect(body.cache_control).toBeUndefined();
  expect(body.session_id).toBe(
    "gmod-bench:run-abc:meta-llama/llama-3.2-3b-instruct:free",
  );
  expect(body.reasoning).toBeUndefined();
  expect(body.provider).toEqual({ allow_fallbacks: true, sort: "throughput" });

  const messages = body.messages as Array<Record<string, unknown>>;
  expect(messages).toEqual([
    { role: "system", content: OPENROUTER_SYSTEM_PROMPT },
    { role: "user", content: "fixture question" },
  ]);
  // System prompt must not name GMod APIs or oracles.
  expect(OPENROUTER_SYSTEM_PROMPT).not.toMatch(
    /Iterator|GetAll|IsValid|hook\.Add|net\.Receive/i,
  );
  expect(OPENROUTER_SYSTEM_PROMPT).not.toMatch(/Garry|GMod/i);
});

test("omits sampling fields when supported_parameters excludes them", () => {
  const body = buildOpenRouterRequestBody(
    {
      prompt: "q",
      model: "openai/gpt-oss-20b:free@low",
      maxAnswerBytes: 100,
      supportedParameters: ["max_tokens", "reasoning", "reasoning_effort"],
    },
    { reasoningEffort: "low" },
  );
  expect(body.temperature).toBeUndefined();
  expect(body.top_p).toBeUndefined();
  expect(body.seed).toBeUndefined();
  expect(body.reasoning).toEqual({ effort: "low", exclude: true });
});

test("OpenRouter headers enable edge response caching", () => {
  const headers = buildOpenRouterHeaders();
  expect(headers["X-OpenRouter-Cache"]).toBe("true");
  expect(headers["X-OpenRouter-Cache-TTL"]).toBe("3600");
  expect(headers["X-OpenRouter-Title"]).toBe("gmod-bench");

  const noCache = buildOpenRouterHeaders({ responseCache: false });
  expect(noCache["X-OpenRouter-Cache"]).toBe("false");
});

test("adapter request wires optimizations end-to-end", () => {
  const request = openrouterAdapter.buildRequest({
    prompt: "q",
    model: "openai/gpt-oss-20b:free",
    maxAnswerBytes: 100,
    runId: "parent-1",
  });
  const body = JSON.parse(request.body) as Record<string, unknown>;
  expect(body.session_id).toContain("parent-1");
  expect(request.headers["X-OpenRouter-Cache"]).toBe("true");
  expect(body.tools).toBeUndefined();
  expect(body.plugins).toBeUndefined();
});

test("parses usage including cached prompt tokens", () => {
  const parsed = parseOpenRouterResponse(
    200,
    JSON.stringify({
      id: "gen-123",
      choices: [
        {
          message: { role: "assistant", content: "```lua\nx\n```\nReason: y" },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        cost: 0,
        prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 20 },
      },
    }),
  );

  expect(parsed.status).toBe("complete");
  expect(parsed.usage).toEqual({
    source: "provider",
    generationId: "gen-123",
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    cost: 0,
    cachedTokens: 80,
    cacheWriteTokens: 20,
  });
  expect(
    extractOpenRouterUsage({ id: "x", usage: { prompt_tokens: 1 } })
      ?.promptTokens,
  ).toBe(1);
});

test("parses reasoning tokens, cost_details, finish reasons, and provider model", () => {
  const parsed = parseOpenRouterResponse(
    200,
    JSON.stringify({
      id: "gen-456",
      model: "google/gemini-2.5-pro",
      choices: [
        {
          finish_reason: "stop",
          native_finish_reason: "STOP",
          message: { role: "assistant", content: "```lua\nx\n```\nReason: y" },
        },
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 200,
        total_tokens: 250,
        cost: 0.0012,
        cost_details: { upstream_inference_cost: 0.001 },
        completion_tokens_details: { reasoning_tokens: 180 },
        prompt_tokens_details: { cached_tokens: 10, audio_tokens: 0 },
      },
    }),
  );

  expect(parsed.status).toBe("complete");
  expect(parsed.usage).toMatchObject({
    source: "provider",
    generationId: "gen-456",
    providerModel: "google/gemini-2.5-pro",
    promptTokens: 50,
    completionTokens: 200,
    totalTokens: 250,
    reasoningTokens: 180,
    cachedTokens: 10,
    audioTokens: 0,
    cost: 0.0012,
    upstreamInferenceCost: 0.001,
    finishReason: "stop",
    nativeFinishReason: "STOP",
  });
});

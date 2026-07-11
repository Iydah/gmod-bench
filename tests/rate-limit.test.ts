import { expect, test } from "bun:test";

import {
  OPENROUTER_FREE_RPD_HIGH,
  OPENROUTER_FREE_RPD_LOW,
  OPENROUTER_FREE_RPM,
  isOpenRouterFreeModelId,
  parseOpenRouterKeyResponse,
  planOpenRouterLimits,
} from "../src/adapters/openrouter-limits";
import { SlidingWindowRateLimiter } from "../src/core/rate-limit";

test("detects :free model ids including effort slots", () => {
  expect(
    isOpenRouterFreeModelId("meta-llama/llama-3.2-3b-instruct:free"),
  ).toBeTrue();
  expect(isOpenRouterFreeModelId("openai/gpt-oss-20b:free@high")).toBeTrue();
  expect(isOpenRouterFreeModelId("openai/gpt-4o-mini")).toBeFalse();
});

test("paid key (≥$10 path) plans 1000 RPD and 20 RPM", () => {
  const paid = parseOpenRouterKeyResponse({
    data: { is_free_tier: false, label: "bench", usage: 12 },
  });
  expect(paid.hasPaidCredits).toBeTrue();
  const plan = planOpenRouterLimits(paid);
  expect(plan.rpm).toBe(OPENROUTER_FREE_RPM);
  expect(plan.rpd).toBe(OPENROUTER_FREE_RPD_HIGH);
  expect(plan.source).toContain("1000");
});

test("free-tier key plans 50 RPD", () => {
  const free = parseOpenRouterKeyResponse({
    data: { is_free_tier: true, label: "temp" },
  });
  expect(free.hasPaidCredits).toBeFalse();
  const plan = planOpenRouterLimits(free);
  expect(plan.rpd).toBe(OPENROUTER_FREE_RPD_LOW);
});

test("config overrides win over key tier", () => {
  const paid = parseOpenRouterKeyResponse({ data: { is_free_tier: false } });
  const plan = planOpenRouterLimits(paid, { rpm: 10, rpd: 100 });
  expect(plan.rpm).toBe(10);
  expect(plan.rpd).toBe(100);
});

test("sliding window blocks after maxPerWindow until window advances", async () => {
  const limiter = new SlidingWindowRateLimiter({
    maxPerWindow: 2,
    windowMs: 80,
    maxPerDay: 100,
  });

  expect(await limiter.acquire()).toBe("ok");
  expect(await limiter.acquire()).toBe("ok");
  // Third call waits until the first slot ages out of the 80ms window.
  const started = performance.now();
  expect(await limiter.acquire()).toBe("ok");
  expect(performance.now() - started).toBeGreaterThanOrEqual(50);
});

test("daily cap returns daily_exhausted", async () => {
  const limiter = new SlidingWindowRateLimiter({
    maxPerWindow: 100,
    windowMs: 60_000,
    maxPerDay: 2,
  });
  expect(await limiter.acquire()).toBe("ok");
  expect(await limiter.acquire()).toBe("ok");
  expect(await limiter.acquire()).toBe("daily_exhausted");
});

test("acquire stops at the caller deadline", async () => {
  let now = 0;
  const limiter = new SlidingWindowRateLimiter({
    maxPerWindow: 1,
    windowMs: 60_000,
    maxPerDay: null,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });

  expect(await limiter.acquire()).toBe("ok");
  expect(await limiter.acquire(30)).toBe("timeout");
  expect(now).toBe(30);
});

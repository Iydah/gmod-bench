import type { AdapterId } from "../adapters";
import {
  createOpenRouterFreeLimiter,
  fetchOpenRouterKeyInfo,
  isOpenRouterFreeModelId,
  planOpenRouterLimits,
  type OpenRouterKeyInfo,
} from "../adapters/openrouter-limits";
import type { SlidingWindowRateLimiter } from "../core/rate-limit";
import type { BenchConfig } from "../cli/config";
import type { ScheduledAttempt } from "./plan";

export async function formatOpenRouterQuotaNote(
  runners: readonly AdapterId[],
  env: NodeJS.ProcessEnv,
  config?: BenchConfig,
): Promise<string | null> {
  if (!runners.includes("openrouter")) return null;
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    return [
      "",
      "### OpenRouter free-model quotas",
      "",
      "OPENROUTER_API_KEY is not set — cannot probe GET /api/v1/key.",
      "Official :free limits: **20 RPM**; **50 RPD** without ≥$10 credits, **1000 RPD** with ≥$10 credits.",
      "See https://openrouter.ai/docs/api/reference/limits",
    ].join("\n");
  }

  try {
    const info = await fetchOpenRouterKeyInfo(key);
    const runner = config?.runners.openrouter;
    const overrides = runner
      ? {
          ...(runner.freeRpm !== undefined ? { rpm: runner.freeRpm } : {}),
          ...(runner.freeRpd !== undefined ? { rpd: runner.freeRpd } : {}),
        }
      : undefined;
    const plan = planOpenRouterLimits(info, overrides);
    return [
      "",
      "### OpenRouter free-model quotas (`:free` only)",
      "",
      `- Key tier: ${info.hasPaidCredits ? "paid credits on account (≥$10 path → **1000 RPD**)" : "free-tier path → **50 RPD**"}`,
      `- Applied plan: **${plan.rpm} RPM** · **${plan.rpd} RPD** (${plan.source})`,
      "- Non-`:free` (paid) models are not RPM/RPD-limited by OpenRouter; upstream providers may still 429.",
      "- Docs: https://openrouter.ai/docs/api/reference/limits",
    ].join("\n");
  } catch (error) {
    return `\n### OpenRouter free-model quotas\n\nKey probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function buildOpenRouterFreeLimiter(
  schedule: readonly ScheduledAttempt[],
  config: BenchConfig,
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
): Promise<{
  limiter: SlidingWindowRateLimiter | undefined;
  key: OpenRouterKeyInfo | null;
}> {
  const freeSlots = schedule.filter(
    (slot) =>
      slot.adapter.id === "openrouter" &&
      slot.model &&
      isOpenRouterFreeModelId(slot.model),
  );
  if (freeSlots.length === 0) return { limiter: undefined, key: null };

  const apiKey = env.OPENROUTER_API_KEY?.trim();
  let key: OpenRouterKeyInfo | null = null;
  if (apiKey) {
    try {
      key = await fetchOpenRouterKeyInfo(apiKey);
    } catch (error) {
      log(
        `[gmod-bench] openrouter key probe failed (${error instanceof Error ? error.message : String(error)}) — assuming free-tier 50 RPD`,
      );
    }
  }

  const runner = config.runners.openrouter;
  const overrides = {
    ...(runner?.freeRpm !== undefined ? { rpm: runner.freeRpm } : {}),
    ...(runner?.freeRpd !== undefined ? { rpd: runner.freeRpd } : {}),
  };
  const plan = planOpenRouterLimits(
    key,
    Object.keys(overrides).length > 0 ? overrides : undefined,
  );
  log(
    `[gmod-bench] openrouter :free rate limit → ${plan.rpm} RPM / ${plan.rpd} RPD (${plan.source}); ${freeSlots.length} free attempt(s) in this run`,
  );
  if (freeSlots.length > plan.rpd) {
    log(
      `[gmod-bench] warning: schedule has ${freeSlots.length} free attempts but daily cap is ${plan.rpd} — later slots will stop with protocol_error`,
    );
  }
  return { limiter: createOpenRouterFreeLimiter(plan, log), key };
}

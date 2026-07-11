/**
 * OpenRouter free-model quotas (official docs):
 * https://openrouter.ai/docs/api/reference/limits
 *
 * - Free model ids ending in `:free`:
 *   - 20 requests per minute (RPM)
 *   - 50 requests per day if purchased < 10 credits
 *   - 1000 requests per day if purchased ≥ 10 credits
 * - Paid models: no OpenRouter-enforced RPM/RPD (providers may still 429)
 * - GET /api/v1/key reports is_free_tier + credit usage
 */

import {
  SlidingWindowRateLimiter,
  type AcquireResult,
} from "../core/rate-limit";
import { parseModelSlot } from "./openrouter-slots";

export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

/** Official free-model RPM. */
export const OPENROUTER_FREE_RPM = 20;
/** Official free-model RPD without ≥$10 credit purchase. */
export const OPENROUTER_FREE_RPD_LOW = 50;
/** Official free-model RPD with ≥$10 credit purchase. */
export const OPENROUTER_FREE_RPD_HIGH = 1000;
/** Credit purchase threshold for high free RPD. */
export const OPENROUTER_FREE_CREDITS_THRESHOLD = 10;

export interface OpenRouterKeyInfo {
  isFreeTier: boolean;
  /** Best-effort: true when account has left free tier (paid credits before). */
  hasPaidCredits: boolean;
  label: string | null;
  usage: number | null;
  limitRemaining: number | null;
  raw: unknown;
}

export interface OpenRouterLimitPlan {
  /** Apply the free RPM/RPD limiter to this model id. */
  isFreeModel: boolean;
  rpm: number;
  rpd: number;
  source: string;
}

export function isOpenRouterFreeModelId(modelOrSlot: string): boolean {
  const { modelId } = parseModelSlot(modelOrSlot);
  return modelId.endsWith(":free") || modelId === "openrouter/free";
}

/**
 * Resolve free-model plan from key metadata + optional config overrides.
 * Docs: is_free_tier means the user has not paid for credits before → 50 RPD.
 * Paid accounts get 1000 RPD on :free models (and still 20 RPM).
 */
export function planOpenRouterLimits(
  key: OpenRouterKeyInfo | null,
  overrides?: { rpm?: number; rpd?: number },
): OpenRouterLimitPlan {
  const rpm = overrides?.rpm ?? OPENROUTER_FREE_RPM;
  let rpd = overrides?.rpd;
  let source: string;

  if (rpd !== undefined) {
    source = "config override";
  } else if (key?.hasPaidCredits) {
    rpd = OPENROUTER_FREE_RPD_HIGH;
    source = "key has paid credits → 1000 free RPD";
  } else {
    rpd = OPENROUTER_FREE_RPD_LOW;
    source = key
      ? "free-tier key → 50 free RPD"
      : "no key info → assume 50 free RPD";
  }

  return {
    isFreeModel: true,
    rpm,
    rpd,
    source,
  };
}

export function parseOpenRouterKeyResponse(value: unknown): OpenRouterKeyInfo {
  const root =
    typeof value === "object" && value !== null
      ? (value as { data?: unknown }).data
      : null;
  const data =
    typeof root === "object" && root !== null
      ? (root as Record<string, unknown>)
      : {};

  const isFreeTier = data.is_free_tier === true;
  // Official field: is_free_tier === whether user has paid for credits before is inverted naming:
  // docs: "Whether the user has paid for credits before" — when true they are free tier (never paid).
  // So hasPaidCredits = !is_free_tier
  const hasPaidCredits = data.is_free_tier === false;

  return {
    isFreeTier,
    hasPaidCredits,
    label: typeof data.label === "string" ? data.label : null,
    usage: typeof data.usage === "number" ? data.usage : null,
    limitRemaining:
      typeof data.limit_remaining === "number" ? data.limit_remaining : null,
    raw: value,
  };
}

export async function fetchOpenRouterKeyInfo(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterKeyInfo> {
  const response = await fetchImpl(OPENROUTER_KEY_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/Iydah/gmod-bench",
      "X-Title": "gmod-bench",
    },
  });
  if (!response.ok) {
    throw new Error(`OpenRouter key probe HTTP ${response.status}`);
  }
  return parseOpenRouterKeyResponse(await response.json());
}

export interface OpenRouterLimiterBundle {
  plan: OpenRouterLimitPlan;
  limiter: SlidingWindowRateLimiter;
  key: OpenRouterKeyInfo | null;
}

/**
 * Build a free-model (:free) limiter. Non-:free paid models skip this at call sites.
 *
 * Official caps (docs):
 * - 20 RPM always for :free variants (even with ≥$10 credits)
 * - 50 RPD if never purchased ≥$10; **1000 RPD with ≥$10 credits**
 *
 * Sliding window of `rpm` / 60s — safer than a fixed gap; allows short bursts then waits.
 * We use the full published RPM (not rpm-1) when the account is paid-tier RPD; headroom
 * comes from Retry-After on provider-side 429s.
 */
export function createOpenRouterFreeLimiter(
  plan: OpenRouterLimitPlan,
  log?: (message: string) => void,
): SlidingWindowRateLimiter {
  return new SlidingWindowRateLimiter({
    maxPerWindow: Math.max(1, plan.rpm),
    windowMs: 60_000,
    maxPerDay: plan.rpd,
    ...(log ? { log } : {}),
  });
}

export type { AcquireResult };

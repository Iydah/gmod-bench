import { environmentReport } from "./probe";
import { parseModelSlot, type ReasoningEffort } from "./openrouter-slots";
import { parseOpenRouterResponse } from "./trace/openrouter";
import type {
  HttpAdapter,
  HttpInvocationInput,
  HttpRequestSpec,
} from "./types";

export const OPENROUTER_API_URL =
  "https://openrouter.ai/api/v1/chat/completions";
/** Default cap for non-reasoning answers (short Lua + one reason line). */
export const OPENROUTER_DEFAULT_MAX_TOKENS = 1_024;
/**
 * Reasoning models spend a large share of max_tokens on thinking.
 * high ≈ 80% reasoning → need headroom so the final answer is not truncated.
 */
export const OPENROUTER_REASONING_MAX_TOKENS = 8_192;
/** Fixed seed when the model supports it. */
export const OPENROUTER_BENCHMARK_SEED = 42;
/** Response-cache TTL for identical re-runs. */
export const OPENROUTER_RESPONSE_CACHE_TTL_SECONDS = 3_600;

/**
 * Format-only system instruction (no domain hints, no oracle cues).
 * Plain string for free-model compatibility (many :free endpoints reject content-parts).
 */
export const OPENROUTER_SYSTEM_PROMPT = [
  "Follow the user message exactly.",
  "Your entire visible reply must be:",
  "(1) one markdown code fence with language tag lua, containing only the requested Lua,",
  "(2) then exactly one line starting with Reason: and a short explanation.",
  "No other text before, between, or after.",
  "If you use private reasoning, still put the final fence and Reason line in the visible content.",
  "Do not use tools, browse, or call functions.",
].join(" ");

export interface OpenRouterRequestOptions {
  sessionId?: string;
  responseCache?: boolean;
  providerSort?: "price" | "throughput" | "latency" | false;
  reasoningEffort?: ReasoningEffort;
  /**
   * From GET /api/v1/models `supported_parameters`.
   * When set, omit sampling fields the model does not list.
   */
  supportedParameters?: readonly string[];
}

function buildSessionId(
  model: string,
  runId?: string,
  effort?: string,
): string {
  const base = effort
    ? `gmod-bench:${runId ?? "local"}:${model}@${effort}`
    : `gmod-bench:${runId ?? "local"}:${model}`;
  return base.length <= 256 ? base : base.slice(0, 256);
}

function supports(
  params: readonly string[] | undefined,
  name: string,
): boolean {
  // Unknown catalog → allow common fields (OpenRouter ignores unsupported ones for many models).
  if (!params || params.length === 0) {
    return true;
  }
  return params.includes(name);
}

/**
 * Build a chat-completions body that works across free + paid OpenRouter models.
 *
 * Compatibility rules learned from free-catalog quirks:
 * - system/user content as plain strings (not multimodal content arrays)
 * - no top-level cache_control (breaks several free providers)
 * - only send temperature / top_p / seed when supported_parameters allows
 * - reasoning.effort only when the slot requests it; exclude reasoning from response body
 * - provider.allow_fallbacks always; sort optional (can be disabled)
 */
export function buildOpenRouterRequestBody(
  input: HttpInvocationInput,
  options: OpenRouterRequestOptions = {},
): Record<string, unknown> {
  const slot = parseModelSlot(input.model);
  const modelId = slot.modelId;
  const reasoningEffort =
    options.reasoningEffort ?? slot.reasoningEffort ?? input.reasoningEffort;
  const sessionId =
    options.sessionId ?? buildSessionId(modelId, input.runId, reasoningEffort);
  const params = options.supportedParameters ?? input.supportedParameters;
  const isReasoning =
    (reasoningEffort !== undefined && reasoningEffort !== "none") ||
    (params?.includes("reasoning") === true && reasoningEffort !== "none");
  const maxTokens =
    reasoningEffort && reasoningEffort !== "none"
      ? OPENROUTER_REASONING_MAX_TOKENS
      : OPENROUTER_DEFAULT_MAX_TOKENS;

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: maxTokens,
    stream: false,
    session_id: sessionId,
    user: "gmod-bench",
    messages: [
      { role: "system", content: OPENROUTER_SYSTEM_PROMPT },
      { role: "user", content: input.prompt },
    ],
  };

  // Sampling — skip when catalog says the model rejects them (common for reasoning OSS models).
  if (supports(params, "temperature") && !isReasoning) {
    body.temperature = 0;
  } else if (supports(params, "temperature") && isReasoning) {
    // Some reasoning models accept temperature; prefer 0 when listed.
    body.temperature = 0;
  }

  if (supports(params, "top_p") && !isReasoning) {
    body.top_p = 1;
  }

  if (supports(params, "seed")) {
    body.seed = OPENROUTER_BENCHMARK_SEED;
  }

  const provider: Record<string, unknown> = {
    allow_fallbacks: true,
  };
  if (options.providerSort !== false) {
    provider.sort = options.providerSort ?? "throughput";
  }
  body.provider = provider;

  if (reasoningEffort !== undefined) {
    // "none" disables reasoning when the model allows it.
    if (reasoningEffort === "none") {
      body.reasoning = { effort: "none", exclude: true };
    } else {
      body.reasoning = {
        effort: reasoningEffort,
        // Keep thinking out of content so our scorer sees only the final answer.
        exclude: true,
      };
    }
  } else if (
    params?.includes("reasoning") ||
    params?.includes("include_reasoning")
  ) {
    // Model can reason but slot didn't pin effort — ask for medium and hide chain-of-thought.
    body.reasoning = { effort: "medium", exclude: true };
  }

  return body;
}

export function buildOpenRouterHeaders(
  options: OpenRouterRequestOptions = {},
): Record<string, string> {
  const responseCache = options.responseCache !== false;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: "Bearer ${OPENROUTER_API_KEY}",
    "HTTP-Referer": "https://github.com/Iydah/gmod-bench",
    "X-OpenRouter-Title": "gmod-bench",
    "X-Title": "gmod-bench",
  };

  if (responseCache) {
    headers["X-OpenRouter-Cache"] = "true";
    headers["X-OpenRouter-Cache-TTL"] = String(
      OPENROUTER_RESPONSE_CACHE_TTL_SECONDS,
    );
  } else {
    headers["X-OpenRouter-Cache"] = "false";
  }

  return headers;
}

export const openrouterAdapter: HttpAdapter = {
  id: "openrouter",
  kind: "http",
  displayName: "OpenRouter",
  assessEnvironment(env) {
    const key = env.OPENROUTER_API_KEY?.trim();
    if (!key) {
      return environmentReport(
        "openrouter",
        "unavailable",
        "OPENROUTER_API_KEY is not set. Create a key at https://openrouter.ai/keys.",
      );
    }

    return environmentReport(
      "openrouter",
      "strict",
      "OpenRouter HTTP adapter is answer-only (no tools) with prompt/response cache optimizations and per-effort reasoning slots.",
      "openrouter-api",
    );
  },
  buildRequest(input: HttpInvocationInput): HttpRequestSpec {
    const slot = parseModelSlot(input.model);
    const body = buildOpenRouterRequestBody(input, {
      sessionId: buildSessionId(
        slot.modelId,
        input.runId,
        slot.reasoningEffort ?? input.reasoningEffort,
      ),
      responseCache: input.responseCache !== false,
      providerSort: input.providerSort ?? "throughput",
      ...(input.supportedParameters
        ? { supportedParameters: input.supportedParameters }
        : {}),
      ...(slot.reasoningEffort || input.reasoningEffort
        ? {
            reasoningEffort: (slot.reasoningEffort ??
              input.reasoningEffort) as ReasoningEffort,
          }
        : {}),
    });

    return {
      url: OPENROUTER_API_URL,
      method: "POST",
      headers: buildOpenRouterHeaders({
        responseCache: input.responseCache !== false,
      }),
      body: JSON.stringify(body),
    };
  },
  parseResponse: parseOpenRouterResponse,
};

export function materializeOpenRouterHeaders(
  headers: Record<string, string>,
  apiKey: string,
): Record<string, string> {
  const materialized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    materialized[name] = value.replaceAll("${OPENROUTER_API_KEY}", apiKey);
  }
  return materialized;
}

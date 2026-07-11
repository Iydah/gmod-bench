import type { AttemptUsage } from "../../core/types";
import type { TraceParseResult } from "../types";
import { isRecord, result, text } from "./shared";

export interface OpenRouterParseResult extends TraceParseResult {
  usage?: AttemptUsage;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Pull every usage field OpenRouter commonly returns on chat.completions.
 * @see https://openrouter.ai/docs/api/reference/overview
 */
export function extractOpenRouterUsage(
  parsed: Record<string, unknown>,
): AttemptUsage | undefined {
  const usageRaw = parsed.usage;
  const generationId = text(parsed.id) ?? undefined;
  const providerModel = text(parsed.model) ?? undefined;
  if (!isRecord(usageRaw) && !generationId && !providerModel) {
    return undefined;
  }

  const usage: AttemptUsage = { source: "provider" };
  if (generationId) {
    usage.generationId = generationId;
  }
  if (providerModel) {
    usage.providerModel = providerModel;
  }
  if (!isRecord(usageRaw)) {
    return usage;
  }

  const promptTokens = readNumber(usageRaw.prompt_tokens);
  const completionTokens = readNumber(usageRaw.completion_tokens);
  const totalTokens = readNumber(usageRaw.total_tokens);
  const cost = readNumber(usageRaw.cost);
  if (promptTokens !== undefined) usage.promptTokens = promptTokens;
  if (completionTokens !== undefined) usage.completionTokens = completionTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (cost !== undefined) usage.cost = cost;

  const costDetails = usageRaw.cost_details;
  if (isRecord(costDetails)) {
    const upstream = readNumber(costDetails.upstream_inference_cost);
    if (upstream !== undefined) usage.upstreamInferenceCost = upstream;
  }

  const promptDetails = usageRaw.prompt_tokens_details;
  if (isRecord(promptDetails)) {
    const cachedTokens = readNumber(promptDetails.cached_tokens);
    const cacheWriteTokens = readNumber(promptDetails.cache_write_tokens);
    const audioTokens = readNumber(promptDetails.audio_tokens);
    if (cachedTokens !== undefined) usage.cachedTokens = cachedTokens;
    if (cacheWriteTokens !== undefined)
      usage.cacheWriteTokens = cacheWriteTokens;
    if (audioTokens !== undefined) usage.audioTokens = audioTokens;
  }

  const completionDetails = usageRaw.completion_tokens_details;
  if (isRecord(completionDetails)) {
    const reasoningTokens = readNumber(completionDetails.reasoning_tokens);
    if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;
  }

  // Some payloads put reasoning under usage.reasoning_tokens directly
  const topReasoning = readNumber(usageRaw.reasoning_tokens);
  if (topReasoning !== undefined && usage.reasoningTokens === undefined) {
    usage.reasoningTokens = topReasoning;
  }

  return usage;
}

function extractFinishReasons(
  choice: Record<string, unknown>,
): Pick<AttemptUsage, "finishReason" | "nativeFinishReason"> {
  const finishReason = text(choice.finish_reason) ?? undefined;
  const nativeFinishReason = text(choice.native_finish_reason) ?? undefined;
  return {
    ...(finishReason ? { finishReason } : {}),
    ...(nativeFinishReason ? { nativeFinishReason } : {}),
  };
}

/**
 * OpenRouter uses the OpenAI chat-completions envelope.
 * Tool calls in the response are policy violations (we never request tools).
 */
export function parseOpenRouterResponse(
  statusCode: number,
  body: string,
): OpenRouterParseResult {
  if (statusCode < 200 || statusCode >= 300) {
    // Still try to scrape usage/generation id from error JSON when present.
    try {
      const errParsed = JSON.parse(body) as unknown;
      if (isRecord(errParsed)) {
        const usage = extractOpenRouterUsage(errParsed);
        const failed = result(
          "protocol_error",
          `OpenRouter HTTP ${statusCode}.`,
        );
        return usage ? { ...failed, usage } : failed;
      }
    } catch {
      // ignore
    }
    return result("protocol_error", `OpenRouter HTTP ${statusCode}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return result("trace_error", "OpenRouter did not return valid JSON.");
  }

  if (!isRecord(parsed)) {
    return result("trace_error", "OpenRouter response is not a JSON object.");
  }

  let usage = extractOpenRouterUsage(parsed);

  if (parsed.error) {
    const message = isRecord(parsed.error) ? text(parsed.error.message) : null;
    const code = isRecord(parsed.error) ? parsed.error.code : undefined;
    const metadata =
      isRecord(parsed.error) && isRecord(parsed.error.metadata)
        ? parsed.error.metadata
        : null;
    const metaHint = metadata
      ? ` metadata=${JSON.stringify(metadata).slice(0, 200)}`
      : "";
    const codeHint = code !== undefined ? ` (code ${String(code)})` : "";
    const failed = result(
      "protocol_error",
      message
        ? `OpenRouter error: ${message}${codeHint}${metaHint}`
        : `OpenRouter returned an error object.${codeHint}${metaHint}`,
    );
    return usage ? { ...failed, usage } : failed;
  }

  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    const failed = result(
      "protocol_error",
      "OpenRouter response has no choices.",
    );
    return usage ? { ...failed, usage } : failed;
  }
  if (choices.length !== 1) {
    const failed = result(
      "protocol_error",
      `OpenRouter returned ${choices.length} choices; expected one.`,
    );
    return usage ? { ...failed, usage } : failed;
  }

  const choice = choices[0];
  if (!isRecord(choice)) {
    return result("trace_error", "OpenRouter choice is not an object.");
  }

  const finish = extractFinishReasons(choice);
  if (usage || finish.finishReason || finish.nativeFinishReason) {
    usage = { ...(usage ?? { source: "provider" as const }), ...finish };
  }

  const message = choice.message;
  if (!isRecord(message)) {
    return result("trace_error", "OpenRouter choice has no message object.");
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return result(
      "policy_violation",
      "OpenRouter message included tool_calls.",
    );
  }
  if (message.function_call) {
    return result(
      "policy_violation",
      "OpenRouter message included function_call.",
    );
  }

  const content = message.content;
  if (typeof content === "string" && content.trim().length > 0) {
    const complete = result(
      "complete",
      "OpenRouter returned one assistant message.",
      content,
    );
    return usage ? { ...complete, usage } : complete;
  }

  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        texts.push(part);
        continue;
      }
      if (isRecord(part) && text(part.type) === "text" && text(part.text)) {
        texts.push(text(part.text) as string);
        continue;
      }
      return result(
        "trace_error",
        "OpenRouter message content has an unsupported part shape.",
      );
    }
    const joined = texts.join("");
    if (joined.trim().length === 0) {
      const failed = result(
        "protocol_error",
        "OpenRouter message content was empty.",
      );
      return usage ? { ...failed, usage } : failed;
    }
    const complete = result(
      "complete",
      "OpenRouter returned one assistant message.",
      joined,
    );
    return usage ? { ...complete, usage } : complete;
  }

  const failed = result(
    "protocol_error",
    "OpenRouter message content was empty or missing.",
  );
  return usage ? { ...failed, usage } : failed;
}

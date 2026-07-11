/**
 * Live OpenRouter model catalog helpers.
 * Free = prompt and completion price are zero (API returns strings).
 */

import {
  expandFreeModelsWithReasoning,
  expandModelToReasoningSlots,
  parseModelSlot,
  type ModelSlot,
  type ReasoningMeta,
} from "./openrouter-slots";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** CLI/config sentinel: expand to every free text chat model (× reasoning efforts). */
export const OPENROUTER_FREE_SENTINEL = ":free";

export interface OpenRouterModelPricing {
  prompt?: string;
  completion?: string;
}

export interface OpenRouterModelArchitecture {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
}

export interface OpenRouterModel {
  id: string;
  name?: string;
  pricing?: OpenRouterModelPricing;
  architecture?: OpenRouterModelArchitecture;
  reasoning?: ReasoningMeta | null;
  supported_parameters?: string[];
}

export interface OpenRouterModelsResponse {
  data?: OpenRouterModel[];
}

export interface FreeModelCatalog {
  fetchedAt: string;
  /** Every valid pure text-chat model, including paid models. */
  models: Array<{
    id: string;
    name: string;
    reasoning?: ReasoningMeta | null;
    supportedParameters?: string[];
  }>;
  /** Free pure text-chat models exposed by list-models and :free expansion. */
  freeModels: Array<{
    id: string;
    name: string;
    reasoning?: ReasoningMeta | null;
    supportedParameters?: string[];
  }>;
  /** Slot ids including `@effort` expansions for reasoning models. */
  slots: ModelSlot[];
  /** modelId → supported_parameters from the catalog. */
  supportedParametersByModel: Map<string, string[]>;
  /** modelId → reasoning metadata for free and paid text-chat models. */
  reasoningByModel: Map<string, ReasoningMeta | null>;
}

export interface ModelsHttpClient {
  getJson(url: string, headers?: Record<string, string>): Promise<unknown>;
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class BunModelsHttpClient implements ModelsHttpClient {
  private cachedPayload: unknown;

  constructor(
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      Bun.sleep(ms),
  ) {}

  async getJson(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response | undefined;
      try {
        response = await this.fetcher(url, { headers });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (response) {
        if (response.ok) {
          const payload: unknown = await response.json();
          this.cachedPayload = payload;
          return payload;
        }
        lastError = new Error(`OpenRouter models API HTTP ${response.status}.`);
        if (![429, 502, 503, 504].includes(response.status)) {
          if (this.cachedPayload !== undefined) return this.cachedPayload;
          throw lastError;
        }
      }
      if (attempt === 0) {
        await this.wait(100);
      }
    }
    if (this.cachedPayload !== undefined) {
      return this.cachedPayload;
    }
    throw lastError ?? new Error("OpenRouter models API request failed.");
  }
}

function isZeroPrice(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim();
  return normalized === "0" || normalized === "0.0" || normalized === "0.00";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? [...value]
    : undefined;
}

function parsePricing(value: unknown): OpenRouterModelPricing | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const prompt = readOptionalString(value.prompt);
  const completion = readOptionalString(value.completion);
  if (value.prompt !== undefined && prompt === undefined) return undefined;
  if (value.completion !== undefined && completion === undefined)
    return undefined;
  return {
    ...(prompt !== undefined ? { prompt } : {}),
    ...(completion !== undefined ? { completion } : {}),
  };
}

function parseArchitecture(
  value: unknown,
): OpenRouterModelArchitecture | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const modality = readOptionalString(value.modality);
  const inputModalities = readStringArray(value.input_modalities);
  const outputModalities = readStringArray(value.output_modalities);
  if (value.modality !== undefined && modality === undefined) return undefined;
  if (value.input_modalities !== undefined && inputModalities === undefined)
    return undefined;
  if (value.output_modalities !== undefined && outputModalities === undefined)
    return undefined;
  return {
    ...(modality !== undefined ? { modality } : {}),
    ...(inputModalities !== undefined
      ? { input_modalities: inputModalities }
      : {}),
    ...(outputModalities !== undefined
      ? { output_modalities: outputModalities }
      : {}),
  };
}

/**
 * Free **pure text chat** models for this benchmark only.
 *
 * Excludes:
 * - routers (`openrouter/free`)
 * - multimodal VL / omni / audio (image/video/audio in or out)
 * - safety classifiers / moderation models
 * - embedding / TTS / STT / music generators
 *
 * GMod Bench is short Lua Q&A — vision and classifier endpoints are noise.
 */
export function isFreeTextChatModel(model: OpenRouterModel): boolean {
  if (!isTextChatModel(model)) {
    return false;
  }

  const pricing = model.pricing;
  if (
    !pricing ||
    !isZeroPrice(pricing.prompt) ||
    !isZeroPrice(pricing.completion)
  ) {
    return false;
  }

  return true;
}

export function isTextChatModel(model: OpenRouterModel): boolean {
  if (!model.id || model.id === "openrouter/free") {
    return false;
  }

  const id = model.id.toLowerCase();
  const name = (model.name ?? "").toLowerCase();

  // Explicit junk for a coding/Q&A bench.
  if (
    /\b(lyria|tts|whisper|embed|embedding|moderation|content-safety|safety|classifier|guard|omni|[-_/]vl\b|vision)\b/i.test(
      id,
    ) ||
    /\b(content safety|moderation|vision|omni)\b/i.test(name)
  ) {
    return false;
  }

  const architecture = model.architecture;
  const inputs = architecture?.input_modalities ?? [];
  const outputs = architecture?.output_modalities ?? [];
  const modality = (architecture?.modality ?? "").toLowerCase();

  // Strict: text in → text out only. Multimodal free models (text+image+video→text) are out.
  const pureTextModality =
    modality === "text->text" || modality === "text → text";
  const pureTextIO =
    inputs.length > 0 &&
    outputs.length > 0 &&
    inputs.every((m) => m === "text") &&
    outputs.every((m) => m === "text");

  if (!pureTextModality && !pureTextIO) {
    return false;
  }

  // If modalities are listed, require pure text even when modality string is missing/odd.
  if (inputs.some((m) => m !== "text")) {
    return false;
  }
  if (outputs.some((m) => m !== "text")) {
    return false;
  }

  return true;
}

export function selectFreeModelIds(
  catalog: readonly OpenRouterModel[],
): string[] {
  const ids = catalog.filter(isFreeTextChatModel).map((model) => model.id);
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

export function parseModelsResponse(value: unknown): OpenRouterModel[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("OpenRouter models response is missing a data array.");
  }

  const models: OpenRouterModel[] = [];
  for (const entry of value.data) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      entry.id.length === 0
    ) {
      continue;
    }
    const name = readOptionalString(entry.name);
    const pricing = parsePricing(entry.pricing);
    const architecture = parseArchitecture(entry.architecture);
    const supportedParameters = readStringArray(entry.supported_parameters);
    if (
      (entry.name !== undefined && name === undefined) ||
      (entry.pricing !== undefined && pricing === undefined) ||
      (entry.architecture !== undefined && architecture === undefined) ||
      (entry.supported_parameters !== undefined &&
        supportedParameters === undefined)
    ) {
      continue;
    }
    models.push({
      id: entry.id,
      ...(name !== undefined ? { name } : {}),
      ...(pricing !== undefined ? { pricing } : {}),
      ...(architecture !== undefined ? { architecture } : {}),
      reasoning: parseReasoningMeta(entry.reasoning),
      ...(supportedParameters !== undefined
        ? { supported_parameters: supportedParameters }
        : {}),
    });
  }
  return models;
}

function parseReasoningMeta(value: unknown): ReasoningMeta | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const meta: ReasoningMeta = {};
  if (typeof record.mandatory === "boolean") {
    meta.mandatory = record.mandatory;
  }
  if (Array.isArray(record.supported_efforts)) {
    meta.supported_efforts = record.supported_efforts.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  if (typeof record.default_effort === "string") {
    meta.default_effort = record.default_effort;
  }
  return meta;
}

export async function fetchFreeOpenRouterModels(
  client: ModelsHttpClient = new BunModelsHttpClient(),
  apiKey?: string,
): Promise<FreeModelCatalog> {
  const headers: Record<string, string> = {
    "HTTP-Referer": "https://github.com/Iydah/gmod-bench",
    "X-Title": "gmod-bench",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const payload = await client.getJson(OPENROUTER_MODELS_URL, headers);
  const all = parseModelsResponse(payload)
    .filter(isTextChatModel)
    .sort((left, right) => left.id.localeCompare(right.id));
  const models = all.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(Array.isArray(model.supported_parameters)
      ? {
          supportedParameters: model.supported_parameters.filter(
            (entry): entry is string => typeof entry === "string",
          ),
        }
      : {}),
  }));
  const freeIds = new Set(
    all.filter(isFreeTextChatModel).map((model) => model.id),
  );
  const freeModels = models.filter((model) => freeIds.has(model.id));
  const supportedParametersByModel = new Map<string, string[]>();
  const reasoningByModel = new Map<string, ReasoningMeta | null>();
  for (const model of models) {
    reasoningByModel.set(model.id, model.reasoning ?? null);
    if (model.supportedParameters) {
      supportedParametersByModel.set(model.id, model.supportedParameters);
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    models,
    freeModels,
    slots: expandFreeModelsWithReasoning(freeModels),
    supportedParametersByModel,
    reasoningByModel,
  };
}

/**
 * Expand requested model entries:
 * - `:free` → every free slot (including each reasoning effort)
 * - bare reasoning model → all of its efforts (when catalog meta is known)
 * - `model@high` → that effort only
 */
export function expandOpenRouterModelList(
  requested: readonly string[],
  freeSlots: readonly ModelSlot[],
  reasoningByModel: ReadonlyMap<string, ReasoningMeta | null> = new Map(),
): string[] {
  const expanded: string[] = [];
  let includedFree = false;

  for (const entry of requested) {
    if (
      entry === OPENROUTER_FREE_SENTINEL ||
      entry === "free" ||
      entry === ":free"
    ) {
      if (!includedFree) {
        expanded.push(...freeSlots.map((slot) => slot.slotId));
        includedFree = true;
      }
      continue;
    }

    const parsed = parseModelSlot(entry);
    if (parsed.reasoningEffort) {
      expanded.push(parsed.slotId);
      continue;
    }

    const meta = reasoningByModel.get(parsed.modelId);
    if (meta?.supported_efforts && meta.supported_efforts.length > 0) {
      expanded.push(
        ...expandModelToReasoningSlots(parsed.modelId, meta).map(
          (slot) => slot.slotId,
        ),
      );
      continue;
    }

    // Fallback: if this base id appears in free slots with effort variants, expand those.
    const matchingFree = freeSlots.filter(
      (slot) => slot.modelId === parsed.modelId,
    );
    if (matchingFree.length > 0) {
      expanded.push(...matchingFree.map((slot) => slot.slotId));
      continue;
    }

    expanded.push(parsed.slotId);
  }

  return [...new Set(expanded)];
}

export function isFreeModelSentinel(value: string): boolean {
  return (
    value === OPENROUTER_FREE_SENTINEL || value === "free" || value === ":free"
  );
}

export function listContainsFreeSentinel(
  models: readonly string[] | undefined,
): boolean {
  return (models ?? []).some(isFreeModelSentinel);
}

export type { ModelSlot, ReasoningMeta };
export {
  parseModelSlot,
  expandModelToReasoningSlots,
  formatModelSlot,
} from "./openrouter-slots";

import { expect, test } from "bun:test";

import {
  BunModelsHttpClient,
  expandOpenRouterModelList,
  fetchFreeOpenRouterModels,
  isFreeTextChatModel,
  parseModelsResponse,
  selectFreeModelIds,
  type OpenRouterModel,
} from "../src/adapters/openrouter-models";

const sample: OpenRouterModel[] = [
  {
    id: "openai/gpt-oss-20b:free",
    name: "GPT OSS 20B free",
    pricing: { prompt: "0", completion: "0" },
    architecture: {
      modality: "text->text",
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    pricing: { prompt: "0.0000025", completion: "0.00001" },
    architecture: {
      modality: "text->text",
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
  },
  {
    id: "openrouter/free",
    name: "Free router",
    pricing: { prompt: "0", completion: "0" },
    architecture: {
      modality: "text->text",
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
  },
  {
    id: "google/lyria-3-pro-preview",
    name: "Lyria",
    pricing: { prompt: "0", completion: "0" },
    architecture: {
      modality: "text->audio",
      input_modalities: ["text"],
      output_modalities: ["audio"],
    },
  },
  {
    id: "meta-llama/llama-3.2-3b-instruct:free",
    name: "Llama free",
    pricing: { prompt: "0", completion: "0" },
    architecture: {
      modality: "text->text",
      input_modalities: ["text"],
      output_modalities: ["text"],
    },
  },
  {
    id: "nvidia/nemotron-nano-12b-v2-vl:free",
    name: "Nemotron VL",
    pricing: { prompt: "0", completion: "0" },
    architecture: {
      modality: "text+image+video->text",
      input_modalities: ["image", "text", "video"],
      output_modalities: ["text"],
    },
  },
  {
    id: "nvidia/nemotron-3.5-content-safety:free",
    name: "Content Safety",
    pricing: { prompt: "0", completion: "0" },
    architecture: {
      modality: "text+image->text",
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    name: "Nemotron Omni",
    pricing: { prompt: "0", completion: "0" },
    architecture: {
      modality: "text+image+audio+video->text",
      input_modalities: ["text", "audio", "image", "video"],
      output_modalities: ["text"],
    },
  },
];

test("selects only pure text chat free models (drops VL, safety, routers, audio)", () => {
  expect(selectFreeModelIds(sample)).toEqual([
    "meta-llama/llama-3.2-3b-instruct:free",
    "openai/gpt-oss-20b:free",
  ]);
  expect(isFreeTextChatModel(sample[0]!)).toBeTrue();
  expect(isFreeTextChatModel(sample[1]!)).toBeFalse();
  expect(isFreeTextChatModel(sample[2]!)).toBeFalse();
  expect(isFreeTextChatModel(sample[5]!)).toBeFalse(); // VL
  expect(isFreeTextChatModel(sample[6]!)).toBeFalse(); // content-safety
  expect(isFreeTextChatModel(sample[7]!)).toBeFalse(); // omni
});

test("expands :free sentinel and de-duplicates", () => {
  const freeSlots = [
    { slotId: "a:free", modelId: "a:free" },
    { slotId: "b:free", modelId: "b:free" },
  ];
  expect(
    expandOpenRouterModelList([":free", "custom/model"], freeSlots),
  ).toEqual(["a:free", "b:free", "custom/model"]);
  expect(expandOpenRouterModelList(["free", ":free"], freeSlots)).toEqual([
    "a:free",
    "b:free",
  ]);
});

test("parses models API payloads", () => {
  const models = parseModelsResponse({ data: sample });
  expect(models).toHaveLength(sample.length);
  expect(() => parseModelsResponse({})).toThrow();
});

test("catalog keeps paid reasoning metadata while free slots stay free-only", async () => {
  const catalog = await fetchFreeOpenRouterModels({
    getJson: async () => ({
      data: [
        sample[0],
        {
          ...sample[1],
          reasoning: { mandatory: true, supported_efforts: ["high", "low"] },
          supported_parameters: ["max_tokens", "reasoning"],
        },
      ],
    }),
  });

  expect(catalog.models.map((model) => model.id)).toEqual([
    "openai/gpt-4o",
    "openai/gpt-oss-20b:free",
  ]);
  expect(catalog.slots.map((slot) => slot.slotId)).toEqual([
    "openai/gpt-oss-20b:free",
  ]);
  expect(
    catalog.reasoningByModel.get("openai/gpt-4o")?.supported_efforts,
  ).toEqual(["high", "low"]);
  expect(catalog.supportedParametersByModel.get("openai/gpt-4o")).toEqual([
    "max_tokens",
    "reasoning",
  ]);
});

test("catalog skips malformed entries instead of crashing consumers", () => {
  const models = parseModelsResponse({
    data: [{ id: "ok/model", name: 42 }, sample[0]],
  });
  expect(models).toHaveLength(1);
  expect(models[0]?.id).toBe(sample[0]?.id);
});

test("models client retries transient failures and reuses its last good payload", async () => {
  let calls = 0;
  let healthy = true;
  const client = new BunModelsHttpClient(
    async () => {
      calls += 1;
      if (healthy && calls === 1) return new Response("busy", { status: 503 });
      if (healthy) return Response.json({ data: sample });
      return new Response("busy", { status: 503 });
    },
    async () => undefined,
  );

  await expect(client.getJson("https://example.test/models")).resolves.toEqual({
    data: sample,
  });
  expect(calls).toBe(2);
  healthy = false;
  await expect(client.getJson("https://example.test/models")).resolves.toEqual({
    data: sample,
  });
  expect(calls).toBe(4);
});

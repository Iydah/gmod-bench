import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  filterDisabledModels,
  loadBenchConfig,
  resolveModelsForRunner,
} from "../src/cli/config";

test("loads safe defaults when no local configuration exists", async () => {
  const config = await loadBenchConfig(
    join(tmpdir(), "missing-gmod-bench-config.json"),
  );
  expect(config).toEqual({
    defaultRepeat: 1,
    timeoutSeconds: 120,
    concurrency: 2,
    runners: {},
  });
});

test("loads per-runner model choices and multi-model OpenRouter lists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gmod-bench-config-"));
  const path = join(dir, "gmod-bench.config.json");
  try {
    await Bun.write(
      path,
      JSON.stringify({
        defaultRepeat: 2,
        concurrency: 4,
        runners: {
          claude: { model: "sonnet" },
          openrouter: {
            models: ["openai/gpt-4o-mini", "google/gemini-2.0-flash-001"],
          },
        },
      }),
    );

    const config = await loadBenchConfig(path);
    expect(config.defaultRepeat).toBe(2);
    expect(config.concurrency).toBe(4);
    expect(resolveModelsForRunner("claude", {}, config)).toEqual(["sonnet"]);
    expect(resolveModelsForRunner("openrouter", {}, config)).toEqual([
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-001",
    ]);
    expect(
      resolveModelsForRunner(
        "openrouter",
        { openrouter: ["meta/llama"] },
        config,
      ),
    ).toEqual(["meta/llama"]);
    expect(
      resolveModelsForRunner(
        "openrouter",
        {},
        { defaultRepeat: 1, timeoutSeconds: 120, concurrency: 1, runners: {} },
      ),
    ).toEqual([":free"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("disabledModels filters base ids and all efforts", () => {
  const { kept, skipped } = filterDisabledModels(
    [
      "ok/model:free",
      "openai/gpt-oss-20b:free@high",
      "openai/gpt-oss-20b:free@low",
      "qwen/qwen3-coder:free",
    ],
    ["openai/gpt-oss-20b:free", "qwen/qwen3-coder:free"],
  );
  expect(kept).toEqual(["ok/model:free"]);
  expect(skipped).toEqual([
    "openai/gpt-oss-20b:free@high",
    "openai/gpt-oss-20b:free@low",
    "qwen/qwen3-coder:free",
  ]);
});

test("effort-specific disabledModels entries keep sibling efforts", () => {
  const { kept, skipped } = filterDisabledModels(
    ["openai/gpt-oss-20b:free@high", "openai/gpt-oss-20b:free@low"],
    ["openai/gpt-oss-20b:free@high"],
  );
  expect(kept).toEqual(["openai/gpt-oss-20b:free@low"]);
  expect(skipped).toEqual(["openai/gpt-oss-20b:free@high"]);
});

test("model resolution removes duplicates in stable order", () => {
  const config = {
    defaultRepeat: 1,
    timeoutSeconds: 120,
    concurrency: 2,
    runners: { claude: { models: ["sonnet", "sonnet", "opus", "sonnet"] } },
  };
  expect(resolveModelsForRunner("claude", {}, config)).toEqual([
    "sonnet",
    "opus",
  ]);
  expect(
    resolveModelsForRunner("claude", { claude: ["sonnet", "sonnet"] }, config),
  ).toEqual(["sonnet"]);
});

test("rejects unknown runners", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gmod-bench-config-bad-"));
  const path = join(dir, "gmod-bench.config.json");
  try {
    await Bun.write(
      path,
      JSON.stringify({ runners: { nope: { model: "x" } } }),
    );
    await expect(loadBenchConfig(path)).rejects.toThrow(
      "Invalid runner configuration",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

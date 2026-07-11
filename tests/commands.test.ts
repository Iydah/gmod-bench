import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { executeList, executeReport, executeRun } from "../src/cli/commands";
import type { ProcessExecutor } from "../src/core/process";
import type { HttpExecutor } from "../src/core/http";

test("run records unavailable adapters without invoking a model and report reads the saved artifact", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "gmod-bench-commands-"));
  const projectRoot = join(import.meta.dir, "..");
  let processWasCalled = false;
  const processExecutor: ProcessExecutor = {
    run: async () => {
      processWasCalled = true;
      throw new Error(
        "The process executor must not run unavailable adapters.",
      );
    },
  };
  const httpExecutor: HttpExecutor = {
    run: async () => {
      throw new Error("HTTP must not run for unavailable CLI adapters.");
    },
  };

  try {
    const result = await executeRun(
      {
        command: "run",
        fixtureIds: ["gmod.player-iterator.v1"],
        fixtureSelection: "explicit-ids",
        rerunAll: false,
        historyPolicy: "scored",
        runners: ["devin"],
        models: {},
        openrouterFree: false,
        keepRaw: false,
      },
      {
        projectRoot,
        fixturesRoot: join(projectRoot, "fixtures"),
        configPath: join(tempRoot, "missing.json"),
        artifactRoot: join(tempRoot, "runs"),
        scratchRoot: join(tempRoot, "scratch"),
      },
      {
        doctorExecutor: {
          findExecutable: async () => null,
          run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        },
        processExecutor,
        httpExecutor,
        now: () => new Date("2026-07-10T12:00:00.000Z"),
        createRunId: () => "run-test",
      },
    );

    expect(processWasCalled).toBeFalse();
    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("expected completed run");
    expect(result.artifact.schemaVersion).toBe(3);
    expect(result.artifact.attempts[0]?.status).toBe("unavailable");
    expect(result.artifact.summary.statusCounts.unavailable).toBe(1);
    await expect(executeReport(result.paths.jsonPath)).resolves.toContain(
      "Unavailable: 1",
    );

    const incremental = await executeRun(
      {
        command: "run",
        fixtureIds: ["gmod.player-iterator.v1"],
        fixtureSelection: "explicit-all",
        rerunAll: false,
        historyPolicy: "all",
        runners: ["devin"],
        models: {},
        openrouterFree: false,
        keepRaw: false,
      },
      {
        projectRoot,
        fixturesRoot: join(projectRoot, "fixtures"),
        configPath: join(tempRoot, "missing.json"),
        artifactRoot: join(tempRoot, "runs"),
        scratchRoot: join(tempRoot, "scratch"),
      },
      {
        doctorExecutor: {
          findExecutable: async () => null,
          run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        },
        processExecutor,
        httpExecutor,
        now: () => new Date("2026-07-10T12:01:00.000Z"),
        createRunId: () => "run-incremental",
      },
    );
    expect(incremental.kind).toBe("no-work");
    expect(
      await Bun.file(
        join(tempRoot, "runs", "run-incremental", "run.json"),
      ).exists(),
    ).toBeFalse();

    const forced = await executeRun(
      {
        command: "run",
        fixtureIds: ["gmod.player-iterator.v1"],
        fixtureSelection: "explicit-all",
        rerunAll: true,
        historyPolicy: "scored",
        runners: ["devin"],
        models: {},
        openrouterFree: false,
        keepRaw: false,
      },
      {
        projectRoot,
        fixturesRoot: join(projectRoot, "fixtures"),
        configPath: join(tempRoot, "missing.json"),
        artifactRoot: join(tempRoot, "runs"),
        scratchRoot: join(tempRoot, "scratch"),
      },
      {
        doctorExecutor: {
          findExecutable: async () => null,
          run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        },
        processExecutor,
        httpExecutor,
        now: () => new Date("2026-07-10T12:02:00.000Z"),
        createRunId: () => "run-forced",
      },
    );
    expect(forced.kind).toBe("completed");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("list enumerates public fixtures", async () => {
  const projectRoot = join(import.meta.dir, "..");
  const output = await executeList({
    projectRoot,
    fixturesRoot: join(projectRoot, "fixtures"),
    configPath: join(projectRoot, "missing.json"),
    artifactRoot: join(projectRoot, ".gmod-bench", "runs"),
    scratchRoot: join(projectRoot, ".gmod-bench", "scratch"),
  });

  expect(output).toContain("gmod.player-iterator.v1");
  expect(output).toContain("gmod.hook-add.v1");
  expect(output).toContain("gmod.isvalid.v1");
});

test("OpenRouter multi-model schedule expands without calling process executor", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "gmod-bench-or-"));
  const projectRoot = join(import.meta.dir, "..");
  const modelsSeen: string[] = [];
  const httpExecutor: HttpExecutor = {
    run: async (spec) => {
      const body = JSON.parse(spec.body) as { model: string };
      modelsSeen.push(body.model);
      return {
        kind: "completed",
        statusCode: 200,
        body: JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: [
                  "```lua",
                  "for _, ply in player.Iterator() do end",
                  "```",
                  "Reason: cached iterator.",
                ].join("\n"),
              },
            },
          ],
        }),
        durationMs: 5,
        outputLimited: false,
        headers: {},
      };
    },
  };

  try {
    await Bun.write(
      join(tempRoot, "config.json"),
      JSON.stringify({
        defaultRepeat: 1,
        timeoutSeconds: 30,
        concurrency: 2,
        runners: {
          openrouter: {
            models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
          },
        },
      }),
    );

    const result = await executeRun(
      {
        command: "run",
        fixtureIds: ["gmod.player-iterator.v1"],
        fixtureSelection: "explicit-ids",
        rerunAll: false,
        historyPolicy: "scored",
        runners: ["openrouter"],
        models: {},
        openrouterFree: false,
        keepRaw: false,
        concurrency: 2,
      },
      {
        projectRoot,
        fixturesRoot: join(projectRoot, "fixtures"),
        configPath: join(tempRoot, "config.json"),
        artifactRoot: join(tempRoot, "runs"),
        scratchRoot: join(tempRoot, "scratch"),
      },
      {
        doctorExecutor: {
          findExecutable: async () => null,
          run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        },
        processExecutor: {
          run: async () => {
            throw new Error("CLI must not run");
          },
        },
        httpExecutor,
        modelsHttpClient: {
          getJson: async () => {
            throw new Error("catalog unavailable");
          },
        },
        now: () => new Date("2026-07-10T12:00:00.000Z"),
        createRunId: () => "run-or-multi",
        env: { OPENROUTER_API_KEY: "sk-or-test" },
      },
    );

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("expected completed run");
    expect(modelsSeen.sort()).toEqual([
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
    ]);
    expect(result.artifact.attempts).toHaveLength(2);
    expect(
      result.artifact.attempts.every((attempt) => attempt.status === "pass"),
    ).toBeTrue();
    expect(result.artifact.summary.passAtKRate).toBe("2/2");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("OpenRouter :free expands from the live catalog client (mocked)", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "gmod-bench-free-"));
  const projectRoot = join(import.meta.dir, "..");
  const modelsSeen: string[] = [];
  const httpExecutor: HttpExecutor = {
    run: async (spec) => {
      const body = JSON.parse(spec.body) as { model: string };
      modelsSeen.push(body.model);
      return {
        kind: "completed",
        statusCode: 200,
        body: JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  "```lua\nfor _, ply in player.Iterator() do end\n```\nReason: ok.",
              },
            },
          ],
        }),
        durationMs: 3,
        outputLimited: false,
        headers: {},
      };
    },
  };

  try {
    const result = await executeRun(
      {
        command: "run",
        fixtureIds: ["gmod.player-iterator.v1"],
        fixtureSelection: "explicit-ids",
        rerunAll: false,
        historyPolicy: "scored",
        runners: ["openrouter"],
        models: { openrouter: [":free"] },
        openrouterFree: true,
        keepRaw: false,
        concurrency: 3,
      },
      {
        projectRoot,
        fixturesRoot: join(projectRoot, "fixtures"),
        configPath: join(tempRoot, "missing.json"),
        artifactRoot: join(tempRoot, "runs"),
        scratchRoot: join(tempRoot, "scratch"),
      },
      {
        doctorExecutor: {
          findExecutable: async () => null,
          run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        },
        processExecutor: {
          run: async () => {
            throw new Error("CLI must not run");
          },
        },
        httpExecutor,
        modelsHttpClient: {
          getJson: async () => ({
            data: [
              {
                id: "alpha/model:free",
                name: "Alpha",
                pricing: { prompt: "0", completion: "0" },
                architecture: {
                  modality: "text->text",
                  input_modalities: ["text"],
                  output_modalities: ["text"],
                },
              },
              {
                id: "beta/model:free",
                name: "Beta",
                pricing: { prompt: "0", completion: "0" },
                architecture: {
                  modality: "text->text",
                  input_modalities: ["text"],
                  output_modalities: ["text"],
                },
                reasoning: {
                  mandatory: true,
                  supported_efforts: ["high", "low"],
                  default_effort: "high",
                },
              },
              {
                id: "paid/model",
                pricing: { prompt: "1", completion: "1" },
                architecture: {
                  modality: "text->text",
                  input_modalities: ["text"],
                  output_modalities: ["text"],
                },
              },
            ],
          }),
        },
        now: () => new Date("2026-07-10T12:00:00.000Z"),
        createRunId: () => "run-free",
        env: { OPENROUTER_API_KEY: "sk-or-test" },
      },
    );

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("expected completed run");
    // beta expands to @high and @low; API still receives the bare model id.
    expect(modelsSeen.sort()).toEqual([
      "alpha/model:free",
      "beta/model:free",
      "beta/model:free",
    ]);
    expect(result.artifact.attempts).toHaveLength(3);
    expect(result.artifact.attempts.map((a) => a.model).sort()).toEqual([
      "alpha/model:free",
      "beta/model:free@high",
      "beta/model:free@low",
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("OpenRouter repeats disable provider response caching", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "gmod-bench-repeat-cache-"));
  const projectRoot = join(import.meta.dir, "..");
  const cacheHeaders: string[] = [];

  try {
    const result = await executeRun(
      {
        command: "run",
        fixtureIds: ["gmod.player-iterator.v1"],
        fixtureSelection: "explicit-ids",
        rerunAll: false,
        historyPolicy: "scored",
        runners: ["openrouter"],
        models: { openrouter: ["openai/gpt-4o-mini"] },
        openrouterFree: false,
        keepRaw: false,
        repeat: 2,
      },
      {
        projectRoot,
        fixturesRoot: join(projectRoot, "fixtures"),
        configPath: join(tempRoot, "missing.json"),
        artifactRoot: join(tempRoot, "runs"),
        scratchRoot: join(tempRoot, "scratch"),
      },
      {
        doctorExecutor: {
          findExecutable: async () => null,
          run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        },
        processExecutor: {
          run: async () => {
            throw new Error("CLI must not run");
          },
        },
        httpExecutor: {
          run: async (spec) => {
            cacheHeaders.push(spec.headers["X-OpenRouter-Cache"] ?? "missing");
            return {
              kind: "completed",
              statusCode: 200,
              body: JSON.stringify({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content:
                        "```lua\nfor _, ply in player.Iterator() do end\n```\nReason: ok.",
                    },
                  },
                ],
              }),
              durationMs: 1,
              outputLimited: false,
              headers: {},
            };
          },
        },
        modelsHttpClient: { getJson: async () => ({ data: [] }) },
        now: () => new Date("2026-07-10T12:00:00.000Z"),
        createRunId: () => "run-repeat-cache",
        env: { OPENROUTER_API_KEY: "sk-or-test" },
      },
    );

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("expected completed run");
    expect(result.artifact.attempts).toHaveLength(2);
    expect(cacheHeaders).toEqual(["false", "false"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { codexAdapter } from "../src/adapters/codex";
import { openrouterAdapter } from "../src/adapters/openrouter";
import { loadFixture } from "../src/fixtures/load";
import { runStrictAttempt } from "../src/core/runner";
import { SlidingWindowRateLimiter } from "../src/core/rate-limit";
import type { ProcessExecutor } from "../src/core/process";
import type { HttpExecutor } from "../src/core/http";

const finalAnswer = [
  "```lua",
  "for _, ply in player.Iterator() do end",
  "```",
  "Reason: It uses GMod's cached iterator rather than materializing player.GetAll().",
].join("\n");

const strictCapability = {
  adapterId: "codex" as const,
  status: "strict" as const,
  reason: "test",
  executablePath: "C:/tools/codex.exe",
  version: "codex-cli 1.0.0",
};

const openrouterCapability = {
  adapterId: "openrouter" as const,
  status: "strict" as const,
  reason: "test",
  executablePath: null,
  version: "openrouter-api",
};

const noopHttp: HttpExecutor = {
  run: async () => {
    throw new Error("HTTP executor should not run for CLI attempts.");
  },
};

test("runs in an empty generated workspace and scores one parsed final answer", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const fixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );
  let workspaceEntries: string[] = [];
  const executor: ProcessExecutor = {
    run: async (_spec, options) => {
      workspaceEntries = await readdir(options.cwd);
      return {
        kind: "completed",
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started" }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({ answer: finalAnswer }),
            },
          }),
          JSON.stringify({ type: "turn.completed" }),
        ].join("\n"),
        stderr: "Authorization: Bearer sk-should-not-leak",
        durationMs: 10,
        outputLimited: false,
      };
    },
  };

  try {
    const attempt = await runStrictAttempt(
      {
        adapter: codexAdapter,
        capability: strictCapability,
        fixture,
        runId: "run-1",
        scratchRoot,
        attemptIndex: 1,
        keepRaw: true,
      },
      { process: executor, http: noopHttp },
    );

    expect(workspaceEntries.sort()).toEqual([
      "answer.schema.json",
      "gemini-deny-all.toml",
    ]);
    expect(attempt.status).toBe("pass");
    expect(attempt.fixtureId).toBe("gmod.player-iterator.v1");
    expect(attempt.finalResponse).toBe(finalAnswer);
    expect(attempt.rawOutput?.stderr).toContain("[REDACTED]");
    expect(attempt.rawOutput?.stderr).not.toContain("sk-should-not-leak");
    // CLI runners get estimated tokens + timing/size metadata
    expect(attempt.usage?.source).toBe("estimated");
    expect(attempt.usage?.promptTokens).toBeGreaterThan(0);
    expect(attempt.usage?.completionTokens).toBeGreaterThan(0);
    expect(attempt.usage?.totalTokens).toBe(
      (attempt.usage?.promptTokens ?? 0) +
        (attempt.usage?.completionTokens ?? 0),
    );
    expect(attempt.startedAt).toBeDefined();
    expect(attempt.completedAt).toBeDefined();
    expect(attempt.answerBytes).toBeGreaterThan(0);
    expect(attempt.answerChars).toBe(finalAnswer.length);
    expect(attempt.exitCode).toBe(0);
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("creates a deny-all Gemini policy before invoking a strict CLI", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const fixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );
  let policy = "";
  const executor: ProcessExecutor = {
    run: async (_spec, options) => {
      policy = await Bun.file(join(options.cwd, "gemini-deny-all.toml")).text();
      return {
        kind: "completed",
        exitCode: 0,
        stdout: JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({ answer: finalAnswer }),
          },
        }),
        stderr: "",
        durationMs: 10,
        outputLimited: false,
      };
    },
  };

  try {
    await runStrictAttempt(
      {
        adapter: codexAdapter,
        capability: strictCapability,
        fixture,
        runId: "run-policy",
        scratchRoot,
        attemptIndex: 1,
      },
      { process: executor, http: noopHttp },
    );

    expect(policy).toContain('toolName = "*"');
    expect(policy).toContain('decision = "deny"');
    expect(policy).toContain("priority = 999");
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("never scores an attempted tool call or a timeout", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const fixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );
  const toolExecutor: ProcessExecutor = {
    run: async () => ({
      kind: "completed",
      exitCode: 0,
      stdout: JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution" },
      }),
      stderr: "",
      durationMs: 10,
      outputLimited: false,
    }),
  };
  const timeoutExecutor: ProcessExecutor = {
    run: async () => ({
      kind: "timeout",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 120_000,
      outputLimited: false,
    }),
  };

  try {
    const toolAttempt = await runStrictAttempt(
      {
        adapter: codexAdapter,
        capability: strictCapability,
        fixture,
        runId: "run-2",
        scratchRoot,
        attemptIndex: 1,
      },
      { process: toolExecutor, http: noopHttp },
    );
    const timeoutAttempt = await runStrictAttempt(
      {
        adapter: codexAdapter,
        capability: strictCapability,
        fixture,
        runId: "run-3",
        scratchRoot,
        attemptIndex: 1,
      },
      { process: timeoutExecutor, http: noopHttp },
    );

    expect(toolAttempt.status).toBe("policy_violation");
    expect(timeoutAttempt.status).toBe("timeout");
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("enforces every fixture's answer-byte cap before generic scoring", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const baseFixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );
  const fixture = {
    ...baseFixture,
    id: "gmod.generic-cap.v1",
    responseContract: { ...baseFixture.responseContract, maxAnswerBytes: 4 },
    scoring: {
      kind: "regex" as const,
      passPatterns: ["native"],
      partialPatterns: [],
      incorrectPatterns: [],
    },
  };
  const executor: ProcessExecutor = {
    run: async () => ({
      kind: "completed",
      exitCode: 0,
      stdout: JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: JSON.stringify({ answer: "native" }),
        },
      }),
      stderr: "",
      durationMs: 10,
      outputLimited: false,
    }),
  };

  try {
    const attempt = await runStrictAttempt(
      {
        adapter: codexAdapter,
        capability: strictCapability,
        fixture,
        runId: "run-4",
        scratchRoot,
        attemptIndex: 1,
      },
      { process: executor, http: noopHttp },
    );

    expect(attempt.status).toBe("protocol_error");
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("scores OpenRouter HTTP answers without spawning a CLI", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const fixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );
  let seenUrl = "";
  let seenAuth = "";
  const http: HttpExecutor = {
    run: async (spec) => {
      seenUrl = spec.url;
      seenAuth = spec.headers.Authorization ?? "";
      return {
        kind: "completed",
        statusCode: 200,
        body: JSON.stringify({
          choices: [{ message: { role: "assistant", content: finalAnswer } }],
        }),
        durationMs: 12,
        outputLimited: false,
        headers: {},
      };
    },
  };
  const processExecutor: ProcessExecutor = {
    run: async () => {
      throw new Error("CLI must not run for OpenRouter.");
    },
  };

  try {
    const attempt = await runStrictAttempt(
      {
        adapter: openrouterAdapter,
        capability: openrouterCapability,
        fixture,
        runId: "run-or",
        scratchRoot,
        attemptIndex: 1,
        model: "openai/gpt-4o-mini",
        env: { OPENROUTER_API_KEY: "sk-or-test-key" },
      },
      { process: processExecutor, http },
    );

    expect(seenUrl).toContain("openrouter.ai");
    expect(seenAuth).toBe("Bearer sk-or-test-key");
    expect(attempt.status).toBe("pass");
    expect(attempt.model).toBe("openai/gpt-4o-mini");
    expect(attempt.adapterId).toBe("openrouter");
    // No provider usage in this fixture body → estimated tokens + HTTP meta
    expect(attempt.usage?.source).toBe("estimated");
    expect(attempt.usage?.promptTokens).toBeGreaterThan(0);
    expect(attempt.httpStatus).toBe(200);
    expect(attempt.httpAttempts).toBe(1);
    expect(attempt.startedAt).toBeDefined();
    expect(attempt.answerBytes).toBeGreaterThan(0);
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("OpenRouter stores provider usage when the API reports tokens", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const fixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );
  const http: HttpExecutor = {
    run: async () => ({
      kind: "completed",
      statusCode: 200,
      body: JSON.stringify({
        id: "gen-provider",
        model: "openai/gpt-4o-mini",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: finalAnswer },
          },
        ],
        usage: {
          prompt_tokens: 111,
          completion_tokens: 22,
          total_tokens: 133,
          cost: 0.0004,
          completion_tokens_details: { reasoning_tokens: 5 },
          prompt_tokens_details: { cached_tokens: 40 },
        },
      }),
      durationMs: 15,
      outputLimited: false,
      headers: {},
    }),
  };

  try {
    const attempt = await runStrictAttempt(
      {
        adapter: openrouterAdapter,
        capability: openrouterCapability,
        fixture,
        runId: "run-or-usage",
        scratchRoot,
        attemptIndex: 1,
        model: "openai/gpt-4o-mini",
        env: { OPENROUTER_API_KEY: "sk-or-test-key" },
      },
      {
        process: {
          run: async () => {
            throw new Error("CLI must not run for OpenRouter.");
          },
        },
        http,
      },
    );

    expect(attempt.status).toBe("pass");
    expect(attempt.usage).toMatchObject({
      source: "provider",
      generationId: "gen-provider",
      providerModel: "openai/gpt-4o-mini",
      promptTokens: 111,
      completionTokens: 22,
      totalTokens: 133,
      reasoningTokens: 5,
      cachedTokens: 40,
      cost: 0.0004,
      finishReason: "stop",
    });
    expect(attempt.httpStatus).toBe(200);
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("OpenRouter retries share one attempt deadline", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const fixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );
  let nowMs = 0;
  let calls = 0;
  const http: HttpExecutor = {
    run: async () => {
      calls += 1;
      nowMs += 40;
      return {
        kind: "completed",
        statusCode: 503,
        body: "{}",
        durationMs: 40,
        outputLimited: false,
        headers: {},
      };
    },
  };

  try {
    const attempt = await runStrictAttempt(
      {
        adapter: openrouterAdapter,
        capability: openrouterCapability,
        fixture,
        runId: "run-deadline",
        scratchRoot,
        attemptIndex: 1,
        model: "openai/gpt-4o-mini",
        timeoutMs: 100,
        env: { OPENROUTER_API_KEY: "sk-or-test-key" },
        runtime: {
          nowMs: () => nowMs,
          sleep: async (ms) => {
            nowMs += ms;
          },
        },
      },
      {
        process: {
          run: async () => {
            throw new Error("CLI must not run");
          },
        },
        http,
      },
    );

    expect(attempt.status).toBe("timeout");
    expect(calls).toBe(1);
    expect(attempt.durationMs).toBe(40);
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("OpenRouter duration includes retry backoff", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const fixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );
  let nowMs = 0;
  let calls = 0;
  let sleptMs = 0;
  let limiterPauses = 0;
  const freeLimiter = new SlidingWindowRateLimiter({
    maxPerWindow: 20,
    windowMs: 60_000,
    maxPerDay: 50,
  });
  freeLimiter.pause = async () => {
    limiterPauses += 1;
    return true;
  };
  const http: HttpExecutor = {
    run: async () => {
      calls += 1;
      nowMs += 40;
      return {
        kind: "completed",
        statusCode: calls === 1 ? 503 : 200,
        body:
          calls === 1
            ? "{}"
            : JSON.stringify({
                choices: [{ message: { content: finalAnswer } }],
              }),
        durationMs: 40,
        outputLimited: false,
        headers: {},
      };
    },
  };

  try {
    const attempt = await runStrictAttempt(
      {
        adapter: openrouterAdapter,
        capability: openrouterCapability,
        fixture,
        runId: "run-duration",
        scratchRoot,
        attemptIndex: 1,
        model: "openai/gpt-4o-mini",
        timeoutMs: 20_000,
        env: { OPENROUTER_API_KEY: "sk-or-test-key" },
        freeRateLimiter: freeLimiter,
        runtime: {
          nowMs: () => nowMs,
          sleep: async (ms) => {
            sleptMs += ms;
            nowMs += ms;
          },
        },
      },
      {
        process: {
          run: async () => {
            throw new Error("CLI must not run");
          },
        },
        http,
      },
    );

    expect(attempt.status).toBe("pass");
    expect(calls).toBe(2);
    expect(attempt.durationMs).toBe(80 + sleptMs);
    expect(sleptMs).toBeGreaterThanOrEqual(5_000);
    expect(limiterPauses).toBe(0);
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("OpenRouter without a model is unsupported rather than incorrect", async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), "gmod-bench-test-"));
  const fixture = await loadFixture(
    join(import.meta.dir, "..", "fixtures"),
    "gmod.player-iterator.v1",
  );

  try {
    const attempt = await runStrictAttempt(
      {
        adapter: openrouterAdapter,
        capability: openrouterCapability,
        fixture,
        runId: "run-or-no-model",
        scratchRoot,
        attemptIndex: 1,
        env: { OPENROUTER_API_KEY: "sk-or-test-key" },
      },
      {
        process: {
          run: async () => ({
            kind: "completed",
            exitCode: 0,
            stdout: "",
            stderr: "",
            durationMs: 0,
            outputLimited: false,
          }),
        },
        http: {
          run: async () => ({
            kind: "completed",
            statusCode: 200,
            body: "",
            durationMs: 0,
            outputLimited: false,
            headers: {},
          }),
        },
      },
    );

    expect(attempt.status).toBe("unsupported");
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

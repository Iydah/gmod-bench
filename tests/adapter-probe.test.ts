import { expect, test } from "bun:test";

import { getAdapter } from "../src/adapters";

test("Codex is strict when non-interactive exec controls are present", () => {
  const adapter = getAdapter("codex");
  if (adapter.kind !== "cli") {
    throw new Error("expected cli");
  }
  const report = adapter.assessHelp({
    executablePath: "C:/tools/codex.exe",
    version: "codex-cli 1.0.0",
    help: "--json\n--output-schema\n--ephemeral\n--ignore-user-config\n--ignore-rules\n--sandbox\n--skip-git-repo-check",
  });

  expect(report.status).toBe("strict");
  const inv = adapter.createInvocation({
    prompt: "question",
    workspace: "C:/scratch/run",
    schemaPath: "C:/scratch/run/answer.schema.json",
    model: "gpt-5.4@high",
  });
  expect(inv.args).toEqual(
    expect.arrayContaining([
      "--json",
      "-c",
      'web_search="disabled"',
      "-c",
      'approval_policy="never"',
      "--model",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="high"',
    ]),
  );
});

test("Cursor remains unsupported until a reviewed deny-all policy exists", () => {
  const adapter = getAdapter("cursor");
  if (adapter.kind !== "cli") {
    throw new Error("expected cli");
  }
  const report = adapter.assessHelp({
    executablePath: "C:/tools/cursor-agent.exe",
    version: "cursor-agent 1.0.0",
    help: "--print\n--output-format stream-json",
  });

  expect(report.status).toBe("unsupported");
});

test("Grok remains unsupported until a reviewed no-MCP/no-plugin policy exists", () => {
  const adapter = getAdapter("grok");
  if (adapter.kind !== "cli") {
    throw new Error("expected cli");
  }
  const report = adapter.assessHelp({
    executablePath: "C:/tools/grok.exe",
    version: "grok 1.0.0",
    help: "--single\n--output-format\n--disable-web-search\n--tools\n--no-memory\n--no-subagents",
  });

  expect(report.status).toBe("unsupported");
});

test("Gemini uses an admin-tier deny-all policy for built-in and MCP tools", () => {
  const adapter = getAdapter("gemini");
  if (adapter.kind !== "cli") {
    throw new Error("expected cli");
  }
  const report = adapter.assessHelp({
    executablePath: "C:/tools/gemini.exe",
    version: "gemini 1.0.0",
    help: "--prompt\n--output-format\n--approval-mode\n--admin-policy",
  });

  expect(report.status).toBe("strict");
  expect(
    adapter.createInvocation({
      prompt: "question",
      workspace: "C:/scratch/run",
      schemaPath: "C:/scratch/run/answer.schema.json",
      policyPath: "C:/scratch/run/deny-all.toml",
    }).args,
  ).toEqual(
    expect.arrayContaining(["--admin-policy", "C:/scratch/run/deny-all.toml"]),
  );
});

test("OpenRouter is strict when OPENROUTER_API_KEY is present and unavailable otherwise", () => {
  const adapter = getAdapter("openrouter");
  if (adapter.kind !== "http") {
    throw new Error("expected http");
  }

  expect(adapter.assessEnvironment({}).status).toBe("unavailable");
  expect(
    adapter.assessEnvironment({ OPENROUTER_API_KEY: "sk-or-test" }).status,
  ).toBe("strict");

  const request = adapter.buildRequest({
    prompt: "hello",
    model: "openai/gpt-4o-mini",
    maxAnswerBytes: 2048,
  });
  expect(request.url).toContain("openrouter.ai");
  expect(JSON.parse(request.body).model).toBe("openai/gpt-4o-mini");
  expect(JSON.parse(request.body).temperature).toBe(0);
});

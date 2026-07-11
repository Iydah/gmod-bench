import { expect, test } from "bun:test";

import { getAdapter } from "../src/adapters";
import { openCodeFreeSlots } from "../src/adapters/opencode-models";
import { parseOpenCodeModelSlot } from "../src/adapters/opencode";
import { parseOpenCodeTrace } from "../src/adapters/trace/opencode";

test("OpenCode is strict when run --format json controls exist", () => {
  const adapter = getAdapter("opencode");
  if (adapter.kind !== "cli") throw new Error("expected cli");
  const report = adapter.assessHelp({
    executablePath: "C:/tools/opencode.exe",
    version: "1.15.9",
    help: "opencode run\n--format\n--model\n--pure\n--variant\n--dir\n",
  });
  expect(report.status).toBe("strict");
});

test("OpenCode invocation uses pure json run + variant slot", () => {
  const adapter = getAdapter("opencode");
  if (adapter.kind !== "cli") throw new Error("expected cli");
  const inv = adapter.createInvocation({
    prompt: "question",
    workspace: "C:/scratch/run",
    schemaPath: "C:/scratch/run/answer.schema.json",
    model: "opencode/hy3-free@high",
  });
  expect(inv.command).toBe("opencode");
  expect(inv.args).toEqual(
    expect.arrayContaining([
      "run",
      "--format",
      "json",
      "--pure",
      "--dir",
      "C:/scratch/run",
      "--model",
      "opencode/hy3-free",
      "--variant",
      "high",
      "question",
    ]),
  );
});

test("parseOpenCodeModelSlot splits @variant", () => {
  expect(parseOpenCodeModelSlot("opencode/big-pickle")).toEqual({
    modelId: "opencode/big-pickle",
  });
  expect(parseOpenCodeModelSlot("opencode/hy3-free@medium")).toEqual({
    modelId: "opencode/hy3-free",
    variant: "medium",
  });
});

test("free slots expand variants", () => {
  const slots = openCodeFreeSlots();
  expect(slots).toContain("opencode/big-pickle");
  expect(slots).toContain("opencode/hy3-free@low");
  expect(slots).toContain("opencode/deepseek-v4-flash-free@max");
  // No "@ultra" effort (model names may still contain "ultra", e.g. nemotron-3-ultra-free).
  expect(slots.some((s) => s.endsWith("@ultra"))).toBe(false);
});

test("parses OpenCode text + provider usage", () => {
  const answer = "```lua\nx\n```\nReason: y";
  const trace = parseOpenCodeTrace(
    [
      JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
      JSON.stringify({ type: "text", part: { type: "text", text: answer } }),
      JSON.stringify({
        type: "step_finish",
        part: {
          type: "step-finish",
          tokens: {
            total: 100,
            input: 80,
            output: 15,
            reasoning: 5,
            cache: { read: 10, write: 0 },
          },
          cost: 0,
        },
      }),
    ].join("\n"),
    "",
  );
  expect(trace.status).toBe("complete");
  expect(trace.finalResponse).toBe(answer);
  expect(trace.usage).toMatchObject({
    source: "provider",
    promptTokens: 80,
    completionTokens: 15,
    reasoningTokens: 5,
    cachedTokens: 10,
    cost: 0,
  });
});

test("rejects OpenCode tool parts", () => {
  const trace = parseOpenCodeTrace(
    JSON.stringify({
      type: "tool_call",
      part: { type: "tool-call", name: "bash" },
    }),
    "",
  );
  expect(trace.status).toBe("policy_violation");

  const siblingToolCall = parseOpenCodeTrace(
    JSON.stringify({
      type: "text",
      message: { content: [{ type: "text", text: "looks safe" }] },
      tool_calls: [{ name: "bash" }],
      part: { type: "text", text: "answer" },
    }),
    "",
  );
  expect(siblingToolCall.status).toBe("policy_violation");
});

test("OpenCode trace fails closed on mixed logs and unknown events", () => {
  const answer = JSON.stringify({
    type: "text",
    part: { type: "text", text: "answer" },
  });
  expect(parseOpenCodeTrace(`debug log\n${answer}`, "").status).toBe(
    "trace_error",
  );
  expect(
    parseOpenCodeTrace(JSON.stringify({ type: "mystery", value: 1 }), "")
      .status,
  ).toBe("trace_error");
});

test("maps error-only streams to protocol_error", () => {
  const trace = parseOpenCodeTrace(
    JSON.stringify({
      type: "error",
      error: { name: "UnknownError", data: { message: "rate limited" } },
    }),
    "",
  );
  expect(trace.status).toBe("protocol_error");
  expect(trace.detail).toContain("rate limited");
});

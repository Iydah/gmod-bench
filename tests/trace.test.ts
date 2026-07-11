import { describe, expect, test } from "bun:test";

import { getAdapter } from "../src/adapters";
import { parseOpenRouterResponse } from "../src/adapters/trace/openrouter";

const finalAnswer = [
  "```lua",
  "for _, ply in player.Iterator() do end",
  "```",
  "Reason: It uses the cached player iterator.",
].join("\n");

describe("adapter-owned trace parsing", () => {
  test("extracts a single final Codex agent message", () => {
    const adapter = getAdapter("codex");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const trace = adapter.parseTrace(
      [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: finalAnswer },
        }),
        JSON.stringify({ type: "turn.completed" }),
      ].join("\n"),
      "",
    );

    expect(trace.status).toBe("complete");
    expect(trace.finalResponse).toBe(finalAnswer);
  });

  test("fails a Codex trace when any tool item appears", () => {
    const adapter = getAdapter("codex");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const trace = adapter.parseTrace(
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution", command: "curl" },
      }),
      "",
    );
    expect(trace.status).toBe("policy_violation");
  });

  test("maps Codex error events to protocol_error with message", () => {
    const adapter = getAdapter("codex");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const trace = adapter.parseTrace(
      [
        JSON.stringify({ type: "thread.started" }),
        JSON.stringify({ type: "error", message: "rate limit exceeded" }),
      ].join("\n"),
      "",
    );
    expect(trace.status).toBe("protocol_error");
    expect(trace.detail).toContain("rate limit exceeded");
  });

  test("ignores transport error items when a final agent_message still arrives", () => {
    const adapter = getAdapter("codex");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const trace = adapter.parseTrace(
      [
        JSON.stringify({ type: "thread.started" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "error",
            message:
              "Falling back from WebSockets to HTTPS transport. unexpected status 403",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: finalAnswer },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            reasoning_output_tokens: 2,
          },
        }),
      ].join("\n"),
      "",
    );
    expect(trace.status).toBe("complete");
    expect(trace.finalResponse).toBe(finalAnswer);
    expect((trace as { usage?: { source?: string } }).usage?.source).toBe(
      "provider",
    );
  });

  test("extracts Codex provider usage from turn.completed", () => {
    const adapter = getAdapter("codex");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const trace = adapter.parseTrace(
      [
        JSON.stringify({ type: "thread.started" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: finalAnswer },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cached_input_tokens: 40,
            reasoning_output_tokens: 8,
          },
        }),
      ].join("\n"),
      "",
    );
    expect(trace.status).toBe("complete");
    expect(
      (trace as { usage?: { source?: string; promptTokens?: number } }).usage,
    ).toMatchObject({
      source: "provider",
      promptTokens: 100,
      completionTokens: 20,
      cachedTokens: 40,
      reasoningTokens: 8,
    });
  });

  test("fails a trace with more than one completed answer", () => {
    const adapter = getAdapter("codex");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const trace = adapter.parseTrace(
      [
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: finalAnswer },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: finalAnswer },
        }),
      ].join("\n"),
      "",
    );
    expect(trace.status).toBe("protocol_error");
  });

  test("extracts the terminal Claude result and rejects tool-use events", () => {
    const adapter = getAdapter("claude");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const complete = adapter.parseTrace(
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: finalAnswer,
      }),
      "",
    );
    const violation = adapter.parseTrace(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "WebSearch" }] },
      }),
      "",
    );

    expect(complete.status).toBe("complete");
    expect(complete.finalResponse).toBe(finalAnswer);
    expect(violation.status).toBe("policy_violation");
  });

  test("fails nested function calls and contradictory assistant text before scoring", () => {
    const adapter = getAdapter("claude");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const nestedFunctionCall = adapter.parseTrace(
      [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "function_call", name: "Bash" }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: finalAnswer,
        }),
      ].join("\n"),
      "",
    );
    const contradictoryAnswer = adapter.parseTrace(
      [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "a different answer" }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: finalAnswer,
        }),
      ].join("\n"),
      "",
    );

    expect(nestedFunctionCall.status).toBe("policy_violation");
    expect(contradictoryAnswer.status).toBe("protocol_error");
  });

  test("marks unknown event shapes as trace_error not unsupported", () => {
    const adapter = getAdapter("grok");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const trace = adapter.parseTrace(
      JSON.stringify({ event: "future_event" }),
      "",
    );
    expect(trace.status).toBe("trace_error");
  });

  test("parses Gemini result events and rejects tool events", () => {
    const adapter = getAdapter("gemini");
    if (adapter.kind !== "cli") {
      throw new Error("expected cli");
    }
    const complete = adapter.parseTrace(
      JSON.stringify({ type: "result", result: finalAnswer }),
      "",
    );
    const violation = adapter.parseTrace(
      JSON.stringify({ type: "tool_call", name: "web" }),
      "",
    );

    expect(complete.status).toBe("complete");
    expect(complete.finalResponse).toBe(finalAnswer);
    expect(violation.status).toBe("policy_violation");
  });

  test("parses OpenRouter chat-completion envelopes", () => {
    const ok = parseOpenRouterResponse(
      200,
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: finalAnswer } }],
      }),
    );
    const tools = parseOpenRouterResponse(
      200,
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "1", type: "function" }],
            },
          },
        ],
      }),
    );
    const httpError = parseOpenRouterResponse(
      401,
      JSON.stringify({ error: { message: "Unauthorized" } }),
    );

    expect(ok.status).toBe("complete");
    expect(ok.finalResponse).toBe(finalAnswer);
    expect(tools.status).toBe("policy_violation");
    expect(httpError.status).toBe("protocol_error");
  });
});

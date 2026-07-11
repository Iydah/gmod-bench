import { expect, test } from "bun:test";

import { agyAdapter } from "../src/adapters/agy";
import { parseAgyTrace } from "../src/adapters/trace/agy";

test("agy 1.1 print mode is strict while older incomplete controls stay unsupported", () => {
  const ok = agyAdapter.assessHelp({
    executablePath: "C:/agy/agy.exe",
    version: "1.1.1",
    help: "--print\n--model\n--mode\n--sandbox\n--print-timeout",
  });
  expect(ok.status).toBe("strict");

  const old = agyAdapter.assessHelp({
    executablePath: "C:/agy/agy.exe",
    version: "1.0.0",
    help: "--print\n--sandbox",
  });
  expect(old.status).toBe("unsupported");
});

test("agy invocation uses plan+sandbox print mode", () => {
  const inv = agyAdapter.createInvocation({
    prompt: "question",
    workspace: "C:/scratch",
    schemaPath: "C:/scratch/schema.json",
    model: "Gemini 3.5 Flash (High)",
  });
  expect(inv.command).toBe("agy");
  expect(inv.args).toEqual(
    expect.arrayContaining([
      "--print",
      "question",
      "--mode",
      "plan",
      "--sandbox",
      "--model",
      "Gemini 3.5 Flash (High)",
    ]),
  );
});

test("agy trace parser accepts clean answers and strips summary chrome", () => {
  const clean = parseAgyTrace(
    "```lua\nfor _ in player.Iterator() do end\n```\nReason: fast.",
    "",
  );
  expect(clean.status).toBe("complete");
  expect(clean.finalResponse).toContain("player.Iterator");

  const withSummary = parseAgyTrace(
    "pong\n\n**Summary of work:**\n* Did stuff\n",
    "",
  );
  expect(withSummary.status).toBe("complete");
  expect(withSummary.finalResponse).toBe("pong");

  const tools = parseAgyTrace("Running tool web_search\nok", "");
  expect(tools.status).toBe("policy_violation");
});

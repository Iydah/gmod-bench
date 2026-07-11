import { unsupportedReport } from "./probe";
import { parseGrokTrace } from "./trace/claude";
import type { CliAdapter, InvocationInput, InvocationSpec } from "./types";

export const grokAdapter: CliAdapter = {
  id: "grok",
  kind: "cli",
  displayName: "Grok Build CLI",
  executable: "grok",
  helpArgs: ["--help"],
  assessHelp(probe) {
    return unsupportedReport(
      "grok",
      probe,
      "Grok's built-in tool allowlist does not prove that inherited MCP servers and plugins are denied.",
    );
  },
  createInvocation(input: InvocationInput): InvocationSpec {
    const args = [
      "--single",
      input.prompt,
      "--output-format",
      "streaming-json",
      "--disable-web-search",
      "--tools",
      "",
      "--no-memory",
      "--no-subagents",
      "--max-turns",
      "1",
      "--permission-mode",
      "plan",
    ];

    if (input.model) {
      args.push("--model", input.model);
    }

    return { command: "grok", args };
  },
  parseTrace: parseGrokTrace,
};

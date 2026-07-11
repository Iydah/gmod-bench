import { strictReport } from "./probe";
import { parseClaudeTrace } from "./trace/claude";
import type { CliAdapter, InvocationInput, InvocationSpec } from "./types";

export const claudeAdapter: CliAdapter = {
  id: "claude",
  kind: "cli",
  displayName: "Claude Code",
  executable: "claude",
  helpArgs: ["--help"],
  assessHelp(probe) {
    return strictReport("claude", probe, [
      "--print",
      "--output-format",
      "--tools",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--safe-mode",
      "--bare",
    ]);
  },
  createInvocation(input: InvocationInput): InvocationSpec {
    const args = [
      "--print",
      input.prompt,
      "--output-format",
      "stream-json",
      "--tools",
      "",
      "--strict-mcp-config",
      "--safe-mode",
      "--bare",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--max-turns",
      "1",
    ];

    if (input.model) {
      args.push("--model", input.model);
    }

    return { command: "claude", args };
  },
  parseTrace: parseClaudeTrace,
};

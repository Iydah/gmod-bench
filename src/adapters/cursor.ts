import { unsupportedReport } from "./probe";
import { parseClaudeTrace } from "./trace/claude";
import type { CliAdapter, InvocationInput, InvocationSpec } from "./types";

export const cursorAdapter: CliAdapter = {
  id: "cursor",
  kind: "cli",
  displayName: "Cursor Agent CLI",
  executable: "cursor-agent",
  helpArgs: ["--help"],
  assessHelp(probe) {
    return unsupportedReport(
      "cursor",
      probe,
      "Cursor requires a reviewed deny-all permission profile before it can be scored in strict mode.",
    );
  },
  createInvocation(input: InvocationInput): InvocationSpec {
    const args = ["--print", input.prompt, "--output-format", "stream-json"];
    if (input.model) {
      args.push("--model", input.model);
    }

    return { command: "cursor-agent", args };
  },
  // Provisional parser for when Cursor becomes strict; still fail-closed on unknown shapes.
  parseTrace: parseClaudeTrace,
};

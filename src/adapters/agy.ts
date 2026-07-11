import { strictReport, unsupportedReport } from "./probe";
import { parseAgyTrace } from "./trace/agy";
import type { CliAdapter, InvocationInput, InvocationSpec } from "./types";

/**
 * Google Antigravity CLI (`agy`) — successor to Gemini CLI.
 *
 * Non-interactive path: `agy --print --model "…" --mode plan --sandbox`.
 * Thinking levels are part of the model display name from `agy models`
 * (e.g. "Gemini 3.5 Flash (High)", "Claude Opus 4.6 (Thinking)").
 *
 * Caveat: there is no proven native deny-all tool flag like Gemini's admin policy.
 * We use `--mode plan` + `--sandbox` and reject tool-looking output in the parser.
 */
export const agyAdapter: CliAdapter = {
  id: "agy",
  kind: "cli",
  displayName: "Antigravity CLI (agy)",
  executable: "agy",
  helpArgs: ["--help"],
  assessHelp(probe) {
    const required = ["--print", "--model", "--mode", "--sandbox"];
    const missing = required.filter((flag) => !probe.help.includes(flag));
    if (missing.length > 0) {
      return unsupportedReport(
        "agy",
        probe,
        `Missing non-interactive controls: ${missing.join(", ")}. Update agy (need ≥1.1.x).`,
      );
    }

    // print+model+plan+sandbox present — allow bench runs (tool deny is weaker than Gemini).
    return strictReport("agy", probe, required);
  },
  createInvocation(input: InvocationInput): InvocationSpec {
    const args = [
      "--print",
      input.prompt,
      // Keep timeout moderate so stuck calls fail fast under parallel runs.
      "--print-timeout",
      "90s",
      "--mode",
      "plan",
      "--sandbox",
    ];

    if (input.model) {
      args.push("--model", input.model);
    }

    return { command: "agy", args };
  },
  parseTrace: parseAgyTrace,
};

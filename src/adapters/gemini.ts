import { strictReport } from "./probe";
import { parseGeminiTrace } from "./trace/gemini";
import type { CliAdapter, InvocationInput, InvocationSpec } from "./types";

export const geminiAdapter: CliAdapter = {
  id: "gemini",
  kind: "cli",
  displayName: "Gemini CLI",
  executable: "gemini",
  helpArgs: ["--help"],
  assessHelp(probe) {
    return strictReport("gemini", probe, [
      "--prompt",
      "--output-format",
      "--approval-mode",
      "--admin-policy",
    ]);
  },
  createInvocation(input: InvocationInput): InvocationSpec {
    if (!input.policyPath) {
      throw new Error(
        "Gemini strict runs require a generated deny-all policy file.",
      );
    }

    const args = [
      "--prompt",
      input.prompt,
      "--output-format",
      "stream-json",
      "--approval-mode",
      "plan",
      "--admin-policy",
      input.policyPath,
    ];

    if (input.model) {
      args.push("--model", input.model);
    }

    return { command: "gemini", args };
  },
  parseTrace: parseGeminiTrace,
};

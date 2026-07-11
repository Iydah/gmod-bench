import { unsupportedReport } from "./probe";
import { result } from "./trace/shared";
import type {
  CliAdapter,
  InvocationInput,
  InvocationSpec,
  TraceParseResult,
} from "./types";

function parseDevinTrace(_stdout: string, _stderr: string): TraceParseResult {
  return result(
    "trace_error",
    "devin has no reviewed structured-trace contract yet.",
  );
}

export const devinAdapter: CliAdapter = {
  id: "devin",
  kind: "cli",
  displayName: "Devin CLI",
  executable: "devin",
  helpArgs: ["--help"],
  assessHelp(probe) {
    return unsupportedReport(
      "devin",
      probe,
      "Devin needs a reviewed non-interactive deny-all-tools and structured-trace contract before strict scoring.",
    );
  },
  createInvocation(input: InvocationInput): InvocationSpec {
    const args = ["run", "--prompt", input.prompt];
    if (input.model) {
      args.push("--model", input.model);
    }

    return { command: "devin", args };
  },
  parseTrace: parseDevinTrace,
};

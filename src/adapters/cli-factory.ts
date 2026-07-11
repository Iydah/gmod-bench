import { strictReport, unsupportedReport } from "./probe";
import type {
  AdapterId,
  CliAdapter,
  HelpProbe,
  InvocationInput,
  InvocationSpec,
  TraceParseResult,
} from "./types";

/**
 * Minimal factory so CLI adapters stay declarative:
 * - declare help flags for doctor/strict
 * - declare how to build argv
 * - declare how to parse stdout/stderr
 *
 * New runners should prefer this over hand-rolling CapabilityReport boilerplate.
 */
export interface DefineCliAdapterOptions {
  id: AdapterId;
  displayName: string;
  executable: string;
  helpArgs: string[];
  /** Flags that must appear in `help` for status=strict. */
  requiredHelpFlags: readonly string[];
  /** Optional custom message when required flags are missing. */
  missingHelpMessage?: (missing: readonly string[]) => string;
  createInvocation: (input: InvocationInput) => InvocationSpec;
  parseTrace: (stdout: string, stderr: string) => TraceParseResult;
  /** Optional override when help shape is more complex than flag presence. */
  assessHelp?: (probe: HelpProbe) => ReturnType<CliAdapter["assessHelp"]>;
}

export function defineCliAdapter(options: DefineCliAdapterOptions): CliAdapter {
  return {
    id: options.id,
    kind: "cli",
    displayName: options.displayName,
    executable: options.executable,
    helpArgs: options.helpArgs,
    assessHelp(probe) {
      if (options.assessHelp) {
        return options.assessHelp(probe);
      }
      const missing = options.requiredHelpFlags.filter(
        (flag) => !probe.help.includes(flag),
      );
      if (missing.length > 0) {
        return unsupportedReport(
          options.id,
          probe,
          options.missingHelpMessage?.(missing) ??
            `Missing non-interactive controls: ${missing.join(", ")}.`,
        );
      }
      return strictReport(options.id, probe, options.requiredHelpFlags);
    },
    createInvocation: options.createInvocation,
    parseTrace: options.parseTrace,
  };
}

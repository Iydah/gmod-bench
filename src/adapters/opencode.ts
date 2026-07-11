import { defineCliAdapter } from "./cli-factory";
import { parseEffortSlot } from "./model-slot";
import { parseOpenCodeTrace } from "./trace/opencode";
import type { InvocationInput, InvocationSpec } from "./types";

/** Variants OpenCode accepts via `--variant` (provider-specific reasoning effort). */
export const OPENCODE_VARIANTS = [
  "low",
  "medium",
  "high",
  "max",
  "minimal",
  "xhigh",
] as const;
export type OpenCodeVariant = (typeof OPENCODE_VARIANTS)[number];

export function parseOpenCodeModelSlot(model: string | undefined): {
  modelId?: string;
  variant?: OpenCodeVariant;
} {
  const parsed = parseEffortSlot(model, OPENCODE_VARIANTS);
  return {
    ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
    ...(parsed.effort ? { variant: parsed.effort } : {}),
  };
}

/**
 * OpenCode CLI — non-interactive `run --format json` path.
 *
 * Hardening:
 * - `--pure` (no external plugins)
 * - `--format json` for machine-parseable events
 * - `--dir` into the attempt workspace
 * - optional `--variant` for reasoning effort (`model@high`)
 * - parser rejects tool-like parts
 *
 * Auth / free Zen models live under the real user profile
 * (`~/.local/share/opencode`); see environment.preserveUserProfile.
 */
export const opencodeAdapter = defineCliAdapter({
  id: "opencode",
  displayName: "OpenCode CLI",
  executable: "opencode",
  helpArgs: ["run", "--help"],
  requiredHelpFlags: ["--format", "--model", "--pure", "--dir", "run"],
  missingHelpMessage: (missing) =>
    `Missing non-interactive controls: ${missing.join(", ")}. Update opencode (need run --format json).`,
  createInvocation(input: InvocationInput): InvocationSpec {
    const { modelId, variant } = parseOpenCodeModelSlot(input.model);
    const args = [
      "run",
      "--format",
      "json",
      "--pure",
      // Isolate project root for the attempt workspace (no repo pollution).
      "--dir",
      input.workspace,
    ];

    if (modelId) {
      args.push("--model", modelId);
    }
    if (variant) {
      args.push("--variant", variant);
    }

    // Prompt last as positional message (opencode run [message..]).
    args.push(input.prompt);
    return { command: "opencode", args };
  },
  parseTrace: parseOpenCodeTrace,
});

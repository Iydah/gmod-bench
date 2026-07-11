import { parseEffortSlot } from "./model-slot";
import { strictReport, unsupportedReport } from "./probe";
import { parseCodexTrace } from "./trace/codex";
import type { CliAdapter, InvocationInput, InvocationSpec } from "./types";

/** Reasoning efforts Codex CLI accepts via model_reasoning_effort. */
export const CODEX_REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

/**
 * Model slots may encode effort as `gpt-5.4@high` (same pattern as OpenRouter).
 * Bare model ids leave effort unset (Codex default for that model).
 */
export function parseCodexModelSlot(model: string | undefined): {
  modelId?: string;
  reasoningEffort?: CodexReasoningEffort;
} {
  const parsed = parseEffortSlot(model, CODEX_REASONING_EFFORTS);
  return {
    ...(parsed.modelId ? { modelId: parsed.modelId } : {}),
    ...(parsed.effort ? { reasoningEffort: parsed.effort } : {}),
  };
}

/**
 * Codex CLI — non-interactive `exec` path for short answer-only prompts.
 *
 * Tool surface is not a true deny-all (model can still *propose* shell commands).
 * We harden with:
 * - read-only sandbox
 * - approval_policy=never (no interactive approval loop)
 * - web_search disabled
 * - plugins/features that expand agency turned off when possible
 * - JSONL + output-schema for a single structured answer
 * - trace parser rejects any tool events
 *
 * Auth: ChatGPT login / API key via real CODEX_HOME (see environment.preserveUserProfile).
 */
export const codexAdapter: CliAdapter = {
  id: "codex",
  kind: "cli",
  displayName: "Codex CLI",
  executable: "codex",
  helpArgs: ["exec", "--help"],
  assessHelp(probe) {
    const required = [
      "--json",
      "--output-schema",
      "--ephemeral",
      "--sandbox",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
    ];
    const missing = required.filter((flag) => !probe.help.includes(flag));
    if (missing.length > 0) {
      return unsupportedReport(
        "codex",
        probe,
        `Missing non-interactive controls: ${missing.join(", ")}. Update Codex CLI.`,
      );
    }
    return strictReport("codex", probe, required);
  },
  createInvocation(input: InvocationInput): InvocationSpec {
    const { modelId, reasoningEffort } = parseCodexModelSlot(input.model);

    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--cd",
      input.workspace,
      "--json",
      "--output-schema",
      input.schemaPath,
      // Answer-only hardening (config overrides; ignore-user-config clears personal config).
      "-c",
      'web_search="disabled"',
      "-c",
      'approval_policy="never"',
      "-c",
      "network_access=false",
      "-c",
      "features.multi_agent=false",
      "-c",
      "features.plugins=false",
      "-c",
      "features.memories=false",
    ];

    if (modelId) {
      args.push("--model", modelId);
    }
    if (reasoningEffort) {
      args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
    }

    args.push(input.prompt);
    return { command: "codex", args };
  },
  parseTrace: parseCodexTrace,
};

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface AttemptWorkspace {
  path: string;
  schemaPath: string;
  policyPath: string;
  cleanup(): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Windows often returns EBUSY/EPERM when a just-exited CLI still holds a
 * handle (or Defender is scanning). Retry, then give up without throwing —
 * orphaned scratch dirs beat killing a multi-hundred-attempt run.
 */
export async function removePathBestEffort(path: string): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT") return;
      const retryable =
        code === "EBUSY" ||
        code === "EPERM" ||
        code === "EACCES" ||
        code === "ENOTEMPTY";
      if (!retryable || attempt === maxAttempts - 1) {
        if (retryable) return;
        throw error;
      }
      await new Promise<void>((resolveDelay) =>
        setTimeout(resolveDelay, 40 * (attempt + 1)),
      );
    }
  }
}

const answerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string" },
  },
};

const denyAllGeminiPolicy = [
  "[[rule]]",
  'toolName = "*"',
  'decision = "deny"',
  "priority = 999",
  "",
].join("\n");

function safeRunPrefix(runId: string): string {
  const normalized = runId.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : "attempt";
}

export async function createAttemptWorkspace(
  scratchRoot: string,
  runId: string,
): Promise<AttemptWorkspace> {
  const root = resolve(scratchRoot);
  await mkdir(root, { recursive: true });

  const path = await mkdtemp(join(root, `${safeRunPrefix(runId)}-`));
  const schemaPath = join(path, "answer.schema.json");
  const policyPath = join(path, "gemini-deny-all.toml");
  await Bun.write(schemaPath, JSON.stringify(answerSchema));
  await Bun.write(policyPath, denyAllGeminiPolicy);

  return {
    path,
    schemaPath,
    policyPath,
    cleanup: () => removePathBestEffort(path),
  };
}

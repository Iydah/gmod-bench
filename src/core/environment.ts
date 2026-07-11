import type { AdapterId } from "../adapters/types";

const baseEnvironmentNames = [
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SystemRoot",
  "SYSTEMROOT",
  "SystemDrive",
] as const;

const authEnvironmentNames: Record<AdapterId, readonly string[]> = {
  // Codex may use API key *or* ChatGPT login under CODEX_HOME (~/.codex).
  codex: ["OPENAI_API_KEY", "CODEX_HOME", "CODEX_API_KEY"],
  claude: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ],
  gemini: [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_GENAI_USE_GCA",
  ],
  grok: ["XAI_API_KEY"],
  cursor: ["CURSOR_API_KEY"],
  devin: ["COGNITION_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  // agy uses Google OAuth session files under the user profile (not a simple API key).
  agy: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"],
  // OpenCode Zen free + optional provider keys (auth.json under ~/.local/share/opencode).
  opencode: [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "XAI_API_KEY",
  ],
};

/**
 * Adapters whose login lives on the real user profile (must not wipe APPDATA / HOME).
 * codex: ChatGPT auth + models_cache under ~/.codex
 * agy: Google OAuth under the user profile
 * opencode: Zen free + credentials under ~/.local/share/opencode
 */
const preserveUserProfile: ReadonlySet<AdapterId> = new Set([
  "agy",
  "codex",
  "opencode",
]);

export function createRestrictedEnvironment(
  adapterId: AdapterId,
  isolatedProfile: string,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of [
    ...baseEnvironmentNames,
    ...authEnvironmentNames[adapterId],
  ]) {
    const value = source[name];
    if (value) {
      environment[name] = value;
    }
  }

  if (preserveUserProfile.has(adapterId)) {
    for (const name of [
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "HOMEDRIVE",
      "HOMEPATH",
    ]) {
      const value = source[name];
      if (value) {
        environment[name] = value;
      }
    }
    environment.TEMP = isolatedProfile;
    environment.TMP = isolatedProfile;
  } else {
    for (const name of [
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
    ]) {
      environment[name] = isolatedProfile;
    }
  }

  return environment;
}

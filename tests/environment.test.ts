import { expect, test } from "bun:test";

import { createRestrictedEnvironment } from "../src/core/environment";

test("runs strict CLIs with a fresh profile and temp directories", () => {
  const env = createRestrictedEnvironment("claude", "C:/scratch/profile", {
    PATH: "C:/bin",
    ANTHROPIC_API_KEY: "secret",
    OPENAI_API_KEY: "should-not-pass",
    USERPROFILE: "C:/Users/real",
  });

  expect(env.PATH).toBe("C:/bin");
  expect(env.ANTHROPIC_API_KEY).toBe("secret");
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.USERPROFILE).toBe("C:/scratch/profile");
  expect(env.TEMP).toBe("C:/scratch/profile");
});

test("forwards only OpenRouter credentials for the HTTP adapter", () => {
  const env = createRestrictedEnvironment("openrouter", "C:/scratch/profile", {
    PATH: "C:/bin",
    OPENROUTER_API_KEY: "sk-or",
    ANTHROPIC_API_KEY: "nope",
  });

  expect(env.OPENROUTER_API_KEY).toBe("sk-or");
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
});

test("agy preserves real user profile for OAuth while isolating temp", () => {
  const env = createRestrictedEnvironment("agy", "C:/scratch/profile", {
    PATH: "C:/bin",
    USERPROFILE: "C:/Users/real",
    APPDATA: "C:/Users/real/AppData/Roaming",
    LOCALAPPDATA: "C:/Users/real/AppData/Local",
    TEMP: "C:/Users/real/Temp",
  });

  expect(env.USERPROFILE).toBe("C:/Users/real");
  expect(env.APPDATA).toBe("C:/Users/real/AppData/Roaming");
  expect(env.TEMP).toBe("C:/scratch/profile");
});

test("codex preserves real user profile for ChatGPT auth under ~/.codex", () => {
  const env = createRestrictedEnvironment("codex", "C:/scratch/profile", {
    PATH: "C:/bin",
    OPENAI_API_KEY: "sk-test",
    USERPROFILE: "C:/Users/real",
    APPDATA: "C:/Users/real/AppData/Roaming",
    LOCALAPPDATA: "C:/Users/real/AppData/Local",
    TEMP: "C:/Users/real/Temp",
  });

  expect(env.OPENAI_API_KEY).toBe("sk-test");
  expect(env.USERPROFILE).toBe("C:/Users/real");
  expect(env.TEMP).toBe("C:/scratch/profile");
});

test("opencode preserves real user profile for Zen auth under ~/.local/share/opencode", () => {
  const env = createRestrictedEnvironment("opencode", "C:/scratch/profile", {
    PATH: "C:/bin",
    OPENROUTER_API_KEY: "sk-or",
    USERPROFILE: "C:/Users/real",
    APPDATA: "C:/Users/real/AppData/Roaming",
    LOCALAPPDATA: "C:/Users/real/AppData/Local",
    TEMP: "C:/Users/real/Temp",
  });

  expect(env.OPENROUTER_API_KEY).toBe("sk-or");
  expect(env.USERPROFILE).toBe("C:/Users/real");
  expect(env.TEMP).toBe("C:/scratch/profile");
});

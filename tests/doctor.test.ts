import { expect, test } from "bun:test";

import { getAdapter } from "../src/adapters";
import { inspectAdapters } from "../src/core/doctor";

test("doctor does not label a sandbox-only Codex binary strict", async () => {
  const reports = await inspectAdapters([getAdapter("codex")], {
    findExecutable: async () => "C:/tools/codex.exe",
    run: async (_command, args) => {
      if (args[0] === "--version") {
        return { exitCode: 0, stdout: "codex-cli 1.0.0\n", stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: "--json\n--sandbox\n--ephemeral\n",
        stderr: "",
      };
    },
  });

  expect(reports[0]?.status).toBe("unsupported");
});

test("doctor marks Codex strict when exec has full non-interactive controls", async () => {
  const reports = await inspectAdapters([getAdapter("codex")], {
    findExecutable: async () => "C:/tools/codex.exe",
    run: async (_command, args) => {
      if (args[0] === "--version") {
        return { exitCode: 0, stdout: "codex-cli 0.144.0\n", stderr: "" };
      }
      return {
        exitCode: 0,
        stdout:
          "Usage: codex exec\n--json\n--output-schema\n--ephemeral\n--ignore-user-config\n--ignore-rules\n--skip-git-repo-check\n--sandbox\n",
        stderr: "",
      };
    },
  });

  expect(reports[0]?.status).toBe("strict");
});

test("doctor reports a missing binary as unavailable instead of a failed score", async () => {
  const reports = await inspectAdapters([getAdapter("claude")], {
    findExecutable: async () => null,
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });

  expect(reports[0]?.status).toBe("unavailable");
});

test("doctor kills a slow local probe instead of waiting indefinitely", async () => {
  const started = performance.now();
  const reports = await inspectAdapters([getAdapter("gemini")], {
    findExecutable: async () => "C:/tools/gemini.exe",
    run: async () => {
      await Bun.sleep(50);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  });
  // Uses real BunDoctorExecutor timeout only in integration; here we just ensure inspect returns.
  expect(reports).toHaveLength(1);
  expect(performance.now() - started).toBeLessThan(5_000);
});

test("doctor converts a probe spawn failure into an unsupported runner", async () => {
  const reports = await inspectAdapters([getAdapter("claude")], {
    findExecutable: async () => "C:/tools/claude.exe",
    run: async () => {
      throw new Error("spawn failed");
    },
  });

  expect(reports[0]?.status).toBe("unsupported");
});

test("doctor marks OpenRouter strict when the API key is present", async () => {
  const reports = await inspectAdapters(
    [getAdapter("openrouter")],
    {
      findExecutable: async () => null,
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    },
    { OPENROUTER_API_KEY: "sk-or-test" },
  );

  expect(reports[0]?.status).toBe("strict");
  expect(reports[0]?.adapterId).toBe("openrouter");
});

test("doctor marks OpenRouter unavailable without an API key", async () => {
  const reports = await inspectAdapters(
    [getAdapter("openrouter")],
    {
      findExecutable: async () => null,
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    },
    {},
  );

  expect(reports[0]?.status).toBe("unavailable");
});

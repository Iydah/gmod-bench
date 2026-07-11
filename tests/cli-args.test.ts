import { expect, test } from "bun:test";

import { parseCliArgs } from "../src/cli/args";

test("parses a bounded run command with selected models and concurrency", () => {
  const args = parseCliArgs([
    "run",
    "--fixture",
    "gmod.player-iterator.v1",
    "--runners",
    "claude,openrouter",
    "--repeat",
    "3",
    "--timeout-seconds",
    "90",
    "--concurrency",
    "4",
    "--model",
    "claude=sonnet",
    "--model",
    "openrouter=openai/gpt-4o-mini",
    "--model",
    "openrouter=anthropic/claude-3.5-sonnet",
    "--keep-raw",
  ]);

  expect(args).toEqual({
    command: "run",
    fixtureIds: ["gmod.player-iterator.v1"],
    fixtureSelection: "explicit-ids",
    rerunAll: false,
    historyPolicy: "scored",
    runners: ["claude", "openrouter"],
    repeat: 3,
    timeoutSeconds: 90,
    concurrency: 4,
    models: {
      claude: ["sonnet"],
      openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
    },
    openrouterFree: false,
    keepRaw: true,
  });
});

test("keep-raw defaults on; --no-keep-raw disables", () => {
  expect(
    parseCliArgs(["run", "--fixture", "x", "--runners", "openrouter"]),
  ).toMatchObject({ keepRaw: true });
  expect(
    parseCliArgs([
      "run",
      "--fixture",
      "x",
      "--runners",
      "openrouter",
      "--no-keep-raw",
    ]),
  ).toMatchObject({
    keepRaw: false,
  });
});

test("parses compare of two models", () => {
  expect(
    parseCliArgs([
      "compare",
      "--run",
      ".gmod-bench/runs/r1/run.json",
      "--model",
      "Pro (Low)",
      "--model",
      "Pro (High)",
    ]),
  ).toEqual({
    command: "compare",
    runPath: ".gmod-bench/runs/r1/run.json",
    models: ["Pro (Low)", "Pro (High)"],
  });
});

test("parses --openrouter-free as all free OpenRouter models", () => {
  const args = parseCliArgs([
    "run",
    "--fixture",
    "all",
    "--openrouter-free",
    "--concurrency",
    "8",
  ]);
  expect(args).toMatchObject({
    command: "run",
    fixtureIds: ["all"],
    runners: ["openrouter"],
    openrouterFree: true,
    models: { openrouter: [":free"] },
    concurrency: 8,
  });
});

test("parses multi-fixture and all fixture selectors", () => {
  expect(
    parseCliArgs(["run", "--fixture", "all", "--runners", "openrouter"]),
  ).toMatchObject({
    command: "run",
    fixtureIds: ["all"],
    fixtureSelection: "explicit-all",
    rerunAll: false,
    runners: ["openrouter"],
  });
  expect(
    parseCliArgs(["run", "--fixture", "a,b", "--runners", "claude"]),
  ).toMatchObject({
    fixtureIds: ["a", "b"],
    fixtureSelection: "explicit-ids",
  });
});

test("defaults to incremental all and parses the full-rerun override", () => {
  expect(parseCliArgs(["run", "--runners", "openrouter"])).toMatchObject({
    fixtureIds: ["all"],
    fixtureSelection: "implicit-all",
    rerunAll: false,
    historyPolicy: "scored",
  });
  expect(
    parseCliArgs(["run", "--runners", "openrouter", "--rerun-all"]),
  ).toMatchObject({
    fixtureIds: ["all"],
    fixtureSelection: "implicit-all",
    rerunAll: true,
  });
});

test("parses the completed-history outcome policy", () => {
  expect(parseCliArgs(["run", "--history-policy", "all"])).toMatchObject({
    historyPolicy: "all",
  });
  expect(() => parseCliArgs(["run", "--history-policy", "invalid"])).toThrow(
    "--history-policy",
  );
});

test("rejects unbounded repeats and unknown adapters", () => {
  expect(() =>
    parseCliArgs(["run", "--fixture", "x", "--repeat", "0"]),
  ).toThrow();
  expect(() =>
    parseCliArgs(["run", "--fixture", "x", "--runners", "nope"]),
  ).toThrow();
  expect(() =>
    parseCliArgs(["run", "--fixture", "x", "--concurrency", "0"]),
  ).toThrow();
});

test("parses quarantine list and clear", () => {
  expect(parseCliArgs(["quarantine"])).toEqual({
    command: "quarantine",
    clear: false,
  });
  expect(parseCliArgs(["quarantine", "--clear"])).toEqual({
    command: "quarantine",
    clear: true,
  });
  expect(parseCliArgs(["quarantine", "--clear", "foo/bar:free"])).toEqual({
    command: "quarantine",
    clear: true,
    clearModel: "foo/bar:free",
  });
});

test("parses list, list-models, and doctor", () => {
  expect(parseCliArgs(["list"])).toEqual({ command: "list" });
  expect(parseCliArgs(["list-models", "--free"])).toEqual({
    command: "list-models",
    freeOnly: true,
  });
  expect(parseCliArgs(["doctor", "--runners", "openrouter"])).toEqual({
    command: "doctor",
    runners: ["openrouter"],
  });
});

test("parses artifact maintenance commands", () => {
  expect(parseCliArgs(["verify", "--all"])).toEqual({
    command: "verify",
    all: true,
  });
  expect(parseCliArgs(["verify", "--run", ".gmod-bench/runs/a"])).toEqual({
    command: "verify",
    all: false,
    runPath: ".gmod-bench/runs/a",
  });
  expect(parseCliArgs(["rebuild-exports", "--run", "a"])).toEqual({
    command: "rebuild-exports",
    runPath: "a",
  });
  expect(parseCliArgs(["rebuild-index"])).toEqual({ command: "rebuild-index" });
});

import { describe, expect, test } from "bun:test";

import {
  displayModel,
  formatScoreInterval,
  shouldShowPassAtK,
  thinkingLabel,
  thinkingOf,
  type LeaderboardRow,
} from "../website/src/lib/leaderboard-view";
import { displayRunModel } from "../website/src/lib/runs-view";

function row(model: string): LeaderboardRow {
  return {
    rank: 1,
    adapterId: "agy",
    model,
    label: `agy/${model}`,
    attempts: 38,
    scored: 38,
    pass: 38,
    partial: 0,
    incorrect: 0,
    protocol_error: 0,
    passRate: 1,
    quality: 1,
    fixtureScore: 1,
    fixtureSolveRate: 1,
    avgDurationMs: 1,
  };
}

describe("leaderboard model metadata", () => {
  test("moves AntiGravity's generic Thinking suffix into the Think column", () => {
    const model = row("Claude Sonnet 4.6 (Thinking)");

    expect(displayModel(model)).toBe("Claude Sonnet 4.6");
    expect(thinkingOf(model)).toBe("thinking");
    expect(thinkingLabel(thinkingOf(model))).toBe("Thinking");
  });

  test("strips OpenRouter provider prefixes and :free routing tags", () => {
    expect(
      displayModel({
        ...row("nvidia/nemotron-3-ultra-550b-a55b:free@high"),
        adapterId: "openrouter",
        label: "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free@high",
      }),
    ).toBe("nemotron-3-ultra-550b-a55b");
    expect(
      displayModel({
        ...row("cohere/north-mini-code:free"),
        adapterId: "openrouter",
        label: "openrouter/cohere/north-mini-code:free",
      }),
    ).toBe("north-mini-code");
    expect(
      displayModel({
        ...row("poolside/laguna-xs-2.1:free"),
        adapterId: "openrouter",
        label: "openrouter/poolside/laguna-xs-2.1:free",
      }),
    ).toBe("laguna-xs-2.1");
  });

  test("uses the same generic Thinking metadata on run pages", () => {
    expect(displayRunModel("agy/Claude Opus 4.6 (Thinking)")).toEqual({
      name: "Claude Opus 4.6",
      thinking: "thinking",
      thinkingLabel: "Thinking",
    });
  });

  test("formats cumulative score evidence and hides Pass@k for single-shot rows", () => {
    expect(formatScoreInterval(0.8123, 0.9344)).toBe("81.2–93.4%");
    expect(shouldShowPassAtK([{ ...row("one"), repeat: 1 }])).toBeFalse();
    expect(shouldShowPassAtK([{ ...row("one"), repeat: 2 }])).toBeTrue();
  });
});

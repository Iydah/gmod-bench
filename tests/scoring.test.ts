import { describe, expect, test } from "bun:test";

import type { ResponseContract } from "../src/core/types";
import { scoreHookAddAnswer } from "../src/scoring/hook-add";
import { scoreIsValidAnswer } from "../src/scoring/isvalid";
import { scorePlayerIteratorAnswer } from "../src/scoring/player-iterator";
import {
  validateResponseContract,
  type ValidatedResponse,
} from "../src/scoring";

const responseContract: ResponseContract = {
  codeFenceLanguage: "lua",
  reasonPrefix: "Reason:",
  maxReasonLines: 1,
  minCandidateLoops: 1,
  maxCandidateLoops: 1,
  maxAnswerBytes: 2048,
};

function response(code: string): ValidatedResponse {
  return {
    answer: [
      "```lua",
      code,
      "```",
      "Reason: It uses GMod's cached iterator.",
    ].join("\n"),
    code,
    reason: "Reason: It uses GMod's cached iterator.",
  };
}

describe("player iterator scoring", () => {
  test("passes a sole player.Iterator loop with one reason line", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(
          [
            "for _, ply in player.Iterator() do",
            "  print(ply:Nick())",
            "end",
          ].join("\n"),
        ),
      ).status,
    ).toBe("pass");
  });

  test("passes a cached numeric player.GetAll loop as the best plain-Lua fallback", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(
          [
            "local plys = player.GetAll()",
            "for i = 1, #plys do",
            "  local ply = plys[i]",
            "end",
          ].join("\n"),
        ),
      ).status,
    ).toBe("pass");
  });

  test("passes a locally aliased player.GetAll with one cached result and numeric loop", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(
          [
            "local player_GetAll = player.GetAll",
            "local plys = player_GetAll()",
            "for i = 1, #plys do",
            "  local ply = plys[i]",
            "end",
          ].join("\n"),
        ),
      ).status,
    ).toBe("pass");
  });

  test("allows per-player if branches that still visit everyone", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(
          [
            "for _, ply in player.Iterator() do",
            "  if IsValid(ply) then print(ply) end",
            "end",
          ].join("\n"),
        ),
      ).status,
    ).toBe("pass");
  });

  test("rejects allocation-based ipairs(player.GetAll()) as not optimized", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(
          [
            "for _, ply in ipairs(player.GetAll()) do",
            "  print(ply:Nick())",
            "end",
          ].join("\n"),
        ),
      ).status,
    ).toBe("incorrect");
  });

  test("rejects behavior-changing player.GetHumans advice", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(
          [
            "for _, ply in ipairs(player.GetHumans()) do",
            "  print(ply:Nick())",
            "end",
          ].join("\n"),
        ),
      ).status,
    ).toBe("incorrect");
  });

  test("rejects iterator loops that stop before every player is visited", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(
          [
            "for _, ply in player.Iterator() do",
            "  if ply:IsBot() then break end",
            "end",
          ].join("\n"),
        ),
      ).status,
    ).toBe("incorrect");
  });

  test("does not treat a differently cased API name as player.Iterator", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(["for _, ply in player.iterator() do", "end"].join("\n")),
      ).status,
    ).toBe("incorrect");
  });

  test("rejects player.Iterator when one loop variable receives only the numeric index", () => {
    expect(
      scorePlayerIteratorAnswer(
        response(
          ["for ply in player.Iterator() do", "  print(ply)", "end"].join("\n"),
        ),
      ).status,
    ).toBe("incorrect");
  });

  test("response contracts reject multiple loops and missing reason lines", () => {
    const multipleLoops = [
      "```lua",
      "for _, ply in player.Iterator() do end",
      "for _, ply in ipairs(player.GetAll()) do end",
      "```",
      "Reason: Either works.",
    ].join("\n");

    expect(
      validateResponseContract(responseContract, multipleLoops),
    ).toMatchObject({ status: "protocol_error" });
    expect(
      validateResponseContract(
        responseContract,
        "```lua\nfor _, ply in player.Iterator() do end\n```",
      ),
    ).toMatchObject({
      status: "protocol_error",
    });
  });
});

describe("hook and isvalid scorers", () => {
  test("hook.Add full form passes", () => {
    expect(
      scoreHookAddAnswer({
        answer: "",
        code: 'hook.Add("Think", "MyAddon.Think", function() end)',
        reason: "Reason: registers",
      }).status,
    ).toBe("pass");
  });

  test("IsValid passes and nil checks fail", () => {
    expect(
      scoreIsValidAnswer({
        answer: "",
        code: "if IsValid(ent) then end",
        reason: "Reason: x",
      }).status,
    ).toBe("pass");
    expect(
      scoreIsValidAnswer({
        answer: "",
        code: "if ent ~= nil then end",
        reason: "Reason: x",
      }).status,
    ).toBe("incorrect");
  });
});

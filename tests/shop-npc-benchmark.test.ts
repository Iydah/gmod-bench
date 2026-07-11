import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { loadFixtures } from "../src/fixtures/load";
import type { ValidatedResponse } from "../src/scoring";
import { scoreFixtureAnswer } from "../src/scoring";
import { scoreShopNpc } from "../src/scoring/shop-npc";

function response(code: string): ValidatedResponse {
  return { answer: "", code, reason: "Reason: complete shop" };
}

function answer(code: string): string {
  return ["```lua", code, "```", "Reason: complete shop"].join("\n");
}

const canonical = `local OPEN, BUY = "MyShop.Open", "MyShop.Buy"
local MAX_DISTANCE_SQR = 128 * 128
local SESSION_TTL = 10
local BUY_LIMIT = 4
local sessions = setmetatable({}, { __mode = "k" })
local budgets = setmetatable({}, { __mode = "k" })

util.AddNetworkString(OPEN)
util.AddNetworkString(BUY)

local SHOP_ITEMS = {
  [1] = { price = 100, grant = function(ply) ply:Give("weapon_crowbar") end }
}

local function nearby(ply, shop)
  return ply:GetPos():DistToSqr(shop:GetPos()) <= MAX_DISTANCE_SQR
end

function ENT:Initialize()
  self:SetUseType(SIMPLE_USE)
end

function ENT:Use(activator)
  if not IsValid(activator) or not activator:IsPlayer() or not nearby(activator, self) then return end
  sessions[activator] = { shop = self, expiresAt = CurTime() + SESSION_TTL }
  net.Start(OPEN)
  net.Send(activator)
end

net.Receive(BUY, function(len, ply)
  if len ~= 8 or not IsValid(ply) then return end
  local now = CurTime()
  local budget = budgets[ply]
  if not budget or now >= budget.resetAt then
    budget = { count = 0, resetAt = now + 1 }
    budgets[ply] = budget
  end
  if budget.count >= BUY_LIMIT then return end
  budget.count = budget.count + 1

  local session = sessions[ply]
  if not session or now > session.expiresAt then return end
  local shop = session.shop
  if not IsValid(shop) or shop:GetClass() ~= "myaddon_shop_npc" or not nearby(ply, shop) then return end

  local item = SHOP_ITEMS[net.ReadUInt(8)]
  if not item then return end
  local price = item.price
  if not isnumber(price) or price < 0 or not isfunction(item.grant) then return end
  if ply:getDarkRPVar("money") < price then return end
  ply:addMoney(-price)
  item.grant(ply)
end)

hook.Add("PlayerDisconnected", "MyShop.Cleanup", function(ply)
  sessions[ply] = nil
  budgets[ply] = nil
end)

hook.Add("EntityRemoved", "MyShop.EntityCleanup", function(ent)
  if ent:GetClass() ~= "myaddon_shop_npc" then return end
  for ply, session in pairs(sessions) do
    if session.shop == ent then sessions[ply] = nil end
  end
end)`;

describe("DarkRP shop NPC capability scoring", () => {
  test("passes a secure, bounded, optimized implementation", () => {
    const result = scoreShopNpc(response(canonical));
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Passed 12/12");
    expect(result.detail).toContain("distance");
    expect(result.detail).toContain("rate-limit");
  });

  test("reports named partial capabilities", () => {
    const incomplete = canonical
      .replace(" or not nearby(ply, shop)", "")
      .replace("if budget.count >= BUY_LIMIT then return end", "")
      .replace("budget.count = budget.count + 1", "");
    const result = scoreShopNpc(response(incomplete));
    expect(result.status).toBe("partial");
    expect(result.detail).toContain("Missing: distance, rate-limit");
    expect(result.detail).toContain("Passed 10/12");
  });

  test("does not award comments, strings, or dead helper declarations", () => {
    const insecure = `util.AddNetworkString("MyShop.Buy")
-- DistToSqr and PlayerDisconnected and SIMPLE_USE
local claims = "rate limit net.Send server catalog cleanup"
local function unusedNearby(ply, ent) return ply:GetPos():DistToSqr(ent:GetPos()) < 128 * 128 end
net.Receive("MyShop.Buy", function(len, ply)
  local price = net.ReadUInt(32)
  ply:addMoney(-price)
end)`;
    const result = scoreShopNpc(response(insecure));
    expect(result.status).toBe("incorrect");
    expect(result.detail).toContain("distance");
    expect(result.detail).toContain("rate-limit");
  });

  test("rejects client-controlled price, buyer, or shop authority", () => {
    const insecure = canonical.replace(
      "local item = SHOP_ITEMS[net.ReadUInt(8)]",
      "local buyer = net.ReadEntity()\n  local shop = net.ReadEntity()\n  local item = { price = net.ReadUInt(32), grant = function() end }",
    );
    const result = scoreShopNpc(response(insecure));
    expect(result.status).toBe("incorrect");
    expect(result.detail).toContain("client-authority");
  });

  test("does not fully pass Distance or a global network budget", () => {
    const weaker = canonical
      .replace(":DistToSqr(", ":Distance(")
      .replace("<= MAX_DISTANCE_SQR", "<= 128")
      .replace(/budgets\[ply\]/g, "budgets.global");
    const result = scoreShopNpc(response(weaker));
    expect(result.status).toBe("partial");
    expect(result.detail).toContain("Missing: distance, rate-limit");
  });

  test("requires throttling before payload parsing and mutations", () => {
    const lateLimit = canonical
      .replace(
        "  local item = SHOP_ITEMS[net.ReadUInt(8)]",
        "  local item = SHOP_ITEMS[net.ReadUInt(8)]\n  if budget.count >= BUY_LIMIT then return end",
      )
      .replace("  if budget.count >= BUY_LIMIT then return end\n", "")
      .replace("  budget.count = budget.count + 1\n", "");
    const result = scoreShopNpc(response(lateLimit));
    expect(result.status).toBe("partial");
    expect(result.detail).toContain("rate-limit");
  });

  test("requires a squared threshold, load-time pooling, and real cleanup", () => {
    const wrongDistance = canonical.replace("<= MAX_DISTANCE_SQR", "<= 128");
    expect(scoreShopNpc(response(wrongDistance)).detail).toContain(
      "Missing: distance",
    );

    const latePooling = canonical
      .replace("util.AddNetworkString(OPEN)\nutil.AddNetworkString(BUY)\n", "")
      .replace(
        "function ENT:Use(activator)",
        "function ENT:Use(activator)\n  util.AddNetworkString(OPEN)\n  util.AddNetworkString(BUY)",
      );
    expect(scoreShopNpc(response(latePooling)).detail).toContain(
      "targeted-networking",
    );

    const fakeCleanup = canonical
      .replace("  sessions[ply] = nil\n  budgets[ply] = nil", "  print(ply)")
      .replace(
        "  for ply, session in pairs(sessions) do\n    if session.shop == ent then sessions[ply] = nil end\n  end",
        "  print(ent)",
      );
    expect(scoreShopNpc(response(fakeCleanup)).detail).toContain(
      "lifecycle-compatibility",
    );
  });
});

test("minimal shop fixture loads and its canonical answer passes", async () => {
  const [fixture] = await loadFixtures(
    join(import.meta.dir, "..", "fixtures"),
    ["gmod.darkrp-shop-npc.v1"],
  );
  expect(fixture?.prompt).toStartWith("Make a DarkRP shop NPC");
  expect(fixture?.prompt).not.toContain("distance");
  expect(fixture?.prompt).not.toContain("rate");
  expect(fixture?.prompt).not.toContain("secure");
  expect(fixture?.oracle.rubricVersion).toBe("1");
  expect(scoreFixtureAnswer(fixture!, answer(canonical)).status).toBe("pass");
});

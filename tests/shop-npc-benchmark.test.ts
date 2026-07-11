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

// A fully hardened, server-authoritative reference: proximity re-check, rate
// limit, session expiry, bounded payload, load-time pooling, and cleanup.
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

// Real published answer from "Gemini 3.1 Pro (High)" on this fixture. Correct,
// safe, server-authoritative — but not hardened. It uses ENT:AcceptInput,
// ply:canAfford, ply:Give, and a two-line item read: all canonical GLua/DarkRP
// idioms the previous scorer wrongly rejected. Must score `partial`, not
// `incorrect`. Kept verbatim as a regression guard against idiom lock-in.
const geminiReal = `AddCSLuaFile()

ENT.Type = "anim"
ENT.Base = "base_gmodentity"
ENT.PrintName = "Shop NPC"
ENT.Category = "DarkRP"
ENT.Spawnable = true

if SERVER then
    util.AddNetworkString("DarkRP_ShopNPC_Open")
    util.AddNetworkString("DarkRP_ShopNPC_Buy")

    local shopItems = {
        [1] = { name = "Pistol", class = "weapon_pistol", price = 250 },
        [2] = { name = "SMG", class = "weapon_smg1", price = 500 },
        [3] = { name = "Health Kit", class = "weapon_medkit", price = 100 }
    }

    function ENT:Initialize()
        self:SetModel("models/Characters/Hostage_04.mdl")
        self:SetUseType(SIMPLE_USE)
    end

    function ENT:AcceptInput(name, activator, caller)
        if name == "Use" and IsValid(activator) and activator:IsPlayer() then
            net.Start("DarkRP_ShopNPC_Open")
            net.WriteTable(shopItems)
            net.Send(activator)
        end
    end

    net.Receive("DarkRP_ShopNPC_Buy", function(len, ply)
        local itemID = net.ReadUInt(8)
        local item = shopItems[itemID]

        if not item then return end
        if not ply:canAfford(item.price) then
            DarkRP.notify(ply, 1, 4, "You cannot afford this item.")
            return
        end

        ply:addMoney(-item.price)
        ply:Give(item.class)
    end)
end`;

// Real published answer from "opencode/hy3-free". Also correct and
// server-authoritative (ENT:Use + canAfford + per-item apply), not hardened.
const hy3Real = `AddCSLuaFile()

ENT.Type = "anim"
ENT.Base = "base_gmodentity"
ENT.Spawnable = true

local shopItems = {
    { name = "Health Kit", price = 200, apply = function(ply) ply:SetHealth(100) end },
    { name = "Lockpick",   price = 500, apply = function(ply) ply:Give("lockpick") end },
}

function ENT:Initialize()
    self:SetUseType(SIMPLE_USE)
end

if SERVER then
    util.AddNetworkString("ShopNPC_OpenMenu")
    util.AddNetworkString("ShopNPC_Buy")

    function ENT:Use(_, caller)
        if IsValid(caller) and caller:IsPlayer() then
            net.Start("ShopNPC_OpenMenu")
            net.Send(caller)
        end
    end

    net.Receive("ShopNPC_Buy", function(_, ply)
        local id = net.ReadUInt(8)
        local item = shopItems[id]
        if not item then return end
        if ply:canAfford(item.price) then
            ply:addMoney(-item.price)
            item.apply(ply)
        end
    end)
end`;

describe("DarkRP shop NPC capability scoring", () => {
  test("passes a secure, bounded, hardened implementation", () => {
    const result = scoreShopNpc(response(canonical));
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Hardening 4/4");
    expect(result.detail).toContain("Missing core: none.");
    expect(result.detail).toContain("Missing hardening: none.");
  });

  test("scores a correct-but-unhardened real answer as partial (Gemini)", () => {
    const result = scoreShopNpc(response(geminiReal));
    expect(result.status).toBe("partial");
    // All correctness concepts credited despite AcceptInput / canAfford / Give.
    expect(result.detail).toContain("Missing core: none.");
    expect(result.detail).toContain("interaction");
    expect(result.detail).toContain("affordability");
    // Hardening genuinely absent.
    expect(result.detail).toContain("Missing hardening: proximity, rate-limit");
  });

  test("scores a correct-but-unhardened real answer as partial (hy3)", () => {
    const result = scoreShopNpc(response(hy3Real));
    expect(result.status).toBe("partial");
    expect(result.detail).toContain("Missing core: none.");
  });

  test("accepts getDarkRPVar-money affordability as well as canAfford", () => {
    // canonical uses getDarkRPVar("money"); the real answers use canAfford.
    expect(scoreShopNpc(response(canonical)).detail).toContain("affordability");
    expect(scoreShopNpc(response(geminiReal)).detail).toContain(
      "affordability",
    );
  });

  test("rejects client-controlled price, buyer, or shop authority", () => {
    const insecure = canonical.replace(
      "local item = SHOP_ITEMS[net.ReadUInt(8)]",
      "local buyer = net.ReadEntity()\n  local shop2 = net.ReadEntity()\n  local item = { price = net.ReadUInt(32), grant = function() end }",
    );
    const result = scoreShopNpc(response(insecure));
    expect(result.status).toBe("incorrect");
    expect(result.detail).toContain("no-client-authority");
    expect(result.detail).toContain("server-authoritative");
  });

  test("rejects broadcasting the shop menu to everyone", () => {
    const broadcast = canonical.replace(
      "net.Send(activator)",
      "net.Broadcast()",
    );
    const result = scoreShopNpc(response(broadcast));
    expect(result.status).toBe("incorrect");
    expect(result.detail).toContain("no-broadcast-menu");
  });

  test("rejects a free shop that never checks affordability or charges", () => {
    const free = geminiReal.replace(
      'if not ply:canAfford(item.price) then\n            DarkRP.notify(ply, 1, 4, "You cannot afford this item.")\n            return\n        end\n\n        ply:addMoney(-item.price)\n        ',
      "",
    );
    const result = scoreShopNpc(response(free));
    expect(result.status).toBe("incorrect");
    expect(result.detail).toContain("affordability");
    expect(result.detail).toContain("purchase-order");
  });

  test("does not award comments, strings, or dead helper declarations", () => {
    const decoy = `util.AddNetworkString("MyShop.Buy")
-- DistToSqr and PlayerDisconnected and SIMPLE_USE and canAfford
local claims = "rate limit net.Send server catalog cleanup addMoney"
local function unusedNearby(ply, ent) return ply:GetPos():DistToSqr(ent:GetPos()) < 128 * 128 end
net.Receive("MyShop.Buy", function(len, ply)
  local price = net.ReadUInt(32)
  ply:addMoney(-price)
end)`;
    const result = scoreShopNpc(response(decoy));
    expect(result.status).toBe("incorrect");
    // Neither the dead helper nor the string decoys earn proximity/rate-limit.
    expect(result.detail).toContain("Missing hardening: proximity, rate-limit");
    expect(result.detail).toContain("interaction");
  });

  test("a stateless shop is not penalized for missing session cleanup", () => {
    // geminiReal keeps no per-player state, so lifecycle-cleanup is N/A and
    // must not appear as a missing hardening item.
    const result = scoreShopNpc(response(geminiReal));
    expect(result.detail).not.toContain("lifecycle-cleanup");
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

  test("accepts either DistToSqr or Distance for the proximity re-check", () => {
    // proximity tests the security concept (re-validate buyer location on the
    // buy packet), not the perf idiom — a one-shot :Distance() check is fine.
    const withDistance = canonical
      .replace(":DistToSqr(", ":Distance(")
      .replace("<= MAX_DISTANCE_SQR", "<= 128");
    const result = scoreShopNpc(response(withDistance));
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("Missing hardening: none.");
  });

  test("does not credit proximity for a distance check that is never called", () => {
    // Strip the nearby() call from the buy path; the helper still exists but is
    // dead in the receiver, so proximity must not be credited.
    const deadCheck = canonical.replace(" or not nearby(ply, shop)", "");
    const result = scoreShopNpc(response(deadCheck));
    expect(result.status).toBe("partial");
    expect(result.detail).toContain("proximity");
  });

  test("requires load-time network string pooling", () => {
    const latePooling = canonical
      .replace("util.AddNetworkString(OPEN)\nutil.AddNetworkString(BUY)\n", "")
      .replace(
        "function ENT:Use(activator)",
        "function ENT:Use(activator)\n  util.AddNetworkString(OPEN)\n  util.AddNetworkString(BUY)",
      );
    const result = scoreShopNpc(response(latePooling));
    expect(result.status).toBe("incorrect");
    expect(result.detail).toContain("targeted-open");
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
  expect(fixture?.oracle.rubricVersion).toBe("2");
  expect(scoreFixtureAnswer(fixture!, answer(canonical)).status).toBe("pass");
});

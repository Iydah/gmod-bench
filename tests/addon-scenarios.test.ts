import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { ValidatedResponse } from "../src/scoring";
import { loadFixtures } from "../src/fixtures/load";
import { scoreFixtureAnswer } from "../src/scoring";
import {
  stripLuaComments,
  stripLuaCommentsAndStrings,
} from "../src/scoring/code-patterns";
import { scoreHotHook } from "../src/scoring/hot-hook";
import {
  scoreHookLifecycle,
  scoreDelayedValidity,
  scoreIteratorReadonly,
} from "../src/scoring/lifecycle";
import {
  scoreNetEfficiency,
  scoreNetworkVarState,
} from "../src/scoring/net-efficiency";
import { scoreNetSecurity } from "../src/scoring/net-security";
import {
  scoreBoundedDecompression,
  scorePerPlayerNetBudget,
} from "../src/scoring/net-bounds";
import {
  scoreBoundedChunkTransfer,
  scoreTransferCleanup,
} from "../src/scoring/transfer-security";
import { scorePreventiveSpawnLimit } from "../src/scoring/spawn-security";
import { scoreDataRootConfinement } from "../src/scoring/file-security";
import { scorePredictionEffect } from "../src/scoring/prediction";
import { scoreRealmLoading } from "../src/scoring/realm-loading";
import { scoreSpatialCache } from "../src/scoring/spatial-cache";
import { scoreSqliteBatch, scoreSqliteTypedWrite } from "../src/scoring/sqlite";

function response(code: string): ValidatedResponse {
  return { answer: "", code, reason: "Reason: contract complete" };
}

function answer(code: string): string {
  return ["```lua", code, "```", "Reason: contract complete"].join("\n");
}

const scenarioIds = [
  "gmod.net-secure-entity-action.v1",
  "gmod.net-compact-targeted-update.v1",
  "gmod.networkvar-entity-state.v1",
  "gmod.hudpaint-hot-path.v1",
  "gmod.spatial-maintained-set.v1",
  "gmod.hook-object-lifecycle.v1",
  "gmod.timer-delayed-validity.v1",
  "gmod.ents-iterator-readonly.v1",
  "gmod.realm-shared-authority.v1",
  "gmod.prediction-one-shot-effect.v1",
  "gmod.sqlite-typed-write.v1",
  "gmod.sqlite-batched-transaction.v1",
] as const;

describe("Lua lexical scrubbing", () => {
  test("removes API decoys from comments and strings", () => {
    const code = `-- net.Receive and IsValid\nlocal s = "sql.QueryTyped"\nlocal long = [=[hook.Add("Think")]=]\n--[=[ ents.Iterator() ]=]\nnet.Start("x")`;
    const scrubbed = stripLuaCommentsAndStrings(code);
    expect(scrubbed).not.toContain("net.Receive");
    expect(scrubbed).not.toContain("sql.QueryTyped");
    expect(scrubbed).not.toContain("ents.Iterator");
    expect(scrubbed).not.toContain("hook.Add");
    expect(scrubbed).toContain("net.Start");
    const commentsOnly = stripLuaComments(code);
    expect(commentsOnly).toContain("sql.QueryTyped");
    expect(commentsOnly).not.toContain("ents.Iterator");
  });
});

test("all production-addon fixtures load with current Facepunch provenance", async () => {
  const fixtures = await loadFixtures(
    join(import.meta.dir, "..", "fixtures"),
    scenarioIds,
  );
  expect(fixtures).toHaveLength(scenarioIds.length);
  for (const fixture of fixtures) {
    // A dated wiki-verification stamp; bumped when a rubric is re-verified.
    expect(fixture.oracle.verifiedAt).toMatch(/^2026-07-\d{2}$/);
    expect(
      fixture.oracle.sourceUrls.some((url) =>
        url.startsWith("https://wiki.facepunch.com/gmod/"),
      ),
    ).toBe(true);
    expect(fixture.scoring.kind).toBe("plugin");
  }
});

test("canonical scenario answers pass through fixture response contracts", async () => {
  const fixtures = await loadFixtures(
    join(import.meta.dir, "..", "fixtures"),
    scenarioIds,
  );
  const byId = Object.fromEntries(
    fixtures.map((fixture) => [fixture.id, fixture]),
  );
  const answers: Record<(typeof scenarioIds)[number], string> = {
    "gmod.net-secure-entity-action.v1": `local nextUse = {} net.Receive("x", function(len, ply) if len > 24 then return end if not ply:IsAdmin() then return end if (nextUse[ply] or 0) > CurTime() then return end nextUse[ply] = CurTime() + 1 local ent = net.ReadEntity() local power = net.ReadUInt(8) if not IsValid(ent) or ent:GetOwner() ~= ply then return end if power > 100 then return end ent:SetPower(power) end)`,
    "gmod.net-compact-targeted-update.v1": `util.AddNetworkString("x") local function send(recipients, state, amount) net.Start("x") net.WriteUInt(state, 3) net.WriteUInt(amount, 10) net.Send(recipients) end`,
    "gmod.networkvar-entity-state.v1": `function ENT:SetupDataTables() self:NetworkVar("Int", "Power") end`,
    "gmod.hudpaint-hot-path.v1": `local icon = Material("x") local white = Color(255,255,255) hook.Add("HUDPaint", "x", function() local ply = LocalPlayer() if not IsValid(ply) then return end local health = ply:Health() surface.SetMaterial(icon) draw.SimpleText(health, "DermaDefault", 0, 0, white) end)`,
    "gmod.spatial-maintained-set.v1": `local tracked = {}
for _, ent in ipairs(ents.FindByClass("my_addon_ent")) do tracked[ent] = true end
hook.Add("OnEntityCreated", "a", function(ent) tracked[ent] = true end)
hook.Add("EntityRemoved", "b", function(ent) tracked[ent] = nil end)
hook.Add("Think", "c", function()
  local r2 = radius * radius
  for ent in pairs(tracked) do if ent:GetPos():DistToSqr(origin) <= r2 then use(ent) end end
end)`,
    "gmod.hook-object-lifecycle.v1": `hook.Add("MyAddon.Tick", ent, ent.Think)`,
    "gmod.timer-delayed-validity.v1": `timer.Simple(1, function() if not IsValid(ent) then return end ent:Remove() end)`,
    "gmod.ents-iterator-readonly.v1": `for _, ent in ents.Iterator() do
  if wanted(ent) then use(ent) end
end`,
    "gmod.realm-shared-authority.v1": `if SERVER then AddCSLuaFile("myaddon/shared.lua") end include("myaddon/shared.lua") if SERVER then function ApplyDamage(ply, ent) if ply:IsAdmin() then ent:TakeDamage(10, ply) end end end`,
    "gmod.prediction-one-shot-effect.v1": `function SWEP:PrimaryAttack() self:SetNextPrimaryFire(CurTime() + 1) if IsFirstTimePredicted() then util.Effect("Sparks", EffectData()) end end`,
    "gmod.sqlite-typed-write.v1": `local result = sql.QueryTyped("INSERT INTO notes(text) VALUES(?)", text) if result == false then ErrorNoHalt(sql.LastError()) end`,
    "gmod.sqlite-batched-transaction.v1": `sql.Begin()
for i = 1, math.min(#rows, 500) do
  sql.QueryTyped("INSERT INTO scores VALUES(?, ?)", rows[i].id, rows[i].score)
end
sql.Commit()`,
  };
  const failures = scenarioIds.flatMap((id) => {
    const result = scoreFixtureAnswer(byId[id]!, answer(answers[id]));
    return result.status === "pass"
      ? []
      : [`${id}: ${result.status} (${result.detail})`];
  });
  expect(failures).toEqual([]);
});

describe("secure networking", () => {
  test("passes bounded authorized owner mutation with cooldown", () => {
    const code = `local nextUse = setmetatable({}, { __mode = "k" })
net.Receive("MyAddon.SetPower", function(len, ply)
  if len > 24 then return end
  if not ply:IsAdmin() then return end
  if (nextUse[ply] or 0) > CurTime() then return end
  nextUse[ply] = CurTime() + 0.25
  local ent = net.ReadEntity()
  local power = net.ReadUInt(8)
  if not IsValid(ent) or ent:GetOwner() ~= ply then return end
  if power > 100 then return end
  ent:SetPower(power)
end)`;
    expect(scoreNetSecurity(response(code)).status).toBe("pass");
  });

  test("rejects trusting a client-sent caller", () => {
    expect(
      scoreNetSecurity(
        response(
          `net.Receive("x", function() local caller = net.ReadEntity() caller:Ban() end)`,
        ),
      ).status,
    ).toBe("incorrect");
  });

  test("passes compact targeted updates and rejects broadcast tables", () => {
    const pass = `util.AddNetworkString("MyAddon.State")\nlocal function send(recipients, state, amount) net.Start("MyAddon.State") net.WriteUInt(state, 3) net.WriteUInt(amount, 10) net.Send(recipients) end`;
    expect(scoreNetEfficiency(response(pass)).status).toBe("pass");
    expect(
      scoreNetEfficiency(
        response(`net.Start("x") net.WriteTable(data) net.Broadcast()`),
      ).status,
    ).toBe("incorrect");
  });

  test("passes datatable state and marks NW2 partial", () => {
    expect(
      scoreNetworkVarState(
        response(
          `function ENT:SetupDataTables() self:NetworkVar("Int", "Power") end`,
        ),
      ).status,
    ).toBe("pass");
    expect(
      scoreNetworkVarState(response(`ent:SetNW2Int("Power", power)`)).status,
    ).toBe("partial");
  });
});

describe("lifecycle and repeated spatial work", () => {
  test("passes a HUD hook with stable resources and per-frame value reuse", () => {
    const pass = `local icon = Material("myaddon/icon.png")
local white = Color(255, 255, 255)
hook.Add("HUDPaint", "MyAddon.HUD", function()
  local ply = LocalPlayer()
  if not IsValid(ply) or not ply:Alive() then return end
  local health = ply:Health()
  surface.SetMaterial(icon)
  surface.SetDrawColor(white)
  draw.SimpleText(health, "DermaDefault", 8, 8, white)
end)`;
    expect(scoreHotHook(response(pass)).status).toBe("pass");
    expect(
      scoreHotHook(
        response(
          `hook.Add("HUDPaint", "x", function() surface.SetMaterial(Material("x")) local a = LocalPlayer():Health() local b = LocalPlayer():Health() end)`,
        ),
      ).status,
    ).toBe("incorrect");
  });

  test("passes object-owned hooks and delayed revalidation", () => {
    expect(
      scoreHookLifecycle(response(`hook.Add("Think", ent, ent.Think)`)).status,
    ).toBe("pass");
    expect(
      scoreDelayedValidity(
        response(
          `timer.Simple(1, function() if not IsValid(ent) then return end ent:Remove() end)`,
        ),
      ).status,
    ).toBe("pass");
  });

  test("passes maintained spatial set and rejects global scans in Think", () => {
    const pass = `local tracked = {}
for _, ent in ipairs(ents.FindByClass("my_addon_ent")) do tracked[ent] = true end
hook.Add("OnEntityCreated", "Track", function(ent) if ent:GetClass() == "my_addon_ent" then tracked[ent] = true end end)
hook.Add("EntityRemoved", "Untrack", function(ent) tracked[ent] = nil end)
hook.Add("Think", "Nearby", function() local origin = target:GetPos() local r2 = radius * radius for ent in pairs(tracked) do if IsValid(ent) and ent:GetPos():DistToSqr(origin) <= r2 then use(ent) end end end)`;
    expect(scoreSpatialCache(response(pass)).status).toBe("pass");
    const missesExisting = `local tracked = {} hook.Add("OnEntityCreated", "Track", function(ent) tracked[ent] = true end) hook.Add("EntityRemoved", "Untrack", function(ent) tracked[ent] = nil end) hook.Add("Think", "Nearby", function() local r2 = radius * radius for ent in pairs(tracked) do if ent:GetPos():DistToSqr(origin) <= r2 then use(ent) end end end)`;
    expect(scoreSpatialCache(response(missesExisting)).status).toBe("partial");
    expect(
      scoreSpatialCache(
        response(
          `hook.Add("Think", "Scan", function() for _, ent in ents.Iterator() do use(ent) end end)`,
        ),
      ).status,
    ).toBe("incorrect");
  });

  test("rejects mutation of the ents.Iterator cached table", () => {
    expect(
      scoreIteratorReadonly(
        response(`local _, all = ents.Iterator() table.remove(all, 1)`),
      ).status,
    ).toBe("incorrect");
    expect(
      scoreIteratorReadonly(
        response(
          `for _, ent in ents.Iterator() do if wanted(ent) then use(ent) end end`,
        ),
      ).status,
    ).toBe("pass");
  });
});

describe("realms, prediction, and SQLite", () => {
  test("passes server distribution plus server authority", () => {
    const code = `if SERVER then AddCSLuaFile("myaddon/shared.lua") end\ninclude("myaddon/shared.lua")\nif SERVER then function ApplyDamage(ply, ent) if ply:IsAdmin() then ent:TakeDamage(10, ply) end end end`;
    expect(scoreRealmLoading(response(code)).status).toBe("pass");
  });

  test("guards only one-shot prediction effects", () => {
    const pass = `function SWEP:PrimaryAttack() self:SetNextPrimaryFire(CurTime() + 0.5) if IsFirstTimePredicted() then util.Effect("Sparks", EffectData()) end end`;
    expect(scorePredictionEffect(response(pass)).status).toBe("pass");
    const bad = `function SWEP:PrimaryAttack() if not IsFirstTimePredicted() then return end self:SetNextPrimaryFire(CurTime() + 0.5) util.Effect("Sparks", EffectData()) end`;
    expect(scorePredictionEffect(response(bad)).status).toBe("incorrect");
  });

  test("passes typed writes with error handling and transactional batches", () => {
    const write = `local result = sql.QueryTyped("INSERT INTO notes(text) VALUES(?)", text) if result == false then ErrorNoHalt(sql.LastError()) end`;
    expect(scoreSqliteTypedWrite(response(write)).status).toBe("pass");
    expect(
      scoreSqliteTypedWrite(
        response(`sql.Query("INSERT INTO notes VALUES('" .. text .. "')")`),
      ).status,
    ).toBe("incorrect");
    const batch = `sql.Begin() for i = 1, math.min(#rows, 500) do sql.QueryTyped("INSERT INTO scores VALUES(?, ?)", rows[i].id, rows[i].score) end sql.Commit()`;
    expect(scoreSqliteBatch(response(batch)).status).toBe("pass");
  });
});

// Regression guards against idiom lock-in: these are correct answers (several
// are verbatim published model answers) that the pre-2026-07-11 scorers wrongly
// graded "incorrect" by matching one reference's exact variables and phrasing.
describe("concept-based scoring accepts idiom variants", () => {
  test("sql.SQLStr with error handling is safe-but-not-preferred (partial)", () => {
    // Verbatim "Gemini 3.1 Pro (High)" answer — safe, correct, previously
    // marked incorrect because it concatenates sql.SQLStr output.
    const geminiSqlStr = `local safe_text = sql.SQLStr(text)
local result = sql.Query("INSERT INTO notes(text) VALUES(" .. safe_text .. ")")
if result == false then
  ErrorNoHalt("Database Insertion Error: " .. sql.LastError() .. "\\n")
end`;
    expect(scoreSqliteTypedWrite(response(geminiSqlStr)).status).toBe(
      "partial",
    );
  });

  test("QueryTyped without error handling is partial, not pass", () => {
    expect(
      scoreSqliteTypedWrite(
        response(`sql.QueryTyped("INSERT INTO notes(text) VALUES(?)", text)`),
      ).status,
    ).toBe("partial");
  });

  test("maintained spatial set passes under any set name and squared form", () => {
    // Descriptive set name + precomputed squared radius (the common real idiom),
    // previously failed because the scorer required `tracked` and `radius*radius`.
    const owned = `local owned = {}
local RADIUS_SQR = 500 * 500
for _, ent in ipairs(ents.FindByClass("my_addon_ent")) do owned[ent] = true end
hook.Add("OnEntityCreated", "a", function(ent) if ent:GetClass() == "my_addon_ent" then owned[ent] = true end end)
hook.Add("EntityRemoved", "b", function(ent) owned[ent] = nil end)
hook.Add("Think", "c", function()
  local origin = target:GetPos()
  for ent in pairs(owned) do
    if IsValid(ent) and origin:DistToSqr(ent:GetPos()) <= RADIUS_SQR then use(ent) end
  end
end)`;
    expect(scoreSpatialCache(response(owned)).status).toBe("pass");
  });

  test("bounded decompression passes with a bytes variable and type-check guard", () => {
    // Verbatim "Gemini 3.1 Pro (High)" answer — textbook-correct; previously
    // failed only for storing bytes in a variable and using type(d)=="string".
    const geminiDecomp = `util.AddNetworkString("MyAddon.Upload")
net.Receive("MyAddon.Upload", function(len, ply)
  if not IsValid(ply) or not ply:IsAdmin() then return end
  local compressedLen = math.floor(len / 8)
  if compressedLen == 0 or compressedLen > 32768 then return end
  local compressedData = net.ReadData(compressedLen)
  local decoded = util.Decompress(compressedData, 262144)
  if type(decoded) == "string" and decoded ~= "" then
    consume(decoded)
  end
end)`;
    expect(scoreBoundedDecompression(response(geminiDecomp)).status).toBe(
      "pass",
    );
  });
});

// Security scorers: correct answers that use real-world idiom variants the old
// exact-match scorers wrongly failed. Each mirrors a verbatim published answer.
describe("security scorers accept correct idiom variants", () => {
  test("net-security: CPPI ownership + clamped value passes", () => {
    const code = `net.Receive("MyAddon.SetPower", function(len, ply)
  if not IsValid(ply) then return end
  ply.NextSet = ply.NextSet or 0
  if CurTime() < ply.NextSet then return end
  ply.NextSet = CurTime() + 0.1
  if not ply:IsAdmin() then return end
  local ent = net.ReadEntity()
  if not IsValid(ent) then return end
  local owner = ent.CPPIGetOwner and ent:CPPIGetOwner() or ent:GetOwner()
  if owner ~= ply then return end
  local power = math.Clamp(net.ReadUInt(7), 0, 100)
  if ent.SetPower then ent:SetPower(power) end
end)`;
    expect(scoreNetSecurity(response(code)).status).toBe("pass");
  });

  test("per-player-budget: player-field state + floor window passes", () => {
    const code = `util.AddNetworkString("MyAddon.Action")
net.Receive("MyAddon.Action", function(len, ply)
  if len > 64 then return end
  local w = math.floor(CurTime())
  if ply.ActWindow ~= w then ply.ActWindow = w; ply.ActCount = 0 end
  if ply.ActCount >= 20 then return end
  ply.ActCount = ply.ActCount + 1
  local ent = net.ReadEntity()
  if IsValid(ent) then perform(ent) end
end)
hook.Add("PlayerDisconnected", "c", function(ply) ply.ActWindow = nil ply.ActCount = nil end)`;
    expect(scorePerPlayerNetBudget(response(code)).status).toBe("pass");
  });

  test("spawn: SteamID key + floor window + count > 10 passes", () => {
    const code = `local rl = {}
hook.Add("PlayerSpawnProp", "x", function(ply)
  local id = ply:SteamID64()
  local w = math.floor(CurTime())
  rl[id] = rl[id] or { window = w, count = 0 }
  if rl[id].window ~= w then rl[id].window = w; rl[id].count = 0 end
  rl[id].count = rl[id].count + 1
  if rl[id].count > 10 then return false end
end)
hook.Add("PlayerDisconnected", "y", function(ply) rl[ply:SteamID64()] = nil end)`;
    expect(scorePreventiveSpawnLimit(response(code)).status).toBe("pass");
  });

  test("realm: server-authoritative via early return + validity check passes", () => {
    const code = `if SERVER then AddCSLuaFile("myaddon/shared.lua") end
include("myaddon/shared.lua")
function ApplyDamage(ply, ent, dmg)
  if not SERVER then return end
  if IsValid(ply) and ply:IsPlayer() and IsValid(ent) then ent:TakeDamage(dmg, ply, ply) end
end`;
    expect(scoreRealmLoading(response(code)).status).toBe("pass");
  });

  test("chunk-transfer: inline literals + counter-received passes", () => {
    const code = `util.AddNetworkString("MyAddon.Chunk")
net.Receive("MyAddon.Chunk", function(len, ply)
  local id = net.ReadUInt(32)
  local index = net.ReadUInt(16)
  local size = net.ReadUInt(16)
  local transfer = transfers[ply]
  if not transfer or transfer.id ~= id then return end
  if index < 1 or index > 64 then return end
  if size > 24000 then return end
  if size > net.BytesLeft() then return end
  transfer.chunks = transfer.chunks or {}
  if transfer.chunks[index] then return end
  transfer.totalBytes = transfer.totalBytes or 0
  if transfer.totalBytes + size > 1048576 then return end
  local data = net.ReadData(size)
  transfer.chunks[index] = data
  transfer.received = (transfer.received or 0) + 1
  transfer.totalBytes = transfer.totalBytes + size
  transfer.lastActivity = CurTime()
end)`;
    expect(scoreBoundedChunkTransfer(response(code)).status).toBe("pass");
  });

  test("transfer-cleanup: peer local + subtraction timeout passes", () => {
    const code = `local function cancelTransfer(ply)
  local data = transfers[ply]
  if not data then return end
  local peer = data.peer
  transfers[ply] = nil
  if IsValid(peer) then transfers[peer] = nil notifyCancelled(peer) end
end
hook.Add("PlayerDisconnected", "d", function(ply) cancelTransfer(ply) end)
timer.Create("t", 1, 0, function()
  local now = CurTime()
  for ply, data in pairs(transfers) do
    if now - data.lastActivity >= 30 then cancelTransfer(ply) end
  end
end)`;
    expect(scoreTransferCleanup(response(code)).status).toBe("pass");
  });

  test("file-confinement: missing ./.. guard is a fair partial, not incorrect", () => {
    const code = `net.Receive("MyAddon.ReadUpload", function(len, ply)
  if not IsValid(ply) or not ply:IsSuperAdmin() then return end
  local filename = net.ReadString()
  if not filename or #filename == 0 or #filename > 64 then return end
  if not string.match(filename, "^[a-zA-Z0-9_%.%-]+$") then return end
  local f = file.Open("myaddon/uploads/" .. filename, "rb", "DATA")
  if not f then return end
  local data = f:Read(65536)
  f:Close()
  if data then consume(data) end
end)`;
    const result = scoreDataRootConfinement(response(code));
    expect(result.status).toBe("partial");
    expect(result.detail).toContain("traversalReject");
  });
});

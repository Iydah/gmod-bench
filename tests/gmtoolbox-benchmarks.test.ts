import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { loadFixtures } from "../src/fixtures/load";
import type { ValidatedResponse } from "../src/scoring";
import { scoreFixtureAnswer } from "../src/scoring";
import { scoreDataRootConfinement } from "../src/scoring/file-security";
import {
  scoreBoundedDecompression,
  scorePerPlayerNetBudget,
} from "../src/scoring/net-bounds";
import { scorePreventiveSpawnLimit } from "../src/scoring/spawn-security";
import {
  scoreBoundedChunkTransfer,
  scoreTransferCleanup,
} from "../src/scoring/transfer-security";

function response(code: string): ValidatedResponse {
  return { answer: "", code, reason: "Reason: contract complete" };
}

function answer(code: string): string {
  return ["```lua", code, "```", "Reason: contract complete"].join("\n");
}

const fixtureIds = [
  "gmod.net-bounded-decompression.v1",
  "gmod.spawn-preventive-rate-limit.v1",
  "gmod.net-per-player-budget.v1",
  "gmod.net-bounded-chunk-transfer.v1",
  "gmod.transfer-lifecycle-cleanup.v1",
  "gmod.file-data-root-confinement.v1",
] as const;

describe("bounded compressed payload", () => {
  const pass = `local MAX_COMPRESSED = 32768
local MAX_DECOMPRESSED = 262144
util.AddNetworkString("MyAddon.Upload")
net.Receive("MyAddon.Upload", function(len, ply)
  if len > MAX_COMPRESSED * 8 then return end
  if not ply:IsAdmin() then return end
  local compressed = net.ReadData(len / 8)
  local decoded = util.Decompress(compressed, MAX_DECOMPRESSED)
  if not decoded then return end
  consume(decoded)
end)`;

  test("requires compressed and decompressed bounds before use", () => {
    expect(scoreBoundedDecompression(response(pass)).status).toBe("pass");
    expect(
      scoreBoundedDecompression(
        response(`net.Receive("x", function(len, ply)
          local data = net.ReadData(len / 8)
          consume(util.Decompress(data))
        end)`),
      ).status,
    ).toBe("incorrect");
  });

  test("does not accept API names hidden in comments or strings", () => {
    expect(
      scoreBoundedDecompression(
        response(`-- util.Decompress(data, 262144)
          local decoy = "if len > 32768 * 8 then return end"
          net.Receive("x", function(len, ply) consume(net.ReadData(len / 8)) end)`),
      ).status,
    ).toBe("incorrect");
  });

  test("requires constant network pooling before the receiver", () => {
    expect(
      scoreBoundedDecompression(
        response(`net.Receive("x", function(len, ply)
          util.AddNetworkString("x")
          if len > 32768 * 8 then return end
          if not ply:IsAdmin() then return end
          local data = net.ReadData(len / 8)
          local decoded = util.Decompress(data, 262144)
          if not decoded then return end
          consume(decoded)
        end)`),
      ).status,
    ).not.toBe("pass");
  });

  test("requires the declared limits and consumes only decoded data", () => {
    expect(
      scoreBoundedDecompression(response(pass.replace("262144", "1048576")))
        .status,
    ).not.toBe("pass");
    expect(
      scoreBoundedDecompression(
        response(pass.replace("  consume(decoded)\n", "")),
      ).status,
    ).not.toBe("pass");
  });
});

describe("preventative spawn throttling", () => {
  const pass = `local windows = setmetatable({}, { __mode = "k" })
hook.Add("PlayerSpawnProp", "MyAddon.PropBudget", function(ply)
  local now = CurTime()
  local state = windows[ply]
  if not state or now >= state.resetAt then
    state = { count = 0, resetAt = now + 1 }
    windows[ply] = state
  end
  if state.count >= 10 then return false end
  state.count = state.count + 1
end)
hook.Add("PlayerDisconnected", "MyAddon.PropBudgetCleanup", function(ply)
  windows[ply] = nil
end)`;

  test("denies before creation and preserves later hooks when allowed", () => {
    expect(scorePreventiveSpawnLimit(response(pass)).status).toBe("pass");
    expect(
      scorePreventiveSpawnLimit(
        response(`hook.Add("PlayerSpawnedProp", "x", function(ply, model, ent)
          if tooFast(ply) then ent:Remove() end
        end)`),
      ).status,
    ).toBe("incorrect");
    expect(
      scorePreventiveSpawnLimit(
        response(`hook.Add("PlayerSpawnProp", "x", function(ply)
          if tooFast(ply) then return false end
          return true
        end)`),
      ).status,
    ).toBe("incorrect");
  });

  test("enforces the specified ten-per-second window", () => {
    expect(
      scorePreventiveSpawnLimit(response(pass.replace(">= 10", ">= 100")))
        .status,
    ).not.toBe("pass");
    expect(
      scorePreventiveSpawnLimit(response(pass.replace("now + 1", "now + 60")))
        .status,
    ).not.toBe("pass");
  });
});

describe("per-player network budget", () => {
  const pass = `local budgets = setmetatable({}, { __mode = "k" })
local LIMIT = 20
util.AddNetworkString("MyAddon.Action")
net.Receive("MyAddon.Action", function(len, ply)
  if len > 64 then return end
  local now = CurTime()
  local state = budgets[ply]
  if not state or now >= state.resetAt then
    state = { count = 0, resetAt = now + 1 }
    budgets[ply] = state
  end
  if state.count >= LIMIT then return end
  state.count = state.count + 1
  local ent = net.ReadEntity()
  if not IsValid(ent) then return end
  perform(ent)
end)
hook.Add("PlayerDisconnected", "MyAddon.ActionCleanup", function(ply)
  budgets[ply] = nil
end)`;

  test("checks a bounded sender-owned budget before parsing", () => {
    expect(scorePerPlayerNetBudget(response(pass)).status).toBe("pass");
    expect(
      scorePerPlayerNetBudget(
        response(`local count = 0
          net.Receive("x", function(len, ply)
            local ent = net.ReadEntity()
            count = count + 1
            if count > 20 then return end
            perform(ent)
          end)`),
      ).status,
    ).toBe("incorrect");
  });

  test("requires the specified budget and validated action", () => {
    expect(
      scorePerPlayerNetBudget(response(pass.replace(">= LIMIT", ">= 200")))
        .status,
    ).not.toBe("pass");
    expect(
      scorePerPlayerNetBudget(response(pass.replace("  perform(ent)\n", "")))
        .status,
    ).not.toBe("pass");
  });
});

describe("bounded chunk transfer", () => {
  const pass = `local transfers = setmetatable({}, { __mode = "k" })
local MAX_CHUNKS, MAX_CHUNK_BYTES, MAX_TOTAL_BYTES = 64, 24000, 1048576
util.AddNetworkString("MyAddon.Chunk")
net.Receive("MyAddon.Chunk", function(len, ply)
  if len > (32 + 16 + 16 + MAX_CHUNK_BYTES * 8) then return end
  local id = net.ReadUInt(32)
  local index = net.ReadUInt(16)
  local size = net.ReadUInt(16)
  local transfer = transfers[ply]
  if not transfer or transfer.id ~= id then return end
  if index < 1 or index > MAX_CHUNKS or index > transfer.totalChunks then return end
  if size < 1 or size > MAX_CHUNK_BYTES then return end
  local bytesLeft = net.BytesLeft()
  if size > bytesLeft then return end
  if transfer.received[index] then return end
  if transfer.totalBytes + size > MAX_TOTAL_BYTES then return end
  local data = net.ReadData(size)
  transfer.received[index] = true
  transfer.chunks[index] = data
  transfer.totalBytes = transfer.totalBytes + size
  transfer.lastActivity = CurTime()
end)`;

  test("binds bounded nonduplicate chunks to sender-owned state", () => {
    expect(scoreBoundedChunkTransfer(response(pass)).status).toBe("pass");
    expect(
      scoreBoundedChunkTransfer(
        response(`local chunks = {}
          net.Receive("x", function(len, ply)
            local index = net.ReadUInt(16)
            local size = net.ReadUInt(16)
            chunks[index] = net.ReadData(size)
          end)`),
      ).status,
    ).toBe("incorrect");
  });

  test("requires the declared maximum message size before reading fields", () => {
    expect(
      scoreBoundedChunkTransfer(
        response(pass.replace("32 + 16 + 16 + MAX_CHUNK_BYTES * 8", "64")),
      ).status,
    ).not.toBe("pass");
  });

  test("rejects a declared chunk larger than the remaining message", () => {
    expect(
      scoreBoundedChunkTransfer(
        response(
          pass.replace(
            "  local bytesLeft = net.BytesLeft()\n  if size > bytesLeft then return end\n",
            "",
          ),
        ),
      ).status,
    ).not.toBe("pass");
  });

  test("requires exact caps and commits accepted chunk state", () => {
    expect(
      scoreBoundedChunkTransfer(
        response(pass.replace("64, 24000, 1048576", "640, 24000, 1048576")),
      ).status,
    ).not.toBe("pass");
    expect(
      scoreBoundedChunkTransfer(
        response(pass.replace("  transfer.chunks[index] = data\n", "")),
      ).status,
    ).not.toBe("pass");
  });
});

describe("transfer lifecycle cleanup", () => {
  const pass = `local transfers = setmetatable({}, { __mode = "k" })
local function cancelTransfer(ply)
  local transfer = transfers[ply]
  if not transfer then return end
  if IsValid(transfer.peer) then notifyCancelled(transfer.peer) end
  transfers[transfer.peer] = nil
  transfers[ply] = nil
end
hook.Add("PlayerDisconnected", "MyAddon.TransferCleanup", cancelTransfer)
timer.Create("MyAddon.TransferTimeouts", 1, 0, function()
  local now = CurTime()
  for ply, transfer in pairs(transfers) do
    if not IsValid(ply) or now - transfer.lastActivity > 30 then
      cancelTransfer(ply)
    end
  end
end)`;

  test("cleans both peers on disconnect and inactivity", () => {
    expect(scoreTransferCleanup(response(pass)).status).toBe("pass");
    expect(
      scoreTransferCleanup(
        response(`local transfers = {}
          hook.Add("PlayerDisconnected", "x", function(ply)
            transfers[ply] = nil
          end)`),
      ).status,
    ).toBe("partial");
  });

  test("requires the specified sweep interval and peer notification", () => {
    expect(
      scoreTransferCleanup(response(pass.replace(", 1, 0,", ", 10, 0,")))
        .status,
    ).not.toBe("pass");
    expect(
      scoreTransferCleanup(
        response(
          pass.replace(
            "  if IsValid(transfer.peer) then notifyCancelled(transfer.peer) end\n",
            "",
          ),
        ),
      ).status,
    ).not.toBe("pass");
  });
});

describe("DATA root confinement", () => {
  const pass = `local function safeName(name)
  if not isstring(name) or #name > 64 then return nil end
  if not string.match(name, "^[%w_.-]+$") then return nil end
  if name == "." or name == ".." then return nil end
  return "myaddon/uploads/" .. name
end
net.Receive("MyAddon.ReadUpload", function(len, ply)
  if len > 520 then return end
  if not ply:IsSuperAdmin() then return end
  local path = safeName(net.ReadString())
  if not path then return end
  local handle = file.Open(path, "rb", "DATA")
  if not handle then return end
  local data = handle:Read(65536)
  handle:Close()
  consume(data)
end)`;

  test("constructs a fixed DATA path from one validated segment", () => {
    expect(scoreDataRootConfinement(response(pass)).status).toBe("pass");
    expect(
      scoreDataRootConfinement(
        response(`net.Receive("x", function(len, ply)
          local path = net.ReadString()
          consume(file.Read(path, "GAME"))
        end)`),
      ).status,
    ).toBe("incorrect");
  });

  test("rejects dot directory segments explicitly", () => {
    expect(
      scoreDataRootConfinement(
        response(
          pass.replace(
            '  if name == "." or name == ".." then return nil end\n',
            "",
          ),
        ),
      ).status,
    ).not.toBe("pass");
  });

  test("requires the exact filename and read bounds plus final use", () => {
    expect(
      scoreDataRootConfinement(
        response(pass.replace("#name > 64", "#name > 640")),
      ).status,
    ).not.toBe("pass");
    expect(
      scoreDataRootConfinement(response(pass.replace("  consume(data)\n", "")))
        .status,
    ).not.toBe("pass");
  });
});

test("new GMToolbox-inspired fixtures load and canonical answers pass", async () => {
  const fixtures = await loadFixtures(
    join(import.meta.dir, "..", "fixtures"),
    fixtureIds,
  );
  expect(fixtures).toHaveLength(fixtureIds.length);
  for (const fixture of fixtures) {
    expect(fixture.oracle.verifiedAt).toMatch(/^2026-07-\d{2}$/);
    expect(
      fixture.oracle.sourceUrls.every((url) =>
        url.startsWith("https://wiki.facepunch.com/gmod/"),
      ),
    ).toBe(true);
  }

  const canonical: Record<(typeof fixtureIds)[number], string> = {
    "gmod.net-bounded-decompression.v1": `local MAX_IN, MAX_OUT = 32768, 262144 util.AddNetworkString("MyAddon.Upload") net.Receive("MyAddon.Upload", function(len, ply) if len > MAX_IN * 8 then return end if not ply:IsAdmin() then return end local data = net.ReadData(len / 8) local decoded = util.Decompress(data, MAX_OUT) if not decoded then return end consume(decoded) end)`,
    "gmod.spawn-preventive-rate-limit.v1": `local states = setmetatable({}, {__mode="k"}) hook.Add("PlayerSpawnProp", "limit", function(ply) local now = CurTime() local state = states[ply] if not state or now >= state.resetAt then state={count=0,resetAt=now+1} states[ply]=state end if state.count >= 10 then return false end state.count=state.count+1 end) hook.Add("PlayerDisconnected", "clean", function(ply) states[ply]=nil end)`,
    "gmod.net-per-player-budget.v1": `local states=setmetatable({}, {__mode="k"}) util.AddNetworkString("MyAddon.Action") net.Receive("MyAddon.Action", function(len,ply) if len > 64 then return end local now=CurTime() local state=states[ply] if not state or now >= state.resetAt then state={count=0,resetAt=now+1} states[ply]=state end if state.count >= 20 then return end state.count=state.count+1 local ent=net.ReadEntity() if not IsValid(ent) then return end perform(ent) end) hook.Add("PlayerDisconnected","clean",function(ply) states[ply]=nil end)`,
    "gmod.net-bounded-chunk-transfer.v1": `local transfers=setmetatable({}, {__mode="k"}) local MAX_CHUNKS,MAX_CHUNK_BYTES,MAX_TOTAL_BYTES=64,24000,1048576 util.AddNetworkString("MyAddon.Chunk") net.Receive("MyAddon.Chunk",function(len,ply) if len > 32+16+16+MAX_CHUNK_BYTES*8 then return end local id=net.ReadUInt(32) local index=net.ReadUInt(16) local size=net.ReadUInt(16) local transfer=transfers[ply] if not transfer or transfer.id ~= id then return end if index < 1 or index > MAX_CHUNKS or index > transfer.totalChunks then return end if size < 1 or size > MAX_CHUNK_BYTES then return end local bytesLeft=net.BytesLeft() if size > bytesLeft then return end if transfer.received[index] then return end if transfer.totalBytes + size > MAX_TOTAL_BYTES then return end local data=net.ReadData(size) transfer.received[index]=true transfer.chunks[index]=data transfer.totalBytes=transfer.totalBytes+size transfer.lastActivity=CurTime() end)`,
    "gmod.transfer-lifecycle-cleanup.v1": `local transfers=setmetatable({}, {__mode="k"}) local function cancelTransfer(ply) local transfer=transfers[ply] if not transfer then return end if IsValid(transfer.peer) then notifyCancelled(transfer.peer) end transfers[transfer.peer]=nil transfers[ply]=nil end hook.Add("PlayerDisconnected","clean",cancelTransfer) timer.Create("timeouts",1,0,function() local now=CurTime()
for ply,transfer in pairs(transfers) do
  if not IsValid(ply) or now-transfer.lastActivity>30 then cancelTransfer(ply) end
end end)`,
    "gmod.file-data-root-confinement.v1": `local function safeName(name) if not isstring(name) or #name>64 then return nil end if not string.match(name,"^[%w_.-]+$") then return nil end if name=="." or name==".." then return nil end return "myaddon/uploads/"..name end net.Receive("MyAddon.ReadUpload",function(len,ply) if len>520 then return end if not ply:IsSuperAdmin() then return end local path=safeName(net.ReadString()) if not path then return end local handle=file.Open(path,"rb","DATA") if not handle then return end local data=handle:Read(65536) handle:Close() consume(data) end)`,
  };

  for (const fixture of fixtures) {
    const result = scoreFixtureAnswer(
      fixture,
      answer(canonical[fixture.id as (typeof fixtureIds)[number]]),
    );
    expect(`${fixture.id}: ${result.status} (${result.detail})`).toBe(
      `${fixture.id}: pass (${result.detail})`,
    );
  }
});

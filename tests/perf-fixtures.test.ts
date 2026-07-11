import { expect, test } from "bun:test";
import { join } from "node:path";

import { listFixtureIds, loadFixtures } from "../src/fixtures/load";
import { scoreFixtureAnswer } from "../src/scoring";

const fixturesRoot = join(import.meta.dir, "..", "fixtures");

function answer(code: string): string {
  return [
    "```lua",
    code,
    "```",
    "Reason: Performance-oriented GMod pattern.",
  ].join("\n");
}

test("loads every public fixture", async () => {
  const ids = await listFixtureIds(fixturesRoot);
  expect(ids.length).toBeGreaterThanOrEqual(30);
  const fixtures = await loadFixtures(fixturesRoot, ids);
  expect(fixtures).toHaveLength(ids.length);
  for (const fixture of fixtures) {
    expect(fixture.id).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
    expect(fixture.oracle.sourceUrls.length).toBeGreaterThan(0);
  }
});

test("perf regex fixtures grade clear winners", async () => {
  const fixtures = await loadFixtures(fixturesRoot, [
    "gmod.perf.table-hasvalue.v1",
    "gmod.perf.steamid-cache.v1",
    "gmod.perf.find-players-near.v1",
    "gmod.perf.looking-at.v1",
    "gmod.perf.darkrpvar.v1",
    "gmod.perf.sqlite-vs-mysql.v1",
    "gmod.perf.table-count-hash.v1",
    "gmod.perf.string-table-concat.v1",
    "gmod.perf.for-vs-while.v1",
    "gmod.perf.x-times-x.v1",
    "gmod.perf.meta-vs-arg.v1",
    "gmod.perf.localplayer-cache.v1",
    "gmod.perf.pairs-ipairs-for.v1",
    "gmod.perf.table-random.v1",
  ]);
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.table-hasvalue.v1"]!,
      answer("if set[value] then end"),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.pairs-ipairs-for.v1"]!,
      answer("local n = #t\nfor i = 1, n do\n  local value = t[i]\nend"),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.table-random.v1"]!,
      answer(
        "local n = #t\nif n == 0 then return nil end\nreturn t[math.random(n)]",
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.localplayer-cache.v1"]!,
      answer(
        [
          "local cachedPlayer",
          'hook.Add("InitPostEntity", "cache", function()',
          "  cachedPlayer = LocalPlayer()",
          "end)",
        ].join("\n"),
      ),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.localplayer-cache.v1"]!,
      answer(
        'local LocalPlayer = LocalPlayer\nhook.Add("HUDPaint", "hot", function()\n  local ply = LocalPlayer()\n  if not IsValid(ply) then return end\nend)',
      ),
    ).status,
  ).toBe("partial");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.localplayer-cache.v1"]!,
      answer(
        "local cached\nlocal function getCached()\n  if not cached or not cached:IsValid() then cached = LocalPlayer() end\n  return cached\nend",
      ),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.table-hasvalue.v1"]!,
      answer("if table.HasValue(t, v) then end"),
    ).status,
  ).toBe("incorrect");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.steamid-cache.v1"]!,
      answer(
        [
          "local cache = {}",
          "local function sid(ply)",
          "  cache[ply] = cache[ply] or ply:SteamID()",
          "  return cache[ply]",
          "end",
        ].join("\n"),
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.find-players-near.v1"]!,
      answer(
        [
          "for _, ply in player.Iterator() do",
          "  if ply:GetPos():DistToSqr(pos) < r2 then end",
          "end",
        ].join("\n"),
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.looking-at.v1"]!,
      answer("local d = a:GetAimVector():DistToSqr(-b:GetAimVector())"),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.darkrpvar.v1"]!,
      answer('local job = ply:getDarkRPVar("job")'),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.sqlite-vs-mysql.v1"]!,
      answer('local r = sql.Query("SELECT 1")'),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.table-count-hash.v1"]!,
      answer("local n = #t"),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.table-count-hash.v1"]!,
      answer("local n = table.Count(t)"),
    ).status,
  ).toBe("incorrect");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.string-table-concat.v1"]!,
      answer("local s = table.concat(parts)"),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.for-vs-while.v1"]!,
      answer("for i = 1, n do end"),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.for-vs-while.v1"]!,
      answer("while i <= n do i = i + 1 end"),
    ).status,
  ).toBe("partial");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.x-times-x.v1"]!,
      answer("local y = x * x"),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.x-times-x.v1"]!,
      answer("local y = math.pow(x, 2)"),
    ).status,
  ).toBe("incorrect");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.meta-vs-arg.v1"]!,
      answer("SomeHelper(ply)"),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.meta-vs-arg.v1"]!,
      answer("ply:SomeHelper()"),
    ).status,
  ).toBe("incorrect");
});

test("comparison loops are graded semantically instead of rejected as format", async () => {
  const fixtures = await loadFixtures(fixturesRoot, [
    "gmod.perf.string-table-concat.v1",
    "gmod.perf.find-ents-near.v1",
  ]);
  const [concat, nearby] = fixtures;
  expect(
    scoreFixtureAnswer(
      concat!,
      "```lua\nlocal out = ''\nfor _, piece in ipairs(pieces) do out = out .. piece end\nlocal out = table.concat(pieces)\n```\nReason: table.concat avoids repeated intermediate allocations.",
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      nearby!,
      "```lua\nfor _, ent in ipairs(ents.FindInSphere(ply:GetPos(), 256)) do print(ent) end\n```\nReason: FindInSphere performs the spatial query directly.",
    ).status,
  ).toBe("partial");
});

test("SOL Max documented optimization answers receive full credit", async () => {
  const fixtures = await loadFixtures(fixturesRoot, [
    "gmod.perf.angle-zero.v1",
    "gmod.perf.looking-at.v1",
    "gmod.perf.hook-once.v1",
  ]);
  const byId = Object.fromEntries(
    fixtures.map((fixture) => [fixture.id, fixture]),
  );

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.angle-zero.v1"]!,
      answer(
        "local ZERO_ANGLE = angle_zero\nlocal ang = ZERO_ANGLE -- treat as read-only",
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.looking-at.v1"]!,
      answer(
        "local FACING_DOT = -0.8\nreturn playerA:GetAimVector():Dot(playerB:GetAimVector()) <= FACING_DOT",
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.hook-once.v1"]!,
      answer(
        [
          "local function slowComparison()",
          "for _, ply in ipairs(player.GetAll()) do",
          '  hook.Run("CustomPlayerTick", ply)',
          "end",
          "end",
          'hook.Run("CustomPlayersTick", player.GetAll())',
          "for i = 1, #players do CustomLogic(players[i]) end",
        ].join("\n"),
      ),
    ).status,
  ).toBe("pass");
});

test("documented top-ten answers are not rejected by brittle response shapes", async () => {
  const fixtures = await loadFixtures(fixturesRoot, [
    "gmod.perf.table-hasvalue.v1",
    "gmod.perf.hudpaint-cache.v1",
    "gmod.perf.seq-tables.v1",
    "gmod.perf.ply-table-index.v1",
    "gmod.perf.ents-iterator.v1",
    "gmod.perf.config-var.v1",
  ]);
  const byId = Object.fromEntries(
    fixtures.map((fixture) => [fixture.id, fixture]),
  );

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.table-hasvalue.v1"]!,
      answer(
        'local set = {}\nfor _, value in ipairs(list) do set[value] = true end\nif set["admin"] then print("found") end',
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.hudpaint-cache.v1"]!,
      answer(
        'local ply\nhook.Add("HUDPaint", "hud", function()\n  ply = ply or LocalPlayer()\n  local health = ply:Health()\n  draw.SimpleText(health, "DermaDefault", 0, 0)\nend)',
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.seq-tables.v1"]!,
      answer('local values = { "a", "b", "c" }'),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.ply-table-index.v1"]!,
      answer(
        "local values = {}\nfor _, ply in player.Iterator() do\n  local value = values[ply]\nend",
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.ents-iterator.v1"]!,
      answer(
        "if ents.Iterator then\n  for _, ent in ents.Iterator() do end\nelse\n  for _, ent in ipairs(ents.GetAll()) do end\nend",
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.config-var.v1"]!,
      answer(
        "local cached_color = myaddon.config.color\nlocal color = cached_color",
      ),
    ).status,
  ).toBe("partial");
});

test("entity-owned SteamID cache helpers pass without rewarding global method replacement", async () => {
  const [fixture] = await loadFixtures(fixturesRoot, [
    "gmod.perf.steamid-cache.v1",
  ]);

  expect(
    scoreFixtureAnswer(
      fixture!,
      answer(
        "local function CachedSteamID(ply)\n  local id = ply.__cachedSteamID\n  if id == nil then id = ply:SteamID(); ply.__cachedSteamID = id end\n  return id\nend",
      ),
    ).status,
  ).toBe("pass");

  expect(
    scoreFixtureAnswer(
      fixture!,
      answer(
        'local meta = FindMetaTable("Player")\nlocal original = meta.SteamID\nfunction meta:SteamID() self._id = self._id or original(self); return self._id end',
      ),
    ).status,
  ).toBe("partial");
});

test("iterator scorers validate bindings and class filtering, not API mentions", async () => {
  const fixtures = await loadFixtures(fixturesRoot, [
    "gmod.ents-iterator.v1",
    "gmod.perf.ents-iterator.v1",
    "gmod.perf.find-players-near.v1",
  ]);
  const byId = Object.fromEntries(
    fixtures.map((fixture) => [fixture.id, fixture]),
  );

  expect(
    scoreFixtureAnswer(
      byId["gmod.ents-iterator.v1"]!,
      answer(
        'for ent in ents.Iterator() do\n  if ent:GetClass() == "prop_physics" then end\nend',
      ),
    ).status,
  ).toBe("incorrect");
  expect(
    scoreFixtureAnswer(
      byId["gmod.ents-iterator.v1"]!,
      answer('for _, ent in ents.Iterator("prop_physics") do end'),
    ).status,
  ).toBe("incorrect");
  expect(
    scoreFixtureAnswer(
      byId["gmod.ents-iterator.v1"]!,
      answer(
        'for _, ent in ents.Iterator() do\n  if ent:GetClass() == "prop_physics" then end\nend',
      ),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.ents-iterator.v1"]!,
      answer("for ent in ents.Iterator() do print(ent) end"),
    ).status,
  ).toBe("incorrect");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.find-players-near.v1"]!,
      answer(
        "for ply in player.Iterator() do\n  if ply:GetPos():DistToSqr(origin) < radiusSqr then end\nend",
      ),
    ).status,
  ).toBe("incorrect");
});

test("semantic performance scorers reject mention-only and runtime-invalid answers", async () => {
  const fixtures = await loadFixtures(fixturesRoot, [
    "gmod.perf.angle-zero.v1",
    "gmod.perf.localplayer-cache.v1",
    "gmod.perf.darkrpvar.v1",
    "gmod.perf.sqlite-vs-mysql.v1",
  ]);
  const byId = Object.fromEntries(
    fixtures.map((fixture) => [fixture.id, fixture]),
  );

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.angle-zero.v1"]!,
      answer(
        "local zero = Angle()\nlocal function getZero() return zero:Zero() end",
      ),
    ).status,
  ).toBe("incorrect");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.localplayer-cache.v1"]!,
      answer(
        'local LocalPlayer = LocalPlayer\nhook.Add("Think", "cache", function()\n  local ply = LocalPlayer()\nend)',
      ),
    ).status,
  ).toBe("partial");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.localplayer-cache.v1"]!,
      answer(
        'local LocalPlayer = LocalPlayer\nhook.Add("HUDPaint", "hot", function()\n  local ply = LocalPlayer()\n  if not IsValid(ply) then return end\nend)',
      ),
    ).status,
  ).toBe("partial");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.darkrpvar.v1"]!,
      answer(
        'local preferred = ply:getDarkRPVar("job")\nlocal slower = ply:GetNWString("job")',
      ),
    ).status,
  ).toBe("partial");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.sqlite-vs-mysql.v1"]!,
      answer(
        'local rows = sql.Query("SELECT * FROM users WHERE id=" .. SQLStr(id))',
      ),
    ).status,
  ).toBe("incorrect");
});

test("semantic scorers catch unsupported angle copies and preserve durable LocalPlayer caches", async () => {
  const fixtures = await loadFixtures(fixturesRoot, [
    "gmod.perf.angle-zero.v1",
    "gmod.perf.localplayer-cache.v1",
    "gmod.perf.hudpaint-cache.v1",
  ]);
  const byId = Object.fromEntries(
    fixtures.map((fixture) => [fixture.id, fixture]),
  );

  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.angle-zero.v1"]!,
      answer("local mutable = angle_zero:Copy()"),
    ).status,
  ).toBe("incorrect");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.localplayer-cache.v1"]!,
      answer(
        'local GetLocalPlayer = LocalPlayer\nlocal cached = GetLocalPlayer()\nhook.Add("Think", "cache", function()\n  if not IsValid(cached) then cached = GetLocalPlayer() end\nend)',
      ),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.localplayer-cache.v1"]!,
      answer(
        'local cached\nhook.Add("Think", "cache", function()\n  cached = IsValid(cached) and cached or LocalPlayer()\nend)',
      ),
    ).status,
  ).toBe("pass");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.hudpaint-cache.v1"]!,
      answer(
        'local health = LocalPlayer():Health()\ndraw.SimpleText(health, "HUD", 0, 0)',
      ),
    ).status,
  ).toBe("pass");
});

test("expression fixtures require executable value use", async () => {
  const fixtures = await loadFixtures(fixturesRoot, [
    "gmod.perf.table-count-hash.v1",
    "gmod.perf.x-times-x.v1",
  ]);
  const byId = Object.fromEntries(
    fixtures.map((fixture) => [fixture.id, fixture]),
  );

  expect(
    scoreFixtureAnswer(byId["gmod.perf.table-count-hash.v1"]!, answer("#items"))
      .status,
  ).toBe("incorrect");
  expect(
    scoreFixtureAnswer(byId["gmod.perf.x-times-x.v1"]!, answer("x * x")).status,
  ).toBe("incorrect");
  expect(
    scoreFixtureAnswer(
      byId["gmod.perf.x-times-x.v1"]!,
      answer("local squared = x * x"),
    ).status,
  ).toBe("pass");
});

test("hook batching does not pass when the active per-player dispatch remains", async () => {
  const [fixture] = await loadFixtures(fixturesRoot, [
    "gmod.perf.hook-once.v1",
  ]);
  expect(
    scoreFixtureAnswer(
      fixture!,
      answer(
        'hook.Run("Batch", player.GetAll())\nfor _, ply in ipairs(player.GetAll()) do\n  hook.Run("PerPlayer", ply)\nend',
      ),
    ).status,
  ).toBe("incorrect");
});

test("response validation rejects malformed Lua function identifiers", async () => {
  const [fixture] = await loadFixtures(fixturesRoot, [
    "gmod.perf.looking-at.v1",
  ]);
  expect(
    scoreFixtureAnswer(
      fixture!,
      answer(
        "local function ArePlayersFacingEach Other(a, b)\n  return a:GetAimVector():Dot(b:GetAimVector()) < -0.8\nend",
      ),
    ).status,
  ).toBe("protocol_error");
});

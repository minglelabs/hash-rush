-- Is the Roblox game the web game at a tenth of the size? The learned bot was
-- trained on the web game's meadow, so every difference here is something it
-- never saw. Compares the tuning values, the map and the walking distances the
-- bot steers by against what tools/trace.mjs wrote down from the web game.
--   node roblox/tools/wrap.mjs && node roblox/tools/trace.mjs
--   luau roblox/test/parity.luau

local shim = require("./shim")
local decode = require("./b64")
local web = require("./out/web")

local ReplicatedStorage = shim.game:GetService("ReplicatedStorage")
local Config = shim.require(ReplicatedStorage:WaitForChild("Config"))
local Map = shim.require(ReplicatedStorage:WaitForChild("Map"))
local RLObserve = shim.require(shim.game:GetService("ServerScriptService"):WaitForChild("RLObserve"))

local PX = 10
local checked = 0
local wrong = 0

local function same(what, here, there)
	checked += 1
	local ok = here == there
	if type(here) == "number" and type(there) == "number" then
		ok = math.abs(here - there) <= 1e-9 * math.max(1, math.abs(there))
	end
	if not ok then
		wrong += 1
		print(`  DIFFERS  {what}: Roblox {here}, web {there}`)
	end
end

-- Tuning values: lengths are pixels on the web and studs here.
local c = web.constants
same("TICK_RATE", Config.TICK_RATE, c.TICK_RATE)
same("HAMSTER_R", Config.HAMSTER_R * PX, c.HAMSTER_R)
same("SPEED", Config.SPEED * PX, c.SPEED)
same("CARRY_SPEED", Config.CARRY_SPEED, c.CARRY_SPEED)
same("ALARM_RANGE", Config.ALARM_RANGE * PX, c.ALARM_RANGE)
same("LAST_STRETCH.range", Config.ALARM_RANGE * PX, c.LAST_STRETCH.range)
same("LAST_STRETCH.speed", Config.LAST_STRETCH_SPEED, c.LAST_STRETCH.speed)
same("COUNTDOWN", Config.COUNTDOWN, c.COUNTDOWN)
same("OVERTIME.start", Config.OVERTIME.start, c.OVERTIME.start)
same("OVERTIME.speed", Config.OVERTIME.speed * PX, c.OVERTIME.speed)
same("OVERTIME.rush", Config.OVERTIME.rush, c.OVERTIME.rush)
same("OVERTIME.rushSpeed", Config.OVERTIME.rushSpeed * PX, c.OVERTIME.rushSpeed)
same("OVERTIME.nibble", Config.OVERTIME.nibble, c.OVERTIME.nibble)
same("OVERTIME.daze", Config.OVERTIME.daze, c.OVERTIME.daze)
same("OVERTIME.end", Config.OVERTIME.finish, c.OVERTIME["end"])
same("GATHER_TIME", Config.GATHER_TIME, c.GATHER_TIME)
same("PICK.reach", Config.PICK.reach * PX, c.PICK.reach)
same("PICK.share", Config.PICK.share, c.PICK.share)
same("PICK.block", Config.PICK.block, c.PICK.block)
for _, key in { "windup", "recovery", "cooldown", "arcCos", "recoveryMove", "chain" } do
	same("BONK." .. key, Config.BONK[key], c.BONK[key])
end
same("BONK.reach", Config.BONK.reach * PX, c.BONK.reach)
same("BONK.assist", Config.BONK.assist * PX, c.BONK.assist)
same("THROW.charge", Config.THROW.charge, c.THROW.charge)
same("THROW.max", Config.THROW.max, c.THROW.max)
same("THROW.range", Config.THROW.range * PX, c.THROW.range)
same("THROW.width", Config.THROW.width * PX, c.THROW.width)
for _, row in web.gatherTime do
	same(`gatherTime({row[1]}, {row[2]})`, Config.gatherTime(row[1], row[2]), row[3])
	same(`pickTime({row[1]}, {row[2]})`, Config.pickTime(row[1], row[2]), row[4])
end

-- The map.
local function sameFields(what, here, there, keys)
	for _, key in keys do
		same(`{what}.{key}`, here[key] * PX, there[key])
	end
end
local function sameList(what, here, there, keys)
	same(`how many {what}`, #here, #there)
	for i = 1, math.min(#here, #there) do
		sameFields(`{what}[{i}]`, here[i], there[i], keys)
	end
end
local m = web.map
sameFields("world", Map.world, web.world, { "w", "h" })
sameFields("bounds", Map.bounds, m.bounds, { "x1", "y1", "x2", "y2" })
sameFields("home", Map.home, m.home, { "x1", "y1", "x2", "y2" })
sameFields("flower", Map.flower, m.flower, { "x", "y", "r", "gatherR" })
same("corner", Map.corner * PX, m.corner)
sameList("warps", Map.warps, m.warps, { "x", "y", "r" })
sameList("nests", Map.nests, m.nests, { "x", "y" })
sameList("bigNests", Map.bigNests, m.bigNests, { "x", "y" })
sameList("rects", Map.rects, m.rects, { "x", "y", "w", "h" })

-- What the observation takes for granted about the web game's meadow.
same("the meadow's place among the maps", web.mapIndex, 0)
same("how many maps", web.maps, 7)
same("the meadow's trouble", m.hazard, nil)
same("the meadow's ice", #m.ice, 0)
same("the meadow's gates", #m.gates, 0)
same("the meadow's day and night", m.cycle, false)
same("observation size", RLObserve.OBS, web.obs)
same("how many moves", #RLObserve.DIRS, #web.dirs)
for i, dir in web.dirs do
	same(`move {i} x`, RLObserve.DIRS[i][1], dir[1])
	same(`move {i} y`, RLObserve.DIRS[i][2], dir[2])
end
local settings = checked
print(`{settings - wrong} of {settings} tuning values, map measures and givens agree`)

-- The walking distances, which have to be the same to the last bit.
local F = RLObserve.fields(Map)
local W = web.fields
same("grid columns", F.cols, W.cols)
same("grid rows", F.rows, W.rows)
local cells = W.cols * W.rows
local walls = 0
for i = 1, cells do
	if F.free[i] ~= (string.byte(W.free, i) == 49) then
		walls += 1
	end
end
same("cells free here and not there, or the other way round", walls, 0)
for _, name in { "flower", "home", "warp" } do
	local there = decode(W[name])
	local off = 0
	local reached = 0
	for i = 0, cells - 1 do
		local a = buffer.readf32(F[name], i * 4)
		if a ~= buffer.readf32(there, i * 4) then
			off += 1
		end
		if a ~= math.huge then
			reached += 1
		end
	end
	same(`cells whose walk to {name} differs`, off, 0)
	print(`walking distance to {name}: {cells - off} of {cells} cells identical, {reached} of them reachable`)
end

if wrong > 0 then
	error(`{wrong} of {checked} checks differ`, 0)
end
print(`all {checked} checks agree`)

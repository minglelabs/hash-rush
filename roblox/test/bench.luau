-- What the learned bot costs a server: milliseconds per decision, and per game
-- tick with 1, 3 and 7 of them in a round of eight.
--   node roblox/tools/wrap.mjs
--   luau --codegen roblox/test/bench.luau     (as Roblox runs a --!native module)
--   luau roblox/test/bench.luau               (interpreted)

local shim = require("./shim")

local ReplicatedStorage = shim.game:GetService("ReplicatedStorage")
local ServerScriptService = shim.game:GetService("ServerScriptService")
local Config = shim.require(ReplicatedStorage:WaitForChild("Config"))
local Map = shim.require(ReplicatedStorage:WaitForChild("Map"))
local Sim = shim.require(ReplicatedStorage:WaitForChild("Sim"))
local RLObserve = shim.require(ServerScriptService:WaitForChild("RLObserve"))

local TICK = 1000 / Config.TICK_RATE
local SEATS = 8
local TICKS = 1200

local started = os.clock()
local RLBot = shim.require(ServerScriptService:WaitForChild("RLBot"))
RLBot.new({ seed = 1 })
print(string.format("first bot, weights unpacked: %.1f ms", (os.clock() - started) * 1000))

started = os.clock()
RLObserve.fields(Map)
print(string.format("walking distances of the map, once: %.1f ms", (os.clock() - started) * 1000))

-- Timings come out of a busy machine too high now and then, so each figure is
-- the middle one of many, with the quickest beside it.
local function middle(list)
	table.sort(list)
	return list[(#list + 1) // 2], list[1]
end

-- A round of eight with `count` learned bots; the rest stand still. Bots made
-- together decide on the same ticks: every other tick carries all of their
-- decisions and the one between carries none. Returns what the bots cost on a
-- tick of each kind, in milliseconds.
local function round(count)
	local slots = {}
	local bots = {}
	for id = 1, SEATS do
		slots[id] = { id = id, name = `h{id}` }
		if id <= count then
			bots[id] = RLBot.new({ seed = id })
		end
	end
	local random = shim.Random.new(count)
	local function rng()
		return random:NextNumber()
	end
	local g = Sim.new(Map, slots, rng)
	local idle = { mx = 0, my = 0, bonk = false, throw = false }
	local inputs = {}
	local deciding = {}
	local holding = {}
	for tick = 0, TICKS - 1 do
		if g.phase == "over" then
			g = Sim.new(Map, slots, rng)
		end
		local before = os.clock()
		for id = 1, SEATS do
			inputs[id] = if bots[id] then bots[id].think(g, id) else idle
		end
		table.insert(if tick % 2 == 0 then deciding else holding, (os.clock() - before) * 1000)
		Sim.step(g, inputs)
	end
	return deciding, holding
end

print("bots   a tick they decide on (middle, quickest)   share of a 16.7 ms tick   a tick between   averaged over both")
for _, count in { 1, 3, 7 } do
	local deciding, holding = round(count)
	local busy, quickest = middle(deciding)
	local quiet = middle(holding)
	print(string.format("%4d   %18.3f ms  %8.3f ms   %21.1f%%   %11.3f ms   %9.3f ms  %5.1f%%", count, busy, quickest, busy / TICK * 100, quiet, (busy + quiet) / 2, (busy + quiet) / 2 / TICK * 100))
end

-- Plays whole rounds of bots against bots through Sim.new / Sim.step, at every
-- difficulty, and checks that they play the game: leave home, pick seeds, bonk,
-- and bring a seed home. Prints what happened and what a think costs.
--   node roblox/tools/wrap.mjs && luau roblox/test/bots.luau [-a rounds]

local shim = require("./shim")
local ReplicatedStorage = shim.game:GetService("ReplicatedStorage")
local ServerScriptService = shim.game:GetService("ServerScriptService")
local Config = shim.require(ReplicatedStorage:WaitForChild("Config"))
local Map = shim.require(ReplicatedStorage:WaitForChild("Map"))
local Sim = shim.require(ReplicatedStorage:WaitForChild("Sim"))
local Bot = shim.require(ServerScriptService:WaitForChild("Bot"))
local mulberry32 = shim.require(ServerScriptService:WaitForChild("BotRng"))

local ROUNDS = tonumber((...)) or 20
local LEVELS = { "easy", "normal", "hard", "ace" }

local failures = 0
local function check(ok, what)
	if not ok then
		failures += 1
		print("FAIL  " .. what)
	end
end

-- The generator has to give the web game's numbers: mulberry32(1) and (12345) in
-- src/sim/rng.js start like this.
do
	local a = mulberry32(1)
	local b = mulberry32(12345)
	check(math.abs(a() - 0.6270739405881613) < 1e-15 and math.abs(a() - 0.002735721180215478) < 1e-15, "mulberry32(1) matches the web game")
	check(math.abs(b() - 0.9797282677609473) < 1e-15, "mulberry32(12345) matches the web game")
end

for _, level in LEVELS do
	check(Bot.DIFFICULTY[level] ~= nil, "difficulty " .. level .. " exists")
end

local thinkTime = {} -- [level] = { n, sum, max }
for _, level in LEVELS do
	thinkTime[level] = { n = 0, sum = 0, max = 0 }
end

-- One round. `levels` gives each seat its difficulty; a seat with `false` is a
-- person who never touches the keys. `leaver` is a seat that walks out after ten
-- seconds. Returns what happened.
local function play(levels, seed, leaver)
	local slots = {}
	local bots = {}
	for seat, level in levels do
		table.insert(slots, { id = seat, name = "seat " .. seat })
		if level then
			bots[seat] = Bot.new({ difficulty = level, seed = seed * 100 + seat })
		end
	end
	local g = Sim.new(Map, slots, mulberry32(seed))
	local inputs = {}
	local stats = { seeds = 0, bonks = 0, throws = 0, steals = 0, warps = 0, left = {}, kills = {}, winner = nil, timeout = false, time = 0 }
	for seat in levels do
		stats.kills[seat] = 0
	end
	while g.phase ~= "over" do
		for seat, bot in bots do
			if g.byId[seat] then
				local t = os.clock()
				local input = bot.think(g, seat)
				t = os.clock() - t
				local cost = thinkTime[levels[seat]]
				cost.n += 1
				cost.sum += t
				cost.max = math.max(cost.max, t)
				check(input.mx == input.mx and input.my == input.my, "a move is a number")
				check(math.abs(input.mx) <= 1.0001 and math.abs(input.my) <= 1.0001, "a move is no longer than one")
				inputs[seat] = input
			end
		end
		Sim.step(g, inputs)
		for _, ev in g.events do
			if ev.type == "seed" then
				stats.seeds += 1
			elseif ev.type == "bonk" then
				stats.bonks += 1
				stats.kills[ev.by] += 1
			elseif ev.type == "throw" then
				stats.throws += 1
			elseif ev.type == "steal" then
				stats.steals += 1
			elseif ev.type == "warp" then
				stats.warps += 1
			end
		end
		for _, p in g.players do
			if p.x > Map.home.x2 + 2 * Config.HAMSTER_R then
				stats.left[p.id] = true
			end
		end
		if leaver and g.byId[leaver] and g.time > 10 then
			Sim.remove(g, leaver)
			inputs[leaver] = nil
		end
		assert(g.tick < 200 * Config.TICK_RATE, "a round never ends")
	end
	stats.timeout = g.timeout
	stats.winner = g.winners[1]
	stats.time = g.time
	return stats
end

local function count(t)
	local n = 0
	for _ in t do
		n += 1
	end
	return n
end

print(string.format("%d rounds each; a round is called on bonks at %d s", ROUNDS, Config.OVERTIME.finish))
print("")
print("same difficulty at every seat")
print("level   seats  seed home  timeout  avg s   seeds  bonks  throws  steals  tunnels")
for _, level in LEVELS do
	for _, seats in { 4, 8 } do
		local levels = table.create(seats, level)
		local home, seeds, bonks, throws, steals, warps, time = 0, 0, 0, 0, 0, 0, 0
		for round = 1, ROUNDS do
			local s = play(levels, round)
			check(count(s.left) == seats, string.format("%s x%d round %d: everyone leaves home", level, seats, round))
			check(s.winner ~= nil, string.format("%s x%d round %d: somebody wins", level, seats, round))
			home += if s.timeout then 0 else 1
			seeds += s.seeds
			bonks += s.bonks
			throws += s.throws
			steals += s.steals
			warps += s.warps
			time += s.time
		end
		print(string.format("%-7s %5d  %8.0f%%  %6.0f%%  %5.1f  %5.1f  %5.1f  %6.1f  %6.1f  %7.1f", level, seats, 100 * home / ROUNDS, 100 * (ROUNDS - home) / ROUNDS, time / ROUNDS, seeds / ROUNDS, bonks / ROUNDS, throws / ROUNDS, steals / ROUNDS, warps / ROUNDS))
		check(seeds >= ROUNDS, string.format("%s x%d: seeds get picked", level, seats))
		check(bonks >= ROUNDS, string.format("%s x%d: bonks happen", level, seats))
		check(home >= ROUNDS / 2, string.format("%s x%d: at least half the rounds end with a seed brought home", level, seats))
	end
end

-- All four against each other, each taking every seat in turn: the better bot
-- should win more.
print("")
print("one of each in a round")
local wins = {}
local mixedRounds = ROUNDS * 4
for _, level in LEVELS do
	wins[level] = 0
end
for round = 1, mixedRounds do
	local levels = {}
	for seat = 1, 4 do
		levels[seat] = LEVELS[(seat + round) % 4 + 1]
	end
	local s = play(levels, 1000 + round)
	if s.winner and not s.timeout then
		wins[levels[s.winner]] += 1
	end
end
for _, level in LEVELS do
	print(string.format("%-7s wins %3d of %d", level, wins[level], mixedRounds))
end
check(wins.ace + wins.hard > wins.easy + wins.normal, "the two better bots win more than the two weaker ones")

-- Gaps in the seat numbers, a person who stands still, and somebody walking out
-- in the middle of the round.
do
	local levels = { [2] = "ace", [3] = false, [5] = "hard", [6] = "normal", [8] = "ace" }
	for round = 1, 5 do
		local s = play(levels, 2000 + round, 6)
		check(s.winner ~= nil, "a round with a leaver and an idle seat ends")
	end
end

print("")
print("cost of one think (one bot, one tick)")
for _, level in LEVELS do
	local cost = thinkTime[level]
	print(string.format("%-7s avg %.4f ms   worst %.2f ms   (%d thinks)", level, 1000 * cost.sum / cost.n, 1000 * cost.max, cost.n))
end

print("")
if failures > 0 then
	error(failures .. " checks failed")
end
print("all checks passed")

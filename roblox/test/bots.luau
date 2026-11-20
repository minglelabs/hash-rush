-- Plays whole rounds of bots against bots through Sim.new / Sim.step, at every
-- difficulty, everyone against everyone and in teams, and checks that they play
-- the game: leave home, pick seeds, bonk, bring a seed home, and in a team round
-- leave their own side alone and win or lose as one. Prints what happened and
-- what a think costs. The team tables are the ones roblox/tools/teams.mjs prints
-- for the web game's bots, from the same seeds, to be read side by side.
--   node roblox/tools/wrap.mjs && luau --codegen roblox/test/bots.luau [-a rounds [team rounds]]

local shim = require("./shim")
local ReplicatedStorage = shim.game:GetService("ReplicatedStorage")
local ServerScriptService = shim.game:GetService("ServerScriptService")
local Config = shim.require(ReplicatedStorage:WaitForChild("Config"))
local Map = shim.require(ReplicatedStorage:WaitForChild("Map"))
local Sim = shim.require(ReplicatedStorage:WaitForChild("Sim"))
local Bot = shim.require(ServerScriptService:WaitForChild("Bot"))
local mulberry32 = shim.require(ServerScriptService:WaitForChild("BotRng"))

local ROUNDS = tonumber((...)) or 10
local TEAM_ROUNDS = tonumber((select(2, ...))) or ROUNDS
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
-- seconds. `teams` gives each seat its side, 0 or 1, in a team round. Returns
-- what happened.
local function play(levels, seed, leaver, teams)
	local slots = {}
	local bots = {}
	for seat, level in levels do
		table.insert(slots, { id = seat, name = "seat " .. seat, team = if teams then teams[seat] else nil })
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
				check(not teams or teams[ev.by] ~= teams[ev.id], string.format("round %d: seat %d does not knock out its team-mate %d", seed, ev.by, ev.id))
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
	stats.winners = g.winners
	stats.time = g.time
	return stats
end

-- What the thinks since the last call cost.
local function printCost(when)
	print("")
	print("cost of one think (one bot, one tick), " .. when)
	for _, level in LEVELS do
		local cost = thinkTime[level]
		print(string.format("%-7s avg %.4f ms   worst %.2f ms   (%d thinks)", level, 1000 * cost.sum / cost.n, 1000 * cost.max, cost.n))
		thinkTime[level] = { n = 0, sum = 0, max = 0 }
	end
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

printCost("everyone against everyone")

-- Teams. Seats alternate sides, so the two sides are spread over the nests alike.
local function sidesFor(seats)
	local teams = {}
	for seat = 1, seats do
		teams[seat] = (seat - 1) % 2
	end
	return teams
end

-- Plays a team round and checks that it was won as a team: by one whole side, or
-- by everybody when time ran out with the sides level. Returns the round and the
-- side that won, nil when it was shared.
local function playTeams(levels, seed, what)
	local teams = sidesFor(#levels)
	local s = play(levels, seed, nil, teams)
	local won = { [0] = 0, [1] = 0 }
	for _, id in s.winners do
		won[teams[id]] += 1
	end
	local half = #levels / 2
	local whole = (won[0] == half and won[1] == 0) or (won[0] == 0 and won[1] == half)
	local shared = s.timeout and won[0] == half and won[1] == half
	check(whole or shared, string.format("%s round %d: the winners are one whole team (%d and %d of %d won)", what, seed, won[0], won[1], half))
	check(count(s.left) == #levels, string.format("%s round %d: everyone leaves home", what, seed))
	return s, if not whole then nil elseif won[0] > 0 then 0 else 1
end

print("")
print(string.format("teams, %d rounds each", TEAM_ROUNDS))
print("")
print("the same difficulty on both sides")
print("level   teams  seed home  timeout  avg s   seeds  bonks  throws  steals")
for _, level in LEVELS do
	for _, size in { 2, 4 } do
		local what = string.format("%s %dv%d", level, size, size)
		local levels = table.create(2 * size, level)
		local home, seeds, bonks, throws, steals, time = 0, 0, 0, 0, 0, 0
		for round = 1, TEAM_ROUNDS do
			local s = playTeams(levels, 3000 + round, what)
			home += if s.timeout then 0 else 1
			seeds += s.seeds
			bonks += s.bonks
			throws += s.throws
			steals += s.steals
			time += s.time
		end
		local n = TEAM_ROUNDS
		print(string.format("%-7s %dv%d    %8.0f%%  %6.0f%%  %5.1f  %5.1f  %5.1f  %6.1f  %6.1f", level, size, size, 100 * home / n, 100 * (n - home) / n, time / n, seeds / n, bonks / n, throws / n, steals / n))
		check(seeds >= n, what .. ": seeds get picked")
		check(bonks >= n, what .. ": bonks happen")
		check(home >= n / 2, what .. ": at least half the rounds end with a seed brought home")
	end
end

-- Two of one difficulty against two of another, each pair taking either side in
-- turn: the better pair should win more.
print("")
print("two against two, one difficulty a side")
print("pair              wins     shared  seed home  avg s   seeds  bonks")
local pairWins = {}
local pairRounds = 0
for _, level in LEVELS do
	pairWins[level] = 0
end
for a = 1, #LEVELS do
	for b = a + 1, #LEVELS do
		local one, other = LEVELS[a], LEVELS[b]
		local what = one .. " v " .. other
		local wins = { [one] = 0, [other] = 0 }
		local home, seeds, bonks, time = 0, 0, 0, 0
		for round = 1, TEAM_ROUNDS do
			local first = if round % 2 == 1 then one else other
			local second = if round % 2 == 1 then other else one
			local s, side = playTeams({ first, second, first, second }, 4000 + 100 * (a * 4 + b) + round, what)
			if side then
				wins[if side == 0 then first else second] += 1
			end
			home += if s.timeout then 0 else 1
			seeds += s.seeds
			bonks += s.bonks
			time += s.time
		end
		local n = TEAM_ROUNDS
		pairWins[one] += wins[one]
		pairWins[other] += wins[other]
		pairRounds += n
		print(string.format("%-6s v %-6s  %3d - %-3d  %5d  %8.0f%%  %5.1f  %5.1f  %5.1f", one, other, wins[one], wins[other], n - wins[one] - wins[other], 100 * home / n, time / n, seeds / n, bonks / n))
	end
end
for _, level in LEVELS do
	print(string.format("%-7s wins %3d of %d", level, pairWins[level], pairRounds / 2))
end
check(pairWins.ace + pairWins.hard > pairWins.easy + pairWins.normal, "in teams the two better bots win more than the two weaker ones")

-- One of each difficulty, two a side, split every way there is and seated every
-- way round.
print("")
print("mixed teams, one of each difficulty in a round")
do
	local SPLITS = { { 1, 2, 3, 4 }, { 1, 3, 2, 4 }, { 1, 2, 4, 3 } } -- seats 1 and 3 against 2 and 4
	local wins = {}
	local home, seeds, bonks, time = 0, 0, 0, 0
	for _, level in LEVELS do
		wins[level] = 0
	end
	local rounds = TEAM_ROUNDS * #SPLITS
	for round = 1, rounds do
		local split = SPLITS[round % #SPLITS + 1]
		local levels = {}
		for seat = 1, 4 do
			levels[seat] = LEVELS[split[(seat + round // #SPLITS) % 4 + 1]]
		end
		local s = playTeams(levels, 6000 + round, "mixed teams")
		for _, id in s.winners do
			wins[levels[id]] += 1
		end
		home += if s.timeout then 0 else 1
		seeds += s.seeds
		bonks += s.bonks
		time += s.time
	end
	for _, level in LEVELS do
		print(string.format("%-7s on the winning side %3d of %d", level, wins[level], rounds))
	end
	print(string.format("seed home %.0f%%   avg %.1f s   seeds %.1f   bonks %.1f", 100 * home / rounds, time / rounds, seeds / rounds, bonks / rounds))
end

printCost("in teams")

print("")
if failures > 0 then
	error(failures .. " checks failed")
end
print("all checks passed")

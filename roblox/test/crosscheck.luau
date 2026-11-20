-- Does the learned bot see and choose in Roblox what it does on the web?
-- And is the Roblox sim the web sim, team rules and all?
-- tools/trace.mjs played rounds in the web game, free-for-all and in teams, and
-- wrote down, tick by tick, what every seat pressed and where everyone stood,
-- and every few ticks what every seat saw (230 numbers) and what the network
-- made of it (13 logits). This plays the same rounds in the Roblox sim with the
-- same presses and compares.
--   node roblox/tools/wrap.mjs && node roblox/tools/trace.mjs
--   luau --codegen roblox/test/crosscheck.luau     (it works without --codegen, slowly)

local shim = require("./shim")
local decode = require("./b64")

local ReplicatedStorage = shim.game:GetService("ReplicatedStorage")
local ServerScriptService = shim.game:GetService("ServerScriptService")
local Map = shim.require(ReplicatedStorage:WaitForChild("Map"))
local Sim = shim.require(ReplicatedStorage:WaitForChild("Sim"))
local RLBot = shim.require(ServerScriptService:WaitForChild("RLBot"))
local RLObserve = shim.require(ServerScriptService:WaitForChild("RLObserve"))

local OBS = RLObserve.OBS
local DIRS = RLObserve.DIRS
local LOGITS = 13
local PX = 10
-- Observations are 32-bit floats on the web, so they can differ by the last bit
-- of one; the weights are the same halves on both sides.
-- Some views hang on a rounding: of two rivals pressed against the flower, say,
-- the one a hair nearer is watched, and the hair is the sims' own last bit.
-- trace.mjs marks those; one that falls the other way here is counted, not failed.
local OBS_SLACK = 1e-4
local LOGIT_SLACK = 1e-3
-- Everyone's place summed into one number a tick: off by a rounding at most.
local PLACE_SLACK = 1e-5

-- The web game's generator (src/sim/rng.js), so nests are dealt and hits that
-- land together are ordered as they were there.
local function mulberry32(seed)
	local function imul(a, b)
		return (a * (b % 65536) + (a * (b // 65536)) % 65536 * 65536) % 4294967296
	end
	local a = seed % 4294967296
	return function()
		a = (a + 0x6d2b79f5) % 4294967296
		local t = imul(bit32.bxor(a, bit32.rshift(a, 15)), bit32.bor(a, 1))
		t = bit32.bxor(t, (t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61))) % 4294967296)
		return bit32.bxor(t, bit32.rshift(t, 14)) / 4294967296
	end
end

-- Free-for-all and team rounds are counted apart.
local function tally()
	return { rounds = 0, ticks = 0, samples = 0, exact = 0, obs = 0, logits = 0, place = 0, sum = 0, clock = 0, choices = 0, otherwise = 0, ends = 0, clumps = 0, felled = 0, timeouts = 0, loose = 0, fell = 0, swayed = 0, worst = table.create(OBS, 0) }
end
local totals = { solo = tally(), team = tally() }
local complaints = {}
local function complain(text)
	if #complaints < 20 then
		table.insert(complaints, text)
	end
end

local view = table.create(OBS, 0)
local apart = table.create(OBS, 0)
local single = buffer.create(4)

local function play(number)
	local trace = require(string.format("./out/round%02d", number))
	-- Ids as a Roblox server might deal them: out of order and with gaps.
	local ids = {}
	local slots = {}
	local bots = {}
	local total = totals.solo
	for k, seat in trace.seats do
		ids[k] = k * 5 % 11 + 1
		slots[k] = { id = ids[k], name = `h{k}`, team = if seat.team >= 0 then seat.team else nil }
		bots[k] = if seat.learned then RLBot.new({ seed = seat.seed }) else false
		if seat.team >= 0 then
			total = totals.team
		end
	end
	local worst = total.worst
	local g = Sim.new(Map, slots, mulberry32(trace.seed))
	local samples = decode(trace.samples)
	local sums = decode(trace.sums)
	local at = 0
	local round = { obs = 0, logits = 0, samples = 0 }
	local clumps = 0
	local felled = 0

	for t, line in trace.ticks do
		for _, event in trace.events[tostring(t)] or {} do
			if event.time then
				g.time = event.time
			elseif event.place then
				local p = g.byId[ids[event.place[1] + 1]]
				p.x = event.place[2] / PX
				p.y = event.place[3] / PX
			elseif event.seed then
				g.byId[ids[event.seed + 1]].carrying = true
			else
				local k = event.remove + 1
				Sim.remove(g, ids[k])
				table.remove(ids, k)
				table.remove(bots, k)
			end
		end
		assert(#line == #ids + 1 and #g.players == #ids, `round {number} tick {t}: the seats do not add up`)

		local past = RLObserve.seenLate(g)
		local inputs = {}
		local sum = 0
		for k, id in ids do
			local pressed = string.byte(line, k + 1) - 48
			local dir = DIRS[pressed % 9 + 1]
			local input = { mx = dir[1], my = dir[2], bonk = pressed // 9 % 2 == 1, throw = pressed // 18 % 2 == 1 }
			inputs[id] = input
			local p = g.byId[id]
			sum += k * (p.x + 2 * p.y) * PX
			if bots[k] then
				local mine = bots[k].think(g, id)
				total.choices += 1
				if mine.mx ~= input.mx or mine.my ~= input.my or mine.bonk ~= input.bonk or mine.throw ~= input.throw then
					if pressed >= 36 then
						total.swayed += 1
					else
						total.otherwise += 1
						complain(`round {number} tick {t} seat {k}: RLBot pressed otherwise than the web bot`)
					end
				end
			end
		end

		sum = math.abs(sum - buffer.readf64(sums, (t - 1) * 8))
		if sum > PLACE_SLACK and total.sum <= PLACE_SLACK then
			complain(`round {number} tick {t}: the hamsters stand elsewhere than on the web, by {sum} px summed`)
		end
		total.sum = math.max(total.sum, sum)

		if string.byte(line, 1) == 83 then
			total.clock = math.max(total.clock, math.abs(g.time - buffer.readf64(samples, at)))
			total.place = math.max(total.place, math.abs(g.homeX * PX - buffer.readf64(samples, at + 8)))
			at += 16
			for k, id in ids do
				local p = g.byId[id]
				total.place = math.max(total.place, math.abs(p.x * PX - buffer.readf64(samples, at)), math.abs(p.y * PX - buffer.readf64(samples, at + 8)))
				local loose = buffer.readf64(samples, at + 16) == 1
				at += 24
				RLObserve.observe(g, past, id, view)
				local off = 0
				for i = 1, OBS do
					buffer.writef32(single, 0, view[i])
					apart[i] = math.abs(buffer.readf32(single, 0) - buffer.readf32(samples, at))
					off = math.max(off, apart[i])
					at += 4
				end
				local logits = RLBot.policyFor(p).logits(view)
				local offL = 0
				for i = 0, LOGITS - 1 do
					offL = math.max(offL, math.abs(buffer.readf32(logits, i * 4) - buffer.readf32(samples, at)))
					at += 4
				end
				round.samples += 1
				if loose then
					total.loose += 1
				end
				if loose and off > OBS_SLACK then
					total.fell += 1
				else
					if off > OBS_SLACK then
						complain(`round {number} tick {t} seat {k}: observation off by {off}`)
					end
					for i = 1, OBS do
						worst[i] = math.max(worst[i], apart[i])
					end
					round.obs = math.max(round.obs, off)
					round.logits = math.max(round.logits, offL)
					if off == 0 then
						total.exact += 1
					end
				end
			end
		end
		Sim.step(g, inputs)

		-- A throw's bonks follow it, a swing's come before its impact: two or more
		-- to one swing is a clump of team-mates down at once.
		local thrown = 0
		local run = 0
		for _, e in g.events do
			if e.type == "throw" then
				thrown = e.hit
			elseif e.type == "bonk" then
				if thrown > 0 then
					thrown -= 1
				else
					run += 1
				end
			elseif e.type == "impact" then
				if run > 1 then
					clumps += 1
					felled += run
				end
				run = 0
			end
		end
	end
	assert(at == buffer.len(samples), `round {number}: the samples do not add up`)

	-- The round has to end the same way too.
	local last = trace.last
	local winners = {}
	for _, id in g.winners do
		table.insert(winners, table.find(ids, id) - 1)
	end
	table.sort(winners)
	local ended = g.tick == last.tick and g.phase == last.phase and g.timeout == last.timeout and table.concat(winners, ",") == table.concat(last.winners, ",")
	-- With the same knock-outs, throws, seeds and pockets picked along the way.
	local tallies = {}
	for k, id in ids do
		local p = g.byId[id]
		total.place = math.max(total.place, math.abs(p.x * PX - last.places[2 * k - 1]), math.abs(p.y * PX - last.places[2 * k]))
		table.move({ p.kills, p.throws, p.deaths, p.seeds, p.steals }, 1, 5, #tallies + 1, tallies)
	end
	ended = ended and table.concat(tallies, ",") == table.concat(last.tallies, ",") and clumps == last.clumps and felled == last.felled
	total.rounds += 1
	total.clumps += clumps
	total.felled += felled
	if g.timeout then
		total.timeouts += 1
	end
	if ended then
		total.ends += 1
	else
		complain(`round {number}: ended otherwise (tick {g.tick}, {g.phase}, winners {table.concat(winners, ",")}, tallies {table.concat(tallies, ",")}, {clumps} clumps)`)
	end
	total.ticks += #trace.ticks
	total.samples += round.samples
	total.obs = math.max(total.obs, round.obs)
	total.logits = math.max(total.logits, round.logits)
	print(string.format("round %2d  %-56s %5d ticks  %5d compared  obs %.3g  logits %.3g  %s", number, trace.name, #trace.ticks, round.samples, round.obs, round.logits, if ended then "same end" else "OTHER END"))
end

local rounds = require("./out/rounds")
for number = 1, rounds do
	play(number)
end

local ok = true
local function report(what, total)
	local worst = total.worst
	local which = 1
	for i = 2, OBS do
		if worst[i] > worst[which] then
			which = i
		end
	end
	print()
	print(`{what}: {total.rounds} rounds, {total.ticks} ticks, {total.ends} ended as on the web, {total.timeouts} of them on time`)
	print(`  the two sims: clocks apart by at most {total.clock} s, places by at most {total.place} px;`)
	print(`    every tick, everyone's place summed: apart by at most {total.sum} px`)
	print(`    bonks that took a clump of team-mates: {total.clumps}, with {total.felled} hamsters down, as on the web`)
	print(`  observations: {total.samples} compared, 230 numbers each; {total.exact} identical to the last bit`)
	print(`    largest difference {total.obs} (number {which} of 230, counted from 1)`)
	print(`    {total.loose} of them hang on a rounding; {total.fell} of those fell the other way here and are left out above`)
	print(`  logits: {total.samples} compared, 13 numbers each; largest difference {total.logits}`)
	print(`  choices: {total.choices} ticks of learned bots, {total.otherwise} pressed otherwise than on the web`)
	print(`    and {total.swayed} more on a view that hangs on a rounding`)
	if total.obs > OBS_SLACK or total.logits > LOGIT_SLACK or total.sum > PLACE_SLACK or total.ends < total.rounds or total.otherwise > 0 then
		ok = false
	end
end
report("free-for-all", totals.solo)
report("teams", totals.team)
for _, text in complaints do
	print("  " .. text)
end
if not ok then
	error("the Roblox bot does not see or choose as the web bot does", 0)
end
print("the Roblox bot sees and chooses as the web bot does, on its own and in a team")

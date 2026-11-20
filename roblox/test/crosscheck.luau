-- Does the learned bot see and choose in Roblox what it does on the web?
-- tools/trace.mjs played rounds in the web game and wrote down, tick by tick,
-- what every seat pressed and, every few ticks, what every seat saw (230
-- numbers) and what the network made of it (13 logits). This plays the same
-- rounds in the Roblox sim with the same presses and compares.
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
local RLPolicy = shim.require(ServerScriptService:WaitForChild("RLPolicy"))

local OBS = RLObserve.OBS
local DIRS = RLObserve.DIRS
local LOGITS = 13
local PX = 10
-- Observations are 32-bit floats on the web, so they can differ by the last bit
-- of one; the weights are the same halves on both sides.
local OBS_SLACK = 1e-4
local LOGIT_SLACK = 1e-3

-- A second copy of the policy, to ask for logits.
local weights = ServerScriptService:WaitForChild("weights")
local index = shim.require(weights:WaitForChild("RLSolo"))
local chunks = {}
for i = 1, index.chunks do
	chunks[i] = shim.require(weights:WaitForChild(string.format("RLSolo%02d", i)))
end
local policy = RLPolicy.load(index, chunks)

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

local total = { ticks = 0, samples = 0, exact = 0, obs = 0, logits = 0, place = 0, clock = 0, choices = 0, otherwise = 0, ends = 0 }
local worst = table.create(OBS, 0)
local complaints = {}
local function complain(text)
	if #complaints < 20 then
		table.insert(complaints, text)
	end
end

local view = table.create(OBS, 0)
local single = buffer.create(4)

local function play(number)
	local trace = require(string.format("./out/round%02d", number))
	-- Ids as a Roblox server might deal them: out of order and with gaps.
	local ids = {}
	local slots = {}
	local bots = {}
	for k, seat in trace.seats do
		ids[k] = k * 5 % 11 + 1
		slots[k] = { id = ids[k], name = `h{k}` }
		bots[k] = if seat.learned then RLBot.new({ seed = seat.seed }) else false
	end
	local g = Sim.new(Map, slots, mulberry32(trace.seed))
	local samples = decode(trace.samples)
	local at = 0
	local round = { obs = 0, logits = 0, samples = 0 }

	for t, line in trace.ticks do
		for _, event in trace.events[tostring(t)] or {} do
			if event.time then
				g.time = event.time
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
		for k, id in ids do
			local pressed = string.byte(line, k + 1) - 48
			local dir = DIRS[pressed % 9 + 1]
			local input = { mx = dir[1], my = dir[2], bonk = pressed // 9 % 2 == 1, throw = pressed // 18 == 1 }
			inputs[id] = input
			if bots[k] then
				local mine = bots[k].think(g, id)
				total.choices += 1
				if mine.mx ~= input.mx or mine.my ~= input.my or mine.bonk ~= input.bonk or mine.throw ~= input.throw then
					total.otherwise += 1
					complain(`round {number} tick {t} seat {k}: RLBot pressed otherwise than the web bot`)
				end
			end
		end

		if string.byte(line, 1) == 83 then
			total.clock = math.max(total.clock, math.abs(g.time - buffer.readf64(samples, at)))
			total.place = math.max(total.place, math.abs(g.homeX * PX - buffer.readf64(samples, at + 8)))
			at += 16
			for k, id in ids do
				local p = g.byId[id]
				total.place = math.max(total.place, math.abs(p.x * PX - buffer.readf64(samples, at)), math.abs(p.y * PX - buffer.readf64(samples, at + 8)))
				at += 16
				RLObserve.observe(g, past, id, view)
				local off = 0
				for i = 1, OBS do
					buffer.writef32(single, 0, view[i])
					local d = math.abs(buffer.readf32(single, 0) - buffer.readf32(samples, at))
					at += 4
					if d > off then
						off = d
					end
					if d > worst[i] then
						worst[i] = d
					end
				end
				if off > OBS_SLACK then
					complain(`round {number} tick {t} seat {k}: observation off by {off}`)
				end
				local logits = policy.logits(view)
				local offL = 0
				for i = 0, LOGITS - 1 do
					offL = math.max(offL, math.abs(buffer.readf32(logits, i * 4) - buffer.readf32(samples, at)))
					at += 4
				end
				round.obs = math.max(round.obs, off)
				round.logits = math.max(round.logits, offL)
				round.samples += 1
				if off == 0 then
					total.exact += 1
				end
			end
		end
		Sim.step(g, inputs)
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
	for k, id in ids do
		local p = g.byId[id]
		total.place = math.max(total.place, math.abs(p.x * PX - last.places[2 * k - 1]), math.abs(p.y * PX - last.places[2 * k]))
	end
	if ended then
		total.ends += 1
	else
		complain(`round {number}: ended otherwise (tick {g.tick}, {g.phase}, winners {table.concat(winners, ",")})`)
	end
	total.ticks += #trace.ticks
	total.samples += round.samples
	total.obs = math.max(total.obs, round.obs)
	total.logits = math.max(total.logits, round.logits)
	print(string.format("round %2d  %-48s %5d ticks  %5d compared  obs %.3g  logits %.3g  %s", number, trace.name, #trace.ticks, round.samples, round.obs, round.logits, if ended then "same end" else "OTHER END"))
end

local rounds = require("./out/rounds")
for number = 1, rounds do
	play(number)
end

local which = 1
for i = 2, OBS do
	if worst[i] > worst[which] then
		which = i
	end
end
print()
print(`{rounds} rounds, {total.ticks} ticks, {total.ends} ended as on the web`)
print(`the two sims: clocks apart by at most {total.clock} s, places by at most {total.place} px`)
print(`observations: {total.samples} compared, 230 numbers each; {total.exact} identical to the last bit`)
print(`  largest difference {total.obs} (number {which} of 230, counted from 1)`)
print(`logits: {total.samples} compared, 13 numbers each; largest difference {total.logits}`)
print(`choices: {total.choices} ticks of learned bots, {total.otherwise} pressed otherwise than on the web`)
for _, text in complaints do
	print("  " .. text)
end
if total.obs > OBS_SLACK or total.logits > LOGIT_SLACK or total.ends < rounds or total.otherwise > 0 then
	error("the Roblox bot does not see or choose as the web bot does", 0)
end
print("the Roblox bot sees and chooses as the web bot does")

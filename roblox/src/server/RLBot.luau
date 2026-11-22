-- The learned bot: plays with the networks the web game trained (weights/, run
-- by RLPolicy), one for free-for-all rounds and one for team rounds, picked by
-- the round it is in. Ported from the web game's src/ai/rl-bot.js.
-- It sees what it saw in training (RLObserve): itself as it is now and the other
-- hamsters a few ticks late. Like in training it picks a move every few ticks and
-- holds it in between.
--
-- One habit is a rule on top of the networks (shadow, below), as on the web:
-- going after a rival that runs home with a seed and does not fight back. Through
-- rl20 the networks never learned to take a seed off a carrier; they swing from
-- behind, which mostly falls short, and so lost to bots that only grab a seed and run.

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local Map = require(game:GetService("ReplicatedStorage"):WaitForChild("Map"))
local RLObserve = require(script.Parent:WaitForChild("RLObserve"))
local RLPolicy = require(script.Parent:WaitForChild("RLPolicy"))

local RLBot = {}

local DIRS = RLObserve.DIRS

-- The web game's small seeded generator (src/sim/rng.js), so a bot with the same
-- seed makes the same choices there and here.
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

-- The weights are put together once, the first time a bot is made, and the
-- map's walking distances worked out then too: both take a moment that a round
-- in play should not have to wait for.
-- The web game's rl-solo.bin and rl-team.bin are the same file for now, so only
-- RLSolo is packed and it plays team rounds too. Team weights of their own go
-- in beside it as RLTeam, RLTeam01, ... (tools/pack_weights.py).
local policies
local function load(folder, name)
	local index = require(folder:WaitForChild(name))
	local chunks = {}
	for i = 1, index.chunks do
		chunks[i] = require(folder:WaitForChild(string.format("%s%02d", name, i)))
	end
	-- Older weights saw themselves late too; these and the ones since do not.
	assert(index.meta.selfNow, "RLBot plays weights that see themselves as they are now")
	return RLPolicy.load(index, chunks)
end
local function loadPolicies()
	if not policies then
		RLObserve.fields(Map)
		local folder = script.Parent:WaitForChild("weights")
		local solo = load(folder, "RLSolo")
		policies = { solo = solo, team = if folder:FindFirstChild("RLTeam") then load(folder, "RLTeam") else solo }
	end
	return policies
end

-- Empty-handed with a rival carrier within `near` studs that has not swung for
-- `quiet` seconds: run at the spot just ahead of it on its way home and keep the
-- paws down, so the pickpocketing gauge fills. A carrier that swings back is left
-- to the network, which bonks it. `seen` is the late view, `swung` when each was
-- last seen swinging. Returns the move to make (an index into DIRS from 0), or -1.
-- The web game's shadow() in src/ai/rl-bot.js; 100 px there is 10 studs here.
RLBot.SHADOW = { near = 10, quiet = 10, lead = 0.15 }
function RLBot.shadow(g, me, seen, swung)
	local SHADOW = RLBot.SHADOW
	if me.carrying then
		return -1
	end
	local c = nil
	local best = SHADOW.near
	for _, q in seen do
		-- Not one that has left the round since: the late view still holds it a while.
		local skip = q.id == me.id or g.byId[q.id] == nil or not q.carrying or (me.team >= 0 and q.team == me.team) or q.x < g.homeX
		if not skip and swung[q.id] ~= nil and g.time - swung[q.id] < SHADOW.quiet then
			skip = true
		end
		if not skip then
			local d = math.sqrt((q.x - me.x) ^ 2 + (q.y - me.y) ^ 2)
			if d < best then
				best = d
				c = q
			end
		end
	end
	if not c then
		return -1
	end
	local tx = c.x - SHADOW.lead * Config.SPEED * Config.CARRY_SPEED - me.x
	local ty = c.y - me.y
	local move = -1
	local most = -math.huge
	for k = 2, #DIRS do
		local dot = DIRS[k][1] * tx + DIRS[k][2] * ty
		if dot > most then
			most = dot
			move = k - 1
		end
	end
	return move
end

-- Carrying a seed with a rival rubbing up against it in the late view, within
-- reach: swing, which the game aims at the nearest rival. The networks let the
-- gauge fill and lose the seed, mostly to 초보 that only run up and rub.
-- The web game's guard() in src/ai/rl-bot.js.
RLBot.GUARD = 1
RLBot.GUARD_R = 0
-- Returns 1 to swing now, 0 to keep the paws down, nil to leave it to the network.
RLBot.GUARD_Q = 10
function RLBot.guard(g, me, seen, swung)
	local mode = RLBot.GUARD
	if mode == 0 or not me.carrying then
		return nil
	end
	local near = false
	for _, q in seen do
		if q.id ~= me.id and g.byId[q.id] ~= nil and not q.carrying and (me.team < 0 or q.team ~= me.team) then
			local d = math.sqrt((q.x - me.x) ^ 2 + (q.y - me.y) ^ 2)
			if d < Config.BONK.reach + RLBot.GUARD_R and (q.pickOn == me.id or mode == 2 or mode == 3) then
				near = true
			end
		end
	end
	if near and not me.swing and me.cooldown <= 0 then
		return 1
	end
	if mode == 5 then
		for _, q in seen do
			if q.id ~= me.id and g.byId[q.id] ~= nil and swung[q.id] ~= nil and g.time - swung[q.id] < RLBot.GUARD_Q and math.sqrt((q.x - me.x) ^ 2 + (q.y - me.y) ^ 2) < RLBot.SHADOW.near then
				return nil
			end
		end
	end
	if mode >= 3 and not near then
		return 0
	end
	return nil
end

-- The network that plays the hamster `p`: the team one if it is in a team.
function RLBot.policyFor(p)
	local all = loadPolicies()
	return if p and p.team >= 0 then all.team else all.solo
end

-- options: { seed = number, offset = number }. Returns { think(g, id) -> input },
-- to be asked every tick of the round. `offset` shifts which ticks it decides on,
-- so several bots in a round do not all run their networks on the same tick.
function RLBot.new(options)
	loadPolicies()
	local random = mulberry32(if options and options.seed then options.seed else 1)
	local view = table.create(RLObserve.OBS, 0)
	local tick = if options and options.offset then options.offset else 0
	local move, bonk, throw = 0, 0, 0

	local bot = {}

	function bot.think(g, id)
		local brain = RLBot.policyFor(g.byId[id])
		local fresh = tick % (brain.meta.frameSkip or 4) == 0
		tick += 1
		-- Every tick, so the late view has no gaps.
		local past = RLObserve.seenLate(g)
		if fresh then
			RLObserve.observe(g, past, id, view)
			local choice = brain.act(view, brain.meta.temperature or 1, random)
			move, bonk, throw = choice[1], choice[2], choice[3]
			local chase = RLBot.shadow(g, g.byId[id], past.players, RLObserve.swung(g))
			if chase >= 0 then
				move, bonk = chase, 0
			else
				local guard = RLBot.guard(g, g.byId[id], past.players, RLObserve.swung(g))
				if guard then
					bonk = guard
				end
			end
		end
		local dir = DIRS[move + 1]
		-- A swing is one press, at the start of a choice, as in training.
		return { mx = dir[1], my = dir[2], bonk = fresh and bonk == 1, throw = throw == 1 }
	end

	return bot
end

return RLBot

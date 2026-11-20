-- The learned bot: plays with the networks the web game trained (weights/, run
-- by RLPolicy), one for free-for-all rounds and one for team rounds, picked by
-- the round it is in. Ported from the web game's src/ai/rl-bot.js.
-- It sees what it saw in training (RLObserve): itself as it is now and the other
-- hamsters a few ticks late. Like in training it picks a move every few ticks and
-- holds it in between.

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
		end
		local dir = DIRS[move + 1]
		-- A swing is one press, at the start of a choice, as in training.
		return { mx = dir[1], my = dir[2], bonk = fresh and bonk == 1, throw = throw == 1 }
	end

	return bot
end

return RLBot

-- One worker of tools/elo.mjs: plays rounds of bots against bots in the Roblox
-- sim and prints who won. Each job draws four seats at random from the pool
-- (repeats allowed) and plays that line-up several times, as rl/elo.js does for
-- the web game.
--   luau --codegen roblox/test/elo.luau -a <solo|team> <first seed> <jobs> <rounds per job>
-- One line per round: mode, the four pool numbers, then 1 or 0 per seat for a win.

local shim = require("./shim")
local ReplicatedStorage = shim.game:GetService("ReplicatedStorage")
local ServerScriptService = shim.game:GetService("ServerScriptService")
local Config = shim.require(ReplicatedStorage:WaitForChild("Config"))
local Map = shim.require(ReplicatedStorage:WaitForChild("Map"))
local Sim = shim.require(ReplicatedStorage:WaitForChild("Sim"))
local Bot = shim.require(ServerScriptService:WaitForChild("Bot"))
local RLBot = shim.require(ServerScriptService:WaitForChild("RLBot"))
local mulberry32 = shim.require(ServerScriptService:WaitForChild("BotRng"))

local mode, first, jobs, perJob = ...
first = tonumber(first)
jobs = tonumber(jobs)
perJob = tonumber(perJob)

-- The pool, in the order tools/elo.mjs names it.
local POOL = { "easy", "normal", "hard", "ace", "rl" }

for j = 0, jobs - 1 do
	local seed = first + j * 7919
	local draw = mulberry32(seed)
	local ids = {}
	for seat = 1, 4 do
		ids[seat] = math.floor(draw() * #POOL) + 1
	end
	for round = 1, perJob do
		local slots = {}
		local bots = {}
		for seat = 1, 4 do
			-- Team rounds are two against two, seats alternating sides.
			slots[seat] = { id = seat, name = "seat " .. seat, team = if mode == "team" then (seat - 1) % 2 else nil }
			local level = POOL[ids[seat]]
			local botSeed = seed * 31 + round * 101 + seat
			bots[seat] = if level == "rl" then RLBot.new({ seed = botSeed, offset = seat }) else Bot.new({ difficulty = level, seed = botSeed })
		end
		local g = Sim.new(Map, slots, mulberry32(seed + round * 104729))
		local inputs = {}
		while g.phase ~= "over" do
			for seat, bot in bots do
				inputs[seat] = bot.think(g, seat)
			end
			Sim.step(g, inputs)
			assert(g.tick < 200 * Config.TICK_RATE, "a round never ends")
		end
		local won = {}
		for seat = 1, 4 do
			won[seat] = if table.find(g.winners, seat) then 1 else 0
		end
		print(mode .. " " .. table.concat(ids, ",") .. " " .. table.concat(won, ",") .. " " .. (if g.timeout then "timeout" else "home"))
	end
end

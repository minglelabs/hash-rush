-- scratch: RL in seat `rlSeat` among three of `level`, solo; SHADOW override
local shim = require("./shim")
local RS = shim.game:GetService("ReplicatedStorage")
local SSS = shim.game:GetService("ServerScriptService")
local Config = shim.require(RS:WaitForChild("Config"))
local Map = shim.require(RS:WaitForChild("Map"))
local Sim = shim.require(RS:WaitForChild("Sim"))
local Bot = shim.require(SSS:WaitForChild("Bot"))
local RLBot = shim.require(SSS:WaitForChild("RLBot"))
local mulberry32 = shim.require(SSS:WaitForChild("BotRng"))
local level, first, n, rlSeat, near, quiet, lead, mode = ...
first = tonumber(first); n = tonumber(n); rlSeat = tonumber(rlSeat)
if near then RLBot.SHADOW.near = tonumber(near); RLBot.SHADOW.quiet = tonumber(quiet); RLBot.SHADOW.lead = tonumber(lead) end
pk = {}
mode = mode or "solo"
if os.getenv and false then end
RLBot.GUARD = tonumber(select(9, ...) or "1")
RLBot.GUARD_R = tonumber(select(10, ...) or "0")
RLBot.GUARD_Q = tonumber(select(11, ...) or "10")
for r = 1, n do
	local seed = first + r * 7919
	local slots, bots = {}, {}
	for seat = 1, 4 do
		slots[seat] = { id = seat, name = "s" .. seat, team = if mode == "team" then (seat - 1) % 2 else nil }
		local isRL = if mode == "team" then (seat - 1) % 2 == (rlSeat - 1) % 2 else seat == rlSeat
		bots[seat] = if isRL then RLBot.new({ seed = seed + seat, offset = seat }) else Bot.new({ difficulty = level, seed = seed + seat })
	end
	local g = Sim.new(Map, slots, mulberry32(seed))
	local inputs = {}
	local me = g.byId[rlSeat]
	local dbg = 0
	local hitC, missC = 0, 0
	local lostT, lostB, lostP, xs = 0, 0, 0, 0
	while g.phase ~= "over" do
		for seat, bot in bots do inputs[seat] = bot.think(g, seat) end
		local was, th, de, x = me.carrying, me.throws, me.deaths, me.x
		pk = {}
		for _, q in g.players do if q.pickOn == me.id then table.insert(pk, string.format("%d:%.2f@%.1f", q.id, q.pick, math.sqrt((q.x-me.x)^2+(q.y-me.y)^2))) end end
		local n0 = #g.events
		Sim.step(g, inputs)
		for e = n0 + 1, #g.events do local ev = g.events[e]
			if ev.type == "impact" and ev.id == rlSeat and was then if ev.hit then hitC += 1 else missC += 1 end end
		end
		if was and not me.carrying and g.phase ~= "over" then
			if me.throws > th then lostT += 1 elseif me.deaths > de then lostB += 1 else lostP += 1
				if dbg < 15 then dbg += 1; print(string.format("D t=%.2f cd=%.2f swing=%s pickers=%s", g.time, me.cooldown, tostring(me.swing and me.swing.windup), table.concat(pk, ","))) end
			end
			xs += x - g.homeX
		end
	end
	local p = g.byId[rlSeat]
	print(string.format("L %d %d %d %.1f %d %d", lostT, lostB, lostP, xs, hitC, missC))
	print(string.format("%d %d %d %d %d %.1f", if table.find(g.winners, rlSeat) then 1 else 0, p.kills, p.deaths, p.seeds, p.steals, g.time))
end

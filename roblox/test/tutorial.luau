-- Plays the tutorial through, step by step, as a player would: a bot walks the
-- maze to the flower and home, then plain steering does the drills (bonk, throw,
-- pickpocket, portal). Checks that every step is reached and passed in order.
--   node roblox/tools/wrap.mjs && luau roblox/test/tutorial.luau [-a trace]

local TRACE = (...) == "trace"

local shim = require("./shim")
local game_ = shim.game
local ReplicatedStorage = game_:GetService("ReplicatedStorage")
local ServerScriptService = game_:GetService("ServerScriptService")

-- The player and the frame clock the tutorial reads.
local attributes = {}
local player = {
	UserId = 1,
	DisplayName = "Tester",
	GetAttribute = function(_, key)
		return attributes[key]
	end,
}
rawset(game_:GetService("Players"), "LocalPlayer", player)
local frame = {}
local heartbeat = {
	Connect = function(_, fn)
		table.insert(frame, fn)
		return {
			Disconnect = function()
				table.remove(frame, table.find(frame, fn))
			end,
		}
	end,
}
rawset(game_:GetService("RunService"), "Heartbeat", heartbeat)

local Map = shim.require(ReplicatedStorage:WaitForChild("Map"))
local Bot = shim.require(ServerScriptService:WaitForChild("Bot"))
local Tutorial = shim.require(game_:GetService("StarterPlayerScripts"):WaitForChild("Tutorial"))

local failures = 0
local function check(ok, what)
	if not ok then
		failures += 1
		print("FAIL  " .. what)
	end
end

local reached = {}
local passed = 0
local finished = false
local began = 0
local handle
handle = Tutorial.run({
	begin = function(list)
		began += 1
		check(list[1].userId == player.UserId, "seat 1 is the player")
	end,
	snapshot = function() end,
	event = function() end,
	say = function(index, step, again)
		table.insert(reached, { index = index, title = step.title, again = again })
		print(("step %d  %s%s"):format(index, step.title, if again then "  (again: " .. again .. ")" else ""))
	end,
	target = function() end,
	cheer = function()
		passed += 1
	end,
	finish = function()
		finished = true
	end,
})

local brain = Bot.new({ difficulty = "hard", seed = 3 })
local DT = 1 / 60
local frames = 0
local pressed = 0 -- how long the current button has been held

-- Walks straight at a spot; the drills take place in the open.
local function toward(me, x, y)
	local dx, dy = x - me.x, y - me.y
	local d = math.sqrt(dx * dx + dy * dy)
	if d < 0.2 then
		return 0, 0
	end
	return dx / d, dy / d
end

local function steer(step, g)
	local me = g.byId[1]
	local mx, my, bonk, throw = 0, 0, false, false
	if step <= 3 then
		-- The tutorial holds its clock at nought; the bot plans by the clock, so it
		-- is shown one that runs.
		local held = g.time
		g.time = frames * DT
		local input = brain.think(g, 1)
		g.time = held
		mx, my, bonk, throw = input.mx, input.my, input.bonk, input.throw
		-- At the flower the lesson is to hold still: the bot does.
	elseif step == 4 then
		local dummy = g.byId[2]
		mx, my = toward(me, dummy.x, dummy.y)
		local d = math.sqrt((dummy.x - me.x) ^ 2 + (dummy.y - me.y) ^ 2)
		-- A tap once it is right next to it.
		if d < 3.4 then
			mx, my = 0, 0
			pressed += DT
			bonk = pressed % 1 < 0.1
		end
	elseif step == 5 then
		-- Face the row, wind up, let go.
		if me.carrying then
			pressed += DT
			my = 0.01
			throw = pressed < 0.7
		end
	elseif step == 6 then
		local dummy = g.byId[2]
		mx, my = toward(me, dummy.x, dummy.y)
	elseif step == 7 then
		local warp = Map.warps[1]
		mx, my = toward(me, warp.x, warp.y)
	end
	attributes.HRMove = shim.env.Vector2.new(mx, my)
	attributes.HRBonkHeld = bonk
	attributes.HRThrowHeld = throw
end

local last = 0
while not finished and frames < 60 * 600 do
	frames += 1
	local current = reached[#reached]
	local index = current and current.index or 1
	if index ~= last then
		last = index
		pressed = 0
	end
	local g = handle.round()
	if TRACE and g and frames % 120 == 0 then
		local me = g.byId[1]
		print(("  t=%.0f step %d at %.1f,%.1f carrying %s phase %s"):format(frames / 60, index, me.x, me.y, tostring(me.carrying), g.phase))
	end
	if g and index < Tutorial.STEPS then
		steer(index, g)
	elseif index == Tutorial.STEPS then
		-- The last step is read, then its button pressed.
		handle.finish()
	end
	for _, fn in table.clone(frame) do
		fn(DT)
	end
	shim.advance(DT)
end

print(("%d steps shown, %d passed, %d set-ups, %.0f s"):format(#reached, passed, began, frames / 60))
check(finished, "the tutorial finished")
check(passed == Tutorial.STEPS - 1, "every step but the last was passed")
local order = {}
for _, r in reached do
	if not r.again then
		table.insert(order, r.index)
	end
end
for i, index in order do
	check(index == i, ("step %d came in order"):format(i))
end
check(#frame == 0, "the tutorial let go of the frame clock when done")
if failures == 0 then
	print("all checks passed")
else
	error(failures .. " checks failed")
end

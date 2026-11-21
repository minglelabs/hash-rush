-- The tutorial: a round of its own, played on this machine with the game's own
-- rules (Sim), one thing at a time: walk to the flower, nibble a seed by holding
-- still, carry it home, bonk, throw, pickpocket, take a portal. Each step sets the
-- meadow up for itself and waits until the player has done it.
-- View draws it as it draws a real round, through the hooks given to `run`.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Map = require(ReplicatedStorage:WaitForChild("Map"))
local Sim = require(ReplicatedStorage:WaitForChild("Sim"))
local Snapshot = require(ReplicatedStorage:WaitForChild("Snapshot"))

local player = Players.LocalPlayer
local FLOWER = Map.flower
local HOME = Map.home
-- The open grass between home and the hedges, where the drills take place.
local STRIP = HOME.x2 + 3
local WARP = Map.warps[1]
local STILL = table.freeze({ mx = 0, my = 0, bonk = false, throw = false })

local function near(p, x, y, r)
	return (p.x - x) ^ 2 + (p.y - y) ^ 2 <= r * r
end

-- Each step: a title and what to do, how to set the meadow up (nil carries on
-- with the one before), where to point, and when it is done. Set-up places each
-- seat: place(seat, x, y, facing x, facing y, carrying), nil x for its nest.
local STEPS = {
	{
		title = "움직이기",
		text = "WASD나 방향키로 움직여요. 휴대폰은 화면 왼쪽을 끌어요.\n🌻 해바라기까지 가 보세요!",
		setup = function(place)
			place(1, nil, nil)
		end,
		target = function()
			return Vector3.new(FLOWER.x, 0, FLOWER.y), "🌻", "해바라기"
		end,
		done = function(g, me)
			return near(me, FLOWER.x, FLOWER.y, FLOWER.gatherR)
		end,
	},
	{
		title = "해씨 캐기",
		text = "해바라기 옆에서 가만히 있으면 해씨가 나와요.\n움직이거나 꿀밤을 치면 처음부터예요!",
		target = function()
			return Vector3.new(FLOWER.x, 0, FLOWER.y), "🌻", "가만히!"
		end,
		done = function(g, me)
			return me.carrying
		end,
	},
	{
		title = "집으로",
		text = "해씨를 물었어요! 왼쪽 모래밭 🏠 집으로 돌아가면 이겨요.\n해씨를 물면 조금 느려지고, 꿀밤 한 대면 놓쳐요.",
		target = function(g, me)
			return Vector3.new(g.homeX - 3, 0, math.clamp(me.y, HOME.y1 + 4, HOME.y2 - 4)), "🏠", "집으로!"
		end,
		done = function(g)
			return g.phase == "over"
		end,
	},
	{
		title = "꿀밤",
		text = "상대 바로 옆에서 Space를 눌러 꿀밤! 휴대폰은 👊 버튼이에요.\n맞은 햄스터는 둥지로 돌아가요. 헛치면 잠깐 굳으니 조심!",
		setup = function(place)
			place(1, STRIP, 20, 0, 1)
			place(2, STRIP, 26)
		end,
		target = function(g)
			local dummy = g.byId[2]
			return Vector3.new(dummy.x, 0, dummy.y), "👊", "꿀밤!"
		end,
		event = function(e)
			return e.type == "bonk" and e.by == 1
		end,
	},
	{
		title = "던지기",
		text = "해씨를 든 채 F를 꾹 눌렀다 떼면 보는 쪽으로 던져요. 휴대폰은 🌻 버튼이에요.\n줄 선 상대가 한꺼번에 쓰러져요. 대신 해씨는 사라져요!",
		setup = function(place)
			place(1, STRIP, 11, 0, 1, true)
			place(2, STRIP, 17)
			place(3, STRIP, 21)
		end,
		target = function(g)
			local dummy = g.byId[2]
			return Vector3.new(dummy.x, 0, dummy.y), "🌻", "이쪽으로!"
		end,
		event = function(e)
			return e.type == "throw" and e.id == 1 and e.hit > 0
		end,
		-- A throw that hit nobody: set it up again and say so.
		retry = function(e)
			return e.type == "throw" and e.id == 1 and e.hit == 0
		end,
		again = "아깝다! 상대 쪽을 보고 다시 던져요.",
	},
	{
		title = "소매치기",
		text = "해씨 든 상대에게 딱 붙어 있으면 해씨를 슬쩍 가져와요.\n빼앗긴 쪽은 1초 동안 되찾을 수 없어요.",
		setup = function(place)
			place(1, STRIP, 18, 0, 1)
			place(2, STRIP, 26, nil, nil, true)
		end,
		target = function(g)
			local dummy = g.byId[2]
			return Vector3.new(dummy.x, 0, dummy.y), "🤏", "붙어요!"
		end,
		event = function(e)
			return e.type == "steal" and e.by == 1
		end,
	},
	{
		title = "순간이동",
		text = "보라색 🌀 소용돌이에 들어가면 둥지로 순간이동해요. 해씨가 없을 때만 돼요.\n앞서가는 상대를 집 앞에서 막으러 갈 때 써요!",
		setup = function(place)
			place(1, WARP.x - 6, WARP.y + 6)
		end,
		target = function()
			return Vector3.new(WARP.x, 0, WARP.y), "🌀", "들어가요!"
		end,
		event = function(e)
			return e.type == "warp" and e.id == 1
		end,
	},
	{
		title = "끝!",
		text = "이제 준비 버튼을 눌러 진짜 판을 해 봐요!\n1:20부터는 연장전: 집이 넓어지고, 쓰러지면 잠깐 기절해요.",
		last = true,
	},
}

local Tutorial = {}
Tutorial.STEPS = #STEPS

--[[ hooks:
	begin(roster)            a new round is set up; seat 1 is the player
	snapshot(snap)           the round as it is now, as the server would send it
	event(e)                 something happened in it
	say(index, step, again)  the step to show; `again` is a word to try again
	target(at?, icon, label) where to point, or nil
	cheer()                  a step done
	finish()                 the tutorial is over
]]
function Tutorial.run(hooks)
	local game_ = nil
	local index = 0
	local acc = 0
	local rng = Random.new()
	local stopped = false
	local connection

	local function roster(count)
		local list = {}
		for seat = 1, count do
			table.insert(list, {
				id = seat,
				userId = if seat == 1 then player.UserId else -seat,
				name = if seat == 1 then player.DisplayName else Config.NAMES[seat],
				wins = 0,
				kills = 0,
			})
		end
		return list
	end

	local function setUp(step)
		local spots = {}
		step.setup(function(seat, x, y, fx, fy, carrying)
			spots[seat] = { x = x, y = y, fx = fx, fy = fy, carrying = carrying }
		end)
		local slots = {}
		for seat = 1, #spots do
			slots[seat] = { id = seat, name = if seat == 1 then player.DisplayName else Config.NAMES[seat] }
		end
		game_ = Sim.new(Map, slots, function()
			return rng:NextNumber()
		end)
		-- No count-down: straight into it.
		game_.phase = "playing"
		game_.countdown = 0
		for seat, spot in spots do
			local p = game_.byId[seat]
			if spot.x then
				p.x, p.y = spot.x, spot.y
			end
			if spot.fx then
				p.fx, p.fy = spot.fx, spot.fy
			end
			p.carrying = spot.carrying == true
		end
		hooks.begin(roster(#spots))
	end

	local function goTo(next)
		index = next
		local step = STEPS[index]
		if not step then
			hooks.finish()
			return
		end
		if step.setup then
			setUp(step)
		end
		hooks.say(index, step)
	end

	local function stop()
		if stopped then
			return
		end
		stopped = true
		connection:Disconnect()
	end

	connection = RunService.Heartbeat:Connect(function(dt)
		local step = STEPS[index]
		if not step or step.last or not game_ then
			return
		end
		acc = math.min(acc + dt, 0.25)
		while acc >= Config.DT do
			acc -= Config.DT
			local move = player:GetAttribute("HRMove")
			local inputs = {
				[1] = {
					mx = if move then move.X else 0,
					my = if move then move.Y else 0,
					bonk = player:GetAttribute("HRBonkHeld") == true,
					throw = player:GetAttribute("HRThrowHeld") == true,
				},
			}
			for seat in game_.byId do
				if seat ~= 1 then
					inputs[seat] = STILL
				end
			end
			Sim.step(game_, inputs)
			-- The clock stands still: no overtime in the middle of a lesson.
			game_.time = 0
			local passed, retry = false, false
			for _, e in game_.events do
				hooks.event(e)
				passed = passed or (step.event ~= nil and step.event(e))
				retry = retry or (step.retry ~= nil and step.retry(e))
			end
			local me = game_.byId[1]
			passed = passed or (step.done ~= nil and step.done(game_, me))
			hooks.snapshot(Snapshot.decode(Snapshot.encode(0, game_, function(p)
				return Sim.lastStretch(game_, p)
			end)))
			if passed then
				hooks.cheer()
				-- A moment to see it happen before the meadow is set up again.
				local next = index + 1
				index = -1
				task.delay(if STEPS[next] and STEPS[next].setup then 1.2 else 0.4, function()
					if not stopped then
						goTo(next)
					end
				end)
				return
			elseif retry then
				local again = step.again
				local this = index
				index = -1
				task.delay(1, function()
					if not stopped then
						goTo(this)
						hooks.say(this, step, again)
					end
				end)
				return
			end
		end
		local at, icon, label = step.target(game_, game_.byId[1])
		hooks.target(at, icon, label)
	end)

	goTo(1)
	return {
		stop = stop,
		-- The last step's button: done.
		finish = function()
			stop()
			hooks.finish()
		end,
		-- The round being played, for tests.
		round = function()
			return game_
		end,
	}
end

return Tutorial

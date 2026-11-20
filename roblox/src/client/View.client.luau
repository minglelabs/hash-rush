-- Everything the player sees: the camera fixed straight above the map, a hamster
-- for every seat, and the words on screen. It draws what the server says and
-- decides nothing.

local Debris = game:GetService("Debris")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")
local TweenService = game:GetService("TweenService")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Snapshot = require(ReplicatedStorage:WaitForChild("Snapshot"))

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("HashRushRemotes")
local roundRemote = remotes:WaitForChild("Round")
local snapRemote = remotes:WaitForChild("Snap")
local mapFolder = workspace:WaitForChild("HashRushMap")

local WORLD_W = mapFolder:GetAttribute("WorldW")
local WORLD_H = mapFolder:GetAttribute("WorldH")
local HOME_X1 = mapFolder:GetAttribute("HomeX1")
local FLOWER_X = mapFolder:GetAttribute("FlowerX")
local FLOWER_Y = mapFolder:GetAttribute("FlowerY")
local GATHER_R = mapFolder:GetAttribute("GatherR")
local homePart = mapFolder:WaitForChild("Home")
local homeEdge = mapFolder:WaitForChild("HomeEdge")

local FONT = Enum.Font.GothamBold
local UPRIGHT = CFrame.Angles(0, 0, math.rad(90)) -- stands a cylinder on its end
local WHITE = Color3.new(1, 1, 1)
local RED = Color3.fromRGB(255, 80, 70)
local GOLD = Color3.fromRGB(255, 210, 60)

task.spawn(function()
	for _, kind in { Enum.CoreGuiType.Backpack, Enum.CoreGuiType.Health, Enum.CoreGuiType.EmotesMenu, Enum.CoreGuiType.PlayerList } do
		for _ = 1, 10 do
			if pcall(StarterGui.SetCoreGuiEnabled, StarterGui, kind, false) then
				break
			end
			task.wait(0.5)
		end
	end
end)

-- Camera ------------------------------------------------------------------

local FOV = 20 -- narrow, so the view is close to flat

local function placeCamera()
	local camera = workspace.CurrentCamera
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = FOV
	local view = camera.ViewportSize
	local half = math.tan(math.rad(FOV / 2))
	-- High enough for the whole map, with room for the top bar.
	local height = math.max(WORLD_H * 1.18 / (2 * half), WORLD_W * 1.04 / (2 * half * view.X / view.Y))
	local centre = Vector3.new(WORLD_W / 2, 0, WORLD_H * 0.46)
	-- Screen right is +X and screen down is +Z, the same way round as the sim.
	camera.CFrame = CFrame.lookAt(centre + Vector3.new(0, height, 0), centre, Vector3.new(0, 0, -1))
end

-- Screen ------------------------------------------------------------------

local function make(className, props, parent)
	local object = Instance.new(className)
	for key, value in props do
		object[key] = value
	end
	object.Parent = parent
	return object
end

local function text(props, parent)
	local label = make("TextLabel", {
		BackgroundTransparency = 1,
		Font = FONT,
		TextColor3 = WHITE,
		TextScaled = true,
		TextStrokeTransparency = 0.4,
		Text = "",
	}, nil)
	for key, value in props do
		label[key] = value
	end
	label.Parent = parent
	return label
end

local hud = make("ScreenGui", { Name = "HashRushHud", ResetOnSpawn = false, IgnoreGuiInset = true }, player:WaitForChild("PlayerGui"))
local timerLabel = text({ AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.fromScale(0.5, 0.01), Size = UDim2.fromScale(0.4, 0.055) }, hud)
local scoreRow = make("Frame", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.fromScale(0.5, 0.07), Size = UDim2.new(0.96, 0, 0, 24), BackgroundTransparency = 1 }, hud)
make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 6) }, scoreRow)
local bigLabel = text({ AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.45), Size = UDim2.fromScale(0.5, 0.22), Visible = false }, hud)
local bannerLabel = text({ AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.2), Size = UDim2.fromScale(0.8, 0.09), TextColor3 = GOLD, Visible = false }, hud)
local noticeLabel = text({ AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.fromScale(0.5, 0.97), Size = UDim2.fromScale(0.7, 0.05) }, hud)

local resultPanel = make("Frame", {
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.fromScale(0.5, 0.5),
	Size = UDim2.fromScale(0.5, 0.6),
	BackgroundColor3 = Color3.fromRGB(40, 30, 20),
	BackgroundTransparency = 0.15,
	Visible = false,
}, hud)
make("UICorner", { CornerRadius = UDim.new(0.05, 0) }, resultPanel)
local resultTitle = text({ Position = UDim2.fromScale(0.05, 0.04), Size = UDim2.fromScale(0.9, 0.17), TextColor3 = GOLD }, resultPanel)
local resultWhy = text({ Position = UDim2.fromScale(0.05, 0.21), Size = UDim2.fromScale(0.9, 0.07) }, resultPanel)
local resultList = text({ Position = UDim2.fromScale(0.1, 0.3), Size = UDim2.fromScale(0.8, 0.56), TextYAlignment = Enum.TextYAlignment.Top }, resultPanel)
-- With one or two names the scaled text would otherwise dwarf the title.
make("UITextSizeConstraint", { MaxTextSize = 30 }, resultList)
local resultNext = text({ Position = UDim2.fromScale(0.05, 0.88), Size = UDim2.fromScale(0.9, 0.08) }, resultPanel)

local bannerShown = 0
local function banner(message)
	bannerShown += 1
	local mine = bannerShown
	bannerLabel.Text = message
	bannerLabel.Visible = true
	task.delay(1.6, function()
		if bannerShown == mine then
			bannerLabel.Visible = false
		end
	end)
end

-- World -------------------------------------------------------------------

local viewFolder = make("Folder", { Name = "HashRushView" }, workspace)

local function part(props, parent)
	local p = make("Part", {
		Anchored = true,
		CanCollide = false,
		CanQuery = false,
		CanTouch = false,
		CastShadow = false,
		Material = Enum.Material.SmoothPlastic,
		TopSurface = Enum.SurfaceType.Smooth,
		BottomSurface = Enum.SurfaceType.Smooth,
	}, nil)
	for key, value in props do
		p[key] = value
	end
	p.Parent = parent or viewFolder
	return p
end

local function disc(radius, height, color, parent)
	return part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(height, radius * 2, radius * 2), Color = color }, parent)
end

-- Words that rise from a spot on the map and fade: "꿀밤!", "뿅!", "던지기!".
-- They start above the name over a hamster, so the two do not overlap.
local function floatText(x, y, message, color)
	local anchor = part({ Size = Vector3.one, Transparency = 1, Position = Vector3.new(x, 2, y) })
	local gui = make("BillboardGui", { Size = UDim2.fromScale(9, 2.6), AlwaysOnTop = true, StudsOffsetWorldSpace = Vector3.new(0, 0, -7) }, anchor)
	local label = text({ Size = UDim2.fromScale(1, 1), Text = message, TextColor3 = color or WHITE, TextStrokeTransparency = 0 }, gui)
	local info = TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	TweenService:Create(gui, info, { StudsOffsetWorldSpace = Vector3.new(0, 0, -10) }):Play()
	TweenService:Create(label, TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	Debris:AddItem(anchor, 0.9)
end

local function flash(x, y, radius, color, seconds)
	local p = disc(radius, 0.1, color)
	p.CFrame = CFrame.new(x, 2.2, y) * UPRIGHT
	p.Transparency = 0.2
	TweenService:Create(p, TweenInfo.new(seconds), { Transparency = 1 }):Play()
	Debris:AddItem(p, seconds + 0.1)
end

local round = -1
local roster = {} -- [seat] = { id, userId, name, wins, kills }
local hamsters = {} -- [seat] = what is drawn for it
local mySeat = nil
local latest = nil -- the newest snapshot of this round
local resultUntil = nil

local function clearHamsters()
	for _, h in hamsters do
		h.model:Destroy()
	end
	table.clear(hamsters)
end

local function makeHamster(info)
	local rgb = Config.COLORS[info.id]
	local color = Color3.fromRGB(rgb[1], rgb[2], rgb[3])
	local dark = color:Lerp(Color3.new(0, 0, 0), 0.3)
	local me = info.id == mySeat
	local model = make("Model", { Name = "Hamster" .. info.id }, viewFolder)
	local h = {
		model = model,
		me = me,
		name = info.name,
		body = disc(Config.HAMSTER_R, 1, color, model),
		earL = disc(0.5, 0.2, dark, model),
		earR = disc(0.5, 0.2, dark, model),
		nose = part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 0.7, Color = Color3.fromRGB(255, 150, 170) }, model),
		seed = part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 1.3, Color = Color3.fromRGB(50, 40, 35), Transparency = 1 }, model),
		-- Shows where a thrown seed would go while the throw winds up.
		aim = part({ Size = Vector3.new(1, 0.1, 0.6), Transparency = 1 }, model),
		ring = if me then disc(Config.HAMSTER_R + 0.45, 0.05, WHITE, model) else nil,
	}
	local gui = make("BillboardGui", { Size = UDim2.fromScale(15, 4.2), AlwaysOnTop = true, StudsOffsetWorldSpace = Vector3.new(0, 0, -(Config.HAMSTER_R + 2.4)) }, h.body)
	h.status = text({ Size = UDim2.fromScale(1, 0.36), TextColor3 = GOLD }, gui)
	local barBack = make("Frame", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.fromScale(0.5, 0.4), Size = UDim2.fromScale(0.4, 0.13), BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 0.4, BorderSizePixel = 0, Visible = false }, gui)
	h.barBack = barBack
	h.bar = make("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = GOLD, BorderSizePixel = 0 }, barBack)
	h.label = text({ Position = UDim2.fromScale(0, 0.58), Size = UDim2.fromScale(1, 0.4), Text = info.name, TextColor3 = if me then GOLD else WHITE }, gui)
	return h
end

local function setText(label, value)
	if label.Text ~= value then
		label.Text = value
	end
end

-- Puts a hamster where the snapshot says, sliding there rather than jumping.
local function drawHamster(h, p, dt)
	if not h.x or math.abs(p.x - h.x) + math.abs(p.y - h.y) > 5 then
		h.x, h.y = p.x, p.y -- back at the nest, or the first time it is seen
	else
		local k = 1 - math.exp(-dt * 30)
		h.x += (p.x - h.x) * k
		h.y += (p.y - h.y) * k
	end
	local at = Vector3.new(h.x, 0, h.y)
	local forward = Vector3.new(p.fx, 0, p.fy)
	local side = Vector3.new(-p.fy, 0, p.fx)
	h.body.CFrame = CFrame.new(at + Vector3.new(0, 0.8, 0)) * UPRIGHT
	h.body.Transparency = if p.dazed then 0.5 else 0
	h.earL.CFrame = CFrame.new(at + forward * 0.2 + side * 1.05 + Vector3.new(0, 1.4, 0)) * UPRIGHT
	h.earR.CFrame = CFrame.new(at + forward * 0.2 - side * 1.05 + Vector3.new(0, 1.4, 0)) * UPRIGHT
	h.nose.Position = at + forward * 1.3 + Vector3.new(0, 1.2, 0)
	h.seed.Position = at + forward * 0.5 + Vector3.new(0, 1.5, 0)
	h.seed.Transparency = if p.carrying then 0 else 1
	if h.ring then
		h.ring.CFrame = CFrame.new(at + Vector3.new(0, 0.33, 0)) * UPRIGHT
	end

	if p.charge > 0 then
		local length = Config.THROW.range * math.min(1, p.charge / Config.THROW.charge)
		h.aim.Size = Vector3.new(length, 0.1, 0.6)
		h.aim.CFrame = CFrame.new(at + forward * (Config.HAMSTER_R + length / 2) + Vector3.new(0, 2, 0)) * CFrame.Angles(0, -math.atan2(p.fy, p.fx), 0)
		h.aim.Color = if p.charge > Config.THROW.max - 0.35 then RED elseif p.charge >= Config.THROW.charge then GOLD else WHITE
		h.aim.Transparency = 0.3
	else
		h.aim.Transparency = 1
	end

	-- A carrier close to home sets the alarm off.
	setText(h.label, (if p.alarm then "🚨 " elseif p.carrying then "🌻 " else "") .. h.name)
	h.label.TextColor3 = if p.alarm then RED elseif h.me then GOLD else WHITE

	local status = ""
	local nibbling = latest.nibbler == p.id
	if p.dazed then
		status = "💫 기절"
	elseif nibbling then
		status = "해씨 캐는 중"
	end
	-- Hints only its own player sees.
	if h.me and not p.carrying and not p.dazed then
		local inRing = (Vector2.new(p.x, p.y) - Vector2.new(FLOWER_X, FLOWER_Y)).Magnitude <= GATHER_R
		if inRing and (nibbling or latest.nibbler == 0) and player:GetAttribute("HRMoving") then
			status = "가만히 있어야 캐져요!"
		elseif inRing and not nibbling and latest.nibbler ~= 0 then
			status = "앞 햄스터가 캐는 중… 대기"
		end
	end
	setText(h.status, status)
	h.barBack.Visible = nibbling
	if nibbling then
		h.bar.Size = UDim2.fromScale(latest.gather, 1)
	end
end

local function drawScores()
	for _, child in scoreRow:GetChildren() do
		if child:IsA("TextLabel") then
			child:Destroy()
		end
	end
	for seat = 1, Config.MAX_PLAYERS do
		local info = roster[seat]
		if info then
			local rgb = Config.COLORS[seat]
			local chip = make("TextLabel", {
				LayoutOrder = seat,
				AutomaticSize = Enum.AutomaticSize.X,
				Size = UDim2.fromScale(0, 1),
				BackgroundColor3 = Color3.fromRGB(rgb[1], rgb[2], rgb[3]),
				Font = FONT,
				TextSize = 15,
				TextColor3 = Color3.new(0, 0, 0),
				Text = ("  %s %d승  "):format(info.name, info.wins),
			}, scoreRow)
			make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, chip)
		end
	end
end

local function setRoster(list)
	table.clear(roster)
	mySeat = nil
	for _, info in list do
		roster[info.id] = info
		if info.userId == player.UserId then
			mySeat = info.id
		end
	end
	drawScores()
end

local function nameOf(seat)
	return if roster[seat] then roster[seat].name else "?"
end

local MULTI = { [2] = "더블킬!", [3] = "트리플킬! 슈퍼플레이!", [4] = "쿼드라킬! 슈퍼플레이!" }

local function showEvent(e)
	local h = e.id and hamsters[e.id]
	if e.type == "swing" and h and h.x then
		floatText(h.x, h.y, "꿀밤!")
	elseif e.type == "impact" then
		flash(e.x + e.dx * 2.6, e.y + e.dy * 2.6, 1.5, if e.hit then GOLD else WHITE, 0.2)
	elseif e.type == "bonk" then
		floatText(e.x, e.y, "뿅!", RED)
		flash(e.x, e.y, 2.2, RED, 0.3)
		if e.close then
			banner(nameOf(e.by) .. " 슈퍼플레이!")
		end
	elseif e.type == "throw" then
		floatText(e.x, e.y, "던지기!", GOLD)
		local seed = part({ Shape = Enum.PartType.Ball, Size = Vector3.one * 1.3, Color = Color3.fromRGB(50, 40, 35), Position = Vector3.new(e.x, 2, e.y) })
		local reach = Config.THROW.range
		TweenService:Create(seed, TweenInfo.new(0.2, Enum.EasingStyle.Linear), { Position = Vector3.new(e.x + e.dx * reach, 2, e.y + e.dy * reach) }):Play()
		Debris:AddItem(seed, 0.25)
	elseif e.type == "multi" then
		banner(nameOf(e.by) .. " " .. (MULTI[e.n] or "펜타킬! 슈퍼플레이!"))
	elseif e.type == "seed" and h and h.x then
		floatText(h.x, h.y, "🌻 해씨 획득!", GOLD)
	elseif e.type == "overtime" then
		banner("연장전! 집이 넓어져요")
	elseif e.type == "rush" then
		banner("집이 빠르게 밀려와요!")
	end
end

local function showResult(msg)
	setRoster(msg.roster)
	local names = {}
	for _, seat in msg.winners do
		table.insert(names, nameOf(seat))
	end
	resultTitle.Text = if #names > 0 then "🏆 " .. table.concat(names, " · ") .. " 승리!" else "판이 끝났어요"
	resultWhy.Text = if msg.left then "상대가 나가서 판이 끝났어요" elseif msg.timeout then "시간 종료 · 꿀밤 횟수로 정했어요" else "해씨를 물고 집에 돌아왔어요"
	local sorted = table.clone(msg.roster)
	table.sort(sorted, function(a, b)
		if a.wins ~= b.wins then
			return a.wins > b.wins
		end
		return a.id < b.id
	end)
	local lines = {}
	for _, info in sorted do
		table.insert(lines, ("%s   %d승 · 꿀밤 %d"):format(info.name, info.wins, info.kills))
	end
	resultList.Text = table.concat(lines, "\n")
	resultUntil = os.clock() + msg.next
	resultPanel.Visible = true
	bigLabel.Visible = false
end

roundRemote.OnClientEvent:Connect(function(msg)
	if msg.kind == "lobby" then
		round = -1
		latest = nil
		clearHamsters()
		setRoster({})
		resultPanel.Visible = false
		bigLabel.Visible = false
		timerLabel.Text = "🌻 Hash Rush"
		if msg.left then
			noticeLabel.Text = ("%d초 뒤 시작해요 (%d명)"):format(msg.left, msg.count)
		else
			noticeLabel.Text = ("다른 햄스터를 기다리는 중… (%d/%d명)"):format(msg.count, msg.need)
		end
	elseif msg.kind == "start" then
		round = msg.round
		latest = nil
		clearHamsters()
		setRoster(msg.roster)
		for _, info in msg.roster do
			hamsters[info.id] = makeHamster(info)
		end
		resultPanel.Visible = false
		noticeLabel.Text = if mySeat then "" else "관전 중 · 다음 판부터 참가해요"
	elseif msg.kind == "events" then
		if msg.round == round then
			for _, e in msg.list do
				showEvent(e)
			end
		end
	elseif msg.kind == "result" then
		showResult(msg)
	end
end)

snapRemote.OnClientEvent:Connect(function(packed)
	local snap = Snapshot.decode(packed)
	if snap.round ~= round % 256 then
		return
	end
	-- Unreliable: an older snapshot can turn up after a newer one.
	if latest and (snap.tick - latest.tick) % 65536 >= 32768 then
		return
	end
	latest = snap
end)

local function clock(seconds)
	return ("%d:%02d"):format(seconds // 60, seconds % 60)
end

RunService:BindToRenderStep("HashRushView", Enum.RenderPriority.Camera.Value + 1, function(dt)
	placeCamera()
	if resultPanel.Visible and resultUntil then
		resultNext.Text = ("%d초 뒤 다음 판"):format(math.max(0, math.ceil(resultUntil - os.clock())))
	end
	if not latest then
		return
	end

	local seen = {}
	local carrying = false
	for _, p in latest.players do
		local h = hamsters[p.id]
		if h then
			seen[p.id] = true
			drawHamster(h, p, dt)
			if h.me then
				carrying = p.carrying
			end
		end
	end
	-- Whoever left the game took its hamster along.
	for seat, h in hamsters do
		if not seen[seat] then
			h.model:Destroy()
			hamsters[seat] = nil
		end
	end
	-- Input shows the throw button while this is set.
	if player:GetAttribute("HRCarrying") ~= carrying then
		player:SetAttribute("HRCarrying", carrying)
	end

	-- In overtime home grows towards the flower.
	if homeEdge.Position.X ~= latest.homeX then
		local size = homePart.Size
		local at = homePart.Position
		homePart.Size = Vector3.new(latest.homeX - HOME_X1, size.Y, size.Z)
		homePart.Position = Vector3.new((HOME_X1 + latest.homeX) / 2, at.Y, at.Z)
		homeEdge.Position = Vector3.new(latest.homeX, homeEdge.Position.Y, homeEdge.Position.Z)
	end

	-- The count before the start, then "go" for a moment.
	bigLabel.Visible = latest.phase == "countdown" or (latest.phase == "playing" and latest.time < 0.7)
	if latest.phase == "countdown" then
		bigLabel.Text = tostring(math.max(1, math.ceil(latest.countdown)))
		timerLabel.Text = clock(0)
		timerLabel.TextColor3 = WHITE
	else
		bigLabel.Text = "출발!"
		local overtime = latest.time > Config.OVERTIME.start
		timerLabel.Text = (if overtime then "연장전 " else "") .. clock(math.floor(latest.time))
		timerLabel.TextColor3 = if overtime then RED else WHITE
	end
end)

placeCamera()
-- Ready to draw: ask the server where things stand.
roundRemote:FireServer()

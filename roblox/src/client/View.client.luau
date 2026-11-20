-- Everything the player sees: the camera looking down on the meadow, a hamster
-- for every seat, and the words on screen. It draws what the server says and
-- decides nothing. The one liberty it takes is drawing the player's own hamster
-- a little ahead of the server, so that the keys answer at once.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ContextActionService = game:GetService("ContextActionService")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")
local TweenService = game:GetService("TweenService")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Map = require(ReplicatedStorage:WaitForChild("Map"))
local Sim = require(ReplicatedStorage:WaitForChild("Sim"))
local Snapshot = require(ReplicatedStorage:WaitForChild("Snapshot"))
local Fx = require(script.Parent:WaitForChild("Fx"))
local Hamster = require(script.Parent:WaitForChild("Hamster"))

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("HashRushRemotes")
local roundRemote = remotes:WaitForChild("Round")
local readyRemote = remotes:WaitForChild("Ready")
local lobbyRemote = remotes:WaitForChild("Lobby")
local snapRemote = remotes:WaitForChild("Snap")
local mapFolder = workspace:WaitForChild("HashRushMap")

local WORLD_W = Map.world.w
local WORLD_H = Map.world.h
local HOME_X1 = Map.home.x1
local FLOWER = Map.flower
local homePart = mapFolder:WaitForChild("Home")
local homeEdge = mapFolder:WaitForChild("HomeEdge")
local sunflower = mapFolder:WaitForChild("Sunflower")
local sunflowerAt = sunflower:GetPivot()

local FONT = Enum.Font.FredokaOne
local WHITE = Color3.new(1, 1, 1)
local INK = Color3.fromRGB(58, 40, 30)
local PANEL = Color3.fromRGB(64, 44, 34)
local CREAM = Color3.fromRGB(255, 244, 222)
local RED = Color3.fromRGB(255, 86, 74)
local GOLD = Color3.fromRGB(255, 214, 70)

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

local FOV = 20 -- narrow, so the picture stays close to flat
local TILT = math.rad(16) -- off straight down, enough to see the sides of things
local punch = 0 -- a hit pushes the camera in for a moment

local function placeCamera(dt)
	local camera = workspace.CurrentCamera
	camera.CameraType = Enum.CameraType.Scriptable
	punch = math.max(0, punch - dt * 5)
	camera.FieldOfView = FOV - punch * 0.7
	local view = camera.ViewportSize
	local half = math.tan(math.rad(FOV / 2))
	-- Far enough for the whole field, with room for the top bar.
	local distance = math.max(WORLD_H * 1.2 * math.cos(TILT) / (2 * half), WORLD_W * 1.05 / (2 * half * view.X / view.Y))
	local centre = Vector3.new(WORLD_W / 2, 0, WORLD_H * 0.45) + Fx.cameraOffset(dt)
	-- Screen right is +X and screen down is +Z, the same way round as the sim.
	camera.CFrame = CFrame.lookAt(centre + Vector3.new(0, math.cos(TILT), math.sin(TILT)) * distance, centre)
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

local function text(props, parent, outline)
	local label = make("TextLabel", {
		BackgroundTransparency = 1,
		Font = FONT,
		TextColor3 = WHITE,
		TextScaled = true,
		Text = "",
	}, nil)
	for key, value in props do
		label[key] = value
	end
	label.Parent = parent
	if outline ~= false then
		make("UIStroke", { Thickness = outline or 3, Color = INK }, label)
	end
	return label
end

-- A rounded card with a dark rim.
local function panel(props, parent, radius)
	local frame = make("Frame", { BackgroundColor3 = PANEL, BorderSizePixel = 0 }, nil)
	for key, value in props do
		frame[key] = value
	end
	frame.Parent = parent
	make("UICorner", { CornerRadius = UDim.new(0, radius or 18) }, frame)
	make("UIStroke", { Thickness = 3, Color = INK }, frame)
	return frame
end

local function pop(scale, from)
	scale.Scale = from or 0.3
	TweenService:Create(scale, TweenInfo.new(0.22, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
end

local screen = make("ScreenGui", { Name = "HashRushHud", ResetOnSpawn = false, IgnoreGuiInset = true }, player:WaitForChild("PlayerGui"))
-- Everything is laid out for a screen 720 tall and scaled to the real one.
local hud = make("Frame", { BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1) }, screen)
local hudScale = make("UIScale", {}, hud)
local function fitHud()
	local view = workspace.CurrentCamera.ViewportSize
	local s = math.clamp(math.min(view.Y / 720, view.X / 900), 0.45, 2)
	hudScale.Scale = s
	hud.Size = UDim2.fromScale(1 / s, 1 / s)
end

-- A red rim when a seed is about to get home, and a flash on a hit.
local alarmRim = make("Frame", { BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Visible = false }, screen)
local alarmStroke = make("UIStroke", { Thickness = 16, Color = RED, Transparency = 0.4 }, alarmRim)
local flashFrame = make("Frame", { BackgroundColor3 = WHITE, BackgroundTransparency = 1, BorderSizePixel = 0, Size = UDim2.fromScale(1, 1), ZIndex = 30 }, screen)
local function flash(color, strength)
	flashFrame.BackgroundColor3 = color
	flashFrame.BackgroundTransparency = 1 - strength
	TweenService:Create(flashFrame, TweenInfo.new(0.25), { BackgroundTransparency = 1 }):Play()
end

local timerPanel = panel({ AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 10), Size = UDim2.fromOffset(190, 50) }, hud, 25)
local timerLabel = text({ Size = UDim2.new(1, -24, 1, -10), Position = UDim2.fromOffset(12, 5) }, timerPanel, false)
local timerScale = make("UIScale", {}, timerPanel)
local scoreRow = make("Frame", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 68), Size = UDim2.new(1, -24, 0, 30), BackgroundTransparency = 1 }, hud)
make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }, scoreRow)

-- Sound on and off.
local muteButton = make("TextButton", { AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -14, 0, 12), Size = UDim2.fromOffset(46, 46), BackgroundColor3 = PANEL, BorderSizePixel = 0, AutoButtonColor = false, Font = FONT, TextSize = 24, TextColor3 = WHITE, Text = "🔊" }, hud)
make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, muteButton)
make("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Thickness = 3, Color = INK }, muteButton)
muteButton.Activated:Connect(function()
	Fx.setMuted(not Fx.muted())
	muteButton.Text = if Fx.muted() then "🔇" else "🔊"
end)

-- Who bonked whom, newest at the top.
local feed = make("Frame", { AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -14, 0, 112), Size = UDim2.fromOffset(300, 200), BackgroundTransparency = 1 }, hud)
make("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Right, Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, feed)
local feedCount = 0

local bigLabel = text({ AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.45), Size = UDim2.fromOffset(520, 190), Visible = false }, hud, 7)
local bigScale = make("UIScale", {}, bigLabel)
local bannerLabel = text({ AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.24), Size = UDim2.fromOffset(860, 76), TextColor3 = GOLD, Visible = false }, hud, 5)
local bannerScale = make("UIScale", {}, bannerLabel)
local noticePanel = panel({ AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -14), Size = UDim2.fromOffset(520, 40), Visible = false }, hud, 20)
local noticeLabel = text({ Size = UDim2.new(1, -30, 1, -14), Position = UDim2.fromOffset(15, 7) }, noticePanel, false)
local function notice(message)
	noticeLabel.Text = message
	noticePanel.Visible = message ~= ""
end

-- Nothing starts until the players say so: this is the button that says so.
local readyButton = make("TextButton", {
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -62),
	Size = UDim2.fromOffset(300, 64),
	BackgroundColor3 = Color3.fromRGB(96, 196, 96),
	BorderSizePixel = 0,
	AutoButtonColor = false,
	Font = FONT,
	TextSize = 30,
	TextColor3 = WHITE,
	Text = "",
	Visible = false,
}, hud)
make("UICorner", { CornerRadius = UDim.new(0, 26) }, readyButton)
make("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Thickness = 4, Color = INK }, readyButton)
make("UIStroke", { Thickness = 3, Color = INK }, readyButton)
local readyScale = make("UIScale", {}, readyButton)
local myReady = false
local function showReady()
	readyButton.Text = if myReady then "✅ 준비 완료!" else "▶ 준비! (Enter)"
	readyButton.BackgroundColor3 = if myReady then Color3.fromRGB(120, 130, 140) else Color3.fromRGB(96, 196, 96)
end
local function setReady(want)
	myReady = want
	showReady()
	pop(readyScale, 0.8)
	Fx.sound("click")
	readyRemote:FireServer(want)
end
readyButton.Activated:Connect(function()
	setReady(not myReady)
end)
ContextActionService:BindAction("HashRushReady", function(_, inputState)
	if inputState ~= Enum.UserInputState.Begin or not readyButton.Visible then
		return Enum.ContextActionResult.Pass
	end
	setReady(not myReady)
	return Enum.ContextActionResult.Sink
end, false, Enum.KeyCode.Return, Enum.KeyCode.KeypadEnter, Enum.KeyCode.ButtonStart)

-- The lobby's bots: how many, and how good. Anyone may change them.
local botBar = panel({ AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -134), Size = UDim2.fromOffset(430, 46), Visible = false }, hud, 23)
local botLabel = text({ Position = UDim2.fromOffset(16, 9), Size = UDim2.fromOffset(120, 28), TextXAlignment = Enum.TextXAlignment.Left }, botBar, false)
local function barButton(label, x, width, action)
	local button = make("TextButton", { Position = UDim2.fromOffset(x, 6), Size = UDim2.fromOffset(width, 34), BackgroundColor3 = Color3.fromRGB(110, 78, 48), BorderSizePixel = 0, AutoButtonColor = false, Font = FONT, TextSize = 20, TextColor3 = CREAM, Text = label }, botBar)
	make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, button)
	make("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Thickness = 2, Color = INK }, button)
	button.Activated:Connect(function()
		Fx.sound("click")
		action()
	end)
	return button
end
barButton("−", 146, 40, function()
	lobbyRemote:FireServer("bots", -1)
end)
barButton("+", 192, 40, function()
	lobbyRemote:FireServer("bots", 1)
end)
local levelButton = barButton("", 246, 170, function()
	lobbyRemote:FireServer("level")
end)

-- How to play and who is here, shown while waiting in the lobby.
local helpPanel = panel({ AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.43), Size = UDim2.fromOffset(800, 330), Visible = false }, hud, 28)
local peopleList = make("Frame", { Position = UDim2.fromOffset(520, 90), Size = UDim2.fromOffset(252, 226), BackgroundColor3 = Color3.fromRGB(48, 32, 24), BorderSizePixel = 0 }, helpPanel)
make("UICorner", { CornerRadius = UDim.new(0, 14) }, peopleList)
make("UIListLayout", { Padding = UDim.new(0, 2), SortOrder = Enum.SortOrder.LayoutOrder }, peopleList)
make("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 10), PaddingTop = UDim.new(0, 6) }, peopleList)
local function showPeople(msg)
	for _, child in peopleList:GetChildren() do
		if child:IsA("TextLabel") then
			child:Destroy()
		end
	end
	local function line(order, message, color)
		make("TextLabel", { LayoutOrder = order, BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 24), Font = FONT, TextSize = 18, TextColor3 = color, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, Text = message }, peopleList)
	end
	for i, person in msg.people do
		if i <= 8 then
			line(i, (if person.ready then "✅ " else "⏳ ") .. person.name, if person.ready then CREAM else Color3.fromRGB(190, 170, 150))
		end
	end
	if msg.bots > 0 and #msg.people < 8 then
		line(20, ("🤖 봇 %d마리 · %s"):format(msg.bots, msg.level), GOLD)
	end
end
text({ Position = UDim2.fromOffset(30, 18), Size = UDim2.new(1, -60, 0, 56), Text = "🐹 Hash Rush", TextColor3 = GOLD }, helpPanel, 4)
do
	local lines = {
		{ "🌻", "해바라기 옆에서 가만히 있으면 해씨를 캐요" },
		{ "🏠", "해씨를 물고 집으로 돌아오면 승리!" },
		{ "👊", "꿀밤으로 상대를 둥지로 돌려보내요" },
		{ "💨", "해씨를 던져서 줄지어 선 상대를 쓰러뜨려요" },
	}
	for i, line in lines do
		local row = make("Frame", { BackgroundColor3 = Color3.fromRGB(88, 62, 46), BorderSizePixel = 0, Position = UDim2.fromOffset(28, 34 + i * 56), Size = UDim2.fromOffset(476, 46) }, helpPanel)
		make("UICorner", { CornerRadius = UDim.new(0, 14) }, row)
		text({ Position = UDim2.fromOffset(8, 5), Size = UDim2.fromOffset(40, 36), Text = line[1] }, row, false)
		text({ Position = UDim2.fromOffset(56, 9), Size = UDim2.new(1, -68, 0, 28), Text = line[2], TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = CREAM }, row, false)
	end
end

local resultPanel = panel({ AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.45), Size = UDim2.fromOffset(600, 400), Visible = false }, hud, 30)
local resultScale = make("UIScale", {}, resultPanel)
local resultTitle = text({ Position = UDim2.fromOffset(24, 18), Size = UDim2.new(1, -48, 0, 66), TextColor3 = GOLD }, resultPanel, 4)
local resultWhy = text({ Position = UDim2.fromOffset(24, 86), Size = UDim2.new(1, -48, 0, 26), TextColor3 = CREAM }, resultPanel, false)
local resultRows = make("Frame", { Position = UDim2.fromOffset(28, 126), Size = UDim2.new(1, -56, 0, 250), BackgroundTransparency = 1 }, resultPanel)
make("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder }, resultRows)

local bannerShown = 0
local function banner(message, color)
	bannerShown += 1
	local mine = bannerShown
	bannerLabel.Text = message
	bannerLabel.TextColor3 = color or GOLD
	bannerLabel.Visible = true
	pop(bannerScale)
	task.delay(1.8, function()
		if bannerShown == mine then
			bannerLabel.Visible = false
		end
	end)
end

-- World -------------------------------------------------------------------

local viewFolder = make("Folder", { Name = "HashRushView" }, workspace)

local round = -1
local roster = {} -- [seat] = { id, userId, name, wins, kills }
local hamsters = {} -- [seat] = Hamster
local mySeat = nil
local latest = nil -- the newest snapshot of this round
local flowerKick = 0 -- the sunflower shakes when a seed comes loose

local function seatColor(seat)
	local rgb = Config.COLORS[seat]
	return Color3.fromRGB(rgb[1], rgb[2], rgb[3])
end

local function clearHamsters()
	for _, h in hamsters do
		h:destroy()
	end
	table.clear(hamsters)
end

local function drawScores()
	for _, child in scoreRow:GetChildren() do
		if child:IsA("Frame") then
			child:Destroy()
		end
	end
	for seat = 1, Config.MAX_PLAYERS do
		local info = roster[seat]
		if info then
			local chip = make("Frame", { LayoutOrder = seat, AutomaticSize = Enum.AutomaticSize.X, Size = UDim2.fromOffset(0, 30), BackgroundColor3 = PANEL, BorderSizePixel = 0 }, scoreRow)
			make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, chip)
			make("UIStroke", { Thickness = if seat == mySeat then 3 else 2, Color = if seat == mySeat then GOLD else INK }, chip)
			make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, VerticalAlignment = Enum.VerticalAlignment.Center, Padding = UDim.new(0, 6) }, chip)
			make("UIPadding", { PaddingLeft = UDim.new(0, 6), PaddingRight = UDim.new(0, 12) }, chip)
			local dot = make("Frame", { Size = UDim2.fromOffset(20, 20), BackgroundColor3 = seatColor(seat), BorderSizePixel = 0 }, chip)
			make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, dot)
			make("UIStroke", { Thickness = 2, Color = INK }, dot)
			make("TextLabel", {
				AutomaticSize = Enum.AutomaticSize.X,
				Size = UDim2.fromOffset(0, 22),
				BackgroundTransparency = 1,
				Font = FONT,
				TextSize = 18,
				TextColor3 = CREAM,
				Text = ("%s  ⭐%d"):format(info.name, info.wins),
			}, chip)
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

local function addFeed(message)
	feedCount += 1
	local row = panel({ LayoutOrder = -feedCount, AutomaticSize = Enum.AutomaticSize.X, Size = UDim2.fromOffset(0, 30) }, feed, 15)
	make("UIPadding", { PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12) }, row)
	make("TextLabel", { AutomaticSize = Enum.AutomaticSize.X, Size = UDim2.fromOffset(0, 30), BackgroundTransparency = 1, Font = FONT, TextSize = 17, TextColor3 = CREAM, Text = message }, row)
	local scale = make("UIScale", {}, row)
	pop(scale, 0.5)
	task.delay(4, function()
		row:Destroy()
	end)
end

local MULTI = { [2] = "더블킬!", [3] = "트리플킬! 슈퍼플레이!", [4] = "쿼드라킬! 슈퍼플레이!" }
local predictedSwing = 0 -- os.clock() of the last swing drawn before the server said so

local function showEvent(e)
	local h = e.id and hamsters[e.id]
	if e.type == "swing" then
		if h then
			h:swing()
		end
		-- My own swing already sounded when the key went down.
		if e.id ~= mySeat or os.clock() - predictedSwing > 0.4 then
			Fx.sound("swing")
		end
	elseif e.type == "impact" then
		if not e.hit then
			Fx.dust(e.x + e.dx * 2.8, e.y + e.dy * 2.8, 6, 9)
			Fx.sound("whiff")
		end
	elseif e.type == "bonk" then
		local mine = e.by == mySeat or e.id == mySeat
		local by = hamsters[e.by]
		local dx, dy = 1, 0
		if by and by.x then
			local len = math.sqrt((e.x - by.x) ^ 2 + (e.y - by.y) ^ 2)
			if len > 0.01 then
				dx, dy = (e.x - by.x) / len, (e.y - by.y) / len
			end
			by:squash(5)
		end
		Fx.stars(e.x, e.y, GOLD, 20)
		Fx.dust(e.x, e.y, 8, 12)
		Fx.ring(e.x, e.y, 7, WHITE, 0.3)
		Fx.words(e.x, e.y, "뿅!", RED, 9)
		Fx.tumble(e.x, e.y, dx, dy, seatColor(e.id))
		Fx.sound("hit")
		Fx.sound("boing")
		Fx.sound("thump")
		if e.id == mySeat then
			Fx.sound("ouch")
		end
		Fx.shake(if mine then 0.75 else 0.4)
		Fx.hitStop(if mine then 0.1 else 0.05)
		punch = if mine then 1 else 0.5
		if e.id == mySeat then
			flash(RED, 0.4)
		elseif e.by == mySeat then
			flash(WHITE, 0.22)
		end
		addFeed(("%s 👊 %s%s"):format(nameOf(e.by), nameOf(e.id), if e.seed then " 🌻" else ""))
		if e.close then
			banner(nameOf(e.by) .. " 슈퍼플레이!")
		end
	elseif e.type == "throw" then
		Fx.words(e.x, e.y, "던지기!", GOLD, 8)
		Fx.seedShot(e.x, e.y, e.dx, e.dy, Config.THROW.range)
		Fx.sound("throw")
		Fx.shake(0.2)
		if h then
			h:squash(4)
		end
	elseif e.type == "multi" then
		banner(nameOf(e.by) .. " " .. (MULTI[e.n] or "펜타킬! 슈퍼플레이!"))
	elseif e.type == "seed" then
		if h and h.x then
			Fx.stars(h.x, h.y, GOLD, 12)
			Fx.words(h.x, h.y, "🌻 해씨 획득!", GOLD, 9)
			h:squash(-5)
		end
		Fx.sound("seed")
		flowerKick = 1
	elseif e.type == "steal" then
		local by = hamsters[e.by]
		Fx.stars(e.x, e.y, CREAM, 10)
		Fx.words(e.x, e.y, "슬쩍!", CREAM, 8)
		Fx.sound("steal")
		if by then
			by:squash(-4)
		end
		addFeed(("%s 🤏 %s 🌻"):format(nameOf(e.by), nameOf(e.id)))
		if e.close then
			banner(nameOf(e.by) .. " 슈퍼플레이!")
		end
	elseif e.type == "spawn" then
		Fx.dust(e.x, e.y, 6, 8)
	elseif e.type == "warp" then
		Fx.dust(e.fromX, e.fromY, 7, 9)
		Fx.ring(e.fromX, e.fromY, 5, Color3.fromRGB(200, 160, 110), 0.3)
		Fx.dust(e.x, e.y, 6, 8)
		Fx.words(e.fromX, e.fromY, "쏙!", CREAM, 7)
		Fx.sound("warp")
	elseif e.type == "go" then
		Fx.sound("go")
	elseif e.type == "overtime" then
		banner("연장전! 집이 넓어져요", RED)
		Fx.sound("alarm", 0.7)
		Fx.music("round", 1.08)
	elseif e.type == "rush" then
		banner("집이 빠르게 밀려와요!", RED)
		Fx.sound("alarm", 0.7)
		Fx.music("round", 1.18)
	end
end

local MEDALS = { "🥇", "🥈", "🥉" }

local function showResult(msg)
	setRoster(msg.roster)
	local names = {}
	local iWon = false
	for _, seat in msg.winners do
		table.insert(names, nameOf(seat))
		iWon = iWon or seat == mySeat
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
	for _, child in resultRows:GetChildren() do
		if child:IsA("Frame") then
			child:Destroy()
		end
	end
	local rowHeight = math.min(42, math.floor(250 / math.max(1, #sorted)) - 6)
	for i, info in sorted do
		local me = info.id == mySeat
		local row = make("Frame", { LayoutOrder = i, BackgroundColor3 = if me then Color3.fromRGB(110, 78, 48) else Color3.fromRGB(88, 62, 46), BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, rowHeight) }, resultRows)
		make("UICorner", { CornerRadius = UDim.new(0, 12) }, row)
		if me then
			make("UIStroke", { Thickness = 2, Color = GOLD }, row)
		end
		text({ Position = UDim2.fromOffset(8, 3), Size = UDim2.new(0, 36, 1, -6), Text = MEDALS[i] or tostring(i) }, row, false)
		local dot = make("Frame", { AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 52, 0.5, 0), Size = UDim2.fromOffset(22, 22), BackgroundColor3 = seatColor(info.id), BorderSizePixel = 0 }, row)
		make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, dot)
		make("UIStroke", { Thickness = 2, Color = INK }, dot)
		text({ Position = UDim2.fromOffset(84, 6), Size = UDim2.new(1, -280, 1, -12), Text = info.name, TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = CREAM }, row, false)
		text({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -100, 0, 6), Size = UDim2.new(0, 84, 1, -12), Text = ("⭐ %d승"):format(info.wins), TextColor3 = GOLD }, row, false)
		text({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -10, 0, 6), Size = UDim2.new(0, 80, 1, -12), Text = ("👊 %d"):format(info.kills), TextColor3 = CREAM }, row, false)
	end
	resultPanel.Visible = true
	pop(resultScale, 0.6)
	bigLabel.Visible = false
	alarmRim.Visible = false
	Fx.music(nil)
	if iWon then
		Fx.sound("win")
		Fx.confetti(screen)
	else
		Fx.sound("over")
	end
	-- The lobby tune comes back once the sting has had its say.
	task.delay(4, function()
		if resultPanel.Visible then
			Fx.music("lobby")
		end
	end)
end

roundRemote.OnClientEvent:Connect(function(msg)
	if msg.kind == "lobby" then
		-- After a round the result stays up, with the hamsters where they stood.
		if not resultPanel.Visible then
			round = -1
			latest = nil
			clearHamsters()
			setRoster({})
			helpPanel.Visible = true
			Fx.music("lobby")
		end
		bigLabel.Visible = false
		alarmRim.Visible = false
		timerLabel.Text = "🌻 대기 중"
		timerLabel.TextColor3 = WHITE
		timerScale.Scale = 1
		if not readyButton.Visible then
			myReady = false
			showReady()
			readyButton.Visible = true
		end
		botBar.Visible = true
		botLabel.Text = ("🤖 봇 %d"):format(msg.bots)
		levelButton.Text = "난이도 " .. msg.level
		showPeople(msg)
		if msg.left then
			notice(("%d초 뒤 시작해요 · 준비 %d/%d명"):format(msg.left, msg.ready, msg.count))
		elseif msg.short > 0 then
			notice(("상대가 필요해요 · 햄스터 %d마리를 더 기다리거나 봇을 넣어요"):format(msg.short))
		else
			notice(("모두 준비하면 시작해요 · 준비 %d/%d명"):format(msg.ready, msg.count))
		end
	elseif msg.kind == "start" then
		round = msg.round
		latest = nil
		clearHamsters()
		setRoster(msg.roster)
		for _, info in msg.roster do
			hamsters[info.id] = Hamster.new(viewFolder, info, info.id == mySeat)
		end
		resultPanel.Visible = false
		helpPanel.Visible = false
		readyButton.Visible = false
		botBar.Visible = false
		Fx.music("round")
		notice(if mySeat then "" else "관전 중 · 판이 끝나면 준비를 눌러 참가해요")
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

-- The bonk key answers at once: the paw goes up before the server has heard.
player:GetAttributeChangedSignal("HRBonk"):Connect(function()
	local h = mySeat and hamsters[mySeat]
	local me = nil
	if latest then
		for _, p in latest.players do
			if p.id == mySeat then
				me = p
			end
		end
	end
	if not h or not me or latest.phase ~= "playing" or me.dazed or me.x < latest.homeX then
		return
	end
	if os.clock() - predictedSwing < Config.BONK.cooldown then
		return
	end
	predictedSwing = os.clock()
	h:swing()
	Fx.sound("swing")
end)

-- Where to draw my own hamster: where the server last saw it, plus what the keys
-- have asked for since then that the server cannot have heard about yet.
local moves = {} -- { t, dx, dy }, oldest first
local function ahead(p, dt)
	local now = os.clock()
	local move = player:GetAttribute("HRMove")
	local speed = Config.SPEED
	if p.carrying then
		speed *= if p.alarm then Config.LAST_STRETCH_SPEED else Config.CARRY_SPEED
	end
	if latest.phase ~= "playing" or p.dazed or p.windup or now - predictedSwing < Config.BONK.windup then
		speed = 0
	elseif p.recovery then
		speed *= Config.BONK.recoveryMove
	end
	if typeof(move) == "Vector2" and speed > 0 then
		table.insert(moves, { t = now, dx = move.X * speed * dt, dy = move.Y * speed * dt })
	end
	local window = math.clamp(player:GetNetworkPing() * 2 + 0.02, 0.02, 0.25)
	while moves[1] and now - moves[1].t > window do
		table.remove(moves, 1)
	end
	local spot = { x = p.x, y = p.y }
	for _, m in moves do
		spot.x += m.dx
		spot.y += m.dy
	end
	Sim.collide(Map, spot)
	return spot.x, spot.y
end

local function clock(seconds)
	return ("%d:%02d"):format(seconds // 60, seconds % 60)
end

local time = 0
local shownCount = nil
local alarmBeep = 0
local stepDust = {}

RunService:BindToRenderStep("HashRushView", Enum.RenderPriority.Camera.Value + 1, function(dt)
	time += dt
	fitHud()
	placeCamera(dt)
	-- The sunflower nods in the breeze, and shakes when it is being nibbled.
	flowerKick = math.max(0, flowerKick - dt * 2.5)
	local busy = if latest and latest.nibbler ~= 0 then 1 else 0
	local sway = 0.05 + busy * 0.06 + flowerKick * 0.25
	local rate = 1.6 + busy * 9 + flowerKick * 14
	sunflower:PivotTo(sunflowerAt * CFrame.Angles(math.sin(time * rate) * sway, time * 0.25, math.cos(time * rate * 0.83) * sway))

	if not latest then
		return
	end
	-- A big hit holds the world still for a moment.
	if Fx.frozen() then
		return
	end

	local seen = {}
	local carrying = false
	local alarm = false
	for _, p in latest.players do
		local h = hamsters[p.id]
		if h then
			seen[p.id] = true
			local x, y = p.x, p.y
			if h.me then
				x, y = ahead(p, dt)
				carrying = p.carrying
			end
			-- It slides to where it should be rather than jumping, unless it is far.
			if h.x and math.abs(x - h.x) + math.abs(y - h.y) <= 5 then
				local k = 1 - math.exp(-dt * (if h.me then 45 else 30))
				x = h.x + (x - h.x) * k
				y = h.y + (y - h.y) * k
			end
			alarm = alarm or p.alarm

			local status = ""
			local nibbling = latest.nibbler == p.id
			local bar = if nibbling then latest.gather else nil
			if p.dazed then
				status = "💫 기절"
			elseif nibbling then
				status = "해씨 캐는 중"
			elseif p.pick > 0 then
				-- Rubbing up against a carrier to take its seed.
				status = "슬쩍하는 중"
				bar = p.pick
			end
			-- Hints only its own player sees.
			if h.me and not p.carrying and not p.dazed then
				local inRing = (Vector2.new(p.x, p.y) - Vector2.new(FLOWER.x, FLOWER.y)).Magnitude <= FLOWER.gatherR
				if inRing and (nibbling or latest.nibbler == 0) and player:GetAttribute("HRMoving") then
					status = "가만히 있어야 캐져요!"
				elseif inRing and not nibbling and latest.nibbler ~= 0 then
					status = "앞 햄스터가 캐는 중… 대기"
				end
			end
			h:draw(dt, x, y, p, { bar = bar, status = status })

			-- Dust under running feet.
			if h.pace > Config.SPEED * 0.5 then
				local last = stepDust[p.id] or 0
				if time - last > 0.16 then
					stepDust[p.id] = time
					Fx.dust(x - p.fx * 1.2, y - p.fy * 1.2, 1, 3)
				end
			end
		end
	end
	-- Whoever left the game took its hamster along.
	for seat, h in hamsters do
		if not seen[seat] then
			h:destroy()
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
	local overtime = latest.time > Config.OVERTIME.start
	homeEdge.Transparency = if overtime then 0.1 + (math.sin(time * 10) + 1) * 0.25 else 0.15

	-- A seed is nearly home: everyone gets the red rim and the beeps.
	alarm = alarm and latest.phase == "playing"
	alarmRim.Visible = alarm
	if alarm then
		alarmStroke.Transparency = 0.35 + (math.sin(time * 12) + 1) * 0.3
		if time - alarmBeep > 0.4 then
			alarmBeep = time
			Fx.sound("alarm")
		end
	end

	-- The count before the start, then "go" for a moment.
	local counting = latest.phase == "countdown"
	local big = if counting then tostring(math.max(1, math.ceil(latest.countdown))) elseif latest.phase == "playing" and latest.time < 0.8 then "출발!" else nil
	bigLabel.Visible = big ~= nil and not resultPanel.Visible
	if big ~= shownCount then
		shownCount = big
		if big then
			bigLabel.Text = big
			bigLabel.TextColor3 = if counting then WHITE else GOLD
			pop(bigScale, 0.2)
			if counting then
				Fx.sound("tick")
			end
		end
	end
	if counting then
		timerLabel.Text = "준비…"
		timerLabel.TextColor3 = WHITE
		timerScale.Scale = 1
	else
		timerLabel.Text = (if overtime then "🔥 " else "⏱ ") .. clock(math.floor(latest.time))
		timerLabel.TextColor3 = if overtime then RED else WHITE
		timerScale.Scale = if overtime then 1 + math.max(0, math.sin(time * 6)) * 0.06 else 1
	end
end)

fitHud()
placeCamera(0)
-- Ready to draw: ask the server where things stand.
roundRemote:FireServer()

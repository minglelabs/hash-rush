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
local Lang = require(ReplicatedStorage:WaitForChild("Lang"))
local Fx = require(script.Parent:WaitForChild("Fx"))
local Hamster = require(script.Parent:WaitForChild("Hamster"))
local Tutorial = require(script.Parent:WaitForChild("Tutorial"))

local player = Players.LocalPlayer
Lang.pick(player)
local UserInputService = game:GetService("UserInputService")
-- A phone or tablet with no keyboard: the words name its buttons, not keys.
local touchOnly = UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled
local remotes = ReplicatedStorage:WaitForChild("HashRushRemotes")
local roundRemote = remotes:WaitForChild("Round")
local readyRemote = remotes:WaitForChild("Ready")
local lobbyRemote = remotes:WaitForChild("Lobby")
local snapRemote = remotes:WaitForChild("Snap")
local mapFolder = workspace:WaitForChild("HashRushMap")
Map.label(mapFolder)

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
-- Waiting, watching or out of the round, it shows the whole meadow. Playing, it
-- comes in close over my hamster and keeps it in the middle, gliding after it;
-- a portal or a knock-out home cuts straight to where it went.

local FOV = 20 -- narrow, so the picture stays close to flat
local TILT_WIDE = math.rad(16) -- off straight down, enough to see the sides of things
local TILT_NEAR = math.rad(30) -- closer in, a little more from the side
local NEAR_H = 30 -- studs of meadow from the top of the screen to the bottom, close in
local NEAR_W = 36 -- and at least this many across, on a narrow screen
local FOLLOW = 3.2 -- how quickly it catches up, per second
local punch = 0 -- a hit pushes the camera in for a moment
local focus = nil -- the spot it looks at while close in
local lead = Vector3.zero -- where my hamster is heading, smoothed
local lastTarget = nil
local near = 0 -- 0 the whole meadow, 1 close in; eased between
local snapCamera = true

local function placeCamera(dt, target)
	local camera = workspace.CurrentCamera
	camera.CameraType = Enum.CameraType.Scriptable
	punch = math.max(0, punch - dt * 5)
	camera.FieldOfView = FOV - punch * 0.7
	local view = camera.ViewportSize
	local aspect = view.X / math.max(1, view.Y)
	local half = math.tan(math.rad(FOV / 2))
	local shake = Fx.cameraOffset(dt)

	-- The whole meadow, with room for the top bar.
	local wideDistance = math.max(WORLD_H * 1.2 * math.cos(TILT_WIDE) / (2 * half), WORLD_W * 1.05 / (2 * half * aspect))
	local wideCentre = Vector3.new(WORLD_W / 2, 0, WORLD_H * 0.45)

	near += ((if target then 1 else 0) - near) * (1 - math.exp(-dt * (if target then 4 else 2.5)))
	if target then
		local at = Vector3.new(target.X, 0, target.Y)
		if snapCamera or not focus or not lastTarget or (at - lastTarget).Magnitude > 12 then
			-- A portal, a knock-out or a new round: straight there.
			focus = at
			lead = Vector3.zero
			snapCamera = false
		elseif dt > 0 then
			-- Looking a little ahead of where it runs, so gliding after it does not
			-- leave it trailing behind the middle.
			local velocity = (at - lastTarget) / dt
			lead += (velocity / FOLLOW - lead) * (1 - math.exp(-dt * 6))
			focus = focus:Lerp(at + lead, 1 - math.exp(-dt * FOLLOW))
		end
		lastTarget = at
	else
		lastTarget = nil
	end

	local tilt = TILT_WIDE + (TILT_NEAR - TILT_WIDE) * near
	local nearDistance = math.max(NEAR_H * math.cos(TILT_NEAR) / (2 * half), NEAR_W / (2 * half * aspect))
	local nearCentre = wideCentre
	if focus then
		-- Not much past the fence: the view stops at the edge of the meadow.
		local halfW = nearDistance * half * aspect
		local halfH = NEAR_H / 2
		local function hold(v, lo, hi)
			return if lo > hi then (lo + hi) / 2 else math.clamp(v, lo, hi)
		end
		nearCentre = Vector3.new(hold(focus.X, halfW - 3, WORLD_W - halfW + 3), 0, hold(focus.Z, halfH - 4, WORLD_H - halfH + 3))
	end
	local distance = wideDistance + (nearDistance - wideDistance) * near
	local centre = wideCentre:Lerp(nearCentre, near) + shake
	-- Screen right is +X and screen down is +Z, the same way round as the sim.
	camera.CFrame = CFrame.lookAt(centre + Vector3.new(0, math.cos(tilt), math.sin(tilt)) * distance, centre)
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

-- A word across the middle of the screen for a moment (defined further down).
local banner

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
-- The lobby as the server last told it: am I playing the next round, do I host it.
local myPlaying = true
local amHost = false
local lobbyFull = false
local function showReady()
	if not myPlaying then
		readyButton.Text = Lang.t("joinPrompt")
		readyButton.BackgroundColor3 = Color3.fromRGB(70, 120, 190)
		return
	end
	readyButton.Text = if myReady then Lang.t("ready") else Lang.t("readyPrompt") .. (if touchOnly then "" else Lang.t("readyKey"))
	readyButton.BackgroundColor3 = if myReady then Color3.fromRGB(120, 130, 140) else Color3.fromRGB(96, 196, 96)
end
local function setReady(want)
	myReady = want
	showReady()
	pop(readyScale, 0.8)
	readyRemote:FireServer(want)
end
-- Watching, the button asks for a seat instead.
local function pressReady()
	if myPlaying then
		setReady(not myReady)
	elseif lobbyFull then
		banner(Lang.t("full", Config.MAX_PLAYERS), RED)
	else
		pop(readyScale, 0.8)
		lobbyRemote:FireServer("seat", player.UserId, true)
	end
end
readyButton.Activated:Connect(pressReady)
ContextActionService:BindAction("HashRushReady", function(_, inputState)
	if inputState ~= Enum.UserInputState.Begin or not readyButton.Visible then
		return Enum.ContextActionResult.Pass
	end
	pressReady()
	return Enum.ContextActionResult.Sink
end, false, Enum.KeyCode.Return, Enum.KeyCode.KeypadEnter, Enum.KeyCode.ButtonStart)

-- The lobby's bots: how many, and how good. Only the host may change them.
local botBar = panel({ AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -134), Size = UDim2.fromOffset(546, 46), Visible = false }, hud, 23)
local botLabel = text({ Position = UDim2.fromOffset(16, 9), Size = UDim2.fromOffset(120, 28), TextXAlignment = Enum.TextXAlignment.Left }, botBar, false)
local function barButton(label, x, width, action)
	local button = make("TextButton", { Position = UDim2.fromOffset(x, 6), Size = UDim2.fromOffset(width, 34), BackgroundColor3 = Color3.fromRGB(110, 78, 48), BorderSizePixel = 0, AutoButtonColor = false, Font = FONT, TextSize = 20, TextColor3 = CREAM, Text = label }, botBar)
	make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, button)
	make("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Thickness = 2, Color = INK }, button)
	button.Activated:Connect(function()
		if amHost then
			action()
		else
			banner(Lang.t("hostOnly"), RED)
		end
	end)
	return button
end
local minusButton = barButton("−", 146, 40, function()
	lobbyRemote:FireServer("bots", -1)
end)
local plusButton = barButton("+", 192, 40, function()
	lobbyRemote:FireServer("bots", 1)
end)
local levelButton = barButton("", 246, 170, function()
	lobbyRemote:FireServer("level")
end)
local modeButton = barButton("", 424, 108, function()
	lobbyRemote:FireServer("teams")
end)
-- Dimmed for everyone but the host.
local function showBotBar()
	for _, button in { minusButton, plusButton, levelButton, modeButton } do
		button.TextTransparency = if amHost then 0 else 0.45
		button.BackgroundTransparency = if amHost then 0 else 0.45
	end
end

-- How to play and who is here, shown while waiting in the lobby.
local helpPanel = panel({ AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.42), Size = UDim2.fromOffset(820, 372), Visible = false }, hud, 28)
local peopleList = make("ScrollingFrame", {
	Position = UDim2.fromOffset(540, 150),
	Size = UDim2.fromOffset(252, 200),
	BackgroundColor3 = Color3.fromRGB(48, 32, 24),
	BorderSizePixel = 0,
	ScrollBarThickness = 6,
	ScrollBarImageColor3 = CREAM,
	ScrollingDirection = Enum.ScrollingDirection.Y,
	CanvasSize = UDim2.new(),
	AutomaticCanvasSize = Enum.AutomaticSize.Y,
}, helpPanel)
make("UICorner", { CornerRadius = UDim.new(0, 14) }, peopleList)
make("UIListLayout", { Padding = UDim.new(0, 2), SortOrder = Enum.SortOrder.LayoutOrder }, peopleList)
make("UIPadding", { PaddingLeft = UDim.new(0, 10), PaddingRight = UDim.new(0, 12), PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 6) }, peopleList)
local pendingHost = nil -- whom the host tapped 👑 for once; a second tap hands the lobby over
local lastLobby = nil -- the lobby message the list was drawn from

-- Who is here: those playing first, then those watching. The host gets buttons to
-- put each one in or take them out and to hand the lobby on; everyone else gets a
-- button to move themselves.
local function showPeople(msg)
	lastLobby = msg
	for _, child in peopleList:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
	local order = 0
	local function line(message, color)
		order += 1
		make("TextLabel", { LayoutOrder = order, BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 24), Font = FONT, TextSize = 18, TextColor3 = color, TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, Text = message }, peopleList)
	end
	local function row(person)
		order += 1
		local me = person.userId == player.UserId
		local frame = make("Frame", { LayoutOrder = order, BackgroundTransparency = 1, Size = UDim2.new(1, 0, 0, 26) }, peopleList)
		local buttons = {}
		local function small(label, width, color, action)
			local b = make("TextButton", { AnchorPoint = Vector2.new(1, 0.5), Size = UDim2.fromOffset(width, 22), BackgroundColor3 = color, BorderSizePixel = 0, AutoButtonColor = false, Font = FONT, TextSize = 14, TextColor3 = WHITE, Text = label }, frame)
			make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, b)
			b.Activated:Connect(action)
			table.insert(buttons, b)
		end
		-- In or out: the host for anyone, everyone else for themselves.
		if amHost or me then
			local mine = me and not amHost
			local key = if person.playing then (if mine then "watchSelf" else "seatOut") else (if mine then "joinSelf" else "seatIn")
			local full = not person.playing and msg.count >= msg.max
			local color = if person.playing then Color3.fromRGB(150, 90, 70) elseif full then Color3.fromRGB(90, 80, 70) else Color3.fromRGB(70, 140, 80)
			small(Lang.t(key), 44, color, function()
				if full then
					banner(Lang.t("full", msg.max), RED)
				else
					lobbyRemote:FireServer("seat", person.userId, not person.playing)
				end
			end)
		end
		-- Handing the lobby on takes two taps.
		if amHost and not me then
			local asking = pendingHost == person.userId
			local color = if asking then Color3.fromRGB(220, 150, 30) else Color3.fromRGB(110, 78, 48)
			small(if asking then Lang.t("confirm") else "👑", if asking then 52 else 30, color, function()
				if pendingHost == person.userId then
					pendingHost = nil
					lobbyRemote:FireServer("host", person.userId)
					return
				end
				pendingHost = person.userId
				showPeople(lastLobby)
				task.delay(3, function()
					if pendingHost == person.userId and lastLobby then
						pendingHost = nil
						showPeople(lastLobby)
					end
				end)
			end)
		end
		local right = 0
		for i = #buttons, 1, -1 do
			buttons[i].Position = UDim2.new(1, -right, 0.5, 0)
			right += buttons[i].Size.X.Offset + 4
		end
		local icon = if not person.playing then "👀 " elseif person.ready then "✅ " else "⏳ "
		local crown = if person.userId == msg.host then " 👑" else ""
		make("TextLabel", {
			BackgroundTransparency = 1,
			Size = UDim2.new(1, -right, 1, 0),
			Font = FONT,
			TextSize = 18,
			TextColor3 = if me then GOLD elseif person.playing and person.ready then CREAM else Color3.fromRGB(190, 170, 150),
			TextXAlignment = Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
			Text = icon .. person.name .. crown,
		}, frame)
	end
	local watching = {}
	for _, person in msg.people do
		if person.playing then
			row(person)
		else
			table.insert(watching, person)
		end
	end
	if msg.bots > 0 then
		line(Lang.t("lobbyBots", msg.bots, Lang.t("levels")[msg.level] or msg.level), GOLD)
	end
	if #watching > 0 then
		line(Lang.t("watchersLine", #watching), Color3.fromRGB(150, 190, 240))
		for _, person in watching do
			row(person)
		end
	end
end
text({ Position = UDim2.fromOffset(30, 18), Size = UDim2.new(1, -60, 0, 56), Text = "🐹 Hush Rush", TextColor3 = GOLD }, helpPanel, 4)
do
	local lines = Lang.t(if touchOnly then "helpTouch" else "help")
	for i, line in lines do
		local row = make("Frame", { BackgroundColor3 = Color3.fromRGB(88, 62, 46), BorderSizePixel = 0, Position = UDim2.fromOffset(28, 30 + i * 54), Size = UDim2.fromOffset(496, 46) }, helpPanel)
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
function banner(message, color)
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
local nestsPainted = false -- each nest's rim takes the colour of whoever starts there
local alarmFor = "" -- the carrier the siren last went off for

-- A seat's colour: its team's in a team round, its own otherwise.
local function seatColor(seat)
	local info = roster[seat]
	return Config.colorOf(seat, info and info.team)
end

-- The portals spin, and each nest's rim takes the colour of whoever starts in it.
local swirls = {}
for _, child in mapFolder:GetChildren() do
	if child.Name == "Swirl" then
		table.insert(swirls, { model = child, at = child:GetPivot() })
	end
end
local nestRims = {}
for _, child in mapFolder:WaitForChild("Nests"):GetChildren() do
	if child.Name == "NestRim" then
		table.insert(nestRims, { part = child, color = child.Color })
	end
end

local function paintNests()
	for _, rim in nestRims do
		rim.part.Color = rim.color
	end
	if not latest then
		return
	end
	for _, p in latest.players do
		local best, bestD = nil, math.huge
		for _, rim in nestRims do
			local d = (Vector2.new(rim.part.Position.X, rim.part.Position.Z) - Vector2.new(p.x, p.y)).Magnitude
			if d < bestD then
				best, bestD = rim, d
			end
		end
		if best and bestD < 1.5 then
			best.part.Color = seatColor(p.id)
		end
	end
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
			make("UIStroke", { Thickness = if seat == mySeat then 3 else 2, Color = if seat == mySeat then GOLD else seatColor(seat) }, chip)
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

-- A bot's name in this player's language; a person's as Roblox has it.
local function localName(info)
	return if info.bot then Lang.t("names")[info.id] or info.name else info.name
end

local function setRoster(list)
	table.clear(roster)
	mySeat = nil
	for _, info in list do
		info.name = localName(info)
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

local MULTI = Lang.t("multi")
local predictedSwing = 0 -- os.clock() of the last swing drawn before the server said so

-- On my side: the same team in a team round.
local function mate(seat)
	local a = roster[mySeat]
	local b = roster[seat]
	return a ~= nil and b ~= nil and a.team ~= nil and a.team == b.team
end

-- Somebody has a seed now: what the web game says about it.
local function gotSeed(seat)
	if seat == mySeat then
		banner(Lang.t("gotSeedMe"))
	elseif mate(seat) then
		banner(Lang.t("gotSeedMate", nameOf(seat)))
	else
		banner(Lang.t("gotSeedFoe", nameOf(seat)), RED)
	end
end

local function showEvent(e)
	local h = e.id and hamsters[e.id]
	if e.type == "swing" then
		if h then
			h:swing()
		end
		-- My own swing is heard as the key goes down; the others' are not, as on the web.
		if e.id == mySeat and os.clock() - predictedSwing > 0.4 then
			Fx.sound("swing")
		end
	elseif e.type == "impact" then
		if not e.hit then
			Fx.dust(e.x + e.dx * 2.8, e.y + e.dy * 2.8, 6, 9)
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
		Fx.words(e.x, e.y, Lang.t("bonkWord"), RED, 9)
		Fx.tumble(e.x, e.y, dx, dy, seatColor(e.id))
		Fx.sound("bonk")
		Fx.shake(if mine then 0.75 else 0.4)
		Fx.hitStop(if mine then 0.1 else 0.05)
		punch = if mine then 1 else 0.5
		if e.id == mySeat then
			flash(RED, 0.4)
			if e.seed then
				banner(Lang.t("lostSeed"), RED)
			end
		elseif e.by == mySeat then
			flash(WHITE, 0.22)
		end
		addFeed(Lang.t("feedBonk", nameOf(e.by), e.seed == true, nameOf(e.id)))
		if e.close then
			banner(Lang.t("superplay", nameOf(e.by)))
			Fx.sound("superplay")
		end
	elseif e.type == "throw" then
		Fx.words(e.x, e.y, Lang.t("throwWord"), GOLD, 8)
		Fx.seedShot(e.x, e.y, e.dx, e.dy, Config.THROW.range)
		Fx.sound("toss")
		Fx.shake(0.2)
		if h then
			h:squash(4)
		end
	elseif e.type == "multi" then
		local name = MULTI[math.min(e.n, #MULTI + 1) - 1]
		banner(Lang.t("multiBanner", nameOf(e.by), name, e.n >= 3))
		Fx.sound(if e.n >= 3 then "triple" else "double")
	elseif e.type == "seed" then
		if h and h.x then
			Fx.stars(h.x, h.y, GOLD, 12)
			Fx.words(h.x, h.y, Lang.t("seedWord"), GOLD, 9)
			h:squash(-5)
		end
		Fx.sound("seed")
		flowerKick = 1
		gotSeed(e.id)
	elseif e.type == "steal" then
		local by = hamsters[e.by]
		Fx.stars(e.x, e.y, CREAM, 10)
		Fx.words(e.x, e.y, Lang.t("stealWord"), CREAM, 8)
		Fx.sound("seed")
		if by then
			by:squash(-4)
		end
		addFeed(Lang.t("feedSteal", nameOf(e.by), nameOf(e.id)))
		if e.id == mySeat then
			banner(Lang.t("gotStolen"), RED)
		else
			gotSeed(e.by)
		end
		if e.close then
			banner(Lang.t("superplay", nameOf(e.by)))
			Fx.sound("superplay")
		end
	elseif e.type == "spawn" then
		Fx.dust(e.x, e.y, 6, 8)
		if e.id == mySeat then
			snapCamera = true
			Fx.sound("spawn")
		end
	elseif e.type == "warp" then
		Fx.dust(e.fromX, e.fromY, 7, 9)
		Fx.ring(e.fromX, e.fromY, 5, Color3.fromRGB(190, 150, 255), 0.3)
		Fx.dust(e.x, e.y, 6, 8)
		Fx.words(e.fromX, e.fromY, Lang.t("warpWord"), CREAM, 7)
		if e.id == mySeat then
			snapCamera = true
			Fx.sound("spawn")
		end
	elseif e.type == "count" then
		Fx.sound("count")
	elseif e.type == "go" then
		Fx.sound("go")
	elseif e.type == "overtime" then
		banner(Lang.t("overtime"), RED)
		Fx.sound("overtime")
	elseif e.type == "rush" then
		banner(Lang.t("rush"), RED)
		Fx.sound("overtime")
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
	local winner = roster[msg.winners[1]]
	local wholeTeam = winner and winner.team ~= nil
	for _, seat in msg.winners do
		wholeTeam = wholeTeam and roster[seat] and roster[seat].team == winner.team
	end
	if wholeTeam then
		resultTitle.Text = Lang.t("teamWin", Lang.t("teams")[winner.team])
		resultTitle.TextColor3 = Config.TEAMS[winner.team].color
	else
		resultTitle.Text = if #names > 0 then Lang.t("win", table.concat(names, " · "), #names) else Lang.t("noWinner")
		resultTitle.TextColor3 = GOLD
	end
	resultWhy.Text = Lang.t(if msg.left then "whyLeft" elseif msg.timeout then "whyTimeout" else "whyHome")
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
		text({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -100, 0, 6), Size = UDim2.new(0, 84, 1, -12), Text = Lang.t("wins", info.wins), TextColor3 = GOLD }, row, false)
		text({ AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -10, 0, 6), Size = UDim2.new(0, 80, 1, -12), Text = ("👊 %d"):format(info.kills), TextColor3 = CREAM }, row, false)
	end
	resultPanel.Visible = true
	pop(resultScale, 0.6)
	bigLabel.Visible = false
	alarmRim.Visible = false
	Fx.music(nil)
	-- As on the web: the winner's tune for whoever won, and for whoever only watched.
	if iWon or not mySeat then
		Fx.sound("win")
	else
		Fx.sound("lose")
	end
	if iWon then
		Fx.confetti(screen)
	end
	-- The lobby tune comes back once the sting has had its say.
	task.delay(4, function()
		if resultPanel.Visible then
			Fx.music("lobby")
		end
	end)
end

-- A new round to draw: the server's, or the tutorial's own.
local function beginRound(list, number)
	round = number
	latest = nil
	clearHamsters()
	setRoster(list)
	for _, info in list do
		hamsters[info.id] = Hamster.new(viewFolder, info, info.id == mySeat)
	end
	resultPanel.Visible = false
	helpPanel.Visible = false
	readyButton.Visible = false
	botBar.Visible = false
	snapCamera = true
	nestsPainted = false
	alarmFor = ""
end

-- Tutorial ------------------------------------------------------------------
-- While it runs, the server's round is not drawn: the tutorial's own is.

local tutorPanel = panel({ AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 108), Size = UDim2.fromOffset(700, 132), Visible = false }, hud, 22)
local tutorScale = make("UIScale", {}, tutorPanel)
local tutorTitle = text({ Position = UDim2.fromOffset(22, 12), Size = UDim2.new(1, -200, 0, 36), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = GOLD }, tutorPanel, 3)
local tutorText = text({ Position = UDim2.fromOffset(22, 54), Size = UDim2.new(1, -44, 0, 66), TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, TextColor3 = CREAM, TextScaled = true }, tutorPanel, false)
local tutorButton = make("TextButton", { AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -14, 0, 12), Size = UDim2.fromOffset(164, 38), BackgroundColor3 = Color3.fromRGB(110, 78, 48), BorderSizePixel = 0, AutoButtonColor = false, Font = FONT, TextSize = 20, TextColor3 = CREAM, Text = "" }, tutorPanel)
make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, tutorButton)
make("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Thickness = 2, Color = INK }, tutorButton)

-- A bouncing arrow over where to go next.
local marker = make("Part", { Name = "TutorialMarker", Anchored = true, CanCollide = false, CanQuery = false, CanTouch = false, Transparency = 1, Size = Vector3.one }, viewFolder)
local markerGui = make("BillboardGui", { Size = UDim2.fromScale(7, 7), AlwaysOnTop = true, LightInfluence = 0, Enabled = false }, marker)
text({ Size = UDim2.fromScale(1, 0.62), Text = "⬇", TextColor3 = GOLD }, markerGui, 4)
local markerLabel = text({ Position = UDim2.fromScale(-0.5, 0.6), Size = UDim2.fromScale(2, 0.3), TextColor3 = GOLD }, markerGui, 3)

local tutorial = nil -- the one running, if any
local tutorTarget = nil -- { at, icon, label }
local onLastStep = false

local function endTutorial()
	if tutorial then
		tutorial.stop()
	end
	tutorial = nil
	tutorTarget = nil
	tutorPanel.Visible = false
	markerGui.Enabled = false
	round = -1
	latest = nil
	clearHamsters()
	setRoster({})
	paintNests()
	-- The lobby, or the round going on, as the server has it now.
	readyButton.Visible = false
	roundRemote:FireServer()
end

local function startTutorial()
	if tutorial then
		return
	end
	if myReady then
		setReady(false)
	end
	helpPanel.Visible = false
	readyButton.Visible = false
	botBar.Visible = false
	resultPanel.Visible = false
	notice("")
	Fx.music("game")
	tutorial = Tutorial.run({
		begin = function(list)
			beginRound(list, -2)
		end,
		snapshot = function(snap)
			latest = snap
		end,
		event = showEvent,
		say = function(index, step, again)
			onLastStep = step.last == true
			tutorPanel.Visible = true
			tutorTitle.Text = ("🎓 %d/%d · %s"):format(index, Tutorial.STEPS, step.title)
			tutorText.Text = again or step.text
			tutorButton.Text = Lang.t(if onLastStep then "tutorStart" else "tutorSkip")
			tutorButton.BackgroundColor3 = if onLastStep then Color3.fromRGB(96, 196, 96) else Color3.fromRGB(110, 78, 48)
			pop(tutorScale, 0.85)
			if onLastStep then
				tutorTarget = nil
			end
		end,
		target = function(at, icon, label)
			tutorTarget = if at then { at = at, icon = icon, label = label } else nil
		end,
		cheer = function()
			banner(Lang.t("cheer"))
			Fx.sound("double")
			tutorTarget = nil
		end,
		finish = endTutorial,
	})
end

tutorButton.Activated:Connect(function()
	endTutorial()
end)

-- Whoever has never played a round is taken through it once, on arrival.
local offered = false
local function offerTutorial()
	if offered or tutorial or player:GetAttribute("HRGames") ~= 0 or round ~= -1 or resultPanel.Visible then
		return
	end
	offered = true
	startTutorial()
end
player:GetAttributeChangedSignal("HRGames"):Connect(offerTutorial)

local tutorialButton = make("TextButton", { Position = UDim2.fromOffset(540, 88), Size = UDim2.fromOffset(252, 50), BackgroundColor3 = Color3.fromRGB(240, 176, 44), BorderSizePixel = 0, AutoButtonColor = false, Font = FONT, TextSize = 24, TextColor3 = WHITE, Text = Lang.t("tutorial") }, helpPanel)
make("UICorner", { CornerRadius = UDim.new(0, 16) }, tutorialButton)
make("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Thickness = 3, Color = INK }, tutorialButton)
make("UIStroke", { Thickness = 2.5, Color = INK }, tutorialButton)
tutorialButton.Activated:Connect(startTutorial)

roundRemote.OnClientEvent:Connect(function(msg)
	if tutorial then
		return
	end
	if msg.kind == "lobby" then
		-- After a round the result stays up, with the hamsters where they stood.
		if not resultPanel.Visible then
			round = -1
			latest = nil
			clearHamsters()
			setRoster({})
			paintNests()
			helpPanel.Visible = true
			Fx.music("lobby")
		end
		bigLabel.Visible = false
		alarmRim.Visible = false
		timerLabel.Text = Lang.t("waiting")
		timerLabel.TextColor3 = WHITE
		timerScale.Scale = 1
		if not readyButton.Visible then
			myReady = false
			showReady()
			readyButton.Visible = true
		end
		botBar.Visible = true
		-- Where I stand in it: playing or watching, host or not.
		local wasHost = amHost
		local seenBefore = lastLobby ~= nil
		amHost = msg.host == player.UserId
		lobbyFull = msg.count >= msg.max
		for _, person in msg.people do
			if person.userId == player.UserId then
				myPlaying = person.playing
			end
		end
		if not myPlaying then
			myReady = false
		end
		showReady()
		showBotBar()
		if amHost and not wasHost and seenBefore then
			banner(Lang.t("becameHost"))
		end
		botLabel.Text = Lang.t("botCount", msg.bots)
		levelButton.Text = Lang.t("level", Lang.t("levels")[msg.level] or msg.level)
		modeButton.Text = Lang.t(if msg.teams then "teamMode" else "solo")
		showPeople(msg)
		offerTutorial()
		if not myPlaying then
			notice(Lang.t("watchingLobby"))
		elseif msg.left then
			notice(Lang.t("startsIn", msg.left, msg.ready, msg.count))
		elseif msg.short > 0 then
			notice(Lang.t("needRival", msg.short))
		else
			notice(Lang.t("allReady", msg.ready, msg.count))
		end
	elseif msg.kind == "start" then
		beginRound(msg.roster, msg.round)
		Fx.music("game")
		Fx.sound("count")
		notice(if mySeat then "" else Lang.t("watching"))
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
	if tutorial then
		return
	end
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
local tickBeat = -1
local stepDust = {}

-- Pointers at the edge of the screen for what matters but is out of sight: a
-- rival or a team-mate running with a seed, and where to go next.
local pointerLayer = make("Frame", { Name = "Pointers", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), ZIndex = 5 }, screen)
local pointers = {} -- [key] = its frames, and whether it is wanted this frame

local function pointer(key)
	local ptr = pointers[key]
	if not ptr then
		local frame = make("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), BackgroundColor3 = PANEL, BorderSizePixel = 0, ZIndex = 5 }, pointerLayer)
		make("UICorner", { CornerRadius = UDim.new(0.5, 0) }, frame)
		local rim = make("UIStroke", { ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Thickness = 4, Color = INK }, frame)
		local icon = text({ AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromScale(0.66, 0.66), ZIndex = 6 }, frame, false)
		local caption = text({ AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 1, 3), Size = UDim2.fromScale(2.4, 0.42), ZIndex = 6 }, frame, 2)
		local arrow = text({ AnchorPoint = Vector2.new(0.5, 0.5), Text = "▲", ZIndex = 6 }, pointerLayer, 2)
		ptr = { frame = frame, rim = rim, icon = icon, caption = caption, arrow = arrow }
		pointers[key] = ptr
	end
	ptr.wanted = true
	return ptr
end

-- Shows a pointer for `world` only while it is off the screen.
local function pointTo(key, world, icon, caption, color, urgent)
	local camera = workspace.CurrentCamera
	local view = camera.ViewportSize
	local scale = hudScale.Scale
	local margin = 62 * scale
	local at, onScreen = camera:WorldToViewportPoint(world)
	if onScreen and at.X > margin * 0.6 and at.X < view.X - margin * 0.6 and at.Y > margin * 0.6 and at.Y < view.Y - margin * 0.6 then
		return
	end
	local middle = view / 2
	local away = Vector2.new(at.X, at.Y) - middle
	if at.Z < 0 then
		away = -away
	end
	if away.Magnitude < 1 then
		return
	end
	-- Where the line from the middle of the screen to it leaves the screen.
	local reach = math.min((view.X / 2 - margin) / math.max(1e-3, math.abs(away.X)), (view.Y / 2 - margin) / math.max(1e-3, math.abs(away.Y)))
	local spot = middle + away * reach
	local unit = away.Unit
	local ptr = pointer(key)
	ptr.frame.Size = UDim2.fromOffset(54 * scale, 54 * scale)
	ptr.frame.Position = UDim2.fromOffset(spot.X, spot.Y)
	ptr.frame.Visible = true
	ptr.frame.BackgroundColor3 = if urgent and math.sin(time * 12) > 0 then RED else PANEL
	ptr.rim.Color = color
	ptr.icon.Text = icon
	ptr.caption.Text = caption
	ptr.caption.TextColor3 = color
	ptr.arrow.Visible = true
	ptr.arrow.Size = UDim2.fromOffset(26 * scale, 26 * scale)
	ptr.arrow.Position = UDim2.fromOffset(spot.X + unit.X * 42 * scale, spot.Y + unit.Y * 42 * scale)
	ptr.arrow.Rotation = math.deg(math.atan2(unit.Y, unit.X)) + 90
	ptr.arrow.TextColor3 = color
end

local function showPointers()
	for _, ptr in pointers do
		ptr.wanted = false
	end
	if latest and not resultPanel.Visible and latest.phase ~= "over" then
		local mine = nil
		for _, p in latest.players do
			local h = hamsters[p.id]
			if p.id == mySeat then
				mine = p
			elseif p.carrying and h and h.x then
				local side = Lang.t(if mate(p.id) then "cover" else "block")
				pointTo("carrier" .. p.id, Vector3.new(h.x, 1, h.y), if p.alarm then "🚨" else "🌻", nameOf(p.id) .. " · " .. side, seatColor(p.id), p.alarm)
			end
		end
		-- Where to go: the tutorial says; otherwise the flower for a seed, then home with it.
		local h = mySeat and hamsters[mySeat]
		if tutorial then
			if tutorTarget then
				pointTo("tutorial", tutorTarget.at, tutorTarget.icon, tutorTarget.label, GOLD, false)
			end
		elseif mine and h and h.x and not mine.dazed then
			if mine.carrying then
				pointTo("home", Vector3.new(latest.homeX - 2, 0, math.clamp(h.y, Map.bounds.y1 + 4, Map.bounds.y2 - 4)), "🏠", Lang.t("toHome"), GOLD, false)
			else
				pointTo("flower", Vector3.new(FLOWER.x, 1, FLOWER.y), "🌻", Lang.t("flower"), GOLD, false)
			end
		end
	end
	for _, ptr in pointers do
		if not ptr.wanted then
			ptr.frame.Visible = false
			ptr.arrow.Visible = false
		end
	end
end

RunService:BindToRenderStep("HashRushView", Enum.RenderPriority.Camera.Value + 1, function(dt)
	time += dt
	fitHud()
	-- Close in over my own hamster while I am in a round; the whole meadow otherwise.
	local mine = mySeat and hamsters[mySeat]
	local target = if mine and mine.x and latest and latest.phase ~= "over" and not resultPanel.Visible then Vector2.new(mine.x, mine.y) else nil
	placeCamera(dt, target)
	showPointers()
	markerGui.Enabled = tutorTarget ~= nil
	if tutorTarget then
		marker.Position = tutorTarget.at + Vector3.new(0, 5 + math.abs(math.sin(time * 4)) * 1.5, 0)
		markerLabel.Text = tutorTarget.label
	end
	for k, swirl in swirls do
		swirl.model:PivotTo(swirl.at * CFrame.Angles(0, -time * 2.4 * (if k % 2 == 0 then -1 else 1), 0))
	end
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
	-- The nests are coloured from where everyone starts, once a round.
	if not nestsPainted and latest.phase == "countdown" then
		nestsPainted = true
		paintNests()
	end

	local seen = {}
	local carrying = false
	local alarm = false
	for _, p in latest.players do
		local h = hamsters[p.id]
		if h then
			seen[p.id] = true
			local x, y = p.x, p.y
			-- The tutorial's round is played here already: nothing to get ahead of.
			if h.me and not tutorial then
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
				status = Lang.t("dazed")
			elseif nibbling then
				status = Lang.t("digging")
			elseif p.pick > 0 then
				-- Rubbing up against a carrier to take its seed.
				status = Lang.t("snatching")
				bar = p.pick
			end
			-- Hints only its own player sees.
			if h.me and p.carrying and latest.phase == "playing" then
				for _, warp in Map.warps do
					if (Vector2.new(p.x, p.y) - Vector2.new(warp.x, warp.y)).Magnitude <= warp.r + 0.5 then
						status = Lang.t("noWarpCarrying")
					end
				end
			end
			if h.me and not p.carrying and not p.dazed then
				local inRing = (Vector2.new(p.x, p.y) - Vector2.new(FLOWER.x, FLOWER.y)).Magnitude <= FLOWER.gatherR
				if inRing and (nibbling or latest.nibbler == 0) and player:GetAttribute("HRMoving") then
					status = Lang.t("holdStill")
				elseif inRing and not nibbling and latest.nibbler ~= 0 then
					status = Lang.t("queue")
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

	-- A seed is nearly home: everyone gets the red rim, and once per seed the
	-- siren and a word on who it is, as on the web.
	alarm = alarm and latest.phase == "playing"
	alarmRim.Visible = alarm
	if alarm then
		alarmStroke.Transparency = 0.35 + (math.sin(time * 12) + 1) * 0.3
	end
	local carrier = nil
	for _, p in latest.players do
		if p.alarm and latest.phase == "playing" then
			carrier = p
		end
	end
	local key = if carrier then tostring(carrier.id) else ""
	if key ~= "" and key ~= alarmFor then
		if carrier.id == mySeat then
			banner(Lang.t("alarmMe"), RED)
		elseif mate(carrier.id) then
			banner(Lang.t("alarmMate", nameOf(carrier.id)), RED)
		else
			banner(Lang.t("alarmFoe", nameOf(carrier.id)), RED)
		end
		Fx.sound("siren")
	end
	-- Stepping back out and in again does not repeat it; a new seed does.
	local anyCarrier = false
	for _, p in latest.players do
		anyCarrier = anyCarrier or p.carrying
	end
	if key ~= "" or not anyCarrier then
		alarmFor = key
	end

	-- The clock is heard ticking all through overtime, twice a second.
	local beat = if overtime and latest.phase == "playing" then math.floor(latest.time * 2) else -1
	if beat ~= tickBeat then
		tickBeat = beat
		if beat >= 0 then
			Fx.sound(if beat % 2 == 1 then "tock" else "tick")
		end
	end

	-- The count before the start, then "go" for a moment.
	local counting = latest.phase == "countdown"
	local big = if counting then tostring(math.max(1, math.ceil(latest.countdown))) elseif latest.phase == "playing" and latest.time < 0.8 then Lang.t("go") else nil
	bigLabel.Visible = big ~= nil and not resultPanel.Visible and not tutorial
	if big ~= shownCount then
		shownCount = big
		if big then
			bigLabel.Text = big
			bigLabel.TextColor3 = if counting then WHITE else GOLD
			pop(bigScale, 0.2)
		end
	end
	if tutorial then
		timerLabel.Text = Lang.t("practice")
		timerLabel.TextColor3 = WHITE
		timerScale.Scale = 1
	elseif counting then
		timerLabel.Text = Lang.t("getReady")
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

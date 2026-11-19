-- Reads what the player is pressing and tells the server: a move direction, the
-- bonk button and the throw button. Nothing here decides anything about the game.
--   PC: WASD / arrows, Space / J, F / K      pad: left stick / D-pad, A, B
--   touch: a joystick under the left thumb and two buttons under the right

local ContextActionService = game:GetService("ContextActionService")
local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local remote = ReplicatedStorage:WaitForChild("HashRushRemotes"):WaitForChild("Input")

-- Roblox's own movement and jump controls are not used.
GuiService.TouchControlsEnabled = false
task.spawn(function()
	local module = player:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule", 10)
	if module then
		pcall(function()
			require(module):GetControls():Disable()
		end)
	end
end)

-- Keys and gamepad --------------------------------------------------------

local KEY_DIRS = {
	[Enum.KeyCode.W] = Vector2.new(0, -1),
	[Enum.KeyCode.Up] = Vector2.new(0, -1),
	[Enum.KeyCode.DPadUp] = Vector2.new(0, -1),
	[Enum.KeyCode.S] = Vector2.new(0, 1),
	[Enum.KeyCode.Down] = Vector2.new(0, 1),
	[Enum.KeyCode.DPadDown] = Vector2.new(0, 1),
	[Enum.KeyCode.A] = Vector2.new(-1, 0),
	[Enum.KeyCode.Left] = Vector2.new(-1, 0),
	[Enum.KeyCode.DPadLeft] = Vector2.new(-1, 0),
	[Enum.KeyCode.D] = Vector2.new(1, 0),
	[Enum.KeyCode.Right] = Vector2.new(1, 0),
	[Enum.KeyCode.DPadRight] = Vector2.new(1, 0),
}

local keysDown = {}
local padStick = Vector2.zero
local bonkKey = false
local throwKey = false

local moveKeys = { Enum.KeyCode.Thumbstick1 }
for key in KEY_DIRS do
	table.insert(moveKeys, key)
end

ContextActionService:BindAction("HashRushMove", function(_, inputState, input)
	if input.KeyCode == Enum.KeyCode.Thumbstick1 then
		local tilted = inputState == Enum.UserInputState.Change or inputState == Enum.UserInputState.Begin
		-- The stick's up is +Y; on screen up is -y.
		padStick = if tilted then Vector2.new(input.Position.X, -input.Position.Y) else Vector2.zero
	else
		keysDown[input.KeyCode] = if inputState == Enum.UserInputState.Begin then true else nil
	end
	return Enum.ContextActionResult.Sink
end, false, table.unpack(moveKeys))

ContextActionService:BindAction("HashRushBonk", function(_, inputState)
	bonkKey = inputState == Enum.UserInputState.Begin
	return Enum.ContextActionResult.Sink
end, false, Enum.KeyCode.Space, Enum.KeyCode.J, Enum.KeyCode.ButtonA)

ContextActionService:BindAction("HashRushThrow", function(_, inputState)
	throwKey = inputState == Enum.UserInputState.Begin
	return Enum.ContextActionResult.Sink
end, false, Enum.KeyCode.F, Enum.KeyCode.K, Enum.KeyCode.ButtonB)

UserInputService.WindowFocusReleased:Connect(function()
	table.clear(keysDown)
	padStick = Vector2.zero
	bonkKey = false
	throwKey = false
end)

-- Touch -------------------------------------------------------------------

local STICK_RADIUS = 60
local touchMove = Vector2.zero
local stickTouch = nil
local stickOrigin = Vector2.zero
local held = {} -- [button name] = the InputObject pressing it

-- IgnoreGuiInset stays off so that InputObject.Position lines up with the gui.
local gui = Instance.new("ScreenGui")
gui.Name = "HashRushTouch"
gui.ResetOnSpawn = false
gui.DisplayOrder = 5
gui.Enabled = UserInputService.TouchEnabled
gui.Parent = player:WaitForChild("PlayerGui")

local function round(parent)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.5, 0)
	corner.Parent = parent
end

local pad = Instance.new("Frame")
pad.Name = "StickArea"
pad.BackgroundTransparency = 1
pad.Position = UDim2.fromScale(0, 0.2)
pad.Size = UDim2.fromScale(0.5, 0.8)
pad.Active = true
pad.Parent = gui

local base = Instance.new("Frame")
base.AnchorPoint = Vector2.new(0.5, 0.5)
base.Size = UDim2.fromOffset(STICK_RADIUS * 2, STICK_RADIUS * 2)
base.BackgroundColor3 = Color3.new(1, 1, 1)
base.BackgroundTransparency = 0.75
base.Visible = false
base.Parent = gui
round(base)

local knob = Instance.new("Frame")
knob.AnchorPoint = Vector2.new(0.5, 0.5)
knob.Size = UDim2.fromOffset(STICK_RADIUS, STICK_RADIUS)
knob.Position = UDim2.fromScale(0.5, 0.5)
knob.BackgroundColor3 = Color3.new(1, 1, 1)
knob.BackgroundTransparency = 0.35
knob.Parent = base
round(knob)

local function moveStick(position)
	local delta = (Vector2.new(position.X, position.Y) - stickOrigin) / STICK_RADIUS
	if delta.Magnitude > 1 then
		delta = delta.Unit
	end
	knob.Position = UDim2.fromScale(0.5 + delta.X / 2, 0.5 + delta.Y / 2)
	if delta.Magnitude < 0.25 then
		touchMove = Vector2.zero
		return
	end
	-- Snapped to 16 directions, so a thumb that drifts a little still runs straight.
	local step = math.pi / 8
	local angle = math.round(math.atan2(delta.Y, delta.X) / step) * step
	touchMove = Vector2.new(math.cos(angle), math.sin(angle))
end

pad.InputBegan:Connect(function(input)
	if input.UserInputType ~= Enum.UserInputType.Touch or stickTouch then
		return
	end
	stickTouch = input
	stickOrigin = Vector2.new(input.Position.X, input.Position.Y)
	base.Position = UDim2.fromOffset(stickOrigin.X, stickOrigin.Y)
	base.Visible = true
	moveStick(input.Position)
end)

local function button(name, text, size, offsetY, color)
	local b = Instance.new("TextButton")
	b.Name = name
	b.AnchorPoint = Vector2.new(1, 1)
	b.Position = UDim2.new(1, -28, 1, offsetY)
	b.Size = UDim2.fromOffset(size, size)
	b.BackgroundColor3 = color
	b.BackgroundTransparency = 0.2
	b.AutoButtonColor = false
	b.Text = text
	b.TextSize = 22
	b.Font = Enum.Font.GothamBold
	b.TextColor3 = Color3.new(1, 1, 1)
	b.Parent = gui
	round(b)
	b.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.Touch or input.UserInputType == Enum.UserInputType.MouseButton1 then
			held[name] = input
			b.BackgroundTransparency = 0
		end
	end)
	return b
end

local bonkButton = button("Bonk", "꿀밤", 112, -28, Color3.fromRGB(230, 90, 70))
-- Only there while there is a seed to throw. View keeps the attribute up to date.
local throwButton = button("Throw", "던지기", 92, -160, Color3.fromRGB(235, 170, 40))
throwButton.Visible = false
player:GetAttributeChangedSignal("HRCarrying"):Connect(function()
	throwButton.Visible = player:GetAttribute("HRCarrying") == true
	if not throwButton.Visible then
		held.Throw = nil
		throwButton.BackgroundTransparency = 0.2
	end
end)

UserInputService.InputChanged:Connect(function(input)
	if input == stickTouch then
		moveStick(input.Position)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input == stickTouch then
		stickTouch = nil
		touchMove = Vector2.zero
		base.Visible = false
	end
	for name, pressing in held do
		if pressing == input or (input.UserInputType == Enum.UserInputType.MouseButton1 and pressing.UserInputType == Enum.UserInputType.MouseButton1) then
			held[name] = nil
			gui[name].BackgroundTransparency = 0.2
		end
	end
end)

-- The touch controls show for whoever last touched the screen.
UserInputService.LastInputTypeChanged:Connect(function(last)
	if last == Enum.UserInputType.Touch then
		gui.Enabled = true
	elseif last == Enum.UserInputType.Keyboard or last.Name:find("Gamepad") then
		gui.Enabled = false
	end
end)

-- Sending -----------------------------------------------------------------

local function moveVector()
	local keys = Vector2.zero
	for key in keysDown do
		keys += KEY_DIRS[key]
	end
	if keys.Magnitude > 0 then
		return keys.Unit
	end
	if padStick.Magnitude > 0.2 then
		return if padStick.Magnitude > 1 then padStick.Unit else padStick
	end
	return touchMove
end

local sent = { mx = 0, my = 0, bonk = false, throw = false }
local sentAt = 0

RunService.Heartbeat:Connect(function()
	local move = moveVector()
	local mx = math.round(move.X * 100) / 100
	local my = math.round(move.Y * 100) / 100
	local bonk = bonkKey or held.Bonk ~= nil
	local throw = throwKey or held.Throw ~= nil
	local buttons = bonk ~= sent.bonk or throw ~= sent.throw
	local moved = mx ~= sent.mx or my ~= sent.my
	-- Buttons go out at once; a stick being rolled around goes out 30 times a second.
	if not buttons and not (moved and os.clock() - sentAt >= 1 / 30) then
		return
	end
	sent.mx, sent.my, sent.bonk, sent.throw = mx, my, bonk, throw
	sentAt = os.clock()
	remote:FireServer(mx, my, bonk, throw)
	-- View uses this for the "hold still" hint at the flower.
	player:SetAttribute("HRMoving", mx ~= 0 or my ~= 0)
end)

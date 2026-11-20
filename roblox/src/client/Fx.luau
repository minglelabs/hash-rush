-- Everything that makes a hit feel like a hit: sounds, bursts of stars and dust,
-- words that pop out of the ground, a camera that shakes and a moment where the
-- world holds still. None of it changes the game.

local Debris = game:GetService("Debris")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local FONT = Enum.Font.FredokaOne
local INK = Color3.fromRGB(58, 40, 30)
local UPRIGHT = CFrame.Angles(0, 0, math.rad(90))

local Fx = {}

local folder = Instance.new("Folder")
folder.Name = "HashRushFx"
folder.Parent = workspace

-- Sounds --------------------------------------------------------------------
-- Everything here is published by Roblox itself or by APM Music, Roblox's
-- licensed library, both free for any experience: nothing to upload, nothing
-- that can be taken down under us. A few come with the client (rbxasset).

local function asset(id)
	return "rbxassetid://" .. id
end

-- { sound, playback speed, volume }
local SOUNDS = {
	swing = { asset(15675012262), 1.15, 0.5 }, -- Roblox_UI_Whoosh_04
	hit = { asset(12222054), 1, 0.9 }, -- Kerplunk
	boing = { asset(12222124), 1.25, 0.55 }, -- Short spring sound
	thump = { "rbxasset://sounds/impact_explosion_03.mp3", 2.4, 0.22 },
	ouch = { asset(15675081158), 1, 0.8 }, -- Roblox_UI_Cute_Goodbye: I was the one bonked
	whiff = { asset(15675024286), 1.5, 0.25 }, -- Roblox_UI_Whoosh_01
	seed = { asset(17208319162), 1, 0.7 }, -- Roblox GUI - Pickup
	steal = { asset(15675037413), 1.1, 0.7 }, -- Roblox_UI_Paper_Swipe
	throw = { asset(15675028888), 1.1, 0.6 }, -- Roblox_UI_Whoosh_02
	warp = { asset(15675046931), 1, 0.5 }, -- Roblox_UI_Sweep
	tick = { asset(15675059323), 0.9, 0.7 }, -- Roblox_UI_Bright_Click
	go = { asset(15675043410), 1, 0.7 }, -- Roblox_UI_Tonal_Stinger
	click = { asset(15675032796), 1, 0.6 }, -- Roblox_UI_Small_Click
	pop = { asset(15675055424), 1.1, 0.5 }, -- Roblox_UI_Cute_Pop
	alarm = { "rbxasset://sounds/volume_slider.ogg", 2.2, 0.3 },
	win = { asset(1844584698), 1, 0.6 }, -- APM "Winner"
	over = { asset(1842335078), 1, 0.5 }, -- APM "Cartoon Fanfare (c)"
}

local MUSIC = {
	lobby = { asset(1839580471), 0.32 }, -- APM "Happy Forever Ukulele"
	round = { asset(1841647421), 0.26 }, -- APM "Cartoon Capers"
}

local sounds = {}
for name, spec in SOUNDS do
	local sound = Instance.new("Sound")
	sound.Name = name
	sound.SoundId = spec[1]
	sound.PlaybackSpeed = spec[2]
	sound.Volume = spec[3]
	sound.Parent = SoundService
	sounds[name] = sound
end

local muted = false

-- `pitch` multiplies the sound's usual speed; a little spread keeps repeats alive.
function Fx.sound(name, pitch)
	local sound = sounds[name]
	if not sound or muted then
		return
	end
	local copy = sound:Clone()
	copy.PlaybackSpeed = sound.PlaybackSpeed * (pitch or 1) * (0.96 + math.random() * 0.08)
	copy.Parent = SoundService
	copy:Play()
	Debris:AddItem(copy, 6)
end

local tracks = {}
for name, spec in MUSIC do
	local track = Instance.new("Sound")
	track.Name = "Music_" .. name
	track.SoundId = spec[1]
	track.Looped = true
	track.Volume = 0
	track.Parent = SoundService
	tracks[name] = track
end
local playing = nil

-- Fades over to the named tune; nil fades to silence. `speed` hurries it along.
function Fx.music(name, speed)
	for key, track in tracks do
		local on = key == name and not muted
		if on and not track.IsPlaying then
			track.TimePosition = 0
			track:Play()
		end
		if key == name then
			track.PlaybackSpeed = speed or 1
		end
		local tween = TweenService:Create(track, TweenInfo.new(0.8), { Volume = if on then MUSIC[key][2] else 0 })
		tween:Play()
		if not on then
			tween.Completed:Once(function()
				if track.Volume == 0 then
					track:Stop()
				end
			end)
		end
	end
	playing = name
end

function Fx.setMuted(want)
	muted = want
	Fx.music(playing, playing and tracks[playing].PlaybackSpeed)
end

function Fx.muted()
	return muted
end

-- Camera shake and hit-stop -------------------------------------------------

local trauma = 0
local frozenUntil = 0

function Fx.shake(amount)
	trauma = math.min(1.2, trauma + amount)
end

-- Holds the picture still for a moment; the bigger the hit, the longer.
function Fx.hitStop(seconds)
	frozenUntil = math.max(frozenUntil, os.clock() + seconds)
end

function Fx.frozen()
	return os.clock() < frozenUntil
end

-- Called once a frame; returns how far to push the camera.
function Fx.cameraOffset(dt)
	trauma = math.max(0, trauma - dt * 2.6)
	if trauma <= 0 then
		return Vector3.zero
	end
	local power = trauma * trauma * 1.6
	return Vector3.new((math.random() - 0.5) * 2 * power, 0, (math.random() - 0.5) * 2 * power)
end

-- Things in the world -------------------------------------------------------

local function part(props)
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = Enum.Material.SmoothPlastic
	for key, value in props do
		p[key] = value
	end
	p.Parent = folder
	return p
end

local function emitter(x, y, height, props, count)
	local holder = part({ Size = Vector3.one, Transparency = 1, Position = Vector3.new(x, height, y) })
	local e = Instance.new("ParticleEmitter")
	e.Enabled = false
	e.Rate = 0
	e.LightInfluence = 0
	for key, value in props do
		e[key] = value
	end
	e.Parent = holder
	e:Emit(count)
	Debris:AddItem(holder, 1.5)
end

-- Stars flying out of a hit.
function Fx.stars(x, y, color, count)
	emitter(x, y, 2, {
		Texture = "rbxasset://textures/particles/sparkles_main.dds",
		Color = ColorSequence.new(color),
		LightEmission = 0.7,
		Lifetime = NumberRange.new(0.3, 0.6),
		Speed = NumberRange.new(14, 30),
		Drag = 5,
		SpreadAngle = Vector2.new(180, 180),
		Rotation = NumberRange.new(0, 360),
		RotSpeed = NumberRange.new(-300, 300),
		Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 2.2), NumberSequenceKeypoint.new(1, 0) }),
	}, count or 14)
end

-- A puff of dust kicked off the ground.
function Fx.dust(x, y, count, spread)
	emitter(x, y, 0.5, {
		Texture = "rbxasset://textures/particles/smoke_main.dds",
		Color = ColorSequence.new(Color3.fromRGB(246, 232, 200)),
		Lifetime = NumberRange.new(0.3, 0.55),
		Speed = NumberRange.new(2, spread or 7),
		Drag = 4,
		SpreadAngle = Vector2.new(180, 180),
		Rotation = NumberRange.new(0, 360),
		Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.9), NumberSequenceKeypoint.new(1, 2.6) }),
		Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.35), NumberSequenceKeypoint.new(1, 1) }),
	}, count or 5)
end

-- A ring that races outwards along the ground.
function Fx.ring(x, y, radius, color, seconds)
	local p = part({ Shape = Enum.PartType.Cylinder, Color = color, Material = Enum.Material.Neon, Transparency = 0.15 })
	p.Size = Vector3.new(0.12, 1, 1)
	p.CFrame = CFrame.new(x, 0.45, y) * UPRIGHT
	local info = TweenInfo.new(seconds, Enum.EasingStyle.Quart, Enum.EasingDirection.Out)
	TweenService:Create(p, info, { Size = Vector3.new(0.12, radius * 2, radius * 2), Transparency = 1 }):Play()
	Debris:AddItem(p, seconds + 0.1)
end

-- Words that pop out of a spot on the map, hang for a beat and float away.
function Fx.words(x, y, message, color, studs)
	studs = studs or 9
	local anchor = part({ Size = Vector3.one, Transparency = 1, Position = Vector3.new(x, 2, y) })
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromScale(studs * 2.2, studs * 0.42)
	gui.StudsOffset = Vector3.new(0, 7.4, 0)
	gui.AlwaysOnTop = true
	gui.LightInfluence = 0
	gui.Parent = anchor
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Position = UDim2.fromScale(0.5, 0.5)
	label.Font = FONT
	label.TextScaled = true
	label.TextColor3 = color or Color3.new(1, 1, 1)
	label.Rotation = math.random(-9, 9)
	label.Text = message
	label.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Color = INK
	stroke.Parent = label
	local scale = Instance.new("UIScale")
	scale.Scale = 0.2
	scale.Parent = label
	TweenService:Create(scale, TweenInfo.new(0.16, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
	local away = TweenInfo.new(0.45, Enum.EasingStyle.Quad, Enum.EasingDirection.In, 0, false, 0.4)
	TweenService:Create(gui, away, { StudsOffset = Vector3.new(0, 10, 0) }):Play()
	TweenService:Create(label, away, { TextTransparency = 1 }):Play()
	TweenService:Create(stroke, away, { Transparency = 1 }):Play()
	Debris:AddItem(anchor, 0.95)
end

-- Whoever was bonked tumbles away from the blow and is gone.
function Fx.tumble(x, y, dx, dy, color)
	local p = part({ Color = color, Size = Vector3.new(3.2, 2.4, 3) })
	local mesh = Instance.new("SpecialMesh")
	mesh.MeshType = Enum.MeshType.Sphere
	mesh.Parent = p
	p.CFrame = CFrame.new(x, 1.4, y)
	local goal = CFrame.new(x + dx * 15, 7, y + dy * 15) * CFrame.Angles(4, 3, 5)
	local info = TweenInfo.new(0.5, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	TweenService:Create(p, info, { CFrame = goal, Size = Vector3.new(0.4, 0.3, 0.4), Transparency = 0.6 }):Play()
	Debris:AddItem(p, 0.55)
end

-- A thrown seed streaking along its line.
function Fx.seedShot(x, y, dx, dy, reach)
	local seed = part({ Color = Color3.fromRGB(52, 42, 38), Size = Vector3.new(1.7, 0.8, 1) })
	local mesh = Instance.new("SpecialMesh")
	mesh.MeshType = Enum.MeshType.Sphere
	mesh.Parent = seed
	local a0 = Instance.new("Attachment")
	a0.Position = Vector3.new(0, 0, 0.5)
	a0.Parent = seed
	local a1 = Instance.new("Attachment")
	a1.Position = Vector3.new(0, 0, -0.5)
	a1.Parent = seed
	local trail = Instance.new("Trail")
	trail.Attachment0 = a0
	trail.Attachment1 = a1
	trail.Lifetime = 0.18
	trail.LightEmission = 1
	trail.Color = ColorSequence.new(Color3.fromRGB(255, 230, 120))
	trail.Transparency = NumberSequence.new(0.2, 1)
	trail.Parent = seed
	local turn = CFrame.Angles(0, -math.atan2(dy, dx), 0)
	seed.CFrame = CFrame.new(x, 1.6, y) * turn
	local info = TweenInfo.new(0.16, Enum.EasingStyle.Linear)
	TweenService:Create(seed, info, { CFrame = CFrame.new(x + dx * reach, 1.6, y + dy * reach) * turn }):Play()
	Debris:AddItem(seed, 0.4)
	task.delay(0.16, function()
		seed.Transparency = 1
	end)
end

-- Paper raining down the screen for a win.
function Fx.confetti(gui)
	local colors = {
		Color3.fromRGB(255, 214, 70),
		Color3.fromRGB(255, 120, 150),
		Color3.fromRGB(110, 190, 255),
		Color3.fromRGB(150, 220, 120),
		Color3.fromRGB(255, 255, 255),
	}
	for _ = 1, 70 do
		local bit = Instance.new("Frame")
		bit.BorderSizePixel = 0
		bit.BackgroundColor3 = colors[math.random(#colors)]
		bit.Size = UDim2.fromOffset(math.random(8, 14), math.random(12, 20))
		bit.Position = UDim2.new(math.random(), 0, -0.05, 0)
		bit.Rotation = math.random(0, 360)
		bit.ZIndex = 20
		bit.Parent = gui
		local seconds = 1.4 + math.random() * 1.6
		local info = TweenInfo.new(seconds, Enum.EasingStyle.Quad, Enum.EasingDirection.In, 0, false, math.random() * 0.6)
		TweenService:Create(bit, info, {
			Position = UDim2.new(bit.Position.X.Scale + (math.random() - 0.5) * 0.2, 0, 1.1, 0),
			Rotation = bit.Rotation + math.random(-540, 540),
		}):Play()
		Debris:AddItem(bit, seconds + 0.7)
	end
end

return Fx

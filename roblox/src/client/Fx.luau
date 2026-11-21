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
-- The web game's own sound effects and music (src/client/audio.js, music.js),
-- rendered from its synthesiser into audio files and uploaded to Roblox; see
-- Sounds. Until they are uploaded, Roblox's own sounds stand in.

local Sounds = require(script.Parent:WaitForChild("Sounds"))

local function asset(id)
	return "rbxassetid://" .. id
end

-- Stand-ins, as { sound, playback speed, volume }: published by Roblox itself or
-- by APM Music, Roblox's licensed library, so they play in any experience.
local STAND_IN = {
	swing = { asset(15675012262), 1.15, 0.5 },
	bonk = { asset(12222054), 1, 0.9 },
	toss = { asset(15675028888), 1.1, 0.6 },
	double = { asset(15675043410), 1.2, 0.6 },
	triple = { asset(15675043410), 1.4, 0.7 },
	superplay = { asset(15675043410), 1, 0.7 },
	spawn = { asset(15675055424), 1.1, 0.5 },
	seed = { asset(17208319162), 1, 0.7 },
	siren = { "rbxasset://sounds/volume_slider.ogg", 2.2, 0.3 },
	tick = { asset(15675059323), 1.2, 0.4 },
	tock = { asset(15675059323), 0.9, 0.4 },
	count = { asset(15675059323), 0.9, 0.7 },
	go = { asset(15675043410), 1, 0.7 },
	overtime = { "rbxasset://sounds/volume_slider.ogg", 1.5, 0.5 },
	win = { asset(1844584698), 1, 0.6 },
	lose = { asset(1842335078), 0.8, 0.5 },
}
local STAND_IN_MUSIC = {
	lobby = { asset(1839580471), 0.32 },
	game = { asset(1841647421), 0.26 },
}

-- All the web game's effects are in one file, each in its own stretch of it.
local effects = nil
if Sounds.effects then
	effects = Instance.new("Sound")
	effects.Name = "Effects"
	effects.SoundId = asset(Sounds.effects)
	effects.Volume = Sounds.volume
	effects.PlaybackRegionsEnabled = true
	effects.Parent = SoundService
end

local standIns = {}
for name, spec in STAND_IN do
	local sound = Instance.new("Sound")
	sound.Name = name
	sound.SoundId = spec[1]
	sound.PlaybackSpeed = spec[2]
	sound.Volume = spec[3]
	sound.Parent = SoundService
	standIns[name] = sound
end

local muted = false

function Fx.sound(name)
	if muted then
		return
	end
	local region = Sounds.sprite[name]
	if effects and region then
		local copy = effects:Clone()
		copy.PlaybackRegion = NumberRange.new(region[1], region[1] + region[2])
		copy.Parent = SoundService
		copy:Play()
		Debris:AddItem(copy, region[2] + 1)
		return
	end
	local sound = standIns[name]
	if sound then
		local copy = sound:Clone()
		copy.Parent = SoundService
		copy:Play()
		Debris:AddItem(copy, 6)
	end
end

-- The tunes: one file for the round, with all the web game's round tunes in it
-- back to back, and one for the lobby.
local tracks = {}
for name, stand in STAND_IN_MUSIC do
	local music = Sounds.music[name]
	local track = Instance.new("Sound")
	track.Name = "Music_" .. name
	track.SoundId = if music.id then asset(music.id) else stand[1]
	track.Looped = true
	track.Volume = 0
	track.Parent = SoundService
	tracks[name] = { sound = track, volume = if music.id then Sounds.volume else stand[2], starts = if music.id then music.starts else nil }
end
local playing = nil

-- Fades over to the named tune; nil fades to silence. A round tune starts at the
-- top of one of the web game's tunes, picked at random, as the web shuffles them.
function Fx.music(name)
	for key, track in tracks do
		local sound = track.sound
		local on = key == name and not muted
		if on and not sound.IsPlaying then
			local starts = track.starts
			sound.TimePosition = if starts then starts[math.random(#starts)] else 0
			sound:Play()
		end
		local tween = TweenService:Create(sound, TweenInfo.new(0.8), { Volume = if on then track.volume else 0 })
		tween:Play()
		if not on then
			tween.Completed:Once(function()
				if sound.Volume == 0 then
					sound:Stop()
				end
			end)
		end
	end
	playing = name
end

function Fx.setMuted(want)
	muted = want
	Fx.music(playing)
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

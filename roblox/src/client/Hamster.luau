-- One hamster as it is drawn: a round body with ears, eyes, cheeks and paws, the
-- name over its head, and the little motions that make it feel alive. It is told
-- where it is and what it is doing every frame, and decides nothing.
-- Local frame of the parts: +X is forward, +Y is up, +Z is its right.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Config"))

local R = Config.HAMSTER_R
-- Drawn a little bigger than it collides, so it reads well from far above.
local GROW = 1.22
local FONT = Enum.Font.FredokaOne
local WHITE = Color3.new(1, 1, 1)
local GOLD = Color3.fromRGB(255, 214, 70)
local RED = Color3.fromRGB(255, 86, 74)
local INK = Color3.fromRGB(58, 40, 30)
local EAR_PINK = Color3.fromHex("#f7b6b6")
local CHEEK = Color3.fromRGB(255, 130, 150)
local EYE = Color3.fromHex("#2a1c14")
local NOSE = Color3.fromHex("#e58a8a")
local SEED = Color3.fromHex("#3a3330")
local SEED_STRIPE = Color3.fromHex("#f4efe6")
local UPRIGHT = CFrame.Angles(0, 0, math.rad(90)) -- stands a cylinder on its end

local Hamster = {}
Hamster.__index = Hamster

local function basePart(parent, color)
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Material = Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Color = color
	p.Parent = parent
	return p
end

-- info: { id, name, team, bot }. `me` marks the local player's own hamster.
-- It wears its seat's look from the web game, outlined in its colour.
function Hamster.new(parent, info, me)
	local look = Config.LOOKS[info.id]
	local color = Config.colorOf(info.id, info.team)
	local model = Instance.new("Model")
	model.Name = "Hamster" .. info.id
	model.Parent = parent
	-- What gets the outline: the hamster itself, not its ring, aim or tag.
	local body = Instance.new("Model")
	body.Name = "Body"
	body.Parent = model

	local self = setmetatable({
		id = info.id,
		name = info.name,
		me = me,
		color = color,
		look = look,
		model = model,
		pieces = {}, -- { part, offset, size }
		x = nil,
		y = nil,
		yaw = 0,
		stride = 0, -- how far along its waddle it is
		pace = 0, -- smoothed speed, studs per second
		pop = 0, -- a squash that springs back
		popSpeed = 0,
		swingAt = nil, -- os.clock() when the current swing began
		landed = false,
		clock = math.random() * 10,
		puff = 0, -- cheeks, 0..1
		daze = 0,
	}, Hamster)

	local function blob(key, offset, size, tint, shadow, parent_)
		local p = basePart(parent_ or body, tint)
		p.Size = size
		local mesh = Instance.new("SpecialMesh")
		mesh.MeshType = Enum.MeshType.Sphere
		mesh.Parent = p
		p.CastShadow = shadow == true
		local piece = { part = p, offset = offset * GROW, size = size * GROW }
		self.pieces[key] = piece
		return piece
	end

	blob("body", Vector3.new(0, 1.3, 0), Vector3.new(3.3, 2.5, 3.1), look.fur, true)
	blob("belly", Vector3.new(0.95, 0.95, 0), Vector3.new(1.55, 1.6, 2.25), look.belly)
	blob("tail", Vector3.new(-1.65, 1.0, 0), Vector3.new(0.55, 0.55, 0.55), look.belly)
	for _, s in { -1, 1 } do
		local k = if s < 0 then "L" else "R"
		blob("ear" .. k, Vector3.new(0.35, 2.45, s * 1.1), Vector3.new(0.55, 1.15, 1.15), look.ear, true)
		blob("earIn" .. k, Vector3.new(0.5, 2.5, s * 1.1), Vector3.new(0.45, 0.68, 0.68), EAR_PINK)
		blob("eye" .. k, Vector3.new(1.2, 1.95, s * 0.62), Vector3.new(0.46, 0.52, 0.46), EYE)
		blob("glint" .. k, Vector3.new(1.33, 2.13, s * 0.52), Vector3.new(0.17, 0.17, 0.17), WHITE)
		blob("cheek" .. k, Vector3.new(1.15, 1.35, s * 1.05), Vector3.new(0.7, 0.55, 0.7), CHEEK)
		blob("pawF" .. k, Vector3.new(0.95, 0.3, s * 1.0), Vector3.new(0.8, 0.5, 0.62), look.paw)
		blob("pawB" .. k, Vector3.new(-0.95, 0.3, s * 1.0), Vector3.new(0.85, 0.5, 0.68), look.paw)
	end
	blob("nose", Vector3.new(1.74, 1.5, 0), Vector3.new(0.3, 0.26, 0.4), NOSE)
	-- The paw that does the bonking.
	blob("fist", Vector3.new(0.4, 3.3, 0), Vector3.new(1.25, 1.25, 1.25), look.paw).part.Transparency = 1
	-- The seed, held in the mouth: dark with two pale stripes, as the web game draws it.
	blob("seed", Vector3.new(1.95, 1.2, 0), Vector3.new(1.3, 0.6, 0.8), SEED).part.Transparency = 1
	blob("seedStripe", Vector3.new(1.97, 1.36, 0), Vector3.new(1.0, 0.32, 0.26), SEED_STRIPE).part.Transparency = 1
	-- Stars that circle a dazed head.
	for i = 1, 3 do
		blob("star" .. i, Vector3.zero, Vector3.new(0.6, 0.6, 0.6), GOLD, false, model).part.Transparency = 1
		self.pieces["star" .. i].part.Material = Enum.Material.Neon
	end

	-- The web game's outline round the body, in the hamster's colour.
	local outline = Instance.new("Highlight")
	outline.Adornee = body
	outline.FillTransparency = 1
	outline.OutlineColor = color
	outline.OutlineTransparency = 0
	outline.DepthMode = Enum.HighlightDepthMode.Occluded
	outline.Parent = model
	self.outline = outline

	-- A ring underfoot: mine in white, and everyone's in its team's colour.
	if me or info.team then
		local ring = basePart(model, if me then WHITE else color)
		ring.Shape = Enum.PartType.Cylinder
		ring.Material = Enum.Material.Neon
		ring.Transparency = if me then 0.1 else 0.35
		self.ring = ring
	end

	-- Shows where a thrown seed would go while the throw winds up.
	local aim = basePart(model, WHITE)
	aim.Material = Enum.Material.Neon
	aim.Transparency = 1
	self.aim = aim

	-- The name tag rides on a part that never squashes.
	local tag = basePart(model, WHITE)
	tag.Size = Vector3.one
	tag.Transparency = 1
	self.tag = tag
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromScale(16, 5.6)
	gui.StudsOffset = Vector3.new(0, 4.2, 0)
	gui.AlwaysOnTop = true
	gui.LightInfluence = 0
	gui.Parent = tag

	local function label(position, size, tint, rim)
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Position = position
		l.Size = size
		l.Font = FONT
		l.TextScaled = true
		l.TextColor3 = tint
		l.Text = ""
		l.Parent = gui
		local stroke = Instance.new("UIStroke")
		stroke.Thickness = 2.5
		stroke.Color = rim or INK
		stroke.Parent = l
		return l
	end
	self.status = label(UDim2.fromScale(0, 0), UDim2.fromScale(1, 0.27), GOLD)
	local barBack = Instance.new("Frame")
	barBack.AnchorPoint = Vector2.new(0.5, 0)
	barBack.Position = UDim2.fromScale(0.5, 0.31)
	barBack.Size = UDim2.fromScale(0.42, 0.11)
	barBack.BackgroundColor3 = INK
	barBack.BorderSizePixel = 0
	barBack.Visible = false
	barBack.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.5, 0)
	corner.Parent = barBack
	local barStroke = Instance.new("UIStroke")
	barStroke.Thickness = 2
	barStroke.Color = INK
	barStroke.Parent = barBack
	local bar = Instance.new("Frame")
	bar.Size = UDim2.fromScale(0, 1)
	bar.BackgroundColor3 = GOLD
	bar.BorderSizePixel = 0
	bar.Parent = barBack
	corner:Clone().Parent = bar
	self.barBack = barBack
	self.bar = bar
	-- The name in the hamster's colour on white, as on the web; mine says so.
	self.label = label(UDim2.fromScale(0, 0.46), UDim2.fromScale(1, 0.32), color, WHITE)
	self.label.Text = info.name
	local level = info.bot and Config.BOT_LEVELS[info.bot]
	local under = if me then { name = "나", color = color } else level
	if under then
		label(UDim2.fromScale(0, 0.78), UDim2.fromScale(1, 0.22), under.color, WHITE).Text = under.name
	end
	return self
end

function Hamster:destroy()
	self.model:Destroy()
end

-- A quick squash that springs back: landing a hit, picking a seed, popping in.
function Hamster:squash(amount)
	self.popSpeed -= amount
end

-- Starts the bonk motion now. The snapshot starts it too; whichever comes first.
function Hamster:swing()
	if not self.swingAt or os.clock() - self.swingAt > 0.3 then
		self.swingAt = os.clock()
		self.landed = false
	end
end

local function setText(label, value)
	if label.Text ~= value then
		label.Text = value
	end
end

-- p: the hamster's line of the snapshot. x, y: where to draw it (already smoothed).
-- view: { bar, status } for the tag: how full its gauge is (or nil) and the words over it.
function Hamster:draw(dt, x, y, p, view)
	local moved = 0
	if self.x then
		moved = math.sqrt((x - self.x) ^ 2 + (y - self.y) ^ 2)
		if moved > 4 then
			-- Back at the nest, or out of a burrow: it pops into place.
			moved = 0
			self.pop = 0.45
		end
	end
	self.x, self.y = x, y
	self.clock += dt
	local speed = if dt > 0 then moved / dt else 0
	self.pace += (speed - self.pace) * (1 - math.exp(-dt * 14))
	local going = math.clamp(self.pace / Config.SPEED, 0, 1)
	self.stride += dt * (4 + going * 16) * (if going > 0.05 then 1 else 0)

	-- It turns towards where it faces, the short way round.
	local want = math.atan2(p.fy, p.fx)
	local turn = (want - self.yaw + math.pi) % (2 * math.pi) - math.pi
	self.yaw += turn * (1 - math.exp(-dt * 22))

	-- The squash spring.
	self.popSpeed += (-self.pop * 260 - self.popSpeed * 16) * dt
	self.pop += self.popSpeed * dt
	self.pop = math.clamp(self.pop, -0.5, 0.6)

	if p.windup or p.recovery then
		self:swing()
	end
	local swingT = if self.swingAt then os.clock() - self.swingAt else math.huge
	local WINDUP = Config.BONK.windup
	local lean = 0 -- backwards before the hit, forwards as it lands
	local lunge = 0
	local fist = self.pieces.fist
	if swingT < WINDUP then
		local k = swingT / WINDUP
		lean = -0.3 * k
		fist.part.Transparency = 0
		fist.offset = Vector3.new(0.2 - 0.5 * k, 3.1 + 0.6 * k, 0) * GROW
		fist.size = Vector3.one * (0.9 + 0.6 * k) * GROW
	elseif swingT < WINDUP + 0.2 then
		local k = (swingT - WINDUP) / 0.2
		local hit = math.min(1, k * 3.2) -- slams down in a third of the time, then holds
		lean = 0.34 * (1 - k)
		lunge = 0.85 * (1 - k) * hit
		fist.part.Transparency = if k > 0.7 then (k - 0.7) / 0.3 else 0
		fist.offset = Vector3.new(-0.3, 3.7, 0):Lerp(Vector3.new(2.9, 0.9, 0), hit) * GROW
		fist.size = Vector3.one * 1.6 * GROW
		if not self.landed then
			self.landed = true
			self.pop = -0.16
		end
	else
		fist.part.Transparency = 1
	end

	local dazed = p.dazed
	self.daze += ((if dazed then 1 else 0) - self.daze) * (1 - math.exp(-dt * 12))
	self.puff += ((if p.carrying then 1 else 0) - self.puff) * (1 - math.exp(-dt * 14))

	-- Squash and stretch: the waddle, breathing, and the spring.
	local bob = math.abs(math.sin(self.stride)) * 0.3 * going
	local breathe = math.sin(self.clock * 2.6) * 0.018 * (1 - going)
	local tall = 1 + self.pop + breathe + bob * 0.18 - self.daze * 0.28
	local wide = 1 - self.pop * 0.5 - breathe * 0.5 + self.daze * 0.16
	local scale = Vector3.new(wide, tall, wide)
	local roll = math.sin(self.stride) * 0.11 * going
	local root = CFrame.new(x, bob, y)
		* CFrame.Angles(0, -self.yaw, 0)
		* CFrame.new(lunge, 0, 0)
		* CFrame.Angles(roll, 0, lean)

	local alpha = if dazed then 0.45 else 0
	for key, piece in self.pieces do
		local part = piece.part
		local offset = piece.offset
		local size = piece.size
		if key == "fist" then
			part.CFrame = root * CFrame.new(offset)
			part.Size = size
			continue
		elseif key == "seed" or key == "seedStripe" then
			part.Transparency = if p.carrying then 0 else 1
		elseif string.sub(key, 1, 4) == "star" then
			local i = tonumber(string.sub(key, 5))
			local a = self.clock * 6 + i * 2.094
			part.Transparency = if dazed then 0 else 1
			part.CFrame = CFrame.new(x + math.cos(a) * 2, 4.4 + math.sin(a * 2) * 0.15, y + math.sin(a) * 2)
			continue
		elseif string.sub(key, 1, 3) == "paw" then
			-- Paws patter: front and back on each side go opposite ways.
			local front = string.sub(key, 4, 4) == "F"
			local right = string.sub(key, 5, 5) == "R"
			local phase = self.stride + (if front == right then 0 else math.pi)
			offset += Vector3.new(math.sin(phase) * 0.55 * going, math.max(0, math.cos(phase)) * 0.25 * going, 0)
			part.Transparency = alpha
		elseif string.sub(key, 1, 5) == "cheek" then
			-- A mouthful of seed puffs the cheeks out.
			size *= 1 + self.puff * 0.9
			part.Color = CHEEK:Lerp(self.look.belly, self.puff * 0.8)
			part.Transparency = math.max(alpha, 0.3 * (1 - self.puff))
		elseif string.sub(key, 1, 3) == "eye" then
			-- It blinks now and then, and squeezes its eyes shut when dazed.
			local shut = dazed or (self.clock % 3.4) < 0.11
			size = Vector3.new(size.X, if shut then 0.1 else size.Y, size.Z)
			part.Transparency = alpha
		elseif string.sub(key, 1, 5) == "glint" then
			part.Transparency = if dazed or (self.clock % 3.4) < 0.11 then 1 else 0
		elseif string.sub(key, 1, 3) == "ear" then
			-- Ears flick as it runs.
			offset += Vector3.new(0, math.sin(self.stride * 2) * 0.06 * going, 0)
			part.Transparency = alpha
		else
			part.Transparency = alpha
		end
		part.Size = size * scale
		part.CFrame = root * CFrame.new(offset * scale)
	end

	if self.ring then
		-- My own ring is the wider one, and it breathes.
		local pulse = if self.me then 1.12 + math.sin(self.clock * 4) * 0.06 else 1
		self.ring.Size = Vector3.new(0.08, (R + 0.7) * 2 * pulse, (R + 0.7) * 2 * pulse)
		self.ring.CFrame = CFrame.new(x, 0.36, y) * UPRIGHT
	end
	self.tag.Position = Vector3.new(x, 1.5, y)

	local aim = self.aim
	if p.charge > 0 then
		local THROW = Config.THROW
		local ready = p.charge >= THROW.charge
		local length = THROW.range * math.min(1, p.charge / THROW.charge)
		local forward = Vector3.new(p.fx, 0, p.fy)
		aim.Size = Vector3.new(length, 0.12, if ready then THROW.width * 2 else 0.7)
		aim.CFrame = CFrame.new(Vector3.new(x, 0.5, y) + forward * (R + length / 2)) * CFrame.Angles(0, -want, 0)
		aim.Color = if p.charge > THROW.max - 0.35 then RED elseif ready then GOLD else WHITE
		aim.Transparency = if ready then 0.55 else 0.4
	else
		aim.Transparency = 1
	end

	-- A carrier close to home sets the alarm off.
	setText(self.label, (if p.alarm then "🚨 " elseif p.carrying then "🌻 " else "") .. self.name)
	self.label.TextColor3 = if p.alarm then RED else self.color
	setText(self.status, view.status)
	self.barBack.Visible = view.bar ~= nil
	if view.bar then
		self.bar.Size = UDim2.fromScale(view.bar, 1)
	end
end

return Hamster

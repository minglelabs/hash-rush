-- The meadow: home on the left, the sunflower on the right and a hedge maze in
-- between. Everything is data, in studs. Sim x runs left to right (world X), sim y
-- runs top to bottom on screen (world Z).

local CELL = 4
local COLS = 12
local ROWS = 13
local HEDGE_X1 = 21

-- Runs of open grid cells, { col, row, col, row }, counted from 0.
local LANES = {
	-- top
	{ 0, 1, 2, 1 }, { 2, 1, 2, 3 }, { 2, 3, 5, 3 }, { 5, 3, 5, 1 }, { 5, 1, 8, 1 }, { 8, 1, 8, 3 }, { 8, 3, 11, 3 },
	-- middle
	{ 0, 5, 3, 5 }, { 3, 5, 3, 7 }, { 3, 7, 6, 7 }, { 6, 7, 6, 5 }, { 6, 5, 9, 5 }, { 9, 5, 9, 7 }, { 9, 7, 11, 7 },
	-- bottom
	{ 0, 11, 2, 11 }, { 2, 11, 2, 9 }, { 2, 9, 5, 9 }, { 5, 9, 5, 11 }, { 5, 11, 8, 11 }, { 8, 11, 8, 9 }, { 8, 9, 11, 9 },
	-- cross links
	{ 3, 3, 3, 5 }, { 4, 7, 4, 9 }, { 8, 3, 8, 5 }, { 10, 7, 10, 9 },
}

local BOUNDS = { x1 = 2.4, y1 = 2, x2 = 89, y2 = 2 + ROWS * CELL }
local FLOWER = { x = 79, y = 28, r = 3, gatherR = 6.6 }
local HOME = { x1 = BOUNDS.x1, y1 = BOUNDS.y1, x2 = 15, y2 = BOUNDS.y2 }

-- Nests sit on an arc, top to bottom, so everyone starts as far from the middle lane.
local function arcNests(cx, cy, r, angles)
	local nests = {}
	for _, deg in angles do
		local a = math.rad(deg)
		table.insert(nests, { x = cx - math.cos(a) * r, y = cy + math.sin(a) * r })
	end
	return nests
end

local bigAngles = {}
for i = 0, 7 do
	table.insert(bigAngles, -66 + i * 132 / 7)
end

-- Every wall cell is covered by its longest horizontal and vertical run. The two
-- sets overlap, so the union only has rounded corners where a wall really ends.
local function hedgeRects()
	local open = {}
	for r = 0, ROWS - 1 do
		open[r] = {}
	end
	for _, lane in LANES do
		for c = math.min(lane[1], lane[3]), math.max(lane[1], lane[3]) do
			for r = math.min(lane[2], lane[4]), math.max(lane[2], lane[4]) do
				open[r][c] = true
			end
		end
	end
	local rects = {}
	for r = 0, ROWS - 1 do
		for c = 0, COLS - 1 do
			if not open[r][c] and (c == 0 or open[r][c - 1]) then
				local last = c
				while last + 1 < COLS and not open[r][last + 1] do
					last += 1
				end
				table.insert(rects, { x = HEDGE_X1 + c * CELL, y = BOUNDS.y1 + r * CELL, w = (last - c + 1) * CELL, h = CELL })
			end
		end
	end
	for c = 0, COLS - 1 do
		for r = 0, ROWS - 1 do
			if not open[r][c] and (r == 0 or open[r - 1][c]) then
				local last = r
				while last + 1 < ROWS and not open[last + 1][c] do
					last += 1
				end
				if last > r then
					table.insert(rects, { x = HEDGE_X1 + c * CELL, y = BOUNDS.y1 + r * CELL, w = CELL, h = (last - r + 1) * CELL })
				end
			end
		end
	end
	return rects
end

local Map = {
	world = { w = 91.4, h = 56 },
	bounds = BOUNDS,
	home = HOME,
	flower = FLOWER,
	-- Tunnels above and below the flower: an empty-handed hamster goes straight home.
	warps = {
		{ x = FLOWER.x, y = 6.4, r = 3.4 },
		{ x = FLOWER.x, y = 49.6, r = 3.4 },
	},
	nests = arcNests(HOME.x2, FLOWER.y, 10, { -36, -12, 12, 36 }),
	-- Used once more than four hamsters play.
	bigNests = arcNests(HOME.x2 + 2, FLOWER.y, 12.5, bigAngles),
	-- Hedges collide as rounded rectangles with this corner radius.
	rects = hedgeRects(),
	corner = 2,
}

-- Builds the map as anchored parts under Workspace.HashRushMap, and sets the
-- light. The folder's attributes tell the client where things are.
function Map.render()
	local Lighting = game:GetService("Lighting")
	local Lang = require(game:GetService("ReplicatedStorage"):WaitForChild("Lang"))
	local folder = Instance.new("Folder")
	folder.Name = "HashRushMap"
	local rng = Random.new(11)

	local function rgb(r, g, b)
		return Color3.fromRGB(r, g, b)
	end
	local function part(name, color, material, parent)
		local p = Instance.new("Part")
		p.Name = name
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = false
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		p.Material = material or Enum.Material.SmoothPlastic
		p.Color = color
		p.Parent = parent or folder
		return p
	end
	-- A box over the sim rectangle (x1, y1)-(x2, y2), standing on `base`.
	local function box(name, x1, y1, x2, y2, base, height, color, material, parent)
		local p = part(name, color, material, parent)
		p.Size = Vector3.new(x2 - x1, height, y2 - y1)
		p.Position = Vector3.new((x1 + x2) / 2, base + height / 2, (y1 + y2) / 2)
		return p
	end
	local function disc(name, x, y, r, base, height, color, material, parent)
		local p = part(name, color, material, parent)
		p.Shape = Enum.PartType.Cylinder
		p.Size = Vector3.new(height, 2 * r, 2 * r)
		p.CFrame = CFrame.new(x, base + height / 2, y) * CFrame.Angles(0, 0, math.rad(90))
		return p
	end
	-- An ellipsoid: a part wearing a sphere mesh.
	local function blob(name, cframe, size, color, parent)
		local p = part(name, color, nil, parent)
		p.Size = size
		p.CFrame = cframe
		local mesh = Instance.new("SpecialMesh")
		mesh.MeshType = Enum.MeshType.Sphere
		mesh.Parent = p
		return p
	end
	local function sign(parent, text, studs)
		local gui = Instance.new("BillboardGui")
		gui.Size = UDim2.fromScale(studs, studs * 0.5)
		gui.AlwaysOnTop = true
		gui.LightInfluence = 0
		gui.Parent = parent
		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.Text = text
		label.TextScaled = true
		label.Font = Enum.Font.FredokaOne
		label.TextColor3 = Color3.new(1, 1, 1)
		label.TextStrokeTransparency = 1
		label.Parent = gui
		local stroke = Instance.new("UIStroke")
		stroke.Thickness = 2.5
		stroke.Color = rgb(74, 50, 30)
		stroke.Parent = label
	end

	local w = Map.world

	-- Light: an afternoon sun with soft shadows, colours a little richer than life.
	Lighting.GlobalShadows = true
	Lighting.Brightness = 2.4
	Lighting.ClockTime = 14.3
	Lighting.GeographicLatitude = 28
	Lighting.Ambient = rgb(150, 150, 165)
	Lighting.OutdoorAmbient = rgb(165, 165, 175)
	Lighting.EnvironmentSpecularScale = 0
	Lighting.EnvironmentDiffuseScale = 0.5
	Lighting.ShadowSoftness = 0.35
	local grade = Instance.new("ColorCorrectionEffect")
	grade.Name = "HashRushGrade"
	grade.Saturation = 0.2
	grade.Contrast = 0.06
	grade.Parent = Lighting
	local bloom = Instance.new("BloomEffect")
	bloom.Name = "HashRushBloom"
	bloom.Intensity = 0.3
	bloom.Size = 18
	bloom.Threshold = 1.5
	bloom.Parent = Lighting

	-- The meadow around the field.
	box("Ground", -400, -400, w.w + 400, w.h + 400, -1, 1, rgb(96, 170, 90), Enum.Material.Grass)

	-- The field: mown in a checkerboard of two greens.
	local TILE = 4
	local cols = math.ceil((BOUNDS.x2 - BOUNDS.x1) / TILE)
	local rows = math.ceil((BOUNDS.y2 - BOUNDS.y1) / TILE)
	for c = 0, cols - 1 do
		for r = 0, rows - 1 do
			local x1 = BOUNDS.x1 + c * TILE
			local y1 = BOUNDS.y1 + r * TILE
			local light = (c + r) % 2 == 0
			box("Field", x1, y1, math.min(BOUNDS.x2, x1 + TILE), math.min(BOUNDS.y2, y1 + TILE), 0, 0.1, if light then rgb(168, 222, 118) else rgb(154, 212, 106))
		end
	end

	-- The maze floor: a sandy path with a darker rim.
	local laneX2 = HEDGE_X1 + COLS * CELL
	box("LaneRim", HEDGE_X1 - 0.5, BOUNDS.y1, laneX2 + 0.5, BOUNDS.y2, 0.1, 0.04, rgb(206, 180, 128))
	for c = 0, COLS - 1 do
		for r = 0, ROWS - 1 do
			local x1 = HEDGE_X1 + c * CELL
			local y1 = BOUNDS.y1 + r * CELL
			local light = (c + r) % 2 == 0
			box("LaneFloor", x1, y1, x1 + CELL, y1 + CELL, 0.14, 0.04, if light then rgb(247, 232, 196) else rgb(241, 224, 184))
		end
	end

	-- Home. The client stretches these two as the home edge moves in overtime.
	box("Home", HOME.x1, HOME.y1, HOME.x2, HOME.y2, 0.2, 0.08, rgb(255, 226, 170), Enum.Material.Sand)
	local edge = box("HomeEdge", HOME.x2 - 0.25, HOME.y1, HOME.x2 + 0.25, HOME.y2, 0.28, 0.5, rgb(255, 150, 60), Enum.Material.Neon)
	edge.Transparency = 0.15
	-- Nests: a dark hole with a rim, as on the web. The client paints each rim in
	-- the colour of whoever starts there.
	local nests = Instance.new("Folder")
	nests.Name = "Nests"
	nests.Parent = folder
	local function nest(n)
		disc("NestRim", n.x, n.y, 2.15, 0.26, 0.1, rgb(150, 118, 84), nil, nests)
		disc("NestHole", n.x, n.y, 1.75, 0.3, 0.1, rgb(74, 56, 44), nil, nests)
	end
	for _, n in Map.bigNests do
		nest(n)
	end
	for _, n in Map.nests do
		nest(n)
	end

	-- A hedge is a rounded rectangle: two crossing boxes and a disc in each corner,
	-- with a lighter cap on top so it reads as a plump bush.
	local c = Map.corner
	local HEDGE_H = 1.9
	local side = rgb(52, 138, 70)
	local cap = rgb(98, 186, 92)
	local INSET = 0.6
	local corners = {}
	for _, r in Map.rects do
		if r.w > 2 * c then
			box("Hedge", r.x + c, r.y, r.x + r.w - c, r.y + r.h, 0.1, HEDGE_H, side, Enum.Material.Grass).CastShadow = true
		end
		if r.h > 2 * c then
			box("Hedge", r.x, r.y + c, r.x + r.w, r.y + r.h - c, 0.1, HEDGE_H, side, Enum.Material.Grass).CastShadow = true
		end
		for _, x in { r.x + c, r.x + r.w - c } do
			for _, y in { r.y + c, r.y + r.h - c } do
				local key = x .. "," .. y
				if not corners[key] then
					corners[key] = true
					disc("Hedge", x, y, c, 0.1, HEDGE_H, side, Enum.Material.Grass).CastShadow = true
					-- A blossom on some of the corners.
					if rng:NextNumber() < 0.45 then
						local petals = ({ rgb(255, 255, 255), rgb(255, 170, 200), rgb(255, 224, 110) })[rng:NextInteger(1, 3)]
						local bx = x + rng:NextNumber(-0.7, 0.7)
						local by = y + rng:NextNumber(-0.7, 0.7)
						blob("Blossom", CFrame.new(bx, 0.1 + HEDGE_H + 0.32, by), Vector3.new(0.85, 0.3, 0.85), petals)
						blob("Blossom", CFrame.new(bx, 0.1 + HEDGE_H + 0.42, by), Vector3.new(0.35, 0.25, 0.35), rgb(255, 200, 60))
					end
				end
			end
		end
	end

	-- The lighter cap, one piece per wall cell, drawn in from every side that
	-- faces a lane so the darker rim shows all the way round.
	local wall = {}
	for r = 0, ROWS - 1 do
		wall[r] = table.create(COLS, true)
		wall[r][0] = true
	end
	for _, lane in LANES do
		for col = math.min(lane[1], lane[3]), math.max(lane[1], lane[3]) do
			for r = math.min(lane[2], lane[4]), math.max(lane[2], lane[4]) do
				wall[r][col] = false
			end
		end
	end
	local function isWall(col, r)
		return r >= 0 and r < ROWS and col >= 0 and col < COLS and wall[r][col]
	end
	for r = 0, ROWS - 1 do
		for col = 0, COLS - 1 do
			if wall[r][col] then
				local x1 = HEDGE_X1 + col * CELL
				local y1 = BOUNDS.y1 + r * CELL
				box(
					"HedgeCap",
					x1 + (if isWall(col - 1, r) then 0 else INSET),
					y1 + (if isWall(col, r - 1) then 0 else INSET),
					x1 + CELL - (if isWall(col + 1, r) then 0 else INSET),
					y1 + CELL - (if isWall(col, r + 1) then 0 else INSET),
					0.1 + HEDGE_H,
					0.25,
					cap,
					Enum.Material.Grass
				)
			end
		end
	end

	-- Leaf clumps on top, a lighter green on the darker hedge, so it reads as a
	-- bush and not a box, as the web game's hedges do.
	local leaves = { rgb(86, 170, 84), rgb(108, 190, 98), rgb(74, 156, 76) }
	local tops = {}
	for r = 0, ROWS - 1 do
		for col = 0, COLS - 1 do
			if wall[r][col] then
				local x1 = HEDGE_X1 + col * CELL
				local y1 = BOUNDS.y1 + r * CELL
				table.insert(tops, { x1 + CELL / 2, y1 + CELL / 2 })
				for _ = 1, 3 do
					local size = rng:NextNumber(1.7, 2.5)
					local lo = INSET + size / 2 - 0.4
					local bx = x1 + rng:NextNumber(lo, CELL - lo)
					local by = y1 + rng:NextNumber(lo, CELL - lo)
					local clump = blob("Leaves", CFrame.new(bx, 0.1 + HEDGE_H + 0.18, by), Vector3.new(size, 0.75, size), leaves[rng:NextInteger(1, 3)])
					clump.Material = Enum.Material.Grass
				end
			end
		end
	end

	-- Red toadstools, tree stumps and grey stones on some of the hedges.
	local TOP = 0.1 + HEDGE_H + 0.25
	local function toadstool(x, y)
		local stalk = part("Toadstool", rgb(250, 244, 230))
		stalk.Shape = Enum.PartType.Cylinder
		stalk.Size = Vector3.new(0.7, 0.45, 0.45)
		stalk.CFrame = CFrame.new(x, TOP + 0.35, y) * CFrame.Angles(0, 0, math.rad(90))
		blob("Toadstool", CFrame.new(x, TOP + 0.75, y), Vector3.new(1.3, 0.7, 1.3), rgb(226, 58, 52)).CastShadow = true
		for k = 0, 2 do
			local a = k * 2.1 + rng:NextNumber(0, 1)
			blob("Toadstool", CFrame.new(x + math.cos(a) * 0.32, TOP + 1.04, y + math.sin(a) * 0.32), Vector3.new(0.26, 0.12, 0.26), rgb(255, 255, 255))
		end
	end
	local function stump(x, y)
		disc("Stump", x, y, 0.85, TOP, 0.6, rgb(150, 100, 60)).CastShadow = true
		disc("Stump", x, y, 0.62, TOP + 0.6, 0.04, rgb(214, 170, 110))
		disc("Stump", x, y, 0.3, TOP + 0.62, 0.04, rgb(180, 132, 84))
	end
	local function stone(x, y, base, size)
		blob("Stone", CFrame.new(x, base + size * 0.15, y) * CFrame.Angles(0, rng:NextNumber(0, 6), 0), Vector3.new(size * 1.3, size * 0.55, size), rgb(150, 152, 158)).CastShadow = true
	end
	for k = #tops, 2, -1 do
		local j = rng:NextInteger(1, k)
		tops[k], tops[j] = tops[j], tops[k]
	end
	for k, at in tops do
		local x = at[1] + rng:NextNumber(-0.8, 0.8)
		local y = at[2] + rng:NextNumber(-0.8, 0.8)
		if k <= 7 then
			toadstool(x, y)
		elseif k <= 10 then
			stump(x, y)
		elseif k <= 15 then
			stone(x, y, TOP, rng:NextNumber(0.9, 1.3))
		end
	end

	-- Clover and little flowers in the open grass by home and by the flower.
	local laneX2 = HEDGE_X1 + COLS * CELL
	local function openGrass()
		while true do
			local x = if rng:NextNumber() < 0.4 then rng:NextNumber(HOME.x2 + 0.8, HEDGE_X1 - 0.8) else rng:NextNumber(laneX2 + 0.8, BOUNDS.x2 - 0.8)
			local y = rng:NextNumber(BOUNDS.y1 + 0.8, BOUNDS.y2 - 0.8)
			local clear = math.sqrt((x - FLOWER.x) ^ 2 + (y - FLOWER.y) ^ 2) > FLOWER.gatherR + 1
			for _, warp in Map.warps do
				clear = clear and math.sqrt((x - warp.x) ^ 2 + (y - warp.y) ^ 2) > warp.r + 1.5
			end
			if clear then
				return x, y
			end
		end
	end
	for _ = 1, 22 do
		local x, y = openGrass()
		for k = 0, 2 do
			local a = k * 2.094 + 0.5
			disc("Clover", x + math.cos(a) * 0.32, y + math.sin(a) * 0.32, 0.3, 0.1, 0.06, rgb(96, 168, 82))
		end
	end
	for _ = 1, 14 do
		local x, y = openGrass()
		blob("Daisy", CFrame.new(x, 0.15, y), Vector3.new(0.7, 0.16, 0.7), rgb(255, 255, 255))
		blob("Daisy", CFrame.new(x, 0.2, y), Vector3.new(0.28, 0.14, 0.28), rgb(255, 206, 70))
	end

	-- Home says what it is for, on the sand, as the web game's does.
	local homeSign = part("HomeSign", rgb(255, 255, 255))
	homeSign.Transparency = 1
	-- Turned so the writing runs left to right as the camera sees it.
	homeSign.Size = Vector3.new(7, 0.05, HOME.x2 - HOME.x1 - 1)
	homeSign.CFrame = CFrame.new((HOME.x1 + HOME.x2) / 2, 0.3, HOME.y2 - 5) * CFrame.Angles(0, -math.pi / 2, 0)
	local surface = Instance.new("SurfaceGui")
	surface.Face = Enum.NormalId.Top
	surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	surface.PixelsPerStud = 40
	surface.LightInfluence = 0
	surface.Parent = homeSign
	for _, line in { { "homeSign", 0, 0.62 }, { "homeHint", 0.62, 0.38 } } do
		local label = Instance.new("TextLabel")
		label.Name = line[1]
		label.BackgroundTransparency = 1
		label.Position = UDim2.fromScale(0, line[2])
		label.Size = UDim2.fromScale(1, line[3])
		label.Text = Lang.t(line[1])
		label.TextScaled = true
		label.Font = Enum.Font.FredokaOne
		label.TextColor3 = rgb(201, 160, 104)
		label.TextTransparency = 0.15
		label.Parent = surface
	end

	-- The sunflower. The client sways the head.
	disc("GatherRing", FLOWER.x, FLOWER.y, FLOWER.gatherR, 0.12, 0.05, rgb(255, 246, 170)).Transparency = 0.55
	for i = 0, 23 do
		local a = i / 24 * math.pi * 2
		disc("GatherDot", FLOWER.x + math.cos(a) * FLOWER.gatherR, FLOWER.y + math.sin(a) * FLOWER.gatherR, 0.32, 0.14, 0.06, rgb(255, 255, 255)).Transparency = 0.15
	end
	local flower = Instance.new("Model")
	flower.Name = "Sunflower"
	local HEAD_Y = 2.6
	local heart = disc("Heart", FLOWER.x, FLOWER.y, FLOWER.r * 0.62, HEAD_Y, 0.7, rgb(120, 76, 40), nil, flower)
	heart.CastShadow = true
	disc("HeartTop", FLOWER.x, FLOWER.y, FLOWER.r * 0.45, HEAD_Y + 0.7, 0.12, rgb(92, 56, 30), nil, flower)
	for i = 0, 15 do
		local a = i / 16 * math.pi * 2
		local reach = FLOWER.r * 0.62 + 0.75
		local at = CFrame.new(FLOWER.x, HEAD_Y + 0.3 + (i % 2) * 0.12, FLOWER.y) * CFrame.Angles(0, -a, 0) * CFrame.new(reach, 0, 0)
		blob("Petal", at, Vector3.new(2.3, 0.45, 1.25), if i % 2 == 0 then rgb(255, 212, 50) else rgb(255, 190, 30), flower).CastShadow = true
	end
	-- No primary part: the pivot stays upright, so the client can nod the head.
	flower.WorldPivot = CFrame.new(FLOWER.x, HEAD_Y, FLOWER.y)
	flower.Parent = folder
	local stem = part("Stem", rgb(86, 160, 70))
	stem.Shape = Enum.PartType.Cylinder
	stem.Size = Vector3.new(HEAD_Y, 0.9, 0.9)
	stem.CFrame = CFrame.new(FLOWER.x, HEAD_Y / 2, FLOWER.y) * CFrame.Angles(0, 0, math.rad(90))
	for _, a in { 0.6, 3.6 } do
		blob("Leaf", CFrame.new(FLOWER.x, 0.5, FLOWER.y) * CFrame.Angles(0, a, 0) * CFrame.new(2.3, 0, 0), Vector3.new(3, 0.3, 1.5), rgb(98, 176, 78))
	end
	sign(heart, "🌻", 5)

	-- Portals back to the nest: a purple swirl, plainly not a home of its own, as
	-- on the web. The client spins each one.
	for i, warp in Map.warps do
		disc("WarpRing", warp.x, warp.y, warp.r + 0.35, 0.12, 0.12, rgb(196, 160, 255)).Material = Enum.Material.Neon
		local base = disc("Warp", warp.x, warp.y, warp.r, 0.16, 0.12, rgb(84, 40, 150))
		local swirl = Instance.new("Model")
		swirl.Name = "Swirl"
		for arm = 0, 2 do
			for t = 0, 6 do
				local a = arm * 2.094 + t * 0.55
				local d = 0.35 + t * (warp.r - 0.6) / 6
				local dot = disc("SwirlDot", warp.x + math.cos(a) * d, warp.y + math.sin(a) * d, 0.42 - t * 0.03, 0.29, 0.04, rgb(214, 186, 255), nil, swirl)
				dot.Material = Enum.Material.Neon
			end
		end
		swirl.WorldPivot = CFrame.new(warp.x, 0.3, warp.y)
		swirl:SetAttribute("Index", i)
		swirl.Parent = folder
		local gui = Instance.new("BillboardGui")
		gui.Size = UDim2.fromScale(12, 1.6)
		gui.StudsOffset = Vector3.new(0, -(warp.r + 1.3), 0)
		gui.AlwaysOnTop = true
		gui.LightInfluence = 0
		gui.Parent = base
		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.Name = "swirlSign"
		label.Text = Lang.t("swirlSign")
		label.TextScaled = true
		label.Font = Enum.Font.FredokaOne
		label.TextColor3 = rgb(120, 70, 200)
		label.Parent = gui
		local stroke = Instance.new("UIStroke")
		stroke.Thickness = 2.5
		stroke.Color = rgb(255, 255, 255)
		stroke.Parent = label
	end

	-- A picket fence around the field.
	local wood = rgb(214, 170, 112)
	local function post(x, y)
		local p = part("FencePost", wood)
		p.Size = Vector3.new(0.6, 2, 0.6)
		p.Position = Vector3.new(x, 1, y)
		p.CastShadow = true
	end
	for x = BOUNDS.x1, BOUNDS.x2, 3.33 do
		post(x, BOUNDS.y1 - 0.5)
		post(x, BOUNDS.y2 + 0.5)
	end
	for y = BOUNDS.y1 + 3, BOUNDS.y2 - 3, 3.25 do
		post(BOUNDS.x1 - 0.5, y)
		post(BOUNDS.x2 + 0.5, y)
	end
	box("FenceRail", BOUNDS.x1 - 0.5, BOUNDS.y1 - 0.65, BOUNDS.x2 + 0.5, BOUNDS.y1 - 0.35, 1.1, 0.4, wood)
	box("FenceRail", BOUNDS.x1 - 0.5, BOUNDS.y2 + 0.35, BOUNDS.x2 + 0.5, BOUNDS.y2 + 0.65, 1.1, 0.4, wood)
	box("FenceRail", BOUNDS.x1 - 0.65, BOUNDS.y1 - 0.5, BOUNDS.x1 - 0.35, BOUNDS.y2 + 0.5, 1.1, 0.4, wood)
	box("FenceRail", BOUNDS.x2 + 0.35, BOUNDS.y1 - 0.5, BOUNDS.x2 + 0.65, BOUNDS.y2 + 0.5, 1.1, 0.4, wood)

	-- Outside the fence: bushes, rocks, wild flowers and a few trees.
	local function outside()
		while true do
			local x = rng:NextNumber(-26, w.w + 26)
			local y = rng:NextNumber(-20, w.h + 20)
			if x < BOUNDS.x1 - 2.5 or x > BOUNDS.x2 + 2.5 or y < BOUNDS.y1 - 2.5 or y > BOUNDS.y2 + 2.5 then
				return x, y
			end
		end
	end
	for _ = 1, 26 do
		local x, y = outside()
		-- A bush is a clump of three low mounds.
		for i = 1, 3 do
			local size = rng:NextNumber(2.2, 3.6)
			local bx = x + rng:NextNumber(-1.4, 1.4)
			local by = y + rng:NextNumber(-1.4, 1.4)
			local bush = blob("Bush", CFrame.new(bx, size * 0.2, by), Vector3.new(size, size * 0.6, size), if i % 2 == 0 then rgb(62, 142, 72) else rgb(76, 158, 80))
			bush.Material = Enum.Material.Grass
			bush.CastShadow = true
		end
	end
	for _ = 1, 16 do
		local x, y = outside()
		local size = rng:NextNumber(1.2, 2.6)
		blob("Rock", CFrame.new(x, size * 0.12, y) * CFrame.Angles(0, rng:NextNumber(0, 6), 0), Vector3.new(size * 1.3, size * 0.5, size), rgb(150, 152, 160)).CastShadow = true
	end
	for _ = 1, 60 do
		local x, y = outside()
		local petals = ({ rgb(255, 255, 255), rgb(255, 170, 200), rgb(255, 224, 110), rgb(190, 170, 255) })[rng:NextInteger(1, 4)]
		blob("WildFlower", CFrame.new(x, 0.25, y), Vector3.new(0.9, 0.3, 0.9), petals)
		blob("WildFlower", CFrame.new(x, 0.35, y), Vector3.new(0.38, 0.28, 0.38), rgb(255, 200, 60))
	end
	for _ = 1, 9 do
		local x, y = outside()
		if x < BOUNDS.x1 - 6 or x > BOUNDS.x2 + 6 or y < BOUNDS.y1 - 6 or y > BOUNDS.y2 + 6 then
			local trunk = part("Trunk", rgb(140, 98, 62))
			trunk.Shape = Enum.PartType.Cylinder
			trunk.Size = Vector3.new(3, 1.6, 1.6)
			trunk.CFrame = CFrame.new(x, 1.5, y) * CFrame.Angles(0, 0, math.rad(90))
			local crown = blob("Crown", CFrame.new(x, 4.2, y), Vector3.new(7.5, 5, 7.5), rgb(64, 146, 76))
			crown.Material = Enum.Material.Grass
			crown.CastShadow = true
			blob("Crown", CFrame.new(x + 0.8, 6, y - 0.6), Vector3.new(5, 3.6, 5), rgb(88, 170, 88)).Material = Enum.Material.Grass
		end
	end

	folder:SetAttribute("WorldW", w.w)
	folder:SetAttribute("WorldH", w.h)
	folder:SetAttribute("HomeX1", HOME.x1)
	folder:SetAttribute("HomeX2", HOME.x2)
	folder:SetAttribute("FlowerX", FLOWER.x)
	folder:SetAttribute("FlowerY", FLOWER.y)
	folder:SetAttribute("GatherR", FLOWER.gatherR)
	folder.Parent = workspace
	return folder
end

-- The signs on the meadow were written by the server; the client writes them
-- again in its player's language.
function Map.label(folder: Instance)
	local Lang = require(game:GetService("ReplicatedStorage"):WaitForChild("Lang"))
	for _, item in folder:GetDescendants() do
		if item:IsA("TextLabel") and (item.Name == "homeSign" or item.Name == "homeHint" or item.Name == "swirlSign") then
			item.Text = Lang.t(item.Name)
		end
	end
end

return Map

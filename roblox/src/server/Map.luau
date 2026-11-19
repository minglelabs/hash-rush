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

-- Builds the map as anchored parts under Workspace.HashRushMap. The folder's
-- attributes tell the client where things are.
function Map.render()
	local folder = Instance.new("Folder")
	folder.Name = "HashRushMap"

	local function part(name, color, material)
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
		p.Parent = folder
		return p
	end
	-- A box over the sim rectangle (x1, y1)-(x2, y2), standing on `base`.
	local function box(name, x1, y1, x2, y2, base, height, color, material)
		local p = part(name, color, material)
		p.Size = Vector3.new(x2 - x1, height, y2 - y1)
		p.Position = Vector3.new((x1 + x2) / 2, base + height / 2, (y1 + y2) / 2)
		return p
	end
	local function disc(name, x, y, r, base, height, color, material)
		local p = part(name, color, material)
		p.Shape = Enum.PartType.Cylinder
		p.Size = Vector3.new(height, 2 * r, 2 * r)
		p.CFrame = CFrame.new(x, base + height / 2, y) * CFrame.Angles(0, 0, math.rad(90))
		return p
	end
	local function sign(parent, text)
		local gui = Instance.new("BillboardGui")
		gui.Size = UDim2.fromScale(8, 2)
		gui.AlwaysOnTop = true
		gui.Parent = parent
		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 1)
		label.BackgroundTransparency = 1
		label.Text = text
		label.TextScaled = true
		label.Font = Enum.Font.GothamBold
		label.TextColor3 = Color3.new(1, 1, 1)
		label.TextStrokeTransparency = 0.3
		label.Parent = gui
	end

	local w = Map.world
	box("Ground", -300, -300, w.w + 300, w.h + 300, -1, 1, Color3.fromRGB(47, 122, 61))
	box("Field", BOUNDS.x1, BOUNDS.y1, BOUNDS.x2, BOUNDS.y2, 0, 0.1, Color3.fromRGB(147, 211, 111))
	box("LaneFloor", HEDGE_X1, BOUNDS.y1, HEDGE_X1 + COLS * CELL, BOUNDS.y2, 0.1, 0.05, Color3.fromRGB(236, 220, 174))
	-- The client stretches these two as the home edge moves in overtime.
	box("Home", HOME.x1, HOME.y1, HOME.x2, HOME.y2, 0.15, 0.1, Color3.fromRGB(246, 230, 194), Enum.Material.Sand)
	box("HomeEdge", HOME.x2 - 0.15, HOME.y1, HOME.x2 + 0.15, HOME.y2, 0.25, 1.6, Color3.fromRGB(226, 150, 70)).Transparency = 0.35
	for _, n in Map.bigNests do
		disc("Nest", n.x, n.y, 1.9, 0.25, 0.05, Color3.fromRGB(214, 190, 140))
	end
	for _, n in Map.nests do
		disc("Nest", n.x, n.y, 1.9, 0.25, 0.05, Color3.fromRGB(214, 190, 140))
	end

	-- A hedge is a rounded rectangle: two crossing boxes and a disc in each corner.
	local c = Map.corner
	local hedge = Color3.fromRGB(60, 148, 73)
	local corners = {}
	for _, r in Map.rects do
		if r.w > 2 * c then
			box("Hedge", r.x + c, r.y, r.x + r.w - c, r.y + r.h, 0.1, 1.5, hedge, Enum.Material.Grass)
		end
		if r.h > 2 * c then
			box("Hedge", r.x, r.y + c, r.x + r.w, r.y + r.h - c, 0.1, 1.5, hedge, Enum.Material.Grass)
		end
		for _, x in { r.x + c, r.x + r.w - c } do
			for _, y in { r.y + c, r.y + r.h - c } do
				local key = x .. "," .. y
				if not corners[key] then
					corners[key] = true
					disc("Hedge", x, y, c, 0.1, 1.5, hedge, Enum.Material.Grass)
				end
			end
		end
	end

	local ring = disc("GatherRing", FLOWER.x, FLOWER.y, FLOWER.gatherR, 0.15, 0.05, Color3.fromRGB(255, 244, 170))
	ring.Transparency = 0.45
	local flower = disc("Flower", FLOWER.x, FLOWER.y, FLOWER.r, 0.1, 1.4, Color3.fromRGB(255, 200, 40))
	disc("FlowerHeart", FLOWER.x, FLOWER.y, FLOWER.r * 0.55, 0.1, 1.5, Color3.fromRGB(110, 70, 40))
	sign(flower, "🌻")
	for _, warp in Map.warps do
		sign(disc("Warp", warp.x, warp.y, warp.r, 0.15, 0.05, Color3.fromRGB(90, 62, 44)), "🏠 굴")
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

return Map

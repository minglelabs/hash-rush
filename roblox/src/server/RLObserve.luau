-- What the trained policy sees of a round: 230 numbers for one hamster. Ported
-- from the web game's src/ai/observe.js for the one kind of round Roblox has:
-- the meadow, everyone for themselves, no trouble on the map. The numbers have to
-- be the ones the policy learned from, so what a meadow free-for-all leaves at
-- zero in the web game is left at zero here, in the same places.
-- Most of it is a share of something (of the map's width, of full speed), which
-- is the same in studs as in pixels. The walking distances are not: the policy
-- learned them on the web game's 8 pixel grid, so that part works in pixels.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Sim = require(ReplicatedStorage:WaitForChild("Sim"))

local RLObserve = {}

-- How stale the other hamsters are, in ticks: 0.15 s, as a quick person's eye.
local REACTION_TICKS = 9
local MAX_P = 8
local OBS = 230
RLObserve.OBS = OBS

-- Where each part starts, counted from 1: me, the round, the three ways to walk,
-- the walls around me, then (after the map's trouble and gates, which the meadow
-- has none of) everyone else, whom I am after, and pickpocketing. The parts for
-- teams are skipped: nobody has a team.
local ROUND = 20
local MEADOW = 31
local NAV = 38
local RAYS = 47
local OTHERS = 109
local OTHER = 13
local MARK = 200
local PICK = 220

-- The moves a policy picks from: standing still, then eight directions.
local DIRS = { { 0, 0 } }
for k = 0, 7 do
	table.insert(DIRS, { math.cos(k * math.pi / 4), math.sin(k * math.pi / 4) })
end
RLObserve.DIRS = DIRS

-- The length of (x, y) the way the web game's Math.hypot works it out, to the
-- last bit: which of two hamsters is the nearer can hang on that bit.
local function hypot(x, y)
	x = math.abs(x)
	y = math.abs(y)
	local max = math.max(x, y)
	if max == 0 then
		return 0
	end
	local a = x / max
	local b = y / max
	return math.sqrt(a * a + b * b) * max
end

-- The map as a policy knows it ----------------------------------------------

local PX = 10 -- web pixels to a stud
local CELL = 8
local RAY = 120
local INF = math.huge

-- A map length in pixels. They are whole numbers there; this keeps them so.
local function px(studs)
	return math.round(studs * PX * 1000) / 1000
end

-- Hamsters start on their nests and come back to them, and there two can be
-- exactly as far from a third. Which one the policy then sees first was settled
-- in training by the last bit of the web game's nests, so a hamster sitting on
-- its nest is put on the web game's, to the bit: these are Map.nests and
-- Map.bigNests in pixels as the web game has them.
local WEB_NESTS = {
	{ 69.098300562505258, 221.22147477075268 },
	{ 52.185239926619431, 259.20883091822407 },
	{ 52.185239926619431, 300.79116908177593 },
	{ 69.098300562505258, 338.77852522924729 },
}
local WEB_BIG_NESTS = {
	{ 119.15791961552497, 165.80681779467488 },
	{ 84.978407778635074, 188.36851602127172 },
	{ 59.925558517907746, 220.76641719087519 },
	{ 46.688675759559814, 259.52276107310780 },
	{ 46.688675759559814, 300.47723892689220 },
	{ 59.925558517907746, 339.23358280912487 },
	{ 84.978407778635074, 371.63148397872828 },
	{ 119.15791961552497, 394.19318220532512 },
}

local fieldsOf = setmetatable({}, { __mode = "k" })

-- Walking distance to the flower, to home and to the nearest tunnel from every
-- 8 pixel cell of the map, worked out once. A policy is told which way is downhill.
local function fields(map)
	local F = fieldsOf[map]
	if F then
		return F
	end
	local cols = math.ceil(px(map.world.w) / CELL)
	local rows = math.ceil(px(map.world.h) / CELL)
	local corner = px(map.corner)
	local flower = map.flower
	local fx, fy = px(flower.x), px(flower.y)
	local pad = px(Config.HAMSTER_R) * 0.8
	local cores = {}
	for _, r in map.rects do
		table.insert(cores, { px(r.x) + corner, px(r.y) + corner, px(r.x + r.w) - corner, px(r.y + r.h) - corner })
	end
	local function isFree(x, y)
		for _, c in cores do
			if hypot(x - math.clamp(x, c[1], c[3]), y - math.clamp(y, c[2], c[4])) < corner + pad then
				return false
			end
		end
		return hypot(x - fx, y - fy) >= px(flower.r) + pad
	end

	-- Cells are counted from 0, row after row.
	local free = table.create(cols * rows, false)
	for r = 0, rows - 1 do
		for c = 0, cols - 1 do
			free[r * cols + c + 1] = isFree((c + 0.5) * CELL, (r + 0.5) * CELL)
		end
	end

	-- Distances are 32-bit floats, as in the web game: the sweeps below stop on
	-- differences that small, so it shows in where they stop.
	local function flood(isSource)
		local dist = buffer.create(cols * rows * 4)
		local frontier = {}
		for i = 0, cols * rows - 1 do
			local source = free[i + 1] and isSource((i % cols + 0.5) * CELL, (i // cols + 0.5) * CELL)
			buffer.writef32(dist, i * 4, if source then 0 else INF)
			if source then
				table.insert(frontier, i)
			end
		end
		-- The steps cost 1 or 1.41, so a few relaxation sweeps settle it.
		while #frontier > 0 do
			local nextUp = {}
			for _, i in frontier do
				local c = i % cols
				local r = i // cols
				for dr = -1, 1 do
					for dc = -1, 1 do
						local nc = c + dc
						local nr = r + dr
						local j = nr * cols + nc
						local diagonal = dr ~= 0 and dc ~= 0
						if
							(dr ~= 0 or dc ~= 0)
							and nc >= 0
							and nr >= 0
							and nc < cols
							and nr < rows
							and free[j + 1]
							-- No cutting a corner between two walls.
							and not (diagonal and not (free[r * cols + nc + 1] and free[nr * cols + c + 1]))
						then
							local d = buffer.readf32(dist, i * 4) + (if diagonal then 1.4142 else 1)
							if d < buffer.readf32(dist, j * 4) - 1e-4 then
								buffer.writef32(dist, j * 4, d)
								table.insert(nextUp, j)
							end
						end
					end
				end
			end
			frontier = nextUp
		end
		return dist
	end

	local nests = {} -- [nest] = where the web game has it
	for i, nest in map.nests do
		nests[nest] = WEB_NESTS[i]
	end
	for i, nest in map.bigNests do
		nests[nest] = WEB_BIG_NESTS[i]
	end

	local homeX = px(map.home.x2) - 12
	local gatherR = px(flower.gatherR) - 6
	F = {
		cols = cols,
		rows = rows,
		free = free,
		nests = nests,
		flower = flood(function(x, y)
			return hypot(x - fx, y - fy) < gatherR
		end),
		home = flood(function(x)
			return x < homeX
		end),
		warp = flood(function(x, y)
			for _, w in map.warps do
				if hypot(x - px(w.x), y - px(w.y)) < px(w.r) - 4 then
					return true
				end
			end
			return false
		end),
	}
	fieldsOf[map] = F
	return F
end
RLObserve.fields = fields

-- Where a hamster is, in the web game's pixels.
local function place(F, p)
	local nest = p.nest
	if p.x == nest.x and p.y == nest.y and F.nests[nest] then
		return F.nests[nest][1], F.nests[nest][2]
	end
	return p.x * PX, p.y * PX
end

-- The cell under a spot given in pixels, or -1.
local function cellOf(F, x, y)
	local c = math.clamp(x // CELL, 0, F.cols - 1)
	local r = math.clamp(y // CELL, 0, F.rows - 1)
	if F.free[r * F.cols + c + 1] then
		return r * F.cols + c
	end
	-- Pressed against a wall: use the nearest walkable cell.
	local best = -1
	local bestD = INF
	for dr = -2, 2 do
		for dc = -2, 2 do
			local nc = c + dc
			local nr = r + dr
			if nc >= 0 and nr >= 0 and nc < F.cols and nr < F.rows and F.free[nr * F.cols + nc + 1] and dr * dr + dc * dc < bestD then
				bestD = dr * dr + dc * dc
				best = nr * F.cols + nc
			end
		end
	end
	return best
end

-- How far the walk is from a spot in pixels, as a share of 1000 pixels.
local function fieldAt(F, dist, x, y)
	local i = cellOf(F, x, y)
	local d = if i < 0 then INF else buffer.readf32(dist, i * 4)
	return if d == INF then 1 else math.min(1, d * CELL / 1000)
end

-- Which way to walk to get nearer `dist`'s target, and how far it is.
local function hint(F, dist, x, y, out, at)
	out[at] = 0
	out[at + 1] = 0
	out[at + 2] = 1
	local i = cellOf(F, x, y)
	local here = if i < 0 then INF else buffer.readf32(dist, i * 4)
	if here == INF then
		return
	end
	local c = i % F.cols
	local r = i // F.cols
	local best = here
	local bx = 0
	local by = 0
	for dr = -1, 1 do
		for dc = -1, 1 do
			local nc = c + dc
			local nr = r + dr
			if (dr ~= 0 or dc ~= 0) and nc >= 0 and nr >= 0 and nc < F.cols and nr < F.rows then
				local d = buffer.readf32(dist, (nr * F.cols + nc) * 4)
				if d < best then
					best = d
					bx = dc
					by = dr
				end
			end
		end
	end
	local len = hypot(bx, by)
	if len == 0 then
		len = 1
	end
	out[at] = bx / len
	out[at + 1] = by / len
	out[at + 2] = math.min(1, here * CELL / 1000)
end

-- The others, seen late ------------------------------------------------------

local views = setmetatable({}, { __mode = "k" })

-- The hamsters as they were REACTION_TICKS ago, shared by every learned bot in
-- the round. Call it every tick, so the late view has no gaps.
-- Returns { nibbler = id or nil, players = { what observe reads of each } }.
function RLObserve.seenLate(g)
	local F = fields(g.map)
	local v = views[g]
	if not v then
		v = { tick = -1, past = {} }
		views[g] = v
	end
	if v.tick ~= g.tick then
		-- The oldest one has been seen; its tables hold the newest.
		local now = if #v.past > REACTION_TICKS then table.remove(v.past, 1) else { players = {} }
		now.nibbler = g.nibbler
		for i, p in g.players do
			local q = now.players[i]
			if not q then
				q = {}
				now.players[i] = q
			end
			q.id = p.id
			q.x = p.x
			q.y = p.y
			q.px, q.py = place(F, p)
			q.vx = p.vx
			q.vy = p.vy
			q.carrying = p.carrying
			q.windup = p.swing ~= nil and p.swing.windup
			q.recovery = p.swing ~= nil and not p.swing.windup
			q.cooldown = p.cooldown
			q.pick = p.pick
			q.pickOn = p.pickOn
		end
		for i = #now.players, #g.players + 1, -1 do
			now.players[i] = nil
		end
		table.insert(v.past, now)
		v.tick = g.tick
	end
	return v.past[1]
end

-- The observation ------------------------------------------------------------

local others = table.create(MAX_P)
local far = table.create(MAX_P)

-- Fills out[1..OBS] with what the hamster `id` sees: itself and the map as they
-- are now, the others as they were in `past` (from seenLate). A hamster that has
-- left since is not seen any more.
function RLObserve.observe(g, past, id, out)
	for i = 1, OBS do
		out[i] = 0
	end
	local me = g.byId[id]
	if not me then
		return
	end
	local map = g.map
	local W = map.world.w
	local H = map.world.h
	local F = fields(map)
	local flower = map.flower
	local need = Config.gatherTime(#g.players, g.time)
	local steal = Config.pickTime(#g.players, g.time)
	local nibbler = past.nibbler
	if nibbler and not g.byId[nibbler] then
		nibbler = nil
	end

	-- Everyone else, nearest first, in pixels; whoever is as near as another
	-- keeps its seat's place. `prey` is the nearest of them with a seed.
	local x, y = place(F, me)
	local n = 0
	local prey = nil
	local preyD = INF
	local seeds = 0
	local robbed = 0
	for _, p in past.players do
		if p.id ~= id and g.byId[p.id] then
			local d = hypot(p.px - x, p.py - y)
			if p.carrying then
				seeds += 1
				if d < preyD then
					prey = p
					preyD = d
				end
			end
			if p.pickOn == id then
				robbed = math.max(robbed, math.min(1, p.pick / steal))
			end
			local at = n + 1
			while at > 1 and far[at - 1] > d do
				others[at] = others[at - 1]
				far[at] = far[at - 1]
				at -= 1
			end
			others[at] = p
			far[at] = d
			n += 1
		end
	end

	local swing = me.swing
	out[1] = me.x / W
	out[2] = me.y / H
	out[3] = me.vx / Config.SPEED
	out[4] = me.vy / Config.SPEED
	out[5] = me.fx
	out[6] = me.fy
	out[7] = if me.carrying then 1 else 0
	out[8] = me.cooldown / Config.BONK.cooldown
	out[9] = if swing and swing.windup then 1 else 0
	out[10] = if swing and not swing.windup then 1 else 0
	out[11] = me.charge / Config.THROW.max
	out[12] = if me.charge >= Config.THROW.charge then 1 else 0
	out[13] = me.gather / need
	out[14] = if Sim.inHome(g, me) then 1 else 0
	out[15] = if Sim.lastStretch(g, me) then 1 else 0
	-- 16 is wet fur and 19 is standing on ice.
	out[17] = (me.x - g.homeX) / W
	out[18] = hypot(me.x - flower.x, me.y - flower.y) / W

	out[ROUND] = g.time / Config.OVERTIME.finish
	out[ROUND + 1] = if g.time > Config.OVERTIME.start then 1 else 0
	out[ROUND + 2] = g.homeX / W
	out[ROUND + 3] = if g.nibbler == id then 1 else 0
	out[ROUND + 4] = if nibbler and nibbler ~= id then 1 else 0
	out[ROUND + 5] = (n + 1) / MAX_P
	-- Then whether I am in a team.
	out[ROUND + 7] = if seeds > 0 then 1 else 0
	-- Then how many teams, night and dusk, and which of the seven maps this is.
	out[MEADOW] = 1

	hint(F, F.flower, x, y, out, NAV)
	hint(F, F.home, x, y, out, NAV + 3)
	hint(F, F.warp, x, y, out, NAV + 6)

	-- How far it is to a wall in eight directions, out to 120 pixels.
	for k = 1, 8 do
		local dir = DIRS[k + 1]
		local reach = 1
		for s = CELL, RAY, CELL do
			local c = (x + dir[1] * s) // CELL
			local r = (y + dir[2] * s) // CELL
			if c < 0 or r < 0 or c >= F.cols or r >= F.rows or not F.free[r * F.cols + c + 1] then
				reach = s / RAY
				break
			end
		end
		out[RAYS + k - 1] = reach
	end

	for k = 1, n do
		local p = others[k]
		local o = OTHERS + (k - 1) * OTHER
		out[o] = 1
		out[o + 1] = (p.x - me.x) / W
		out[o + 2] = (p.y - me.y) / H
		out[o + 3] = math.min(1, far[k] / (4 * Config.BONK.reach * PX))
		out[o + 4] = p.vx / Config.SPEED
		out[o + 5] = p.vy / Config.SPEED
		out[o + 6] = if p.carrying then 1 else 0
		-- o + 7 is whether it is on my team.
		out[o + 8] = if p.windup then 1 else 0
		out[o + 9] = if p.recovery then 1 else 0
		out[o + 10] = p.cooldown / Config.BONK.cooldown
		out[o + 11] = if Sim.inHome(g, p) then 1 else 0
		out[o + 12] = (p.x - g.homeX) / W
	end

	-- Whom I am after. On my own that is the nearest rival with a seed; the three
	-- numbers before these say which job I have in a team, and the fourth whether
	-- a teammate has a seed.
	out[MARK + 4] = seeds / 4
	if prey then
		out[MARK + 5] = 1
		out[MARK + 6] = (prey.x - me.x) / W
		out[MARK + 7] = (prey.y - me.y) / H
		out[MARK + 8] = fieldAt(F, F.home, prey.px, prey.py)
		out[MARK + 9] = math.min(1, preyD / 1000)
	end

	-- Pickpocketing: how far I am into taking a seed, how long until I may try
	-- again after losing mine, how far a rival is into taking mine, and where the
	-- nearest rival with a seed is.
	out[PICK] = math.min(1, me.pick / steal)
	out[PICK + 1] = me.pickBlock / Config.PICK.block
	out[PICK + 2] = robbed
	if prey then
		out[PICK + 3] = (prey.x - me.x) / W
		out[PICK + 4] = (prey.y - me.y) / H
		out[PICK + 5] = math.min(1, preyD / (8 * Config.PICK.reach * PX))
	end
end

return RLObserve

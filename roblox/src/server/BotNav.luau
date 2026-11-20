-- Path finding for the bots, over a graph of waypoints: every bend, junction and
-- lane mouth of the maze, and the spots round the flower. Ported from the web
-- game's src/ai/nav.js, with the map helpers it needs (src/sim/map.js).

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Config"))

local R = Config.HAMSTER_R
-- One web pixel in studs. The bots were tuned in pixels; their distances are
-- written here as `pixels * PX`, so they follow Config and stay easy to compare.
local PX = R / 15
-- How far a walked line keeps from the hedges.
local PAD = R * 0.7
local BLOCK_COST = 900 * PX

local Nav = {}
Nav.PX = PX

local function hypot(x, y)
	return math.sqrt(x * x + y * y)
end

local function distToSegment(px, py, ax, ay, bx, by)
	local dx = bx - ax
	local dy = by - ay
	local len2 = dx * dx + dy * dy
	local t = if len2 > 1e-9 then math.clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) else 0
	return hypot(px - (ax + dx * t), py - (ay + dy * t))
end
Nav.distToSegment = distToSegment

local function segmentHitsRect(ax, ay, bx, by, x1, y1, x2, y2)
	local t0 = 0
	local t1 = 1
	local dx = bx - ax
	local dy = by - ay
	if math.abs(dx) < 1e-9 then
		if ax < x1 or ax > x2 then
			return false
		end
	else
		local ta = (x1 - ax) / dx
		local tb = (x2 - ax) / dx
		t0 = math.max(t0, math.min(ta, tb))
		t1 = math.min(t1, math.max(ta, tb))
		if t0 > t1 then
			return false
		end
	end
	if math.abs(dy) < 1e-9 then
		if ay < y1 or ay > y2 then
			return false
		end
	else
		local ta = (y1 - ay) / dy
		local tb = (y2 - ay) / dy
		t0 = math.max(t0, math.min(ta, tb))
		t1 = math.min(t1, math.max(ta, tb))
		if t0 > t1 then
			return false
		end
	end
	return true
end

local function pointRectDistance(px, py, x1, y1, x2, y2)
	return hypot(px - math.clamp(px, x1, x2), py - math.clamp(py, y1, y2))
end

local function segmentRectDistance(ax, ay, bx, by, x1, y1, x2, y2)
	if segmentHitsRect(ax, ay, bx, by, x1, y1, x2, y2) then
		return 0
	end
	return math.min(
		pointRectDistance(ax, ay, x1, y1, x2, y2),
		pointRectDistance(bx, by, x1, y1, x2, y2),
		distToSegment(x1, y1, ax, ay, bx, by),
		distToSegment(x2, y1, ax, ay, bx, by),
		distToSegment(x1, y2, ax, ay, bx, by),
		distToSegment(x2, y2, ax, ay, bx, by)
	)
end

-- Extra path cost for a leg that someone is standing in. A lane is one hamster
-- wide, so whoever is in it cannot be passed and the path should go around.
-- Someone walking the same way ahead is barely an obstacle. `units` are the
-- hamsters inside the lanes (see `inLanes`).
function Nav.blockCost(units, p, q)
	local c = 0
	for _, u in units do
		if distToSegment(u.x, u.y, p.x, p.y, q.x, q.y) <= 2 * R then
			local lx = q.x - p.x
			local ly = q.y - p.y
			local len = hypot(lx, ly)
			local along = (u.vx * lx + u.vy * ly) / (if len > 0 then len else 1)
			c += if along > 0.6 * Config.SPEED then BLOCK_COST * 0.15 else BLOCK_COST
		end
	end
	return c
end

local function create(map)
	local corner = map.corner
	local flower = map.flower
	local bounds = map.bounds

	-- The hard middle of every hedge: a hedge is this, grown by the corner radius.
	local cores = {}
	-- The grid the hedges were cut from is not in the map data, but the hedges
	-- give it away: every one is a whole number of cells, one cell thick.
	local cell = math.huge
	local hedgeX1 = math.huge
	local hedgeX2 = -math.huge
	for _, r in map.rects do
		table.insert(cores, { x1 = r.x + corner, y1 = r.y + corner, x2 = r.x + r.w - corner, y2 = r.y + r.h - corner })
		cell = math.min(cell, r.w, r.h)
		hedgeX1 = math.min(hedgeX1, r.x)
		hedgeX2 = math.max(hedgeX2, r.x + r.w)
	end
	local cols = math.round((hedgeX2 - hedgeX1) / cell)
	local rows = math.round((bounds.y2 - bounds.y1) / cell)
	local wall = {}
	for r = 0, rows - 1 do
		wall[r] = {}
	end
	for _, rect in map.rects do
		local c1 = math.round((rect.x - hedgeX1) / cell)
		local r1 = math.round((rect.y - bounds.y1) / cell)
		for r = r1, r1 + math.round(rect.h / cell) - 1 do
			for c = c1, c1 + math.round(rect.w / cell) - 1 do
				wall[r][c] = true
			end
		end
	end
	local function isOpen(c, r)
		return r >= 0 and r < rows and c >= 0 and c < cols and not wall[r][c]
	end
	local function cellX(c)
		return hedgeX1 + (c + 0.5) * cell
	end
	local function cellY(r)
		return bounds.y1 + (r + 0.5) * cell
	end

	-- The hedges round each cell of the grid. A line is nearly always stopped by a
	-- hedge next to one of its ends, so those are looked at first.
	local around = {}
	for r = 0, rows - 1 do
		for c = 0, cols - 1 do
			local list = {}
			local x1 = hedgeX1 + (c - 1) * cell
			local y1 = bounds.y1 + (r - 1) * cell
			for i, rect in map.rects do
				if rect.x < x1 + 3 * cell and rect.x + rect.w > x1 and rect.y < y1 + 3 * cell and rect.y + rect.h > y1 then
					table.insert(list, cores[i])
				end
			end
			around[r * cols + c] = list
		end
	end
	local function hedgesAround(x, y)
		local c = (x - hedgeX1) // cell
		local r = (y - bounds.y1) // cell
		return if c >= 0 and c < cols and r >= 0 and r < rows then around[r * cols + c] else nil
	end

	-- Which of map.rects a hamster at (x, y) could touch within a step of the
	-- game, as their places in that list: on a finer grid, the hedges within a
	-- hamster and a bit of each square. The grid reaches a cell past the hedges.
	local FINE = cell / 4
	local fineCols = (cols + 2) * 4
	local fineRows = rows * 4
	local fineX1 = hedgeX1 - cell
	local touching = {}
	for j = 0, fineRows - 1 do
		for i = 0, fineCols - 1 do
			local ids = {}
			local x1 = fineX1 + i * FINE
			local y1 = bounds.y1 + j * FINE
			for k, core in cores do
				local dx = math.max(0, core.x1 - (x1 + FINE), x1 - core.x2)
				local dy = math.max(0, core.y1 - (y1 + FINE), y1 - core.y2)
				if hypot(dx, dy) < corner + R + 10 * PX then
					table.insert(ids, k)
				end
			end
			touching[j * fineCols + i] = ids
		end
	end
	local function hedgesNear(x, y)
		local i = (x - fineX1) // FINE
		local j = (y - bounds.y1) // FINE
		return if i >= 0 and i < fineCols and j >= 0 and j < fineRows then touching[j * fineCols + i] else nil
	end

	local function blockedBy(list, ax, ay, bx, by, m)
		local lx = math.min(ax, bx) - m
		local hx = math.max(ax, bx) + m
		local ly = math.min(ay, by) - m
		local hy = math.max(ay, by) + m
		for _, r in list do
			-- Boxes apart by the margin on either axis cannot be nearer than it, nor
			-- can a line that misses the hedge's box grown by the margin.
			if r.x1 < hx and r.x2 > lx and r.y1 < hy and r.y2 > ly and segmentHitsRect(ax, ay, bx, by, r.x1 - m, r.y1 - m, r.x2 + m, r.y2 + m) then
				if segmentRectDistance(ax, ay, bx, by, r.x1, r.y1, r.x2, r.y2) < m then
					return true
				end
			end
		end
		return false
	end

	-- True when a straight line from a to b stays `pad` away from every obstacle.
	local function segmentClear(ax, ay, bx, by, pad)
		local m = corner + pad
		local nearA = hedgesAround(ax, ay)
		if nearA and blockedBy(nearA, ax, ay, bx, by, m) then
			return false
		end
		local nearB = hedgesAround(bx, by)
		if nearB and blockedBy(nearB, ax, ay, bx, by, m) then
			return false
		end
		if blockedBy(cores, ax, ay, bx, by, m) then
			return false
		end
		return distToSegment(flower.x, flower.y, ax, ay, bx, by) >= flower.r + pad
	end

	-- True when a circle of radius `pad` at (x, y) touches no obstacle.
	local function isFree(x, y, pad)
		for _, r in cores do
			if pointRectDistance(x, y, r.x1, r.y1, r.x2, r.y2) < corner + pad then
				return false
			end
		end
		return hypot(x - flower.x, y - flower.y) >= flower.r + pad
	end

	local gatherSpots = {}
	for i = 0, 7 do
		local a = i / 8 * math.pi * 2
		table.insert(gatherSpots, { x = flower.x + math.cos(a) * 55 * PX, y = flower.y + math.sin(a) * 55 * PX })
	end

	-- Waypoints, in the web game's order, so that equally short paths are told
	-- apart the same way there and here.
	local nodes = {}
	local rowYs = {}
	for r = 0, rows - 1 do
		table.insert(rowYs, cellY(r))
		for c = 0, cols - 1 do
			if isOpen(c, r) then
				local w = isOpen(c - 1, r) or c == 0
				local e = isOpen(c + 1, r) or c == cols - 1
				local n = isOpen(c, r - 1)
				local s = isOpen(c, r + 1)
				local straight = (w and e and not n and not s) or (n and s and not w and not e)
				if not straight then
					table.insert(nodes, { x = cellX(c), y = cellY(r) })
				end
			end
		end
	end
	-- Rows where a lane opens on the home side: a point in front of it and one
	-- inside home.
	for r = 0, rows - 1 do
		if isOpen(0, r) then
			table.insert(nodes, { x = hedgeX1 - 30 * PX, y = cellY(r) })
			table.insert(nodes, { x = 80 * PX, y = cellY(r) })
		end
	end
	for r = 0, rows - 1 do
		if isOpen(cols - 1, r) then
			table.insert(nodes, { x = hedgeX2 + 40 * PX, y = cellY(r) })
		end
	end
	for _, spot in gatherSpots do
		table.insert(nodes, spot)
	end
	local n = #nodes

	local function clear(a, b)
		return segmentClear(a.x, a.y, b.x, b.y, PAD)
	end
	local function len(a, b)
		return hypot(a.x - b.x, a.y - b.y)
	end

	-- Which waypoints see each other, and the walking distance between every two.
	local adj = {}
	local D = {}
	for i = 1, n do
		adj[i] = {}
		D[i] = table.create(n, math.huge)
		D[i][i] = 0
	end
	for i = 1, n do
		for j = i + 1, n do
			if clear(nodes[i], nodes[j]) then
				local d = len(nodes[i], nodes[j])
				table.insert(adj[i], j)
				table.insert(adj[j], i)
				D[i][j] = d
				D[j][i] = d
			end
		end
	end
	for k = 1, n do
		local Dk = D[k]
		for i = 1, n do
			local Di = D[i]
			local ik = Di[k]
			for j = 1, n do
				if ik + Dk[j] < Di[j] then
					Di[j] = ik + Dk[j]
				end
			end
		end
	end

	-- The waypoints in plain view of a point, and how far each is. Kept per point
	-- (a hamster, a nest, a door...) for as long as it stays where it was: the same
	-- few points are asked about over and over, and looking is the costly part.
	local views = setmetatable({}, { __mode = "k" })
	local function view(p)
		local px, py = p.x, p.y
		local v = views[p]
		if v then
			if v.x == px and v.y == py then
				return v
			end
		else
			v = { x = 0, y = 0, n = 0, node = {}, leg = {} }
			views[p] = v
		end
		v.x = px
		v.y = py
		local count = 0
		for i = 1, n do
			local node = nodes[i]
			if segmentClear(px, py, node.x, node.y, PAD) then
				count += 1
				v.node[count] = i
				v.leg[count] = hypot(px - node.x, py - node.y)
			end
		end
		v.n = count
		return v
	end

	-- Walking distance between two points, ignoring everyone else.
	local function distance(a, b)
		if clear(a, b) then
			return len(a, b)
		end
		local va = view(a)
		local vb = view(b)
		local best = math.huge
		for i = 1, va.n do
			local row = D[va.node[i]]
			local da = va.leg[i]
			for j = 1, vb.n do
				local d = da + row[vb.node[j]] + vb.leg[j]
				if d < best then
					best = d
				end
			end
		end
		return best
	end

	local S = n + 1
	local G = n + 2
	local dist = table.create(n + 2, 0)
	local prev = table.create(n + 2, 0)
	local done = table.create(n + 2, false)
	local toGoal = table.create(n, false)

	local function relax(u, v, pu, pv, extra)
		local d = dist[u] + len(pu, pv) + (if extra then extra(pu, pv) else 0)
		if d < dist[v] then
			dist[v] = d
			prev[v] = u
		end
	end

	-- Shortest path from a to b, as a list of points ending in b, and its cost.
	-- `extra(p, q)` can add a cost to a leg, which is how bots steer around lanes
	-- that have a rival in them.
	local function findPath(a, b, extra)
		for i = 1, n + 2 do
			dist[i] = math.huge
			prev[i] = 0
			done[i] = false
		end
		for i = 1, n do
			toGoal[i] = false
		end
		local vb = view(b)
		for j = 1, vb.n do
			toGoal[vb.node[j]] = true
		end
		local va = view(a)
		local direct = clear(a, b)
		dist[S] = 0

		while true do
			local u = 0
			for i = 1, n + 2 do
				if not done[i] and (u == 0 or dist[i] < dist[u]) then
					u = i
				end
			end
			if u == 0 or dist[u] == math.huge or u == G then
				break
			end
			done[u] = true
			if u == S then
				for i = 1, va.n do
					relax(S, va.node[i], a, nodes[va.node[i]], extra)
				end
				if direct then
					relax(S, G, a, b, extra)
				end
			else
				local pu = nodes[u]
				for _, v in adj[u] do
					if not done[v] then
						relax(u, v, pu, nodes[v], extra)
					end
				end
				if toGoal[u] then
					relax(u, G, pu, b, extra)
				end
			end
		end

		if dist[G] == math.huge then
			return { b }, math.huge
		end
		local points = { b }
		local i = prev[G]
		while i ~= S do
			table.insert(points, 1, nodes[i])
			i = prev[i]
		end
		return points, dist[G]
	end

	-- The same search from one point to many: `from` works out the way to every
	-- waypoint once, then `costTo` and `pathTo` answer for any end point, with the
	-- answers `findPath` would give. They speak of the last `from`.
	local treeDist = table.create(n, 0)
	local treePrev = table.create(n, 0)
	local treeRank = table.create(n, 0)
	local treeA = nil
	local treeExtra = nil

	local function from(a, extra)
		treeA = a
		treeExtra = extra
		for i = 1, n do
			dist[i] = math.huge
			done[i] = false
		end
		local va = view(a)
		for i = 1, va.n do
			local v = va.node[i]
			dist[v] = va.leg[i] + (if extra then extra(a, nodes[v]) else 0)
			prev[v] = S
		end
		local rank = 0
		while true do
			local u = 0
			for i = 1, n do
				if not done[i] and (u == 0 or dist[i] < dist[u]) then
					u = i
				end
			end
			if u == 0 or dist[u] == math.huge then
				break
			end
			done[u] = true
			rank += 1
			treeRank[u] = rank
			local pu = nodes[u]
			for _, v in adj[u] do
				if not done[v] then
					relax(u, v, pu, nodes[v], extra)
				end
			end
		end
		for i = 1, n do
			treeDist[i] = dist[i]
			treePrev[i] = prev[i]
		end
	end

	-- The cost of the way to b, and the waypoint it comes in by.
	local function costTo(b)
		local a = treeA
		local extra = treeExtra
		local best = math.huge
		local via = 0
		if clear(a, b) then
			best = len(a, b) + (if extra then extra(a, b) else 0)
			via = S
		end
		local vb = view(b)
		for j = 1, vb.n do
			local u = vb.node[j]
			if treeDist[u] < math.huge then
				local d = treeDist[u] + vb.leg[j] + (if extra then extra(nodes[u], b) else 0)
				-- Of two equally short ways, the one found first.
				if d < best or (d == best and via ~= S and treeRank[u] < treeRank[via]) then
					best = d
					via = u
				end
			end
		end
		return best, via
	end

	local function pathTo(b, via)
		local points = { b }
		while via ~= S and via ~= 0 do
			table.insert(points, 1, nodes[via])
			via = treePrev[via]
		end
		return points
	end

	-- The furthest point of a path that can be walked to in a straight line.
	local function nextTarget(from, points)
		for i = #points, 2, -1 do
			if clear(from, points[i]) then
				return points[i]
			end
		end
		return points[1]
	end

	-- Spots just inside home that a seed carrier can aim for, one per open row.
	-- Home's edge moves in overtime; the spots move with it.
	local rowEntries = {}
	for i, y in rowYs do
		rowEntries[i] = { x = 0, y = y }
	end
	local entries = {}
	local entriesAt = nil
	local function entriesFor(homeX)
		if homeX ~= entriesAt then
			entriesAt = homeX
			table.clear(entries)
			for _, e in rowEntries do
				e.x = homeX - 14 * PX
				if isFree(e.x, e.y, R) then
					table.insert(entries, e)
				end
			end
		end
		return entries
	end

	return {
		gatherSpots = gatherSpots,
		clear = clear,
		-- A line of sight, as the game's bonks and throws need one.
		sight = function(a, b)
			return segmentClear(a.x, a.y, b.x, b.y, 0)
		end,
		-- Anyone standing between the two ends of the hedge is inside a lane.
		inLanes = function(u)
			return u.x > hedgeX1 - R and u.x < hedgeX2 + R
		end,
		hedgesNear = hedgesNear,
		distance = distance,
		findPath = findPath,
		from = from,
		costTo = costTo,
		pathTo = pathTo,
		nextTarget = nextTarget,
		entries = entriesFor,
	}
end

local cache = setmetatable({}, { __mode = "k" })

function Nav.get(map)
	local nav = cache[map]
	if not nav then
		nav = create(map)
		cache[map] = nav
	end
	return nav
end

return Nav

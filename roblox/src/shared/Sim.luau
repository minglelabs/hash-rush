-- The game itself, as plain logic: no Instances, no remotes, no clock. Every tick
-- it takes one input per player and advances the world by Config.DT.
--   input = { mx, my, bonk, throw }   move vector and the two buttons, held or not
-- Ported from the web game's src/sim/game.js (meadow, free-for-all).

local Config = require(script.Parent:WaitForChild("Config"))

local DT = Config.DT
local R = Config.HAMSTER_R
local BONK = Config.BONK
local THROW = Config.THROW
local OVERTIME = Config.OVERTIME
local PICK = Config.PICK

local Sim = {}

local EMPTY_INPUT = table.freeze({ mx = 0, my = 0, bonk = false, throw = false })

local function hypot(x, y)
	return math.sqrt(x * x + y * y)
end

-- Collision ---------------------------------------------------------------

-- Hedges collide as rounded rectangles: a core rect grown by the corner radius.
local function pushOutHedge(p, rect, corner)
	local cx = math.clamp(p.x, rect.x + corner, rect.x + rect.w - corner)
	local cy = math.clamp(p.y, rect.y + corner, rect.y + rect.h - corner)
	local dx = p.x - cx
	local dy = p.y - cy
	local min = R + corner
	local d2 = dx * dx + dy * dy
	if d2 >= min * min then
		return
	end
	if d2 > 1e-9 then
		local d = math.sqrt(d2)
		p.x = cx + dx / d * min
		p.y = cy + dy / d * min
		return
	end
	-- Centre is inside the core: leave through the nearest side.
	local left = p.x - rect.x
	local right = rect.x + rect.w - p.x
	local top = p.y - rect.y
	local bottom = rect.y + rect.h - p.y
	local m = math.min(left, right, top, bottom)
	if m == left then
		p.x = rect.x - R
	elseif m == right then
		p.x = rect.x + rect.w + R
	elseif m == top then
		p.y = rect.y - R
	else
		p.y = rect.y + rect.h + R
	end
end

local function pushOutFlower(p, f)
	local dx = p.x - f.x
	local dy = p.y - f.y
	local min = R + f.r
	local d2 = dx * dx + dy * dy
	if d2 >= min * min then
		return
	end
	local d = math.sqrt(d2)
	if d < 1e-6 then
		p.x = f.x + min
		return
	end
	p.x = f.x + dx / d * min
	p.y = f.y + dy / d * min
end

-- Walls, the flower and the map edge.
local function collide(map, p)
	local b = map.bounds
	for _ = 1, 2 do
		for _, rect in map.rects do
			pushOutHedge(p, rect, map.corner)
		end
		pushOutFlower(p, map.flower)
		p.x = math.clamp(p.x, b.x1 + R, b.x2 - R)
		p.y = math.clamp(p.y, b.y1 + R, b.y2 - R)
	end
end

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

local function distToSegment(px, py, ax, ay, bx, by)
	local dx = bx - ax
	local dy = by - ay
	local len2 = dx * dx + dy * dy
	local t = if len2 > 1e-9 then math.clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) else 0
	return hypot(px - (ax + dx * t), py - (ay + dy * t))
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

-- A clear line from a to b: no hedge and no flower in between.
local function sight(map, a, b)
	local c = map.corner
	for _, r in map.rects do
		if segmentRectDistance(a.x, a.y, b.x, b.y, r.x + c, r.y + c, r.x + r.w - c, r.y + r.h - c) < c then
			return false
		end
	end
	local f = map.flower
	return distToSegment(f.x, f.y, a.x, a.y, b.x, b.y) >= f.r
end

-- The client uses this too, to place its own hamster ahead of the server.
Sim.collide = collide

-- Rules -------------------------------------------------------------------

-- Inside home nobody can bonk or be bonked, and a carrier who gets here wins.
local function inHome(g, p)
	return p.x < g.homeX
end
Sim.inHome = inHome

-- A carrier this close to home sets the alarm off and is slowest.
local function lastStretch(g, p)
	return p.carrying and p.x - g.homeX < Config.ALARM_RANGE
end
Sim.lastStretch = lastStretch

-- Team-mates cannot bonk each other and walk straight through one another. A
-- hamster without a team (-1) is on its own side, so a round with no teams is
-- everyone against everyone.
local function allied(a, b)
	return a.team >= 0 and a.team == b.team
end
Sim.allied = allied

local function shuffle(list, rng)
	for i = #list, 2, -1 do
		local j = math.floor(rng() * i) + 1
		list[i], list[j] = list[j], list[i]
	end
end

-- slots: { { id = number, name = string, team = number? }, ... }, team 0 or 1
-- in a team round and left out otherwise. rng returns a number in [0, 1).
function Sim.new(map, slots, rng)
	rng = rng or math.random
	local nests = table.clone(if #slots > #map.nests then map.bigNests else map.nests)
	shuffle(nests, rng)
	local players = {}
	local byId = {}
	for i, slot in slots do
		local p = {
			id = slot.id,
			name = slot.name,
			team = slot.team or -1,
			nest = nests[i],
			x = nests[i].x,
			y = nests[i].y,
			vx = 0,
			vy = 0,
			fx = 1,
			fy = 0,
			carrying = false,
			gather = 0,
			queued = -1,
			swing = nil, -- { windup = boolean, t, dx, dy }
			cooldown = 0,
			bonkHeld = false,
			charge = 0,
			dazed = 0,
			-- Pickpocketing: progress on the carrier `pickOn` (-1 for nobody), and how
			-- long until this one may try again after having its own seed taken.
			pick = 0,
			pickOn = -1,
			pickBlock = 0,
			steals = 0,
			chain = 0,
			chainUntil = 0,
			kills = 0,
			throws = 0,
			deaths = 0,
			seeds = 0,
		}
		players[i] = p
		byId[p.id] = p
	end
	return {
		map = map,
		tick = 0,
		time = 0,
		phase = "countdown", -- "countdown" | "playing" | "over"
		countdown = Config.COUNTDOWN,
		homeX = map.home.x2,
		nibbler = nil, -- id of whoever is at the flower's head of the line
		rng = rng,
		players = players,
		byId = byId,
		winners = {}, -- ids
		timeout = false,
		events = {},
	}
end

-- A player who left takes its hamster with it.
function Sim.remove(g, id)
	local p = g.byId[id]
	if not p then
		return
	end
	g.byId[id] = nil
	table.remove(g.players, table.find(g.players, p))
	if g.nibbler == id then
		g.nibbler = nil
	end
end

local function pickAim(g, p, mx, my, moveLen)
	local bestX, bestY
	local bestD = BONK.assist
	for _, e in g.players do
		if e ~= p and not allied(p, e) and not inHome(g, e) then
			local tx = e.x + e.vx * BONK.windup - p.x
			local ty = e.y + e.vy * BONK.windup - p.y
			local d = hypot(tx, ty)
			if d < bestD and d > 1e-6 then
				bestD = d
				bestX = tx / d
				bestY = ty / d
			end
		end
	end
	if bestX then
		return bestX, bestY
	end
	if moveLen > 0.05 then
		return mx / moveLen, my / moveLen
	end
	return p.fx, p.fy
end

-- Hamsters are solid. Whoever walked into the other gives way, so standing still
-- in a lane blocks it and nobody can be shoved along.
local function separate(g)
	local players = g.players
	local min = 2 * R
	for _ = 1, 3 do
		for i = 1, #players do
			for j = i + 1, #players do
				local a = players[i]
				local b = players[j]
				local nx = b.x - a.x
				local ny = b.y - a.y
				local d = hypot(nx, ny)
				if d < min and not allied(a, b) then
					if d < 1e-6 then
						nx = 1
						ny = 0
					else
						nx /= d
						ny /= d
					end
					local pa = math.max(0, a.vx * nx + a.vy * ny)
					local pb = math.max(0, -(b.vx * nx + b.vy * ny))
					local wa = if pa + pb > 1e-6 then pa / (pa + pb) else 0.5
					local overlap = min - d
					a.x -= nx * overlap * wa
					a.y -= ny * overlap * wa
					b.x += nx * overlap * (1 - wa)
					b.y += ny * overlap * (1 - wa)
					collide(g.map, a)
					collide(g.map, b)
				end
			end
		end
	end
end

local function sendHome(p)
	p.x = p.nest.x
	p.y = p.nest.y
	p.vx = 0
	p.vy = 0
	p.carrying = false
	p.gather = 0
	p.queued = -1
	p.swing = nil
	p.cooldown = 0
	p.charge = 0
	p.dazed = 0
	p.pick = 0
	p.pickOn = -1
end

local function respawn(g, p)
	sendHome(p)
	-- In overtime a knock-out costs more than the walk back.
	p.dazed = if g.time > OVERTIME.start then OVERTIME.daze else 0
	p.chain = 0
	p.chainUntil = 0
	p.deaths += 1
	table.insert(g.events, { type = "spawn", id = p.id, x = p.x, y = p.y })
end

-- Nobody brought a seed home in time: the side with the most knock-outs takes
-- the round, then the fewest times knocked out, then the most seeds picked. Sides
-- still level after that share the win. A team counts as one side.
local function timeoutWinners(players)
	local sides = {}
	local byKey = {}
	for _, p in players do
		local key = if p.team >= 0 then "t" .. p.team else "p" .. p.id
		local side = byKey[key]
		if not side then
			side = { ids = {}, kills = 0, deaths = 0, seeds = 0 }
			byKey[key] = side
			table.insert(sides, side)
		end
		table.insert(side.ids, p.id)
		side.kills += p.kills + p.throws
		side.deaths += p.deaths
		side.seeds += p.seeds
	end
	local function better(a, b)
		if a.kills ~= b.kills then
			return a.kills > b.kills
		end
		if a.deaths ~= b.deaths then
			return a.deaths < b.deaths
		end
		return a.seeds > b.seeds
	end
	local top = sides[1]
	for _, side in sides do
		if better(side, top) then
			top = side
		end
	end
	local winners = {}
	for _, side in sides do
		if not better(top, side) then
			for _, id in side.ids do
				table.insert(winners, id)
			end
		end
	end
	return winners
end

-- Credits `a` with knocking out `victims`, by a bonk or a thrown seed.
local function strike(g, a, victims, bonked, thrown)
	if #victims == 0 then
		return
	end
	for _, v in victims do
		bonked[v] = true
		if thrown then
			a.throws += 1
		else
			a.kills += 1
		end
		-- `close` marks a seed stopped just short of home: a super play.
		table.insert(g.events, { type = "bonk", by = a.id, id = v.id, x = v.x, y = v.y, seed = v.carrying, close = lastStretch(g, v) })
	end
	-- Several down at once, or one after another in quick succession.
	a.chain = (if g.time <= a.chainUntil then a.chain else 0) + #victims
	a.chainUntil = g.time + BONK.chain
	if a.chain > 1 then
		table.insert(g.events, { type = "multi", by = a.id, n = a.chain })
	end
end

local function stepPlayer(g, p, inp, landing, throwing)
	-- Dazed at the nest: nothing it presses does anything until it wears off.
	if p.dazed > 0 then
		p.dazed = math.max(0, p.dazed - DT)
		inp = EMPTY_INPUT
	end
	p.cooldown = math.max(0, p.cooldown - DT)
	p.pickBlock = math.max(0, p.pickBlock - DT)

	local mx = inp.mx or 0
	local my = inp.my or 0
	local len = hypot(mx, my)
	if len > 1 then
		mx /= len
		my /= len
		len = 1
	end

	local pressed = inp.bonk and not p.bonkHeld
	p.bonkHeld = inp.bonk == true
	if pressed and not p.swing and p.cooldown <= 0 and not inHome(g, p) then
		local ax, ay = pickAim(g, p, mx, my, len)
		p.swing = { windup = true, t = 0, dx = ax, dy = ay }
		p.fx = ax
		p.fy = ay
		p.cooldown = BONK.cooldown
		table.insert(g.events, { type = "swing", id = p.id })
	end

	-- Holding the throw button with a seed winds up a throw, and letting go throws
	-- it. A swing already on its way lands first.
	local landed = not (p.swing and p.swing.windup)
	if inp.throw and p.carrying and not inHome(g, p) then
		p.charge += DT
		-- Fully wound up: it goes by itself.
		if p.charge >= THROW.max - 1e-9 and landed then
			table.insert(throwing, p)
			p.charge = 0
		end
	else
		local ready = p.charge >= THROW.charge - 1e-9 and p.carrying and not inHome(g, p)
		if ready and landed then
			table.insert(throwing, p)
		end
		p.charge = 0
	end

	local share = 1
	if p.carrying then
		share = if lastStretch(g, p) then Config.LAST_STRETCH_SPEED else Config.CARRY_SPEED
	end
	local speed = Config.SPEED * share
	local swing = p.swing
	if swing then
		swing.t += DT
		if swing.windup then
			p.vx = 0
			p.vy = 0
			if swing.t >= BONK.windup - 1e-9 then
				swing.windup = false
				swing.t = 0
				table.insert(landing, p)
			end
		else
			p.vx = mx * speed * BONK.recoveryMove
			p.vy = my * speed * BONK.recoveryMove
			if swing.t >= BONK.recovery - 1e-9 then
				p.swing = nil
			end
		end
	else
		p.vx = mx * speed
		p.vy = my * speed
		if len > 0.05 then
			p.fx = mx / len
			p.fy = my / len
		end
	end

	-- Winding up a throw, the hamster turns wherever it is steered.
	if p.charge > 0 and len > 0.05 then
		p.fx = mx / len
		p.fy = my / len
	end

	p.x += p.vx * DT
	p.y += p.vy * DT
	collide(g.map, p)
end

-- The flower feeds one hamster at a time. Whoever has waited in the ring longest
-- nibbles, and has to hold still to do it. Walking resets the progress; leaving
-- or bonking goes to the back of the line.
local function stepFlower(g)
	local players = g.players
	local f = g.map.flower
	local nibbler = nil
	for _, p in players do
		local inRing = not p.carrying and hypot(p.x - f.x, p.y - f.y) <= f.gatherR
		if not inRing or p.swing then
			p.queued = if inRing then g.tick else -1
			p.gather = 0
		else
			if p.queued < 0 then
				p.queued = g.tick
			end
			if not nibbler or p.queued < nibbler.queued then
				nibbler = p
			end
		end
	end
	g.nibbler = if nibbler then nibbler.id else nil
	for _, p in players do
		if p ~= nibbler then
			p.gather = 0
		end
	end
	if not nibbler then
		return
	end
	if hypot(nibbler.vx, nibbler.vy) > 0.1 then
		nibbler.gather = 0
		return
	end
	nibbler.gather += DT
	if nibbler.gather >= Config.gatherTime(#players, g.time) - 1e-9 then
		nibbler.gather = 0
		nibbler.queued = -1
		nibbler.carrying = true
		nibbler.seeds += 1
		g.nibbler = nil
		table.insert(g.events, { type = "seed", id = nibbler.id })
	end
end

-- Rubbing up against a rival's seed carrier fills a gauge, moving or not, and a
-- full gauge takes the seed. Only one hamster works on a carrier at a time:
-- whoever got furthest keeps at it, the rest start over. Losing touch, swinging,
-- or the carrier getting home first all reset it.
local function pickpocket(g)
	local players = g.players
	local need = Config.pickTime(#players, g.time)
	local working = {} -- [carrier] = whoever is furthest along on it
	for _, p in players do
		local on = nil
		if not p.carrying and not p.swing and p.pickBlock <= 0 and p.dazed <= 0 and not inHome(g, p) then
			local nearest = PICK.reach
			for _, c in players do
				if c ~= p and c.carrying and not allied(p, c) and not inHome(g, c) then
					local d = hypot(c.x - p.x, c.y - p.y)
					if d <= nearest then
						on = c
						nearest = d
					end
				end
			end
		end
		if not on or on.id ~= p.pickOn then
			p.pick = 0
		end
		p.pickOn = if on then on.id else -1
		if on then
			local best = working[on]
			if not best or p.pick > best.pick then
				working[on] = p
			end
		end
	end
	for _, p in players do
		local c = if p.pickOn >= 0 then g.byId[p.pickOn] else nil
		if c then
			if working[c] ~= p then
				p.pick = 0
			else
				p.pick += DT
				if p.pick >= need - 1e-9 then
					c.carrying = false
					c.charge = 0
					c.pickBlock = PICK.block
					p.carrying = true
					p.pick = 0
					p.pickOn = -1
					p.steals += 1
					-- Taking it right at the door is a super play, as a bonk there is.
					table.insert(g.events, { type = "steal", by = p.id, id = c.id, x = c.x, y = c.y, close = c.x - g.homeX < Config.ALARM_RANGE })
				end
			end
		end
	end
end

local function finish(g, winners, timeout)
	g.phase = "over"
	g.winners = winners
	g.timeout = timeout
	table.insert(g.events, { type = "win", ids = winners, timeout = timeout })
end

-- inputs: { [id] = input }. Events of this tick are left in g.events.
function Sim.step(g, inputs)
	table.clear(g.events)
	if g.phase == "over" then
		return g
	end
	g.tick += 1

	if g.phase == "countdown" then
		local before = math.ceil(g.countdown - 1e-9)
		g.countdown -= DT
		if g.countdown <= 1e-9 then
			g.phase = "playing"
			table.insert(g.events, { type = "go" })
		else
			local after = math.ceil(g.countdown - 1e-9)
			if after ~= before then
				table.insert(g.events, { type = "count", n = after })
			end
		end
		return g
	end

	g.time += DT
	local map = g.map
	local players = g.players
	if g.time > OVERTIME.start then
		if g.homeX == map.home.x2 then
			table.insert(g.events, { type = "overtime" })
		end
		if g.time > OVERTIME.rush and g.time - DT <= OVERTIME.rush then
			table.insert(g.events, { type = "rush" })
		end
		-- A creep at first, then a rush. It stops over the near half of the flower's
		-- ring, where a seed is home the moment it is nibbled loose.
		local crept = (math.min(g.time, OVERTIME.rush) - OVERTIME.start) * OVERTIME.speed
		local rushed = math.max(0, g.time - OVERTIME.rush) * OVERTIME.rushSpeed
		g.homeX = math.min(map.flower.x, map.home.x2 + crept + rushed)
	end

	local landing = {}
	local throwing = {}
	for _, p in players do
		stepPlayer(g, p, inputs[p.id] or EMPTY_INPUT, landing, throwing)
	end
	separate(g)

	-- There is never a double knock-out. Hits landing on the same tick resolve one
	-- at a time in a random order, and whoever is already down loses its own hit.
	shuffle(landing, g.rng)
	shuffle(throwing, g.rng)
	local bonked = {}
	-- Thrown seeds go first: everyone on the line goes down.
	for _, a in throwing do
		if not bonked[a] then
			a.carrying = false
			a.swing = nil
			a.cooldown = BONK.cooldown
			local victims = {}
			for _, v in players do
				if v ~= a and not bonked[v] and not inHome(g, v) and (THROW.friendlyFire or not allied(a, v)) then
					local dx = v.x - a.x
					local dy = v.y - a.y
					local along = dx * a.fx + dy * a.fy
					if along >= 0 and along <= THROW.range and math.abs(dx * a.fy - dy * a.fx) <= THROW.width and sight(map, a, v) then
						table.insert(victims, v)
					end
				end
			end
			table.insert(g.events, { type = "throw", id = a.id, x = a.x, y = a.y, dx = a.fx, dy = a.fy, hit = #victims })
			strike(g, a, victims, bonked, true)
		end
	end
	-- A bonk lands on one hamster only: the nearest one in front.
	for _, a in landing do
		if not bonked[a] then
			local victim = nil
			local nearest = BONK.reach
			if not inHome(g, a) then
				for _, v in players do
					if v ~= a and not allied(a, v) and not bonked[v] and not inHome(g, v) then
						local dx = v.x - a.x
						local dy = v.y - a.y
						local d = hypot(dx, dy)
						local inFront = d <= R or (dx * a.swing.dx + dy * a.swing.dy) / d >= BONK.arcCos
						if d <= nearest and inFront and sight(map, a, v) then
							victim = v
							nearest = d
						end
					end
				end
			end
			if victim then
				-- Team-mates can stand inside each other, and that is a risk: a hit on
				-- one of a clump takes out everyone overlapping it.
				local clump = { victim }
				local at = 1
				while at <= #clump do
					local c = clump[at]
					for _, v in players do
						if not table.find(clump, v) and allied(c, v) and not bonked[v] and not inHome(g, v) and hypot(v.x - c.x, v.y - c.y) < 2 * R then
							table.insert(clump, v)
						end
					end
					at += 1
				end
				strike(g, a, clump, bonked, false)
			end
			table.insert(g.events, { type = "impact", id = a.id, x = a.x, y = a.y, dx = a.swing.dx, dy = a.swing.dy, hit = victim ~= nil })
		end
	end
	for _, v in players do
		if bonked[v] then
			respawn(g, v)
		end
	end

	-- A tunnel takes an empty-handed hamster straight back to its nest.
	for _, p in players do
		if not p.carrying then
			for _, w in map.warps do
				if hypot(p.x - w.x, p.y - w.y) <= w.r then
					local fromX, fromY = p.x, p.y
					sendHome(p)
					table.insert(g.events, { type = "warp", id = p.id, fromX = fromX, fromY = fromY, x = p.x, y = p.y })
					break
				end
			end
		end
	end

	for _, p in players do
		if p.carrying and inHome(g, p) then
			-- Its whole team wins with it.
			local winners = {}
			for _, o in players do
				if o == p or allied(o, p) then
					table.insert(winners, o.id)
				end
			end
			finish(g, winners, false)
			return g
		end
	end

	pickpocket(g)

	if g.time >= OVERTIME.finish then
		finish(g, timeoutWinners(players), true)
		return g
	end

	stepFlower(g)
	return g
end

return Sim

-- The thinking part of the top bot. Instead of following fixed rules for what to
-- do next, it lists a handful of plans ("go for the seed", "cut that carrier off
-- at the door", "take the tunnel home"...), plays each one forward a couple of
-- seconds in a copy of the game with everyone else doing the obvious thing, and
-- takes the plan that leaves it best off. The hands stay the bot's own: this only
-- chooses the plan. Ported from the web game's src/ai/search.js.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Sim = require(ReplicatedStorage:WaitForChild("Sim"))
local Nav = require(script.Parent:WaitForChild("BotNav"))
local mulberry32 = require(script.Parent:WaitForChild("BotRng"))

local PX = Nav.PX
local R = Config.HAMSTER_R
local BONK = Config.BONK
local inHome = Sim.inHome

-- How far ahead a plan is played out, and how often the bot thinks again.
-- `edge` is how much better than the rule book's own plan another plan has to
-- look before the bot leaves the rule book; `keep` is the same for changing its
-- mind. A plan once chosen is given `commit` seconds: within that time only a
-- much better one (`jump` points) replaces it. The scores are rough, and a bot
-- that changes its mind three times a second gets nowhere.
local SEARCH = { horizon = 2.4, every = 0.3, keep = 25, edge = 60, commit = 1.2, jump = 320 }

local Search = {}
Search.every = SEARCH.every

local function dist(a, b)
	local dx = a.x - b.x
	local dy = a.y - b.y
	return math.sqrt(dx * dx + dy * dy)
end

local function copy(g, seed)
	local c = table.clone(g)
	c.players = table.create(#g.players)
	c.byId = {}
	for i, p in g.players do
		local q = table.clone(p)
		if q.swing then
			q.swing = table.clone(q.swing)
		end
		c.players[i] = q
		c.byId[q.id] = q
	end
	c.events = {}
	c.rng = mulberry32(seed)
	return c
end

-- A driver turns a hamster's situation into where to walk, cheaply: along a list
-- of points, or at somebody. It writes into `out`, the hamster's input.
local function walker(points)
	local i = 1
	return function(_, p, out)
		while i < #points and dist(p, points[i]) < 14 * PX do
			i += 1
		end
		local to = points[i]
		local d = dist(p, to)
		if d < 4 * PX then
			out.mx = 0
			out.my = 0
		else
			out.mx = (to.x - p.x) / d
			out.my = (to.y - p.y) / d
		end
	end
end

local function chaser(targetId, points)
	local walk = if points and #points > 0 then walker(points) else nil
	return function(c, p, out)
		local e = c.byId[targetId]
		local d = dist(p, e)
		-- Close enough to see: go straight at it. Otherwise keep to the path there.
		if walk and d >= 110 * PX then
			walk(c, p, out)
		elseif d < 2 * PX then
			out.mx = 0
			out.my = 0
		else
			out.mx = (e.x - p.x) / d
			out.my = (e.y - p.y) / d
		end
	end
end

local function still(_, _, out)
	out.mx = 0
	out.my = 0
end

-- Whoever is near enough gets bonked. Everyone in the daydream does this.
local function withBonk(c, p, out)
	out.bonk = false
	if p.swing or p.cooldown > 0 or inHome(c, p) then
		return
	end
	for _, e in c.players do
		if e ~= p and not inHome(c, e) and dist(e, p) <= BONK.reach - 2 * PX then
			out.bonk = true
			return
		end
	end
end

-- How good things look for hamster `id` at the end of a daydream. `used` is the
-- share of the horizon it took.
local function judge(c, id, before, used)
	local me = c.byId[id]
	local f = c.map.flower
	if c.phase == "over" and not c.timeout then
		-- Sooner is better when winning, later when losing.
		return if table.find(c.winners, id) then 2000 - 400 * used else -2000 + 400 * used
	end
	local span = f.x - c.map.home.x2
	local s = 0
	for _, p in c.players do
		local side = if p == me then 1 else -1
		local was = before[p.id]
		if p.carrying then
			-- How far along the way home the seed is, 0 at the flower and 1 at the door.
			s += side * (260 + 520 * math.clamp((f.x - p.x) / span, 0, 1))
		end
		s -= side * 70 * (p.deaths - was.deaths) * (if p == me then 1.6 else 1)
		s += side * 15 * (p.kills - was.kills)
		-- A rival left to nibble in peace is a seed on its way.
		if side < 0 then
			s -= 140 * p.gather
		end
	end
	if not me.carrying then
		-- Being at the flower and nibbling is what leads to a seed.
		s -= 0.3 / PX * math.max(0, dist(me, f) - f.gatherR)
		s += 160 * me.gather
	end
	return s
end

-- A daydream only needs the hedges its hamsters are next to, and the game spends
-- most of a step pushing hamsters out of hedges that are nowhere near them. So
-- each map gets a twin whose list of hedges is cut down, before every step, to
-- the ones somebody could touch in it. The rest of the twin is the map's own.
local twins = setmetatable({}, { __mode = "k" })

local function twinOf(map)
	local twin = twins[map]
	if not twin then
		twin = { map = table.clone(map), mark = table.create(#map.rects, false) }
		twin.map.rects = {}
		twins[map] = twin
	end
	return twin
end

local function hedgesFor(c, map, nav, twin)
	local mark = twin.mark
	local near = twin.map.rects
	table.clear(near)
	local any = false
	for _, p in c.players do
		local ids = nav.hedgesNear(p.x, p.y)
		if ids then
			any = true
			for _, i in ids do
				mark[i] = true
			end
		end
	end
	if any then
		-- In the map's own order, so that everything comes out as it would there.
		for i, rect in map.rects do
			if mark[i] then
				mark[i] = false
				table.insert(near, rect)
			end
		end
	end
end

-- `stepsPerThink` is how many steps of daydream a call to `work` may play: the
-- thinking is spread over the ticks that follow, and the answer comes that much
-- later. Without it the bot thinks it all through on the spot, as on the web;
-- that is some thousand steps of the game in one tick.
function Search.new(seed: number, stepsPerThink: number?)
	local budget = stepsPerThink or math.huge
	local last = nil
	-- Bots do not all think on the same tick: each starts a little out of step.
	local lastAt = ((seed % 9) / 9) * SEARCH.every - SEARCH.every
	local thought = 0
	local since = 0
	local inputs = {} -- [id] = that hamster's input in the daydream
	local job = nil -- the thought it is in the middle of

	-- Plays the daydreams of the thought in hand on, and settles on a plan once the
	-- last one is through. Returns true when that happens.
	local function work()
		if not job then
			return false
		end
		local base = job.base
		local id = job.id
		local map = base.map
		local nav = Nav.get(map)
		local twin = twinOf(map)
		local ticks = math.round(SEARCH.horizon * Config.TICK_RATE)
		local left = budget
		while left > 0 do
			local plan = job.plans[job.at]
			local c = job.dream
			if not c then
				c = copy(base, seed + base.tick * 31 + thought)
				thought += 1
				job.dream = c
				job.t = 0
			end
			while left > 0 and job.t < ticks and c.phase == "playing" do
				for _, p in c.players do
					local inp = inputs[p.id]
					if not inp then
						inp = { mx = 0, my = 0, bonk = false, throw = false }
						inputs[p.id] = inp
					end
					local drive = if p.id == id then plan.drive else job.drivers[p.id]
					drive(c, p, inp)
					withBonk(c, p, inp)
				end
				-- A seed thrown in the first step flies further than "next to": that
				-- step sees every hedge.
				if job.t == 0 then
					c.map = map
				else
					c.map = twin.map
					hedgesFor(c, map, nav, twin)
				end
				Sim.step(c, inputs)
				job.t += 1
				left -= 1
			end
			if job.t < ticks and c.phase == "playing" then
				return false
			end
			plan.score = judge(c, id, job.before, job.t / ticks)
			-- Stick with the current plan unless another is clearly better: no dithering.
			if last and last.label == plan.label then
				plan.score += SEARCH.keep
			end
			if plan.label == "rules" then
				plan.score += SEARCH.edge
			end
			job.dream = nil
			job.at += 1
			if job.at > #job.plans then
				break
			end
		end
		if job.at <= #job.plans then
			return false
		end

		local best = nil
		for _, plan in job.plans do
			if not best or plan.score > best.score then
				best = plan
			end
		end
		if last and job.startedAt - since < SEARCH.commit then
			for _, plan in job.plans do
				if plan.label == last.label then
					if plan ~= best and best.score < plan.score + SEARCH.jump then
						best = plan
					end
					break
				end
			end
		end
		if not last or best.label ~= last.label then
			since = job.startedAt
		end
		last = best
		job = nil
		return true
	end

	-- `rules` is what the rule book would do right now: { mode, targetId, path, entryY }.
	-- `cost(p, q)` is what a leg of a path costs on top of its length.
	local function choose(g, id, cost, rules)
		local now = g.time
		-- Between thoughts, and while one is still going on, it stays with its last
		-- choice; if that was the rule book, with whatever the rule book says now.
		if not job and now - lastAt >= SEARCH.every then
			local map = g.map
			local nav = Nav.get(map)
			local me = g.byId[id]
			local f = map.flower
			local entries = nav.entries(g.homeX)
			local function nearestEntry(p)
				local best = entries[1]
				local bestD = nav.distance(p, best)
				for i = 2, #entries do
					local d = nav.distance(p, entries[i])
					if d < bestD then
						best = entries[i]
						bestD = d
					end
				end
				return best
			end

			-- What everybody else is taken to be doing: a carrier runs home, the rest
			-- go for the nearest seed somebody is carrying, or else for the flower.
			-- These drivers keep their place on a path from one daydream to the next,
			-- as in the web game, so that both bots come to the same choices.
			local drivers = {}
			local homeRuns = {}
			for _, p in g.players do
				if p == me then
					continue
				end
				if p.carrying then
					local run = nav.findPath(p, nearestEntry(p))
					homeRuns[p.id] = run
					drivers[p.id] = walker(run)
					continue
				end
				local prey = nil
				local preyD = math.huge
				for _, c in g.players do
					if c.carrying and not inHome(g, c) and dist(p, c) < preyD then
						prey = c
						preyD = dist(p, c)
					end
				end
				if prey then
					drivers[p.id] = chaser(prey.id, (nav.findPath(p, prey)))
				elseif dist(p, f) <= f.gatherR - 6 * PX then
					drivers[p.id] = still
				else
					local spot = nav.gatherSpots[1]
					for _, s in nav.gatherSpots do
						if dist(p, s) < dist(p, spot) then
							spot = s
						end
					end
					drivers[p.id] = walker((nav.findPath(p, spot)))
				end
			end

			-- The plans worth weighing right now.
			local plans = {}
			local function add(label, intent, drive)
				table.insert(plans, { label = label, intent = intent, drive = drive, score = 0 })
			end
			local defending = rules.mode == "deny"
			-- The rule book's plan is always in the running, and has to be beaten clearly.
			local target = if rules.targetId >= 0 then g.byId[rules.targetId] else nil
			if target then
				add("rules", rules, chaser(target.id, rules.path or (nav.findPath(me, target))))
			elseif rules.path and #rules.path > 0 then
				add("rules", rules, walker(rules.path))
			else
				add("rules", rules, still)
			end
			if me.carrying then
				local runs = {}
				nav.from(me, cost)
				for _, entry in entries do
					local c, via = nav.costTo(entry)
					table.insert(runs, { entry = entry, cost = c, via = via })
				end
				table.sort(runs, function(a, b)
					return a.cost < b.cost
				end)
				for i = 1, math.min(3, #runs) do
					local run = runs[i]
					local points = nav.pathTo(run.entry, run.via)
					add("home:" .. run.entry.y, { mode = "home", entryY = run.entry.y, path = points }, walker(points))
				end
			else
				-- When the rule book says a seed has to be stopped, that is settled:
				-- looking ahead only gets to choose how.
				if not defending then
					local spot = nil
					local spotD = math.huge
					for _, s in nav.gatherSpots do
						local taken = false
						for _, e in g.players do
							if e ~= me and dist(e, s) < 2 * R then
								taken = true
								break
							end
						end
						if not taken and (not spot or nav.distance(me, s) < spotD) then
							spot = s
							spotD = nav.distance(me, s)
						end
					end
					if dist(me, f) <= f.gatherR - 8 * PX then
						add("gather", { mode = "gather", path = nil }, still)
					else
						local toSpot = nav.findPath(me, spot or f, cost)
						add("gather", { mode = "gather", path = toSpot }, walker(toSpot))
					end
				end

				local carriers = {}
				for _, c in g.players do
					if c ~= me and c.carrying and not inHome(g, c) then
						table.insert(carriers, c)
					end
				end
				table.sort(carriers, function(a, b)
					return a.x < b.x
				end)
				for i = 1, math.min(2, #carriers) do
					local c = carriers[i]
					add("chase:" .. c.id, { mode = "deny", targetId = c.id, path = nil }, chaser(c.id, (nav.findPath(me, c))))
					-- Get in front of it: at the door it is making for, on foot or by tunnel.
					local run = homeRuns[c.id]
					local door = { x = g.homeX + 26 * PX, y = run[#run].y }
					local toDoor = nav.findPath(me, door, cost)
					add("door:" .. c.id, { mode = "deny", targetId = c.id, path = toDoor }, chaser(c.id, toDoor))
					local tunnel = map.warps[1]
					for _, w in map.warps do
						if nav.distance(me, w) < nav.distance(me, tunnel) then
							tunnel = w
						end
					end
					if nav.distance(me, tunnel) < 260 * PX then
						local toTunnel = nav.findPath(me, tunnel)
						add("tunnel:" .. c.id, { mode = "deny", targetId = c.id, path = toTunnel }, walker(toTunnel))
					end
				end
				-- Clear somebody out: whoever is nearest.
				if not defending then
					local near = nil
					local nearD = 220 * PX
					for _, e in g.players do
						if e ~= me and not e.carrying and not inHome(g, e) and dist(me, e) < nearD then
							near = e
							nearD = dist(me, e)
						end
					end
					if near then
						add("hunt:" .. near.id, { mode = "hunt", targetId = near.id, path = nil }, chaser(near.id, nil))
					end
				end
			end

			-- Every plan is played out from the game as it is now, however long the
			-- thinking takes.
			local before = {}
			for _, p in g.players do
				before[p.id] = { deaths = p.deaths, kills = p.kills }
			end
			job = { base = copy(g, 0), id = id, plans = plans, drivers = drivers, before = before, at = 1, dream = nil, t = 0, startedAt = now }
			lastAt = now
			if budget == math.huge then
				work()
			end
		end
		return if not last or last.label == "rules" then rules else last.intent
	end

	return { choose = choose, work = work }
end

return Search

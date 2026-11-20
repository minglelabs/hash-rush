-- Computer-controlled hamster. A bot only reads the game state and returns the
-- same input a player sends, so any seat can be given to one:
--   local bot = Bot.new({ difficulty = "normal", seed = 7 })
--   inputs[id] = bot.think(g, id)   -- every tick, after Sim.step
-- Ported from the web game's src/ai/bot.js, for the meadow, with or without
-- teams: what it had for other maps and their hazards is left out.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Sim = require(ReplicatedStorage:WaitForChild("Sim"))
local Nav = require(script.Parent:WaitForChild("BotNav"))
local Search = require(script.Parent:WaitForChild("BotSearch"))
local mulberry32 = require(script.Parent:WaitForChild("BotRng"))

local DT = Config.DT
local SPEED = Config.SPEED
local R = Config.HAMSTER_R
local BONK = Config.BONK
local THROW = Config.THROW
-- One web pixel in studs: the bot's distances are the web game's, in pixels.
local PX = Nav.PX
local inHome = Sim.inHome
local allied = Sim.allied
local distToSegment = Nav.distToSegment

local Bot = {}

-- reaction: how stale the bot's view of others is (seconds)
-- lead: how well it makes up for that delay when timing a swing (0..1)
-- margin/jitter: how far inside its reach it wants a target before swinging
-- bait: chance to hover just out of reach, waiting for a whiff, before going in
-- hold: chance to stand its ground when charged, which is the stronger position
-- deny: chance to go after someone who picked up a seed
-- hunt: chance to clear a rival away from the flower instead of waiting in line
-- opportunism: swings per second at bystanders who happen to be in reach
-- caution: how strongly a seed carrier avoids rivals waiting near its route
-- toss: chance to throw the seed at a single rival standing in the way home
-- volley: chance to throw it when it would take down two, or a rival's seed
-- thrifty: this near home it never throws its seed away. The seed is the win; a
--   rival knocked down there is worth nothing next to it.
-- guard: carrying a seed, it swings at a rival rubbing up against it before the
--   gauge fills. A swing is the only way to shake a thief off, as nobody outruns
--   an empty-handed hamster with a seed.
-- freeze: how long it dithers before a swing it has decided on (seconds)
-- rally: whether it joins the chase after a seed it cannot head off in time
-- The rookie keeps to four simple things: go for a seed, go and stop a rival who
-- has one, carry its own seed home, and bonk whoever comes close. It is beatable
-- because it sees late and swings late, not because it stands about.
local DIFFICULTY = {
	easy = { reaction = 0.45, lead = 0, margin = 0, jitter = 9 * PX, bait = 0, hold = 0, deny = 1, hunt = 0, opportunism = 0.3, caution = 0.2, freeze = 0.3, rally = false, toss = 0, volley = 0 },
	normal = { reaction = 0.24, lead = 0.4, margin = 2 * PX, jitter = 4 * PX, bait = 0.25, hold = 0.5, deny = 0.7, hunt = 0.7, opportunism = 0.8, caution = 0.8, freeze = 0.09, rally = true, toss = 0.3, volley = 0.8 },
	hard = { reaction = 0.15, lead = 0.9, margin = 3 * PX, jitter = 1 * PX, bait = 0.55, hold = 1, deny = 1, hunt = 1, opportunism = 1.5, caution = 1.2, freeze = 0, rally = true, toss = 0.5, volley = 1, thrifty = 330 * PX, guard = true },
}
-- The top bot has hard's hands, and on top of them:
-- search: it plays each plan forward in a copy of the game and picks the best
--   (see BotSearch), instead of only following the rules below.
-- dance: up close it feints instead of walking in: a dash at the rival to draw a
--   swing, a step back out of reach so the swing misses, then in for the hit.
-- poach: with no team, and this many others better placed to stop a rival's
--   seed, it leaves that seed to them and goes for one of its own.
-- wary: it learns from being fooled. Once a rival has drawn a wasted swing out of
--   it and bonked it for that, it stops swinging at that rival just for running
--   at it. The number is how often it holds fire while it does not know the
--   rival's habit.
-- toss 0, boxed: it does not gamble its seed on one rival in the way. It throws
--   for two at once, for a rival's seed, or when one is ahead and another is
--   coming up within `boxed` behind, so the seed is as good as lost anyway.
-- trail: behind a rival that is running away it keeps this far back. A swing from
--   behind cannot reach anyone who keeps going; from here the rival's own swing
--   hits nothing, and the bot is on it while it is stuck.
-- rubAfter, rubHome: when it rubs up against a carrier for the seed all the same:
--   one that has run on this long without turning, and one that is nearly home.
-- lure: a rival nibbling still swings at whoever walks up. The bot dashes in to
--   this distance, where a swing looks sure to land, and straight back out.
-- clock: at the flower it nibbles on only while no rival can reach it before the
--   seed comes loose (with this much to spare), and goes to meet one that can.
-- ambush: a rival at its heels for this long is following, and a follower runs
--   straight into a swing: it stops dead and swings.
-- flinch: how soon after a swing starts it sees it, and steps back out of reach.
-- dodge: carrying a seed past a side lane, it steps back for this long from a
--   person who sets off to swing just as it crosses.
-- margin 7, hold 0: it swings only once a rival is well inside reach, and does
--   not stand its ground against a charge.
-- pincer: on a team, those after the same seed split up instead of all running
--   the same way: the best placed cuts off the way it is going, the next covers
--   the way it would turn to instead, any others run it down from behind. Within
--   this distance of each other the lower-numbered one counts as better placed.
-- crowd: with no team, it does not swing at a rival without a seed while another
--   one is this near and ready to swing: that one would hit it while it is stuck.
DIFFICULTY.ace = table.clone(DIFFICULTY.hard)
for k, v in pairs({ margin = 7 * PX, hold = 0, crowd = 110 * PX, search = true, dance = true, poach = 1, wary = 0.5, clock = 0.15, toss = 0, boxed = 120 * PX, trail = 78 * PX, rubAfter = 1, rubHome = true, lure = 54 * PX, pincer = 60 * PX, ambush = 0.2, dodge = 0.3, flinch = 0.15 }) do
	DIFFICULTY.ace[k] = v
end
Bot.DIFFICULTY = DIFFICULTY

local TOUCH = 2 * R
local DANGER_R = 110 * PX
local DANGER_K = 300 * PX
-- Chance that a bot goes for a seed of its own while a team-mate carries one home.
local SECOND_SEED = 0.45
-- How far outside a tunnel's edge a bot stops when it does not mean to go in.
local RIM = 2 * PX
-- A seed carrier this close to home has every rival bot drop what it is doing.
local LAST_STAND = 260 * PX
local NO_TUNNELS = table.freeze({})

local function hypot(x, y)
	return math.sqrt(x * x + y * y)
end

local function dist(a, b)
	return hypot(a.x - b.x, a.y - b.y)
end

-- If `me` started a swing now, how far away would `e` be when it lands?
-- `lead` is how far ahead (seconds) to carry the target's movement on.
local function predictSwing(me, e, lead)
	local drift = if e.swing then 0 else lead
	local cx = e.x - me.x
	local cy = e.y - me.y
	local cd = hypot(cx, cy)
	local dx = cx + e.vx * drift
	local dy = cy + e.vy * drift
	local d = hypot(dx, dy)
	-- Hamsters are solid: one charging at me stops when it touches me.
	if cd > 1e-6 and ((d < TOUCH and d < cd) or dx * cx + dy * cy <= 0) then
		return math.min(cd, TOUCH)
	end
	return if d > 0 then d else 1
end

-- Which seats bots are thinking for, per game. Everyone else is a person.
local botsIn = setmetatable({}, { __mode = "k" })

function Bot.new(opts)
	opts = opts or {}
	local seed = opts.seed or 1
	local rng = mulberry32(seed)
	-- Every bot gets a slightly different temperament so they don't all play alike.
	local cfg = table.clone(DIFFICULTY[opts.difficulty] or DIFFICULTY.normal)
	for _, k in { "bait", "hold", "deny", "hunt" } do
		cfg[k] = math.clamp(cfg[k] + (rng() - 0.5) * 0.3, 0, 1)
	end
	local planner = if cfg.search then Search.new(seed, opts.stepsPerThink) else nil

	-- What the bot saw of everyone on each of the last ticks. It acts on the oldest.
	local delayTicks = math.max(1, math.round(cfg.reaction / DT))
	local frames = {}
	local frameCount = 0
	local newest = 0
	local flinchTicks = if cfg.flinch then math.round(cfg.flinch / DT) else 0

	local mem = {
		replanAt = 0,
		mode = "gather",
		path = nil,
		targetId = -1,
		entryY = -1,
		denyRolls = {},
		secondRolls = {},
		huntRoll = { id = -1, till = 0, yes = false },
		duel = { id = -1, bait = false, hold = false, till = 0, expires = 0 },
		spot = nil,
		nibbling = false,
		flank = false,
		flee = { id = -1, since = 0, tick = -1 },
		tail = {},
		dodge = { id = -1, till = 0, x = 0, y = 0 },
		flinch = { id = -1, till = 0 },
		cut = nil,
		dance = { id = -1, nib = nil, out = false, turn = 0, till = 0, feints = 0, most = 0, expires = 0 },
		fooled = {},
		whiff = { id = -1, till = 0 },
		inReach = {},
		habit = {},
		patience = { id = -1, till = 0, hold = false },
		aimedAt = -1,
		noise = 0,
		noiseAt = 0,
		bonkDown = false,
		swingAt = -1,
		toss = nil, -- id of the rival a throw is being wound up for, -1 for one that is called off
		tossRoll = { id = -1, till = 0, yes = false },
		stuck = { x = 0, y = 0, at = 0 },
		nudge = { till = 0, x = 0, y = 0 },
		-- When each rival was last seen starting a swing, and whether it was winding
		-- up then: a swing cannot follow another for BONK.cooldown.
		swung = {},
	}

	-- This tick's view, shared by the helpers below.
	local g, id, me, map, nav, now, f
	-- Everything below is about rivals; team-mates are neither targets nor obstacles.
	local seen = {} -- the rivals, as they were `reaction` ago
	local mates = {} -- its team-mates, likewise
	local laneUnits = {} -- those of them inside the lanes
	local entries = nil
	local tunnels = NO_TUNNELS
	local tunnelling = false
	local out = { mx = 0, my = 0, bonk = false, throw = false }
	local ahead = {}
	local hit = {}

	local function record()
		newest = newest % (delayTicks + 1) + 1
		frameCount = math.min(frameCount + 1, delayTicks + 1)
		local frame = frames[newest]
		if not frame then
			frame = {}
			frames[newest] = frame
		end
		local players = g.players
		for i, p in players do
			local s = frame[i]
			if not s then
				s = {}
				frame[i] = s
			end
			local swing = p.swing
			s.id = p.id
			s.team = p.team
			s.x = p.x
			s.y = p.y
			s.vx = p.vx
			s.vy = p.vy
			s.carrying = p.carrying
			s.swing = if not swing then false elseif swing.windup then "windup" else "recovery"
			s.aimX = if swing then swing.dx else 0
			s.aimY = if swing then swing.dy else 0
			s.seeds = p.seeds
			s.nibbler = g.nibbler == p.id
			s.home = inHome(g, p)
			s.pickOn = p.pickOn
		end
		for i = #frame, #players + 1, -1 do
			frame[i] = nil
		end
	end

	-- The frame from `back` ticks ago, or the oldest there is.
	local function frameAgo(back)
		back = math.min(back, frameCount - 1)
		return frames[(newest - 1 - back) % (delayTicks + 1) + 1]
	end

	local function sawOf(who)
		for _, e in seen do
			if e.id == who then
				return e
			end
		end
		return nil
	end

	-- A lane with someone in it cannot be passed, so paths cost more through it.
	local function blocked(p, q)
		return Nav.blockCost(laneUnits, p, q)
	end

	local function steerTo(x, y)
		local dx = x - me.x
		local dy = y - me.y
		local d = hypot(dx, dy)
		if d < 3 * PX then
			return
		end
		out.mx = dx / d
		out.my = dy / d
	end

	local function follow(points)
		if not points or #points == 0 then
			return
		end
		-- Only a deliberate shortcut home may step into a tunnel.
		if table.find(map.warps, points[#points]) then
			tunnelling = true
		end
		local to = nav.nextTarget(me, points)
		steerTo(to.x, to.y)
	end

	-- A tunnel is part of the map like any lane: for a hamster without a seed it is
	-- a one-way hop from the flower's side to its own nest. Routes and travel
	-- distances count it whenever going in and walking on from the nest is shorter.
	local function travel(to)
		local best = nav.distance(me, to)
		for _, w in tunnels do
			-- As the crow flies is the least it could be: most targets are ruled out here.
			if dist(me, w) + dist(me.nest, to) < best then
				best = math.min(best, nav.distance(me, w) + nav.distance(me.nest, to))
			end
		end
		return best
	end

	local function route(to, extra)
		local points, cost = nav.findPath(me, to, extra)
		for _, w in tunnels do
			-- The least the tunnel way can cost; skip the search unless it could win.
			if dist(me, w) + dist(me.nest, to) < cost and nav.distance(me, w) + nav.distance(me.nest, to) < cost then
				local leg, legCost = nav.findPath(me, w, extra)
				local _, afterCost = nav.findPath(me.nest, to, extra)
				if legCost + afterCost < cost then
					points = leg
					cost = legCost + afterCost
				end
			end
		end
		return points, cost
	end

	-- The same for one of several places, after `nav.from(me, blocked)`.
	local function routeTo(to)
		local cost, via = nav.costTo(to)
		for _, w in tunnels do
			if dist(me, w) + dist(me.nest, to) < cost and nav.distance(me, w) + nav.distance(me.nest, to) < cost then
				local legCost, legVia = nav.costTo(w)
				local _, afterCost = nav.findPath(me.nest, to, blocked)
				if legCost + afterCost < cost then
					return nav.pathTo(w, legVia), legCost + afterCost
				end
			end
		end
		return nav.pathTo(to, via), cost
	end

	-- Rivals loitering near a leg of the route, e.g. at a lane mouth.
	local function danger(p, q)
		local c = 0
		for _, e in seen do
			if not e.home then
				local d = distToSegment(e.x, e.y, p.x, p.y, q.x, q.y)
				if d < DANGER_R then
					c += (if e.carrying then 0.35 else 1) * (1 - d / DANGER_R) * DANGER_K
				end
			end
		end
		return c * cfg.caution
	end

	local function wayHome(p, q)
		return blocked(p, q) + danger(p, q)
	end

	local function searchCost(p, q)
		return blocked(p, q) + (if me.carrying then danger(p, q) else 0)
	end

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
		return best, bestD
	end

	local function lastStandFor(c)
		return c.x - g.homeX < LAST_STAND
	end

	-- Where could I cut off a seed carrier before it gets home?
	-- `shun`: places a team-mate has covered. The carrier is then taken to go home
	-- by the best way that keeps clear of them, and that is the way to cut off.
	local function intercept(c, force, flank, shun)
		local entry, home = nearestEntry(c)
		local pts
		if shun then
			local function wide(p, q)
				local k = 0
				for _, at in shun do
					k += math.max(0, 1 - distToSegment(at.x, at.y, p.x, p.y, q.x, q.y) / (130 * PX)) * 900 * PX
				end
				return k
			end
			local bestCost, bestVia = math.huge, 0
			nav.from(c, wide)
			for _, en in entries do
				local cost, via = nav.costTo(en)
				if cost < bestCost then
					entry, bestCost, bestVia = en, cost, via
				end
			end
			home = nav.distance(c, entry)
			pts = nav.pathTo(entry, bestVia)
		else
			pts = nav.findPath(c, entry)
		end
		local walked = 0
		local a = c
		for i, b in pts do
			local seg = dist(a, b)
			if seg >= 1 * PX then
				local s = if i == 1 then 40 * PX else 0
				while s <= seg do
					local P = { x = a.x + (b.x - a.x) * s / seg, y = a.y + (b.y - a.y) * s / seg }
					if P.x < g.homeX + 20 * PX then
						break
					end
					if travel(P) / SPEED <= (walked + s) / (SPEED * Config.CARRY_SPEED) then
						return P
					end
					s += 50 * PX
				end
				walked += seg
			end
			a = b
		end
		local door = { x = g.homeX + 26 * PX, y = entry.y }
		local deadline = home / (SPEED * Config.CARRY_SPEED) + 0.25
		if nav.distance(me, door) / SPEED <= deadline then
			return door
		end
		-- Too far to run: a tunnel by the flower drops me at my nest, ahead of it.
		local fromNest = nav.distance(me.nest, door) / SPEED
		local viaTunnel = nil
		local tunnelTime = math.huge
		for _, w in map.warps do
			local time = nav.distance(me, w) / SPEED + fromNest
			if time <= deadline then
				return w
			end
			if time < tunnelTime then
				tunnelTime = time
				viaTunnel = w
			end
		end
		-- Too late on paper. That is no reason to let it go: carriers get held up on
		-- the way and at the door, so head there anyway.
		if not force then
			return nil
		end
		-- Running at it shows the chase; the tunnel is only worth it when clearly quicker.
		-- With a team-mate already on its heels, running after it too adds nothing:
		-- then the tunnel is taken whenever it is the quicker way round to the door.
		return if nav.distance(me, door) / SPEED <= tunnelTime * (if flank then 1 else 1.25) then door else viaTunnel
	end

	local function plan()
		mem.targetId = -1
		mem.flank = false
		if me.carrying then
			local best, bestCost, bestVia = nil, math.huge, 0
			local kept, keptCost, keptVia = nil, math.huge, 0
			nav.from(me, wayHome)
			for _, entry in entries do
				local cost, via = nav.costTo(entry)
				if not best or cost < bestCost then
					best, bestCost, bestVia = entry, cost, via
				end
				if mem.mode == "home" and entry.y == mem.entryY then
					kept, keptCost, keptVia = entry, cost, via
				end
			end
			-- Stick with the lane already chosen unless another is clearly better.
			if kept and keptCost <= bestCost * 1.15 then
				best, bestVia = kept, keptVia
			end
			mem.mode = "home"
			mem.entryY = best.y
			mem.path = nav.pathTo(best, bestVia)
			return
		end

		-- Someone has a seed: stop it if I can get in its way.
		local target, targetAt, targetFlank = nil, nil, false
		local urgent = math.huge
		for _, c in seen do
			if not c.carrying or c.home then
				continue
			end
			-- A seed about to reach home is everybody's problem, whatever was rolled.
			local lastStand = cfg.rally and lastStandFor(c)
			local key = c.id * 1000 + c.seeds
			if mem.denyRolls[key] == nil then
				mem.denyRolls[key] = rng() < cfg.deny
			end
			if not mem.denyRolls[key] and not lastStand then
				continue
			end
			local near = dist(me, c) < 230 * PX and nav.clear(me, c)
			-- Let the others have that one. With enough of them better placed than I
			-- am to get in its way, nearer the door it is making for, the seed is
			-- theirs to stop and the flower is free: fetch a second seed and walk it
			-- home behind the commotion. Not when the first is about to get in.
			if cfg.poach and #mates == 0 and not lastStandFor(c) and not near then
				local door = { x = g.homeX + 26 * PX, y = nearestEntry(c).y }
				local mine = travel(door)
				local better = 0
				for _, e in seen do
					if e.id ~= c.id and not e.carrying and nav.distance(e, door) < mine then
						better += 1
					end
				end
				if better >= cfg.poach then
					continue
				end
			end
			-- Out of reach is no reason to shrug either: everyone keeps after the
			-- seed, except that with three or more chasers the one nearest the flower
			-- stays on it, ready to nibble the moment the seed is knocked loose.
			local chasers = 1
			local nearestFlower = true
			for _, m in mates do
				if not m.carrying then
					chasers += 1
					if dist(m, f) <= dist(me, f) then
						nearestFlower = false
					end
				end
			end
			for _, e in seen do
				if e.id ~= c.id and not allied(e, c) and not e.carrying then
					chasers += 1
					if dist(e, f) <= dist(me, f) then
						nearestFlower = false
					end
				end
			end
			local stays = chasers >= 3 and nearestFlower
			-- With team-mates after the same seed, split up rather than all run the
			-- same way and leave it the other. Everyone works the roles out the same
			-- way from where everyone stands.
			local press = false
			local flank = false
			local shun = nil
			if cfg.pincer then
				local door = nil
				local mine = 0
				local better = 0
				local first, firstD = nil, math.huge
				for _, m in mates do
					if m.carrying then
						continue
					end
					if not door then
						door = { x = g.homeX + 26 * PX, y = nearestEntry(c).y }
						mine = nav.distance(me, door)
					end
					-- Clearly nearer the door goes first; when it is close, the lower
					-- number does. Both sides of a pair come to the same answer that
					-- way, even standing on the same spot.
					local theirs = nav.distance(m, door)
					if theirs < mine - cfg.pincer or (theirs <= mine + cfg.pincer and m.id < id) then
						better += 1
					end
					if theirs < firstD then
						first, firstD = m, theirs
					end
				end
				if door then
					-- The best placed takes the way it is going. The next covers the way
					-- it would turn to instead. Any more run it down from behind.
					press = better >= 2
					if better == 1 then
						shun = { first, door }
					end
					-- Cutting it off from behind it means going round, not after it.
					flank = not press and mine >= nav.distance(c, door)
				end
			end
			local at
			if flank or shun then
				at = intercept(c, true, flank, shun)
			elseif near or press then
				at = c
			else
				at = intercept(c, cfg.rally and (lastStand or not stays))
			end
			if at and c.x < urgent then
				urgent = c.x
				target = c
				targetAt = at
				targetFlank = flank or shun ~= nil
			end
		end
		if target then
			mem.mode = "deny"
			mem.targetId = target.id
			-- Where to cut it off shifts a little with every step the carrier takes,
			-- and now and then jumps to another lane altogether. Do not turn round for
			-- that: stay with the spot picked a moment ago while it is still ahead of
			-- the carrier.
			local was = mem.cut
			if was and was.id ~= target.id then
				was = nil
			end
			local jumped = targetAt ~= target and (not was or dist(was.at, targetAt) > 110 * PX)
			if was and jumped and now < was.till and was.at.x < target.x - 30 * PX and not table.find(map.warps, targetAt) then
				targetAt = was.at
			elseif jumped then
				mem.cut = { id = target.id, at = targetAt, till = now + 1.2 }
			end
			mem.path = if targetAt == target then nil else (route(targetAt))
			mem.flank = targetFlank and mem.path ~= nil
			return
		end

		-- A team-mate is running a seed home: clear out whoever is closest to it. Or
		-- leave the escorting to others and fetch a second seed, which gives the
		-- rivals two carriers to stop. One choice per trip, so it does not dither.
		for _, c in mates do
			if not c.carrying or c.home then
				continue
			end
			local key = c.id * 1000 + c.seeds
			if mem.secondRolls[key] == nil then
				mem.secondRolls[key] = rng() < SECOND_SEED
			end
			if g.nibbler == id or mem.secondRolls[key] then
				break
			end
			local guard = nil
			local guardD = 320 * PX
			for _, e in seen do
				if not e.home and not e.carrying and dist(e, c) < guardD then
					guardD = dist(e, c)
					guard = e
				end
			end
			if guard then
				mem.mode = "hunt"
				mem.targetId = guard.id
				mem.path = nil
				return
			end
		end

		-- Otherwise go for a seed. Only one hamster can nibble at a time and it has
		-- to hold still, so a rival near the flower has to be dealt with first.
		local fd = dist(me, f)
		local rival = nil
		local rivalD = math.huge
		if fd < 330 * PX and g.nibbler ~= id then
			for _, e in seen do
				if not e.carrying and not e.home and dist(e, f) <= 330 * PX then
					local d = if e.nibbler then 0 else dist(me, e)
					if d < rivalD then
						rivalD = d
						rival = e
					end
				end
			end
		end
		if rival then
			local roll = mem.huntRoll
			if roll.id ~= rival.id or now > roll.till then
				roll.id = rival.id
				roll.till = now + 2.5
				roll.yes = rng() < cfg.hunt
			end
			if roll.yes then
				mem.mode = "hunt"
				mem.targetId = rival.id
				mem.path = nil
				return
			end
		end
		mem.mode = "gather"
		if fd <= f.gatherR - 8 * PX then
			mem.path = nil
			return
		end
		-- Pick a free spot on the ring, preferably out of everyone's reach.
		local best, bestCost, bestSpot = nil, math.huge, nil
		local kept, keptCost = nil, math.huge
		nav.from(me, blocked)
		for _, spot in nav.gatherSpots do
			local crowd = 0
			for _, e in seen do
				local d = dist(e, spot)
				if d < TOUCH then
					crowd = math.huge
				elseif d < 70 * PX then
					crowd += 400 * PX
				end
			end
			if crowd ~= math.huge then
				local points, cost = routeTo(spot)
				cost += crowd
				if not best or cost < bestCost then
					best, bestCost, bestSpot = points, cost, spot
				end
				if spot == mem.spot then
					kept, keptCost = points, cost
				end
			end
		end
		-- Two spots are often as good as each other. Keep heading for the one already
		-- chosen unless another is clearly better, or the bot weaves between them.
		if kept and keptCost <= bestCost * 1.2 + 40 * PX then
			best, bestSpot = kept, mem.spot
		end
		mem.spot = bestSpot
		mem.path = best or { f }
	end

	-- Close-quarters movement against one opponent. Whoever walks into a hamster
	-- that is standing ready gets hit first, so: stand firm when charged, and when
	-- attacking, hover just out of reach to draw a swing at thin air before going in.
	local function engage(e)
		mem.targetId = e.id
		local duel = mem.duel
		if duel.id ~= e.id or now > duel.expires then
			duel.id = e.id
			duel.bait = rng() < cfg.bait
			duel.hold = rng() < cfg.hold
			duel.till = now + 0.5 + rng() * 1.1
			duel.expires = now + 2.4 + rng()
		end
		if not nav.clear(me, e) then
			follow((route(e)))
			return
		end
		local dx = e.x - me.x
		local dy = e.y - me.y
		local d = hypot(dx, dy)
		if d == 0 then
			d = 1
		end
		-- A swing that has started cannot be taken back: once it is seen, it has as
		-- good as landed, so that is the moment to go in. Without the footwork a bot
		-- waits until the rival is plainly stuck.
		if e.swing == "recovery" or (cfg.dance and e.swing and d > BONK.reach + 6 * PX) then
			steerTo(e.x, e.y)
			return
		end
		-- Right behind a rival that is running away there is nothing to hit: a swing
		-- from behind falls short of anyone who keeps going. All that can happen at
		-- its heels is that it turns and swings first. So follow a step out of that
		-- swing's reach, and be there when it has swung at nothing, or stops.
		local fleeing = cfg.trail and not e.swing and d < 140 * PX and (e.vx * dx + e.vy * dy) / d > 0.45 * SPEED
		local flee = mem.flee
		if not fleeing or flee.id ~= e.id or g.tick ~= flee.tick + 1 then
			flee.id = if fleeing then e.id else -1
			flee.since = now
		end
		flee.tick = g.tick
		-- Only one that has been going for a while: a step back in the middle of a
		-- fight is footwork, and is answered as such below.
		if fleeing and now - flee.since >= 0.35 then
			if d > cfg.trail then
				steerTo(e.x + e.vx * 0.12, e.y + e.vy * 0.12)
			end
			return
		end
		local charging = -(e.vx * dx + e.vy * dy) / d > 0.5 * SPEED
		if duel.hold and charging and d < 150 * PX then
			return
		end
		-- No feints against a rival with a seed: it is not there to fight, it is going
		-- past. Someone nibbling gets the short ones that draw its swing (see `lure`),
		-- unless its seed is about to come loose: then straight in.
		local busy = e.nibbler and hypot(e.vx, e.vy) < 20 * PX
		local hurry = busy and (not cfg.lure or Config.gatherTime(#g.players, now) - g.byId[e.id].gather < math.max(0, d - 60 * PX) / SPEED + 1.1)
		local dn = mem.dance
		if cfg.dance and busy and not hurry and (dn.id ~= e.id or now > dn.expires or not dn.nib) then
			dn.id = e.id
			dn.nib = now
			dn.out = false
			dn.turn = cfg.lure + rng() * 6 * PX
			dn.till = 0
			dn.feints = 0
			dn.most = 3
			dn.expires = now + 4
		elseif dn.nib then
			-- These feints are for the rival with its head down. Once that is well
			-- over, the next meeting gets the full footwork again.
			if busy then
				dn.nib = now
			elseif now - dn.nib > 1.5 then
				dn.id = -1
				dn.nib = nil
				dn.expires = 0
			end
		end
		if cfg.dance and not e.carrying and not hurry then
			-- Dash in to where a swing at me looks sure to land, then straight back
			-- out before it does. A few feints, and if nothing bites, go in for real.
			if dn.id ~= e.id or now > dn.expires then
				dn.id = e.id
				dn.nib = nil
				dn.out = false
				dn.turn = (58 + rng() * 10) * PX
				dn.till = 0
				dn.feints = 0
				dn.most = 2 + math.floor(rng() * 3)
				dn.expires = now + 4
			end
			if dn.feints < dn.most then
				if dn.out then
					out.mx = -dx / d
					out.my = -dy / d
					if now >= dn.till or d > 92 * PX then
						dn.out = false
						dn.turn = if dn.nib then cfg.lure + rng() * 6 * PX else (58 + rng() * 10) * PX
					end
				else
					out.mx = dx / d
					out.my = dy / d
					if d <= dn.turn then
						dn.out = true
						dn.till = now + 0.17 + rng() * 0.1
						dn.feints += 1
					end
				end
				return
			end
			steerTo(e.x + e.vx * 0.12, e.y + e.vy * 0.12)
			return
		end
		if duel.bait and now < duel.till then
			if d < 58 * PX then
				out.mx = -dx / d
				out.my = -dy / d
			elseif d > 68 * PX then
				out.mx = dx / d
				out.my = dy / d
			end
			return
		end
		steerTo(e.x + e.vx * 0.12, e.y + e.vy * 0.12)
	end

	-- Fills `into` with the rivals a seed thrown along (ax, ay) would reach,
	-- nearest first.
	local function byDistance(a, b)
		return dist(me, a) < dist(me, b)
	end
	local function inLine(into, ax, ay, reach, width)
		table.clear(into)
		for _, e in seen do
			local dx = e.x - me.x
			local dy = e.y - me.y
			local along = dx * ax + dy * ay
			if not e.home and along > 0 and along <= reach and math.abs(dx * ay - dy * ax) <= width and nav.sight(me, e) then
				table.insert(into, e)
			end
		end
		table.sort(into, byDistance)
		return into
	end

	local function face(e, k)
		local d = dist(me, e)
		if d == 0 then
			d = 1
		end
		out.mx = (e.x - me.x) / d * k
		out.my = (e.y - me.y) / d * k
	end

	-- A wind-up that has gone too far to be dropped would throw the seed at
	-- nothing, so a swing is started to swallow it instead; if no swing can start
	-- right now, it is held until one can. Returns whether to swing.
	local function swallow()
		if not me.swing and me.cooldown <= 0 and not mem.bonkDown then
			return true
		end
		mem.toss = -1
		return false
	end

	-- The same table every tick: read it before the next call.
	local function think(game_, seat)
		g = game_
		id = seat
		me = g.byId[id]
		out.mx = 0
		out.my = 0
		out.bonk = false
		out.throw = false
		if not me then
			return out
		end
		local bots = botsIn[g]
		if not bots then
			bots = {}
			botsIn[g] = bots
		end
		bots[id] = true
		record()
		if g.phase ~= "playing" then
			mem.bonkDown = false
			return out
		end

		map = g.map
		nav = Nav.get(map)
		now = g.time
		f = map.flower
		entries = nav.entries(g.homeX)
		tunnels = if me.carrying then NO_TUNNELS else map.warps
		tunnelling = false
		local meHome = inHome(g, me)

		table.clear(seen)
		table.clear(mates)
		for _, s in frameAgo(delayTicks) do
			if s.id == id or not g.byId[s.id] then
				continue
			end
			if allied(s, me) then
				table.insert(mates, s)
			else
				table.insert(seen, s)
				local was = mem.swung[s.id]
				local winding = s.swing == "windup"
				if winding and not (was and was.winding) then
					if was then
						was.at = now - cfg.reaction
						was.winding = true
					else
						mem.swung[s.id] = { at = now - cfg.reaction, winding = true }
					end
				elseif was then
					was.winding = winding
				end
			end
		end

		-- A thought that has just come to its end is taken up at once.
		if planner and planner.work() then
			mem.replanAt = 0
		end
		if now >= mem.replanAt then
			table.clear(laneUnits)
			for _, e in seen do
				if nav.inLanes(e) then
					table.insert(laneUnits, e)
				end
			end
			plan()
			mem.replanAt = now + (if planner then math.min(Search.every, 0.2) else 0.16 + rng() * 0.08)
			-- A rival at the flower with its head down is to be bonked, now. That is not
			-- up for a second opinion: weighing it is how a bot ends up standing and watching.
			local nibbler = if g.nibbler then g.byId[g.nibbler] else nil
			local atNibbler = mem.mode == "hunt" and nibbler ~= nil and mem.targetId == nibbler.id and hypot(nibbler.vx, nibbler.vy) < 20 * PX
			-- Nor is stopping a seed: the rule book defends, as the hard bot does. Its
			-- way of cutting a carrier off beat the look-ahead's second-guessing of it.
			local defending = mem.mode == "deny"
			-- At the flower with its own head down, the clock decides: stay if the seed
			-- comes loose before anyone can get here, otherwise deal with the first to come.
			local counted = false
			mem.nibbling = false
			if cfg.clock and g.nibbler == id and mem.mode == "gather" then
				local left = Config.gatherTime(#g.players, now) - me.gather
				local eta = math.huge
				for _, e in seen do
					if not e.home and not e.carrying then
						local way = if nav.clear(me, e) then dist(me, e) else nav.distance(me, e)
						eta = math.min(eta, math.max(0, way - BONK.reach) / SPEED + BONK.windup)
					end
				end
				if eta > left + cfg.clock then
					counted = true
					mem.nibbling = true
					mem.path = nil
				end
			end
			if planner and not atNibbler and not defending and not counted then
				local rules = { mode = mem.mode, targetId = mem.targetId, path = mem.path, entryY = mem.entryY }
				local idea = planner.choose(g, id, searchCost, rules)
				if idea ~= rules then
					mem.mode = idea.mode
					mem.targetId = idea.targetId or -1
					mem.path = idea.path
					if idea.entryY then
						mem.entryY = idea.entryY
					end
				end
			end
		end

		local target = if mem.targetId >= 0 then sawOf(mem.targetId) else nil
		if mem.mode == "home" then
			follow(mem.path)
			local met = false
			-- Someone standing in the way: fight through rather than walk into a bonk.
			for _, e in seen do
				if e.home then
					continue
				end
				local d = dist(me, e)
				if d > 150 * PX or not nav.clear(me, e) then
					continue
				end
				if (out.mx * (e.x - me.x) + out.my * (e.y - me.y)) / (if d > 0 then d else 1) < 0.5 then
					continue
				end
				out.mx = 0
				out.my = 0
				engage(e)
				met = true
				break
			end
			-- Someone in a side lane setting off for the spot I am about to cross
			-- means to be there with a swing as I pass (see `dodge`).
			if cfg.dodge and not met and (out.mx ~= 0 or out.my ~= 0) then
				local hx = out.mx
				local hy = out.my
				local lag = cfg.reaction + cfg.dodge
				local from = if now < mem.dodge.till then sawOf(mem.dodge.id) else nil
				if from and not from.home and from.swing ~= "recovery" then
					out.mx = mem.dodge.x
					out.my = mem.dodge.y
				else
					for _, e in seen do
						-- A person's trick. A bot never swings round a corner at what it
						-- cannot see, so from a bot there is nothing to step back from.
						if e.home or e.carrying or e.swing or bots[e.id] then
							continue
						end
						local dx = e.x - me.x
						local dy = e.y - me.y
						local d = hypot(dx, dy)
						if d == 0 then
							d = 1
						end
						-- From the side, that is: one ahead is met head on, one behind cannot reach.
						if d > 130 * PX or (hx * dx + hy * dy) / d < -0.2 or math.abs(e.vx * hy - e.vy * hx) < 0.4 * SPEED then
							continue
						end
						-- Only one that can have its swing there just as I cross.
						local mine = (hx * dx + hy * dy) / math.max(1 * PX, hypot(me.vx, me.vy)) - cfg.reaction
						local its = math.max(0, math.abs(hx * dy - hy * dx) - BONK.reach) / SPEED + BONK.windup
						if mine > its + 0.1 then
							continue
						end
						local atX = e.x + e.vx * lag
						local atY = e.y + e.vy * lag
						if distToSegment(atX, atY, me.x, me.y, me.x + hx * 100 * PX, me.y + hy * 100 * PX) > BONK.reach + 6 * PX then
							continue
						end
						-- Not back into somebody else.
						local behind = false
						for _, r in seen do
							if r ~= e and not r.home and dist(me, r) < 110 * PX and (r.x - me.x) * hx + (r.y - me.y) * hy < 0 then
								behind = true
								break
							end
						end
						if behind then
							continue
						end
						mem.dodge.id = e.id
						mem.dodge.till = now + cfg.dodge
						mem.dodge.x = -hx
						mem.dodge.y = -hy
						out.mx = -hx
						out.my = -hy
						break
					end
				end
			end
		elseif mem.mode == "deny" and target then
			if dist(me, target) < (if mem.flank then 100 else 230) * PX and nav.clear(me, target) then
				engage(target)
			elseif mem.path then
				follow(mem.path)
			else
				engage(target)
			end
		elseif mem.mode == "hunt" and target then
			engage(target)
		elseif mem.path then
			follow(mem.path)
		end

		-- A swing seen coming (see `flinch`): out of its reach, straight back. Nothing
		-- else it could do in that moment is worth being sent home for.
		local flinching = false
		if cfg.flinch and not me.swing and not meHome then
			for _, e in frameAgo(flinchTicks) do
				if e.id == id or allied(e, me) or e.home or not e.swing or not g.byId[e.id] then
					continue
				end
				local dx = me.x - e.x
				local dy = me.y - e.y
				local d = hypot(dx, dy)
				if d == 0 then
					d = 1
				end
				if e.swing == "windup" then
					-- Only one that would land: in reach, in its arc, nothing in between.
					if d > BONK.reach + 3 * PX or (d > R and (dx * e.aimX + dy * e.aimY) / d < BONK.arcCos - 0.1) then
						continue
					end
					if not nav.sight(me, e) then
						continue
					end
					out.mx = dx / d
					out.my = dy / d
					flinching = true
					mem.flinch.id = e.id
					mem.flinch.till = now + BONK.windup + BONK.recovery
					break
				end
				-- It has swung at nothing and is stuck: back in for the hit, unless there
				-- is a seed to take home instead.
				if e.id == mem.flinch.id and now < mem.flinch.till and not me.carrying and d < 90 * PX then
					out.mx = -dx / d
					out.my = -dy / d
					break
				end
			end
		end

		-- Break out of the rare case where steering presses into a corner.
		local stuck = mem.stuck
		if now - stuck.at > 0.6 then
			local wants = hypot(out.mx, out.my) > 0.5 and not me.swing
			if wants and hypot(me.x - stuck.x, me.y - stuck.y) < 5 * PX then
				local a = rng() * math.pi * 2
				mem.nudge.till = now + 0.3
				mem.nudge.x = math.cos(a)
				mem.nudge.y = math.sin(a)
				mem.replanAt = 0
			end
			stuck.x = me.x
			stuck.y = me.y
			stuck.at = now
		end

		-- Pickpocketing: at the heels of a seed carrier a swing falls short, but
		-- staying pressed up against it takes the seed. So a carrier that is not
		-- running at me gets rubbed up against instead of swung at, and once the gauge
		-- is going the bot keeps at it. One coming straight at me is still met with a
		-- swing. The top bot only does when the carrier cannot answer: right up
		-- against a carrier it is in reach of the carrier's swing, so otherwise it
		-- follows out of reach and punishes a swing at nothing (see `trail`). It goes
		-- in when that wait is not worth it: the carrier has just swung and cannot
		-- again before the gauge fills, it is nearly home, or it has kept running
		-- without ever turning.
		local rubbing = -1
		if not me.carrying and not meHome and me.pickBlock <= 0 and not me.swing and not flinching then
			for _, e in seen do
				if not e.carrying or e.home or not nav.clear(me, e) then
					continue
				end
				local dx = e.x - me.x
				local dy = e.y - me.y
				local d = hypot(dx, dy)
				local away = (e.vx * dx + e.vy * dy) / (if d > 0 then d else 1)
				if cfg.trail and me.pickOn ~= e.id then
					local left = Config.pickTime(#g.players, now)
					local swung = mem.swung[e.id]
					local free = if swung then math.max(0, swung.at + BONK.cooldown - now) else 0
					local unanswered = free + BONK.windup > left + 0.03
					-- Waiting for a swing only pays while there is time for one: not this
					-- close to home, nor behind one that has run on without turning.
					local runner = mem.flee.id == e.id and now - mem.flee.since >= cfg.rubAfter
					if not unanswered and not runner and not (cfg.rubHome and lastStandFor(e)) then
						continue
					end
				end
				if me.pickOn ~= e.id and (d > 110 * PX or away < -0.2 * SPEED) then
					continue
				end
				rubbing = e.id
				steerTo(e.x + e.vx * 0.15, e.y + e.vy * 0.15)
				break
			end
		end

		local wantX = out.mx
		local wantY = out.my
		if now < mem.nudge.till then
			out.mx = mem.nudge.x
			out.my = mem.nudge.y
		end

		if not me.carrying and not tunnelling then
			-- A seed carrier is safe from the tunnel it stands in, and whoever follows
			-- it in is sent home. Stop at the rim, which is still within reach of
			-- anyone inside.
			for _, w in map.warps do
				local rx = me.x - w.x
				local ry = me.y - w.y
				local d = hypot(rx, ry)
				if d == 0 then
					d = 1
				end
				local room = math.max(0, d - w.r - RIM) / (SPEED * DT)
				local inward = -(out.mx * rx + out.my * ry) / d
				if inward <= room then
					continue
				end
				out.mx += rx / d * (inward - room)
				out.my += ry / d * (inward - room)
				-- Headed straight in, that leaves it standing still: go round to the target's side.
				if target and hypot(out.mx, out.my) < 0.3 and dist(me, target) > BONK.reach - cfg.margin - cfg.jitter then
					local side = if -ry * (target.x - me.x) + rx * (target.y - me.y) < 0 then -1 else 1
					out.mx = side * -ry / d
					out.my = side * rx / d
				end
			end

			-- The last word on tunnels: a step that would end inside one is not taken.
			-- The rim logic above only cancels walking straight in. Sliding round the
			-- rim is another way in, above all between a tunnel and the map's edge,
			-- where there is no room to pass and the edge pushes a hamster inwards.
			if out.mx ~= 0 or out.my ~= 0 then
				local b = map.bounds
				local nx = math.clamp(me.x + out.mx * SPEED * DT, b.x1 + R, b.x2 - R)
				local ny = math.clamp(me.y + out.my * SPEED * DT, b.y1 + R, b.y2 - R)
				for _, w in map.warps do
					local next = hypot(nx - w.x, ny - w.y)
					if next < w.r + RIM and next < hypot(me.x - w.x, me.y - w.y) - 0.01 * PX then
						out.mx = 0
						out.my = 0
						break
					end
				end
			end
		end

		-- Seed throw. A carrier can give its seed up to knock down whoever is lined up
		-- ahead: well worth it for two at once or a rival's seed, a gamble against one
		-- hamster blocking the way. It winds up on the walk and lets go once it would hit.
		local abort = false
		if me.carrying and not meHome then
			local wl = hypot(wantX, wantY)
			local hx = if wl > 0.3 then wantX / wl else me.fx
			local hy = if wl > 0.3 then wantY / wl else me.fy
			inLine(ahead, hx, hy, THROW.range + 30 * PX, THROW.width + 6 * PX)
			-- Close to home the seed stays in its cheeks, whoever is standing there.
			local keep = cfg.thrifty and me.x - g.homeX < cfg.thrifty
			if keep and mem.toss then
				-- A wind-up begun further out is called off: dropped if it is early
				-- enough, otherwise swallowed by a swing.
				mem.toss = nil
				if me.charge >= THROW.charge - 2 * DT then
					abort = swallow()
				end
			end
			if not keep and not mem.toss and #ahead > 0 then
				local first = ahead[1]
				local roll = mem.tossRoll
				if roll.id ~= first.id or now > roll.till then
					local sure = #ahead > 1 or first.carrying
					-- Caught between one ahead and one coming up behind, the seed is lost
					-- either way: then it may as well take somebody with it.
					local boxed = false
					if cfg.boxed and not sure then
						for _, e in seen do
							if not e.home and not table.find(ahead, e) and dist(me, e) < cfg.boxed and nav.clear(me, e) and (e.x - me.x) * hx + (e.y - me.y) * hy < 0 then
								boxed = true
								break
							end
						end
					end
					roll.id = first.id
					roll.till = now + 3
					roll.yes = rng() < (if sure or boxed then cfg.volley else cfg.toss)
				end
				mem.toss = if roll.yes then first.id else nil
			end
			if mem.toss then
				out.throw = true
				-- Keep the one it wound up for in its sights, whatever the route home
				-- says, and stand off rather than walk into its reach.
				local mark = sawOf(mem.toss)
				local inSight = mark ~= nil and not mark.home and dist(me, mark) < THROW.range + 30 * PX and nav.sight(me, mark)
				if mark and inSight then
					face(mark, if dist(me, mark) < 90 * PX then 0.08 else 1)
				end
				inLine(hit, me.fx, me.fy, THROW.range - 8 * PX, THROW.width - 5 * PX)
				if me.charge >= THROW.charge and #hit > 0 then
					out.throw = false
					mem.toss = nil
					face(hit[1], 0.08)
				elseif not inSight or me.charge > THROW.max - 0.3 then
					-- It got away. A wind-up let go early is simply dropped.
					mem.toss = nil
					if me.charge < THROW.charge - 2 * DT then
						out.throw = false
					else
						abort = swallow()
					end
				end
			end
		else
			mem.toss = nil
		end

		if cfg.wary then
			-- How each rival comes at me: how near it gets before it turns away again.
			for _, e in seen do
				local dx = e.x - me.x
				local dy = e.y - me.y
				local d = hypot(dx, dy)
				if d == 0 then
					d = 1
				end
				local closing = -(e.vx * dx + e.vy * dy) / d
				local h = mem.habit[e.id]
				if not h then
					h = { coming = false, min = math.huge, turns = {} }
					mem.habit[e.id] = h
				end
				if e.home or d > 120 * PX then
					h.coming = false
				elseif closing > 0.4 * SPEED then
					h.min = if h.coming then math.min(h.min, d) else d
					h.coming = true
				elseif h.coming and closing < -0.3 * SPEED then
					table.insert(h.turns, math.min(h.min, d))
					if #h.turns > 3 then
						table.remove(h.turns, 1)
					end
					h.coming = false
				end
			end

			-- Fooled: I swung at somebody, hit nothing, and that same somebody bonked
			-- me while I was stuck. Once is enough to start treating it differently.
			for _, ev in g.events do
				if ev.type == "impact" and ev.id == id and mem.aimedAt >= 0 then
					if not ev.hit then
						mem.whiff.id = mem.aimedAt
						mem.whiff.till = now + 1
					end
					mem.aimedAt = -1
				end
			end
			for _, ev in g.events do
				if ev.type == "bonk" and ev.id == id then
					if ev.by == mem.whiff.id and now <= mem.whiff.till then
						mem.fooled[ev.by] = (mem.fooled[ev.by] or 0) + 1
					end
					break
				end
			end
		end

		-- Swing decision.
		local want = false
		local wantId = -1
		local wantDist = math.huge
		local giveX, giveY = nil, nil
		if not me.swing and me.cooldown <= 0 and not meHome then
			if now >= mem.noiseAt then
				mem.noise = (rng() * 2 - 1) * cfg.jitter
				mem.noiseAt = now + 0.4
			end
			local lead = BONK.windup + cfg.reaction * cfg.lead
			local limit = BONK.reach - cfg.margin + mem.noise
			for _, e in seen do
				-- Already rubbing away at it: a swing would only throw the gauge away.
				if e.home or (e.id == rubbing and me.pickOn == e.id) then
					continue
				end
				local reach = predictSwing(me, e, lead)
				if reach > limit or not nav.clear(me, e) then
					continue
				end
				-- A swing roots me through the hit and after it. With no teams, and
				-- another rival close by and ready to swing, that is a free hit for it,
				-- so only a seed is worth it then. On a team the one close by is the
				-- target's team-mate, and mine are about too.
				if cfg.crowd and me.team < 0 and not e.carrying and not me.carrying then
					local crowded = false
					for _, o in seen do
						if o.id ~= e.id and not o.home and o.swing ~= "recovery" and dist(o, me) < cfg.crowd then
							crowded = true
							break
						end
					end
					if crowded then
						continue
					end
				end
				local dx = e.x - me.x
				local dy = e.y - me.y
				local d = hypot(dx, dy)
				if d == 0 then
					d = 1
				end
				local closing = -((e.vx - me.vx) * dx + (e.vy - me.vy) * dy) / d
				local hostile = closing > 0.3 * SPEED or e.swing == "windup"
				-- Standing right where I am trying to go: the only way past is through.
				local inMyWay = d < BONK.reach and (wantX * dx + wantY * dy) / d > 0.5
				-- Rubbing up against my seed: that one is after it as surely as a swing is.
				local thief = cfg.guard and me.carrying and e.pickOn == id
				local wanted = thief or inMyWay or e.carrying or e.id == mem.targetId or e.swing == "recovery" or (not me.carrying and e.nibbler)
				-- At my heels, both of us running the same way, for long enough to be sure.
				local ambush = false
				if cfg.ambush then
					local tailing = not e.swing and not e.carrying and -(me.vx * dx + me.vy * dy) / d > 0.45 * SPEED and -(e.vx * dx + e.vy * dy) / d > 0.45 * SPEED
					if tailing then
						local was = mem.tail[e.id]
						if not was then
							was = { tick = -1, since = 0 }
							mem.tail[e.id] = was
						end
						if was.tick ~= g.tick - 1 then
							was.since = now
						end
						was.tick = g.tick
						ambush = now - was.since >= cfg.ambush
					end
				end
				if not hostile and not wanted and not ambush and rng() >= cfg.opportunism * DT then
					continue
				end
				-- The rival is not in reach yet, only on its way: this swing counts on it
				-- carrying on. That is exactly what a feint looks like, so a wary bot
				-- often lets it come, backing off, and swings once it is really there.
				-- A rival with a seed has to come through, so that one is swung at as
				-- ever. Not against a rival standing at the flower with its head down.
				local busy = e.nibbler and hypot(e.vx, e.vy) < 20 * PX
				if cfg.wary and not ambush and not thief and not e.swing and not e.carrying and not busy then
					local fooled = (mem.fooled[e.id] or 0) > 0
					local there = d <= BONK.reach - 3 * PX and closing > -0.2 * SPEED
					local stay = mem.inReach[e.id]
					if not stay then
						stay = { tick = -1, n = 0 }
						mem.inReach[e.id] = stay
					end
					stay.n = if not there then 0 elseif stay.tick == g.tick - 1 then stay.n + 1 else 1
					stay.tick = g.tick
					-- Where it will be when a swing started now lands, if it keeps coming.
					-- Once that is past the point of touching, the swing is too late: it
					-- will have bumped into me and may already be on its way back out.
					local inward = -(e.vx * dx + e.vy * dy) / d
					local onTime = inward > 0.5 * SPEED and d - inward * lead >= TOUCH + 1 * PX
					-- Against someone who has fooled it before, one guess per approach:
					-- take the swing, or let it come.
					local patience = mem.patience
					if patience.id ~= e.id or now > patience.till then
						patience.id = e.id
						patience.till = now + 0.7
						patience.hold = fooled and rng() < cfg.wary
					end
					-- It has shown how it comes at me. One that runs right up before it
					-- turns will be there when a well-timed swing lands, so that swing is
					-- always on. One that turns short of my reach is feinting or about to
					-- commit, and there is no telling which.
					local h = mem.habit[e.id]
					local comesClose = false
					if h and #h.turns > 0 then
						local sum = 0
						for _, t in h.turns do
							sum += t
						end
						comesClose = sum / #h.turns <= BONK.reach - 1 * PX
					end
					-- From the first meeting on, a swing at a rival running in is only ever
					-- the timely one. Once it has got as far as touching, swinging is what
					-- it wants: step back instead. A rival that is not rushing in is fair game.
					local fire = stay.n >= 3 or (onTime and (comesClose or not patience.hold)) or (not fooled and inward <= 0.5 * SPEED)
					if not fire then
						if not there then
							giveX = -dx / d
							giveY = -dy / d
						end
						continue
					end
				end
				if not want or reach < wantDist then
					want = true
					wantDist = reach
					wantId = e.id
				end
			end
		end
		if flinching then
			want = false
		end
		if giveX and not want and not mem.nibbling and not flinching and rubbing < 0 then
			out.mx = giveX
			out.my = giveY
			-- Not into a tunnel, though.
			if not me.carrying then
				for _, w in map.warps do
					if hypot(me.x + out.mx * 8 * PX - w.x, me.y + out.my * 8 * PX - w.y) < w.r + RIM + 2 * PX then
						out.mx = 0
						out.my = 0
						break
					end
				end
			end
		end

		-- A weaker bot dithers: the chance has to stay open for a moment before it swings.
		if not want then
			mem.swingAt = -1
		elseif mem.swingAt < 0 then
			mem.swingAt = now + cfg.freeze * (0.5 + rng())
		end
		if want and now < mem.swingAt then
			want = false
		end
		if abort and not want then
			want = true
			wantId = -1
		end
		if want and not mem.bonkDown then
			out.bonk = true
			mem.bonkDown = true
			mem.aimedAt = wantId
			-- A swing and a throw do not mix: the bonk goes first and the wind-up is dropped.
			out.throw = false
			mem.toss = nil
		else
			mem.bonkDown = false
		end
		return out
	end

	return { think = think }
end

return Bot

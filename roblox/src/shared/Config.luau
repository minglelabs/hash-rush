-- Every tuning value of the game. Distances are studs (10 web pixels = 1 stud),
-- times are seconds.

local Config = {}

Config.TICK_RATE = 60
Config.DT = 1 / Config.TICK_RATE

Config.HAMSTER_R = 1.5
Config.SPEED = 18.5
-- A hamster with a seed is slower, and slower still right before home.
Config.CARRY_SPEED = 0.85
Config.ALARM_RANGE = 19
Config.LAST_STRETCH_SPEED = 0.7

Config.COUNTDOWN = 3

-- Stalemate breaker: after `start` the home edge creeps towards the flower, from
-- `rush` it comes on fast. A seed comes loose quicker (down to `nibble` of the
-- usual time at `rush`), and whoever is knocked out sits dazed for `daze`.
-- At `finish` the round is called on bonks.
Config.OVERTIME = { start = 40, speed = 0.65, rush = 70, rushSpeed = 2.0, nibble = 0.45, daze = 1.5, finish = 105 }

Config.GATHER_TIME = 2.2
-- Four players is the baseline; more players nibble quicker.
function Config.gatherTime(players: number, time: number?): number
	local ot = Config.OVERTIME
	local late = math.clamp(((time or 0) - ot.start) / (ot.rush - ot.start), 0, 1)
	return (Config.GATHER_TIME * 4 / math.max(4, players)) * (1 - (1 - ot.nibble) * late)
end

Config.BONK = {
	windup = 0.14, -- standing still before the hit lands
	recovery = 0.42, -- stuck after the hit; a whiff is punishable
	cooldown = 0.8, -- from swing start until the next swing
	reach = 4, -- centre-to-centre distance that still hits
	arcCos = math.cos(math.rad(75)),
	recoveryMove = 0.15,
	chain = 2, -- a knock-out this soon after the last one makes a double, a triple...
	assist = 8, -- auto-aim picks the nearest rival inside this radius
}

Config.THROW = { charge = 0.4, max = 1.6, range = 12, width = 2.1 }

-- Lobby and round flow.
Config.MIN_PLAYERS = 2
Config.MAX_PLAYERS = 8
-- Once enough players are ready, the rest get this long to join in.
Config.LOBBY_COUNTDOWN = 10

-- One colour per seat, as { r, g, b } 0..255.
Config.COLORS = {
	{ 244, 162, 97 },
	{ 255, 255, 255 },
	{ 120, 144, 156 },
	{ 255, 213, 79 },
	{ 161, 136, 127 },
	{ 240, 98, 146 },
	{ 100, 181, 246 },
	{ 174, 213, 129 },
}

return Config

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
Config.OVERTIME = { start = 80, speed = 0.65, rush = 110, rushSpeed = 2.0, nibble = 0.45, daze = 1.5, finish = 145 }

Config.GATHER_TIME = 2.2
-- How far overtime has sped things up: 1 until it starts, down to `nibble` by `rush`.
local function hurry(time: number?): number
	local ot = Config.OVERTIME
	local late = math.clamp(((time or 0) - ot.start) / (ot.rush - ot.start), 0, 1)
	return 1 - (1 - ot.nibble) * late
end
-- Four players is the baseline; more players nibble quicker.
function Config.gatherTime(players: number, time: number?): number
	return (Config.GATHER_TIME * 4 / math.max(4, players)) * hurry(time)
end

-- Pickpocketing: an empty-handed rival who keeps rubbing up against a seed
-- carrier, moving or not, takes the seed after `time` seconds, however many are
-- in the round; quicker in overtime, as nibbling is. Whoever lost it cannot take
-- it straight back for `block` seconds.
Config.PICK = { reach = 2 * Config.HAMSTER_R + 0.6, time = 0.5, block = 1 }
function Config.pickTime(_players: number, time: number?): number
	return Config.PICK.time * hurry(time)
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

-- `friendlyFire` decides whether a thrown seed takes team-mates in its way down too.
Config.THROW = { charge = 0.4, max = 1.6, range = 12, width = 2.1, friendlyFire = false }

-- Lobby and round flow.
Config.MIN_PLAYERS = 2
Config.MAX_PLAYERS = 8
-- Once enough players are ready, the rest get this long to join in.
Config.LOBBY_COUNTDOWN = 10

-- One look per seat, as the web game has them (src/client/looks.js): fur, ears,
-- belly, paws, and the seat's own colour for the outline, the name and the nest.
local function hex(h: string): Color3
	return Color3.fromHex(h)
end
Config.LOOKS = {
	{ fur = hex("#f7b558"), ear = hex("#e3963b"), belly = hex("#fff4dc"), paw = hex("#f3c9a0"), color = hex("#e5484d") },
	{ fur = hex("#f6f1ea"), ear = hex("#dccfbd"), belly = hex("#ffffff"), paw = hex("#f3c9c0"), color = hex("#2f6fed") },
	{ fur = hex("#96613f"), ear = hex("#744829"), belly = hex("#edd5ba"), paw = hex("#e0b796"), color = hex("#1f9d55") },
	{ fur = hex("#a3abb5"), ear = hex("#808993"), belly = hex("#eff2f5"), paw = hex("#e3c4bc"), color = hex("#9b51e0") },
	{ fur = hex("#4a403c"), ear = hex("#332b28"), belly = hex("#ddd2c8"), paw = hex("#e0b7a8"), color = hex("#f2851d") },
	{ fur = hex("#efcf94"), ear = hex("#d8ac68"), belly = hex("#fffaf0"), paw = hex("#f1cfae"), color = hex("#0fa3a3") },
	{ fur = hex("#cf8562"), ear = hex("#ad6243"), belly = hex("#fbe6d6"), paw = hex("#f0c2a8"), color = hex("#e0529c") },
	{ fur = hex("#d9d2c3"), ear = hex("#b8ad98"), belly = hex("#ffffff"), paw = hex("#eccbc0"), color = hex("#b58900") },
}
-- In a team round the outline, the name and the nest take the team's colour.
Config.TEAMS = {
	[0] = { color = hex("#e5484d") },
	[1] = { color = hex("#2f6fed") },
}
-- The colour a bot's level is written in under it. The words are in Lang.
Config.BOT_LEVELS = {
	easy = { color = hex("#1f9d55") },
	normal = { color = hex("#e08a00") },
	hard = { color = hex("#d63031") },
	ace = { color = hex("#8e44ad") },
	rl = { color = hex("#0984e3") },
}

-- A hamster's colour: its team's in a team round, its seat's otherwise.
function Config.colorOf(seat: number, team: number?): Color3
	return if team and Config.TEAMS[team] then Config.TEAMS[team].color else Config.LOOKS[seat].color
end

return Config

-- The world as the server sends it every tick, packed into a buffer so it stays
-- well under the size limit of an UnreliableRemoteEvent.
--
-- header (19 bytes): u8 round, u16 tick, u8 phase, f32 countdown, f32 time,
--   f32 homeX, u8 nibbler id (0 = nobody), u8 gather progress (0..255), u8 players
-- per player (16 bytes): u8 id, f32 x, f32 y, f32 facing angle, u8 flags,
--   u8 throw charge (0..255 of THROW.max), u8 pickpocket progress (0..255)

local Config = require(script.Parent:WaitForChild("Config"))

local Snapshot = {}

local HEADER = 19
local PER_PLAYER = 16
local PHASES = { "countdown", "playing", "over" }

local CARRYING, WINDUP, RECOVERY, DAZED, ALARM = 1, 2, 4, 8, 16

local function byte(fraction)
	return math.clamp(math.floor(fraction * 255 + 0.5), 0, 255)
end

-- `alarm(p)` says whether p is a carrier in the last stretch.
function Snapshot.encode(round, g, alarm)
	local players = g.players
	local b = buffer.create(HEADER + PER_PLAYER * #players)
	local gather = 0
	local pickTime = Config.pickTime(#players, g.time)
	local nibbler = g.nibbler and g.byId[g.nibbler]
	if nibbler then
		gather = nibbler.gather / Config.gatherTime(#players, g.time)
	end
	buffer.writeu8(b, 0, round % 256)
	buffer.writeu16(b, 1, g.tick % 65536)
	buffer.writeu8(b, 3, table.find(PHASES, g.phase) or 1)
	buffer.writef32(b, 4, g.countdown)
	buffer.writef32(b, 8, g.time)
	buffer.writef32(b, 12, g.homeX)
	buffer.writeu8(b, 16, g.nibbler or 0)
	buffer.writeu8(b, 17, byte(gather))
	buffer.writeu8(b, 18, #players)
	for i, p in players do
		local o = HEADER + (i - 1) * PER_PLAYER
		local flags = 0
		if p.carrying then
			flags += CARRYING
		end
		if p.swing then
			flags += if p.swing.windup then WINDUP else RECOVERY
		end
		if p.dazed > 0 then
			flags += DAZED
		end
		if alarm(p) then
			flags += ALARM
		end
		buffer.writeu8(b, o, p.id)
		buffer.writef32(b, o + 1, p.x)
		buffer.writef32(b, o + 5, p.y)
		buffer.writef32(b, o + 9, math.atan2(p.fy, p.fx))
		buffer.writeu8(b, o + 13, flags)
		buffer.writeu8(b, o + 14, byte(p.charge / Config.THROW.max))
		buffer.writeu8(b, o + 15, byte(p.pick / pickTime))
	end
	return b
end

function Snapshot.decode(b)
	local snap = {
		round = buffer.readu8(b, 0),
		tick = buffer.readu16(b, 1),
		phase = PHASES[buffer.readu8(b, 3)],
		countdown = buffer.readf32(b, 4),
		time = buffer.readf32(b, 8),
		homeX = buffer.readf32(b, 12),
		nibbler = buffer.readu8(b, 16),
		gather = buffer.readu8(b, 17) / 255,
		players = {},
	}
	for i = 1, buffer.readu8(b, 18) do
		local o = HEADER + (i - 1) * PER_PLAYER
		local flags = buffer.readu8(b, o + 13)
		local angle = buffer.readf32(b, o + 9)
		table.insert(snap.players, {
			id = buffer.readu8(b, o),
			x = buffer.readf32(b, o + 1),
			y = buffer.readf32(b, o + 5),
			fx = math.cos(angle),
			fy = math.sin(angle),
			carrying = bit32.btest(flags, CARRYING),
			windup = bit32.btest(flags, WINDUP),
			recovery = bit32.btest(flags, RECOVERY),
			dazed = bit32.btest(flags, DAZED),
			alarm = bit32.btest(flags, ALARM),
			charge = buffer.readu8(b, o + 14) / 255 * Config.THROW.max,
			pick = buffer.readu8(b, o + 15) / 255,
		})
	end
	return snap
end

return Snapshot

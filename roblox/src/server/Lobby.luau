-- Who is in the server, who plays the next round and who runs the lobby, as in
-- the web game's rooms. Plain state with no Roblox in it: Round.server.luau tells
-- it who comes and goes and what is asked for, and test/lobby.luau checks it.
--   The first to arrive is the host. When the host leaves, the first one playing
--   takes over, else the first one watching. The host may hand it on.
--   There are `max` seats. Whoever arrives while there is room plays; the rest
--   watch. A seat freed by someone leaving goes to whoever has waited longest,
--   unless they were taken out, by the host or by themselves.
--   The host puts anyone in or takes them out. Anyone may take themselves out,
--   and put themselves back in while there is room.

local Lobby = {}
Lobby.__index = Lobby

export type Lobby = typeof(setmetatable(
	{} :: { max: number, joined: { any }, playing: { [any]: boolean }, benched: { [any]: boolean }, host: any },
	Lobby
))

function Lobby.new(max: number): Lobby
	return setmetatable({ max = max, joined = {}, playing = {}, benched = {}, host = nil }, Lobby)
end

-- How many play the next round.
function Lobby.count(self: Lobby): number
	local n = 0
	for _, p in self.joined do
		if self.playing[p] then
			n += 1
		end
	end
	return n
end

function Lobby.isPlaying(self: Lobby, p: any): boolean
	return self.playing[p] == true
end

function Lobby.isHere(self: Lobby, p: any): boolean
	return table.find(self.joined, p) ~= nil
end

-- Free seats to whoever has waited longest and was not taken out.
function Lobby.fill(self: Lobby)
	for _, p in self.joined do
		if self:count() >= self.max then
			return
		end
		if not self.playing[p] and not self.benched[p] then
			self.playing[p] = true
		end
	end
end

function Lobby.passHost(self: Lobby)
	if self.host ~= nil and self:isHere(self.host) then
		return
	end
	self.host = nil
	for _, p in self.joined do
		if self.playing[p] then
			self.host = p
			return
		end
	end
	self.host = self.joined[1]
end

function Lobby.join(self: Lobby, p: any)
	if self:isHere(p) then
		return
	end
	table.insert(self.joined, p)
	self:fill()
	self:passHost()
end

function Lobby.leave(self: Lobby, p: any)
	local at = table.find(self.joined, p)
	if at then
		table.remove(self.joined, at)
	end
	self.playing[p] = nil
	self.benched[p] = nil
	-- Seats first, so that whoever just sat down can take the lobby over.
	self:fill()
	self:passHost()
end

-- `by` asks for `who` to play (want) or watch. True when that changed anything.
function Lobby.seat(self: Lobby, by: any, who: any, want: boolean): boolean
	if not self:isHere(by) or not self:isHere(who) or (by ~= self.host and by ~= who) then
		return false
	end
	if want then
		if self.playing[who] or self:count() >= self.max then
			return false
		end
		self.playing[who] = true
		self.benched[who] = nil
	else
		if not self.playing[who] then
			return false
		end
		self.playing[who] = nil
		self.benched[who] = true
	end
	return true
end

-- The host gives the lobby to someone else in it.
function Lobby.handOver(self: Lobby, by: any, who: any): boolean
	if by ~= self.host or who == by or not self:isHere(who) then
		return false
	end
	self.host = who
	return true
end

return Lobby

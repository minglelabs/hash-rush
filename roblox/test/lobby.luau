-- Checks the lobby's host and seats (src/server/Lobby.luau): who hosts, who plays,
-- who watches, and who may change that.
--   node roblox/tools/wrap.mjs && luau roblox/test/lobby.luau

local shim = require("./shim")
local Lobby = shim.require(shim.game:GetService("ServerScriptService"):WaitForChild("Lobby"))

local failures = 0
local function check(ok, what)
	if not ok then
		failures += 1
		print("FAIL  " .. what)
	end
end

local function people(n)
	local list = {}
	for i = 1, n do
		list[i] = { name = "p" .. i }
	end
	return list
end

local function playingNames(lobby)
	local names = {}
	for _, p in lobby.joined do
		if lobby:isPlaying(p) then
			table.insert(names, p.name)
		end
	end
	return table.concat(names, " ")
end

-- Fifty arrive: the first eight play, the first one hosts.
do
	local lobby = Lobby.new(8)
	local p = people(50)
	for _, who in p do
		lobby:join(who)
	end
	check(lobby.host == p[1], "the first to arrive hosts")
	check(lobby:count() == 8, "eight play: " .. lobby:count())
	check(playingNames(lobby) == "p1 p2 p3 p4 p5 p6 p7 p8", "the first eight play: " .. playingNames(lobby))
	check(not lobby:isPlaying(p[9]), "the ninth watches")

	-- Only the host moves others; anyone may move themselves.
	check(not lobby:seat(p[2], p[3], false), "a guest cannot take someone else out")
	check(not lobby:seat(p[9], p[9], true), "nobody gets in while the seats are full")
	check(lobby:seat(p[1], p[3], false), "the host takes p3 out")
	check(lobby:count() == 7 and not lobby:isPlaying(p[3]), "p3 watches")
	check(lobby:count() == 7, "the seat stays open for the host to give")
	check(lobby:seat(p[1], p[20], true), "the host puts p20 in")
	check(lobby:isPlaying(p[20]) and lobby:count() == 8, "p20 plays")
	check(not lobby:seat(p[1], p[21], true), "not past eight")
	check(lobby:seat(p[5], p[5], false), "p5 takes itself out")
	check(lobby:seat(p[9], p[9], true), "p9 takes the open seat itself")
	check(not lobby:seat(p[5], p[5], true), "full again: p5 cannot get back in")

	-- Someone playing leaves: the longest waiting who was not taken out gets in.
	lobby:leave(p[2])
	check(lobby:isPlaying(p[10]), "p10, waiting longest, takes p2's seat: " .. playingNames(lobby))
	check(not lobby:isPlaying(p[3]) and not lobby:isPlaying(p[5]), "those taken out are not put back by themselves")

	-- The host leaves: the first one playing takes over.
	lobby:leave(p[1])
	check(lobby.host == p[4], "the host passes to the first one playing: " .. tostring(lobby.host and lobby.host.name))
	check(lobby:isPlaying(p[11]), "and p11 takes the host's seat")

	-- Handing over.
	check(not lobby:handOver(p[6], p[7]), "only the host hands over")
	check(lobby:handOver(p[4], p[30]), "the host hands the lobby to a watcher")
	check(lobby.host == p[30], "p30 hosts")
	check(lobby:seat(p[30], p[3], true) == false, "full: even the host cannot put a ninth in")
end

-- Everyone playing leaves: a watcher hosts.
do
	local lobby = Lobby.new(2)
	local p = people(3)
	for _, who in p do
		lobby:join(who)
	end
	check(not lobby:isPlaying(p[3]), "p3 watches: two seats")
	check(lobby:seat(p[1], p[2], false), "the host takes p2 out")
	check(not lobby:isPlaying(p[2]), "p2 watches")
	lobby:leave(p[1])
	check(lobby:isPlaying(p[3]) and not lobby:isPlaying(p[2]), "the host's seat goes to p3, not to p2 who was taken out")
	check(lobby.host == p[3], "the one playing hosts")
	lobby:leave(p[3])
	check(lobby.host == p[2], "the last one left hosts, watching or not")
	check(not lobby:isPlaying(p[2]), "taken out stays out")
	check(lobby:seat(p[2], p[2], true), "and can sit down again")
	lobby:leave(p[2])
	check(lobby.host == nil and #lobby.joined == 0, "an empty lobby has no host")
end

-- Asking twice changes nothing; strangers change nothing.
do
	local lobby = Lobby.new(8)
	local p = people(2)
	lobby:join(p[1])
	lobby:join(p[1])
	check(#lobby.joined == 1, "joining twice counts once")
	check(not lobby:seat(p[1], p[2], false), "nothing for someone not here")
	check(not lobby:seat(p[1], p[1], true), "already playing")
	check(not lobby:handOver(p[1], p[1]), "not to yourself")
end

if failures > 0 then
	error(failures .. " checks failed", 0)
end
print("lobby: host and seats behave")

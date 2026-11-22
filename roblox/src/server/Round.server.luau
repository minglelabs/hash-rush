-- Lobby and round flow. The first to arrive hosts the lobby, as in the web game's
-- rooms: the host decides who plays the next round and who watches, and how many
-- bots fill the empty seats and how good they are (Lobby.luau). The server owns
-- the game: clients only send what they are pressing, and get back a snapshot
-- every tick plus the events of that tick.
--   lobby (everyone presses ready) -> round (3 s countdown, play) -> lobby, showing the result ...
-- Nothing starts by itself: a round begins once everyone playing is ready, or ten
-- seconds after enough of them are. Whoever is not ready sits it out.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Lang = require(ReplicatedStorage:WaitForChild("Lang"))
local Snapshot = require(ReplicatedStorage:WaitForChild("Snapshot"))
local Map = require(ReplicatedStorage:WaitForChild("Map"))
local Sim = require(ReplicatedStorage:WaitForChild("Sim"))
local Bot = require(script.Parent:WaitForChild("Bot"))
local RLBot = require(script.Parent:WaitForChild("RLBot"))
local Lobby = require(script.Parent:WaitForChild("Lobby"))

Players.CharacterAutoLoads = false

-- In Studio one player is enough, so the game can be looked at with a plain test run.
local MIN_PLAYERS = if RunService:IsStudio() then 1 else Config.MIN_PLAYERS

-- Bot levels, weakest first: the scripted ones the web game has, then the one
-- that learned the game by playing it.
local LEVELS = {}
for _, level in { "easy", "normal", "hard", "ace" } do
	if Bot.DIFFICULTY[level] then
		table.insert(LEVELS, level)
	end
end
table.insert(LEVELS, "rl")

local remotes = Instance.new("Folder")
remotes.Name = "HashRushRemotes"
local inputRemote = Instance.new("RemoteEvent")
inputRemote.Name = "Input"
inputRemote.Parent = remotes
local roundRemote = Instance.new("RemoteEvent")
roundRemote.Name = "Round"
roundRemote.Parent = remotes
local readyRemote = Instance.new("RemoteEvent")
readyRemote.Name = "Ready"
readyRemote.Parent = remotes
local lobbyRemote = Instance.new("RemoteEvent")
lobbyRemote.Name = "Lobby"
lobbyRemote.Parent = remotes
local snapRemote = Instance.new("UnreliableRemoteEvent")
snapRemote.Name = "Snap"
snapRemote.Parent = remotes
remotes.Parent = ReplicatedStorage

Map.render()

-- Wins and games played, kept across visits.
local store = nil
do
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore("HashRushStats")
	end)
	if ok then
		store = result
	else
		warn("HashRush: stats are not saved (" .. tostring(result) .. ")")
	end
end

local function record(userId, won)
	if not store then
		return
	end
	task.spawn(function()
		local ok, err = pcall(function()
			store:UpdateAsync("u" .. userId, function(old)
				old = old or { wins = 0, games = 0 }
				old.games += 1
				if won then
					old.wins += 1
				end
				return old
			end)
		end)
		if not ok then
			warn("HashRush: could not save stats for " .. userId .. ": " .. tostring(err))
		end
	end)
end

local lobby = Lobby.new(Config.MAX_PLAYERS)
local joined = lobby.joined -- players, in the order they came in
local raw = {} -- [player] = what that player is pressing
local wins = {} -- [userId] = rounds won on this server
local ready = {} -- [player] = true once it has asked for the next round (only those playing)

local state = "lobby" -- "lobby" | "round"
local timer = Config.LOBBY_COUNTDOWN
local roundNo = 0
local game_ = nil -- the Sim game of the running round
local seats = {} -- [seat number] = player
local bots = {} -- [seat number] = { think, name }
local fill = 4 -- how many hamsters a round has: the people, and bots for the rest
local botLevel = "normal" -- every bot's, unless the host gave one its own
local botLevels = {} -- [k] = the k-th bot's own level, as the web game's rooms have it
local teams = true -- two sides instead of everyone for themselves

-- A round at the press of one button: four hamsters, the people first and bots
-- for the rest. Two against two by default, all at the middle level; everyone
-- for themselves against a rookie, a regular and a pro. Changing the mode starts
-- from its setup again; the host can change anything after.
local QUICK = { fill = 4, solo = { "easy", "normal", "hard" } }
local function quickSetup()
	fill = QUICK.fill
	botLevel = "normal"
	table.clear(botLevels)
	if not teams then
		for k, level in QUICK.solo do
			botLevels[k] = if level == botLevel then nil else level
		end
	end
end
quickSetup()
local simInputs = {}
local rng = Random.new()

-- The last of each message, for whoever joins in the middle.
local lastLobby = nil
local lastStart = nil
local lastResult = nil

local function roster()
	local list = {}
	for seat, player in seats do
		local p = game_ and game_.byId[seat]
		table.insert(list, {
			id = seat,
			userId = player.UserId,
			name = player.DisplayName,
			wins = wins[player.UserId] or 0,
			kills = if p then p.kills + p.throws else 0,
			team = if p and p.team >= 0 then p.team else nil,
		})
	end
	for seat, bot in bots do
		local p = game_ and game_.byId[seat]
		table.insert(list, {
			id = seat,
			userId = -seat,
			name = bot.name,
			bot = bot.level,
			wins = wins[bot.name] or 0,
			kills = if p then p.kills + p.throws else 0,
			team = if p and p.team >= 0 then p.team else nil,
		})
	end
	table.sort(list, function(a, b)
		return a.id < b.id
	end)
	return list
end

local function readyCount()
	local n = 0
	for _ in ready do
		n += 1
	end
	return n
end

-- How many bots a round with this many people in it would get: enough to make
-- `fill` hamsters, if there are seats for them.
local function botsFor(people)
	return math.clamp(fill - people, 0, Config.MAX_PLAYERS - people)
end

-- Enough to play: somebody real, and a rival for it, bot or not.
local function enough(readied)
	return readied >= 1 and readied + botsFor(readied) >= MIN_PLAYERS
end

-- The k-th bot's level: its own if the host set one, else everyone's.
local function levelOf(k)
	return botLevels[k] or botLevel
end

-- The level after `level`, round the list.
local function nextLevel(level)
	return LEVELS[(table.find(LEVELS, level) or 0) % #LEVELS + 1]
end

local function sendLobby()
	local count = lobby:count()
	local readied = readyCount()
	-- The count runs only while some, but not all, are ready.
	local left = if enough(readied) and readied < count then math.ceil(timer) else nil
	local people = {}
	local hostId = if lobby.host then lobby.host.UserId else 0
	local mark = { count, readied, left or -1, fill, botLevel, if teams then 1 else 0, hostId }
	-- The bots the next round would seat, after the people, each with its level.
	local base = math.max(1, readied)
	local botList = {}
	local mixed = false
	for k = 1, botsFor(base) do
		table.insert(botList, { seat = base + k, level = levelOf(k) })
		table.insert(mark, "b" .. levelOf(k))
		mixed = mixed or levelOf(k) ~= botLevel
	end
	for _, player in joined do
		local playing = lobby:isPlaying(player)
		table.insert(people, { name = player.DisplayName, userId = player.UserId, ready = ready[player] == true, playing = playing })
		table.insert(mark, player.UserId .. (if ready[player] then "r" elseif playing then "p" else "w"))
	end
	local signature = table.concat(mark, ",")
	if lastLobby and lastLobby.signature == signature then
		return
	end
	lastLobby = {
		kind = "lobby",
		signature = signature,
		count = count,
		ready = readied,
		-- How many more people it takes before a round can start at all.
		short = math.max(0, MIN_PLAYERS - botsFor(count) - count),
		left = left,
		people = people,
		bots = botsFor(math.max(1, readied)),
		botList = botList,
		level = botLevel,
		mixed = mixed,
		teams = teams,
		host = hostId,
		max = Config.MAX_PLAYERS,
	}
	roundRemote:FireAllClients(lastLobby)
end

local function startRound()
	roundNo += 1
	seats = {}
	simInputs = {}
	local slots = {}
	for _, player in joined do
		if ready[player] and lobby:isPlaying(player) and #slots < Config.MAX_PLAYERS then
			local i = #slots + 1
			seats[i] = player
			simInputs[i] = { mx = 0, my = 0, bonk = false, throw = false }
			slots[i] = { id = i, name = player.DisplayName }
		end
	end
	table.clear(ready)
	table.clear(bots)
	for k = 1, botsFor(#slots) do
		local i = #slots + 1
		local seed = rng:NextInteger(1, 2 ^ 30)
		local level = levelOf(k)
		local brain = if level == "rl" then RLBot.new({ seed = seed, offset = k }) else Bot.new({ difficulty = level, seed = seed })
		-- A bot is named after its seat's hamster in the web game. Each client
		-- writes the name in its own language; this one keeps the score.
		bots[i] = { brain = brain, name = Lang.WORDS.ko.names[i], level = level }
		simInputs[i] = { mx = 0, my = 0, bonk = false, throw = false }
		slots[i] = { id = i, name = bots[i].name }
	end
	-- Sides by turns down the seats: people are seated first, so they are spread
	-- over both teams and the bots fill each side up.
	if teams then
		for i, slot in slots do
			slot.team = (i - 1) % 2
		end
	end
	game_ = Sim.new(Map, slots, function()
		return rng:NextNumber()
	end)
	state = "round"
	lastStart = { kind = "start", round = roundNo, roster = roster() }
	roundRemote:FireAllClients(lastStart)
end

-- winners: seat numbers. `left` is true when the round stopped for want of players.
local function endRound(winners, timeout, left)
	for seat, bot in bots do
		if table.find(winners, seat) then
			wins[bot.name] = (wins[bot.name] or 0) + 1
		end
	end
	for seat, player in seats do
		local won = table.find(winners, seat) ~= nil
		if won then
			wins[player.UserId] = (wins[player.UserId] or 0) + 1
		end
		if not left then
			record(player.UserId, won)
		end
	end
	lastResult = { kind = "result", winners = winners, timeout = timeout, left = left, roster = roster() }
	roundRemote:FireAllClients(lastResult)
	-- Back to the lobby, where the result stays up until the next round is asked for.
	state = "lobby"
	timer = Config.LOBBY_COUNTDOWN
	game_ = nil
	seats = {}
	table.clear(bots)
	lastLobby = nil
	sendLobby()
end

local function stepRound()
	for seat, player in seats do
		local r = raw[player]
		local inp = simInputs[seat]
		inp.mx = r.mx
		inp.my = r.my
		-- A tap that came and went between two ticks still counts.
		inp.bonk = r.bonk or r.tapped
		inp.throw = r.throw
		r.tapped = false
	end
	for seat, bot in bots do
		-- A bot that trips up stands still rather than taking the round down with it.
		local ok, input = pcall(bot.brain.think, game_, seat)
		if ok and input then
			simInputs[seat] = input
		elseif not bot.broken then
			bot.broken = true
			warn("HashRush: " .. bot.name .. " stopped thinking: " .. tostring(input))
			simInputs[seat] = { mx = 0, my = 0, bonk = false, throw = false }
		end
	end
	Sim.step(game_, simInputs)
	if #game_.events > 0 then
		roundRemote:FireAllClients({ kind = "events", round = roundNo, list = table.clone(game_.events) })
	end
	snapRemote:FireAllClients(Snapshot.encode(roundNo, game_, function(p)
		return Sim.lastStretch(game_, p)
	end))
	if game_.phase == "over" then
		endRound(game_.winners, game_.timeout, false)
	end
end

local function tick()
	if state == "lobby" then
		local readied = readyCount()
		if enough(readied) and readied == lobby:count() then
			startRound()
			return
		elseif enough(readied) then
			timer -= Config.DT
			if timer <= 0 then
				startRound()
				return
			end
		else
			timer = Config.LOBBY_COUNTDOWN
		end
		sendLobby()
	else
		stepRound()
	end
end

-- How many rounds a player has played, as far as the stats know: the client
-- offers the tutorial to whoever has none. Left unset when the stats cannot be read.
local function lookUp(player)
	if not store then
		return
	end
	task.spawn(function()
		local ok, stats = pcall(function()
			return store:GetAsync("u" .. player.UserId)
		end)
		if ok and player.Parent then
			player:SetAttribute("HRGames", if stats then stats.games else 0)
		end
	end)
end

Players.PlayerAdded:Connect(function(player)
	lobby:join(player)
	raw[player] = { mx = 0, my = 0, bonk = false, throw = false, tapped = false }
	lookUp(player)
end)
for _, player in Players:GetPlayers() do
	lobby:join(player)
	raw[player] = { mx = 0, my = 0, bonk = false, throw = false, tapped = false }
	lookUp(player)
end

Players.PlayerRemoving:Connect(function(player)
	-- The host's lobby passes on, and a seat that frees up goes to whoever waited longest.
	lobby:leave(player)
	raw[player] = nil
	ready[player] = nil
	-- Not table.find: seats has gaps once somebody has left.
	local seat = nil
	for s, seated in seats do
		if seated == player then
			seat = s
		end
	end
	if seat then
		seats[seat] = nil
		simInputs[seat] = nil
		if state == "round" then
			Sim.remove(game_, seat)
			if #game_.players < MIN_PLAYERS or next(seats) == nil then
				endRound({}, false, true)
			end
		end
	end
end)

inputRemote.OnServerEvent:Connect(function(player, mx, my, bonk, throw)
	local r = raw[player]
	if not r or type(mx) ~= "number" or type(my) ~= "number" or mx ~= mx or my ~= my then
		return
	end
	r.mx = math.clamp(mx, -1, 1)
	r.my = math.clamp(my, -1, 1)
	if bonk == true and not r.bonk then
		r.tapped = true
	end
	r.bonk = bonk == true
	r.throw = throw == true
end)

-- A player asks for the next round, or takes that back.
readyRemote.OnServerEvent:Connect(function(player, want)
	if state ~= "lobby" or not raw[player] then
		return
	end
	-- Only those playing the next round can be ready for it.
	ready[player] = if want == true and lobby:isPlaying(player) then true else nil
end)

-- The host sets the lobby up: bots, their level, the mode, who plays and who
-- watches, and may hand the lobby on. Anyone may move themselves in or out.
local function byUserId(userId)
	for _, player in joined do
		if player.UserId == userId then
			return player
		end
	end
	return nil
end

lobbyRemote.OnServerEvent:Connect(function(player, what, value, want)
	if state ~= "lobby" or not raw[player] then
		return
	end
	if what == "seat" and type(value) == "number" then
		local who = byUserId(value)
		if who and lobby:seat(player, who, want == true) and not lobby:isPlaying(who) then
			ready[who] = nil
		end
		return
	elseif what == "host" and type(value) == "number" then
		local who = byUserId(value)
		if who then
			lobby:handOver(player, who)
		end
		return
	end
	if player ~= lobby.host then
		return
	end
	if what == "bots" and type(value) == "number" then
		-- One bot more or fewer than the lobby shows now.
		local people = math.max(1, readyCount())
		local count = math.clamp(botsFor(people) + (if value > 0 then 1 else -1), 0, Config.MAX_PLAYERS - people)
		fill = people + count
	elseif what == "teams" then
		teams = not teams
		quickSetup()
	elseif what == "level" then
		-- Everyone's level: the ones set bot by bot go back to it.
		botLevel = nextLevel(botLevel)
		table.clear(botLevels)
	elseif what == "botLevel" and type(value) == "number" and value >= 1 and value <= Config.MAX_PLAYERS and value % 1 == 0 then
		-- One bot's own level, as the web game's rooms let the host set it.
		local level = nextLevel(levelOf(value))
		botLevels[value] = if level == botLevel then nil else level
	end
end)

-- A client says it is ready to draw: tell it where things stand.
roundRemote.OnServerEvent:Connect(function(player)
	if state == "lobby" then
		if lastLobby then
			roundRemote:FireClient(player, lastLobby)
		end
		return
	end
	roundRemote:FireClient(player, lastStart)
end)

local behind = 0
RunService.Heartbeat:Connect(function(dt)
	behind = math.min(behind + dt, 0.25)
	while behind >= Config.DT do
		behind -= Config.DT
		tick()
	end
end)

-- Lobby and round flow. The server owns the game: clients only send what they
-- are pressing, and get back a snapshot every tick plus the events of that tick.
--   lobby (2+ players, 10 s) -> round (3 s countdown, play) -> result (5 s) -> round ...

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Config = require(ReplicatedStorage:WaitForChild("Config"))
local Snapshot = require(ReplicatedStorage:WaitForChild("Snapshot"))
local Map = require(ReplicatedStorage:WaitForChild("Map"))
local Sim = require(ReplicatedStorage:WaitForChild("Sim"))

Players.CharacterAutoLoads = false

-- In Studio one player is enough, so the game can be looked at with a plain test run.
local MIN_PLAYERS = if RunService:IsStudio() then 1 else Config.MIN_PLAYERS

local remotes = Instance.new("Folder")
remotes.Name = "HashRushRemotes"
local inputRemote = Instance.new("RemoteEvent")
inputRemote.Name = "Input"
inputRemote.Parent = remotes
local roundRemote = Instance.new("RemoteEvent")
roundRemote.Name = "Round"
roundRemote.Parent = remotes
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

local joined = {} -- players, in the order they came in
local raw = {} -- [player] = what that player is pressing
local wins = {} -- [userId] = rounds won on this server

local state = "lobby" -- "lobby" | "round" | "result"
local timer = Config.LOBBY_COUNTDOWN
local roundNo = 0
local game_ = nil -- the Sim game of the running round
local seats = {} -- [seat number] = player
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
		})
	end
	return list
end

local function sendLobby()
	local count = #joined
	local left = if count >= MIN_PLAYERS then math.ceil(timer) else nil
	if lastLobby and lastLobby.count == count and lastLobby.left == left then
		return
	end
	lastLobby = { kind = "lobby", count = count, need = MIN_PLAYERS, left = left }
	roundRemote:FireAllClients(lastLobby)
end

local function toLobby()
	state = "lobby"
	timer = Config.LOBBY_COUNTDOWN
	game_ = nil
	seats = {}
	lastLobby = nil
	sendLobby()
end

local function startRound()
	roundNo += 1
	seats = {}
	simInputs = {}
	local slots = {}
	for i = 1, math.min(#joined, Config.MAX_PLAYERS) do
		seats[i] = joined[i]
		simInputs[i] = { mx = 0, my = 0, bonk = false, throw = false }
		slots[i] = { id = i, name = joined[i].DisplayName }
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
	for seat, player in seats do
		local won = table.find(winners, seat) ~= nil
		if won then
			wins[player.UserId] = (wins[player.UserId] or 0) + 1
		end
		if not left then
			record(player.UserId, won)
		end
	end
	state = "result"
	timer = Config.RESULT_TIME
	lastResult = { kind = "result", winners = winners, timeout = timeout, left = left, roster = roster(), next = Config.RESULT_TIME }
	roundRemote:FireAllClients(lastResult)
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
		if #joined >= MIN_PLAYERS then
			timer -= Config.DT
			if timer <= 0 then
				startRound()
				return
			end
		else
			timer = Config.LOBBY_COUNTDOWN
		end
		sendLobby()
	elseif state == "round" then
		stepRound()
	else
		timer -= Config.DT
		if timer <= 0 then
			if #joined >= MIN_PLAYERS then
				startRound()
			else
				toLobby()
			end
		end
	end
end

Players.PlayerAdded:Connect(function(player)
	table.insert(joined, player)
	raw[player] = { mx = 0, my = 0, bonk = false, throw = false, tapped = false }
end)
for _, player in Players:GetPlayers() do
	table.insert(joined, player)
	raw[player] = { mx = 0, my = 0, bonk = false, throw = false, tapped = false }
end

Players.PlayerRemoving:Connect(function(player)
	local at = table.find(joined, player)
	if at then
		table.remove(joined, at)
	end
	raw[player] = nil
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
			if #game_.players < MIN_PLAYERS then
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

-- A client says it is ready to draw: tell it where things stand.
roundRemote.OnServerEvent:Connect(function(player)
	if state == "lobby" then
		if lastLobby then
			roundRemote:FireClient(player, lastLobby)
		end
		return
	end
	roundRemote:FireClient(player, lastStart)
	if state == "result" then
		roundRemote:FireClient(player, lastResult)
	end
end)

local behind = 0
RunService.Heartbeat:Connect(function(dt)
	behind = math.min(behind + dt, 0.25)
	while behind >= Config.DT do
		behind -= Config.DT
		tick()
	end
end)

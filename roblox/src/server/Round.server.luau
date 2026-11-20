-- Lobby and round flow. The server owns the game: clients only send what they
-- are pressing, and get back a snapshot every tick plus the events of that tick.
--   lobby (everyone presses ready) -> round (3 s countdown, play) -> lobby, showing the result ...
-- Nothing starts by itself: a round begins once everyone in the server is ready,
-- or ten seconds after enough of them are. Whoever is not ready sits it out.

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
-- And whoever plays alone there gets a sparring partner to bonk and be bonked by.
local PRACTICE = RunService:IsStudio()
local DUMMY_NAME = "연습 상대"

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
local ready = {} -- [player] = true once it has asked for the next round

local state = "lobby" -- "lobby" | "round"
local timer = Config.LOBBY_COUNTDOWN
local roundNo = 0
local game_ = nil -- the Sim game of the running round
local seats = {} -- [seat number] = player
local dummy = nil -- seat number of the sparring partner, if there is one
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
	local d = dummy and game_ and game_.byId[dummy]
	if d then
		table.insert(list, { id = dummy, userId = -1, name = DUMMY_NAME, wins = 0, kills = d.kills + d.throws })
	end
	return list
end

local function readyCount()
	local n = 0
	for _ in ready do
		n += 1
	end
	return n
end

local function sendLobby()
	local count = #joined
	local readied = readyCount()
	-- The count runs only while some, but not all, are ready.
	local left = if readied >= MIN_PLAYERS and readied < count then math.ceil(timer) else nil
	if lastLobby and lastLobby.count == count and lastLobby.ready == readied and lastLobby.left == left then
		return
	end
	lastLobby = { kind = "lobby", count = count, ready = readied, need = MIN_PLAYERS, left = left }
	roundRemote:FireAllClients(lastLobby)
end

local function startRound()
	roundNo += 1
	seats = {}
	simInputs = {}
	local slots = {}
	for _, player in joined do
		if ready[player] and #slots < Config.MAX_PLAYERS then
			local i = #slots + 1
			seats[i] = player
			simInputs[i] = { mx = 0, my = 0, bonk = false, throw = false }
			slots[i] = { id = i, name = player.DisplayName }
		end
	end
	table.clear(ready)
	dummy = nil
	if PRACTICE and #slots == 1 then
		dummy = 2
		simInputs[dummy] = { mx = 0, my = 0, bonk = false, throw = false }
		slots[dummy] = { id = dummy, name = DUMMY_NAME }
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
	lastResult = { kind = "result", winners = winners, timeout = timeout, left = left, roster = roster() }
	roundRemote:FireAllClients(lastResult)
	-- Back to the lobby, where the result stays up until the next round is asked for.
	state = "lobby"
	timer = Config.LOBBY_COUNTDOWN
	game_ = nil
	seats = {}
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
	-- The sparring partner paces up and down just outside home, and swings at
	-- whoever comes close.
	local d = dummy and game_.byId[dummy]
	if d then
		local inp = simInputs[dummy]
		local tx = Map.home.x2 + 4
		local ty = Map.flower.y + math.sin(game_.time * 0.9) * 13
		local dx, dy = tx - d.x, ty - d.y
		local far = math.sqrt(dx * dx + dy * dy)
		inp.mx = if far > 0.6 then dx / far * 0.6 else 0
		inp.my = if far > 0.6 then dy / far * 0.6 else 0
		local near = false
		for _, p in game_.players do
			if p ~= d and math.abs(p.x - d.x) + math.abs(p.y - d.y) < 4 then
				near = true
			end
		end
		inp.bonk = near and game_.tick % 90 < 3
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
		if readied >= MIN_PLAYERS and readied == #joined then
			startRound()
			return
		elseif readied >= MIN_PLAYERS then
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
	ready[player] = if want == true then true else nil
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

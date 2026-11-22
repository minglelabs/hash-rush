-- Every word the game shows, in Korean and in English. A player whose Roblox
-- language is Korean gets Korean; everyone else gets English. The client picks
-- with `Lang.pick(player)`; the server never shows words of its own beyond the
-- map's signs, which the client writes again in its own language.
--   Lang.t("key")             the word
--   Lang.t("key", a, b)       string.format'ed with a, b, or called with them
--                             when the word is a function

local Lang = {}
Lang.code = "ko"

-- "구름이" or "초코가", as the web game writes a name before a verb.
local function subject(name: string): string
	local last = utf8.codepoint(name, utf8.offset(name, -1) or 1)
	local hangul = last >= 0xAC00 and last <= 0xD7A3
	return name .. (if hangul and (last - 0xAC00) % 28 ~= 0 then "이" else "가")
end
Lang.subject = subject

local WORDS = {}

WORDS.ko = {
	-- Names and sides
	me = "나",
	names = { "나", "구름", "초코", "먼지", "콩이", "보리", "밤톨", "호두" },
	levels = { easy = "초보", normal = "중수", hard = "고수", ace = "초고수", rl = "RL" },
	teams = { [0] = "🔴 레드", [1] = "🔵 블루" },

	-- Touch buttons
	bonkButton = "👊\n꿀밤",
	throwButton = "🌻\n던지기",

	-- Lobby
	ready = "✅ 준비 완료!",
	readyPrompt = "▶ 준비!",
	startNow = "▶ 바로 시작!",
	readyKey = " (Enter)",
	lobbyBots = "🤖 봇 %d마리 · %s",
	botCount = "🤖 봇 %d",
	level = "난이도 %s",
	mixed = "제각각",
	solo = "👤 개인전",
	teamMode = "⚔ 팀전",
	waiting = "🌻 대기 중",
	tutorial = "🎓 튜토리얼",
	startsIn = "%d초 뒤 시작해요 · 준비 %d/%d명",
	needRival = "상대가 필요해요 · 햄스터 %d마리를 더 기다리거나 봇을 넣어요",
	allReady = "모두 준비하면 시작해요 · 준비 %d/%d명",
	watching = "관전 중 · 판이 끝나면 준비를 눌러 참가해요",
	-- The host
	joinPrompt = "👀 관전 중 · 참가하기",
	watchingLobby = "👀 관전 중 · 방장이 넣어 주거나 자리가 나면 참가해요",
	watchersLine = "👀 관전 %d명",
	full = "자리가 꽉 찼어요 (%d명)",
	hostOnly = "👑 방장만 바꿀 수 있어요",
	becameHost = "👑 이제 내가 방장이에요! 봇과 참가자를 정해요",
	seatIn = "넣기",
	seatOut = "빼기",
	joinSelf = "참가",
	watchSelf = "관전",
	confirm = "넘길까?",
	help = {
		{ "🌻", "해바라기 옆에서 2초 가만히! 해씨는 한 번에 한 마리씩" },
		{ "🏠", "해씨를 물고 왼쪽 모래밭 집에 들어가면 승리" },
		{ "👊", "Space 꿀밤: 바로 옆에서만 맞아요. 맞으면 둥지로" },
		{ "🌀", "보라색 소용돌이: 빈손일 때 둥지로 순간이동" },
		{ "💨", "해씨를 든 채 F를 꾹: 줄 선 상대를 한꺼번에" },
	},
	helpTouch = {
		{ "🌻", "해바라기 옆에서 2초 가만히! 해씨는 한 번에 한 마리씩" },
		{ "🏠", "해씨를 물고 왼쪽 모래밭 집에 들어가면 승리" },
		{ "👊", "👊 버튼 꿀밤: 바로 옆에서만 맞아요. 맞으면 둥지로" },
		{ "🌀", "보라색 소용돌이: 빈손일 때 둥지로 순간이동" },
		{ "💨", "해씨를 든 채 🌻 버튼을 꾹: 줄 선 상대를 한꺼번에" },
	},

	-- Round
	getReady = "준비…",
	go = "출발!",
	practice = "🎓 연습",
	multi = { "더블킬!", "트리플킬!", "쿼드라킬!", "펜타킬!", "헥사킬!", "헵타킬!" },
	gotSeedMe = "🌻 해씨 획득! 노랗게 빛나는 🏠 집으로 달려요!",
	gotSeedMate = function(name)
		return "🌻 " .. subject(name) .. " 씨를 물었어요! 지켜줘요!"
	end,
	gotSeedFoe = function(name)
		return "🌻 " .. subject(name) .. " 씨를 물었어요! 막아요!"
	end,
	bonkWord = "뿅!",
	lostSeed = "씨를 놓쳤어요! 다시 해바라기로!",
	feedBonk = function(by, seed, whom)
		return ("%s %s뿅! %s"):format(by, if seed then "🌻" else "", whom)
	end,
	superplay = "%s 슈퍼플레이!",
	multiBanner = function(name, kill, super)
		return name .. " " .. kill .. (if super then " 슈퍼플레이!" else "")
	end,
	throwWord = "던지기!",
	seedWord = "🌻 해씨 획득!",
	stealWord = "소매치기!",
	feedSteal = "%s 🌻소매치기! %s",
	gotStolen = "해씨를 소매치기 당했어요!",
	warpWord = "쏙!",
	overtime = "⏰ 연장전! 씨가 빨리 나오고, 쓰러지면 기절!",
	rush = "🚨 막판! 집이 해바라기까지 밀려옵니다",
	alarmMe = "🚨 집이 코앞! 끝까지 달려요!",
	alarmMate = function(name)
		return "🚨 " .. subject(name) .. " 해씨를 물고 집에 다 왔어요! 지켜줘요!"
	end,
	alarmFoe = function(name)
		return "🚨 " .. subject(name) .. " 해씨를 물고 집에 다 왔어요! 막아요!"
	end,
	cover = "지켜요!",
	block = "막아요!",
	toHome = "집으로!",
	flower = "해바라기",
	dazed = "💫 기절",
	digging = "해씨 캐는 중",
	snatching = "슬쩍하는 중",
	noWarpCarrying = "씨를 물고는 순간이동 못 해요! 걸어서 집으로!",
	holdStill = "가만히 있어야 캐져요!",
	queue = "앞 햄스터가 캐는 중… 대기",

	-- Result
	teamWin = "🏆 %s 팀 승리!",
	win = function(names, _count)
		return "🏆 " .. names .. " 승리!"
	end,
	noWinner = "판이 끝났어요",
	whyLeft = "상대가 나가서 판이 끝났어요",
	whyTimeout = "시간 종료 · 꿀밤 횟수로 정했어요",
	whyHome = "해씨를 물고 집에 돌아왔어요",
	wins = "⭐ %d승",

	-- Tutorial
	tutorStart = "▶ 시작하기!",
	tutorSkip = "건너뛰기 ✕",
	cheer = "👍 잘했어요!",
	steps = {
		{ title = "움직이기", text = "WASD나 방향키로 움직여요. 휴대폰은 화면 왼쪽을 끌어요.\n🌻 해바라기까지 가 보세요!", label = "해바라기" },
		{ title = "해씨 캐기", text = "해바라기 옆에서 가만히 있으면 해씨가 나와요.\n움직이거나 꿀밤을 치면 처음부터예요!", label = "가만히!" },
		{ title = "집으로", text = "해씨를 물었어요! 왼쪽 모래밭 🏠 집으로 돌아가면 이겨요.\n해씨를 물면 조금 느려지고, 꿀밤 한 대면 놓쳐요.", label = "집으로!" },
		{ title = "꿀밤", text = "상대 바로 옆에서 Space를 눌러 꿀밤! 휴대폰은 👊 버튼이에요.\n맞은 햄스터는 둥지로 돌아가요. 헛치면 잠깐 굳으니 조심!", label = "꿀밤!" },
		{
			title = "던지기",
			text = "해씨를 든 채 F를 꾹 눌렀다 떼면 보는 쪽으로 던져요. 휴대폰은 🌻 버튼이에요.\n줄 선 상대가 한꺼번에 쓰러져요. 대신 해씨는 사라져요!",
			label = "이쪽으로!",
			again = "아깝다! 상대 쪽을 보고 다시 던져요.",
		},
		{ title = "소매치기", text = "해씨 든 상대에게 딱 붙어 있으면 해씨를 슬쩍 가져와요.\n빼앗긴 쪽은 1초 동안 되찾을 수 없어요.", label = "붙어요!" },
		{ title = "순간이동", text = "보라색 🌀 소용돌이에 들어가면 둥지로 순간이동해요. 해씨가 없을 때만 돼요.\n앞서가는 상대를 집 앞에서 막으러 갈 때 써요!", label = "들어가요!" },
		{ title = "끝!", text = "▶ 시작하기!를 누르면 바로 진짜 판이 시작돼요!\n1:20부터는 연장전: 집이 넓어지고, 쓰러지면 잠깐 기절해요." },
	},

	-- Map signs
	homeSign = "🏠 집",
	homeHint = "씨를 물고 여기로!",
	swirlSign = "🌀 집으로 순간이동",
}

WORDS.en = {
	me = "You",
	names = { "Me", "Cloud", "Choco", "Dusty", "Bean", "Barley", "Chestnut", "Walnut" },
	levels = { easy = "Easy", normal = "Normal", hard = "Hard", ace = "Expert", rl = "RL" },
	teams = { [0] = "🔴 Red", [1] = "🔵 Blue" },

	bonkButton = "👊\nBonk",
	throwButton = "🌻\nThrow",

	ready = "✅ Ready!",
	readyPrompt = "▶ Ready?",
	startNow = "▶ Play now!",
	readyKey = " (Enter)",
	lobbyBots = "🤖 %d bots · %s",
	botCount = "🤖 Bots %d",
	level = "Level: %s",
	mixed = "Mixed",
	solo = "👤 Solo",
	teamMode = "⚔ Teams",
	waiting = "🌻 Lobby",
	tutorial = "🎓 Tutorial",
	startsIn = "Starting in %d s · %d/%d ready",
	needRival = "Need a rival · wait for %d more hamsters or add bots",
	allReady = "Starts when everyone is ready · %d/%d ready",
	watching = "Watching · press Ready after this round to join",
	joinPrompt = "👀 Watching · Join",
	watchingLobby = "👀 Watching · you play when the host puts you in or a seat opens",
	watchersLine = "👀 %d watching",
	full = "All %d seats are taken",
	hostOnly = "👑 Only the host can change this",
	becameHost = "👑 You're the host! Pick the bots and who plays",
	seatIn = "In",
	seatOut = "Out",
	joinSelf = "Join",
	watchSelf = "Watch",
	confirm = "Sure?",
	help = {
		{ "🌻", "Stand still by the sunflower for 2 s. One hamster digs at a time" },
		{ "🏠", "Carry the seed into the home on the sand at the left to win" },
		{ "👊", "Space to bonk: hits only right next to you. Bonked = back to nest" },
		{ "🌀", "Purple swirl: warp to your nest, with empty paws only" },
		{ "💨", "Hold F with a seed: knock down a whole line at once" },
	},
	helpTouch = {
		{ "🌻", "Stand still by the sunflower for 2 s. One hamster digs at a time" },
		{ "🏠", "Carry the seed into the home on the sand at the left to win" },
		{ "👊", "👊 button to bonk: hits only right next to you. Bonked = back to nest" },
		{ "🌀", "Purple swirl: warp to your nest, with empty paws only" },
		{ "💨", "Hold 🌻 with a seed: knock down a whole line at once" },
	},

	getReady = "Get ready…",
	go = "GO!",
	practice = "🎓 Practice",
	multi = { "Double!", "Triple!", "Quadra!", "Penta!", "Hexa!", "Hepta!" },
	gotSeedMe = "🌻 Got a seed! Run to the glowing 🏠 home!",
	gotSeedMate = "🌻 %s has a seed! Cover them!",
	gotSeedFoe = "🌻 %s has a seed! Stop them!",
	bonkWord = "BONK!",
	lostSeed = "Dropped the seed! Back to the sunflower!",
	feedBonk = function(by, seed, whom)
		return ("%s 👊 %s%s"):format(by, whom, if seed then " 🌻" else "")
	end,
	superplay = "%s SUPER PLAY!",
	multiBanner = function(name, kill, super)
		return name .. " " .. kill .. (if super then " SUPER PLAY!" else "")
	end,
	throwWord = "THROW!",
	seedWord = "🌻 Seed!",
	stealWord = "Snatched!",
	feedSteal = "%s 🤏🌻 %s",
	gotStolen = "Your seed got snatched!",
	warpWord = "Zip!",
	overtime = "⏰ Overtime! Seeds come faster, and a bonk stuns!",
	rush = "🚨 Final rush! Home is sliding up to the sunflower",
	alarmMe = "🚨 Almost home! Keep running!",
	alarmMate = "🚨 %s is almost home with a seed! Cover them!",
	alarmFoe = "🚨 %s is almost home with a seed! Stop them!",
	cover = "Cover!",
	block = "Stop!",
	toHome = "Home!",
	flower = "Sunflower",
	dazed = "💫 Stunned",
	digging = "Digging a seed",
	snatching = "Snatching",
	noWarpCarrying = "No warping with a seed! Walk it home!",
	holdStill = "Hold still to dig!",
	queue = "Someone is digging… wait your turn",

	teamWin = "🏆 %s team wins!",
	win = function(names, count)
		return "🏆 " .. names .. (if count > 1 then " win!" else " wins!")
	end,
	noWinner = "Round over",
	whyLeft = "A player left, so the round ended",
	whyTimeout = "Time's up · decided by bonks",
	whyHome = "Brought a seed home",
	wins = "⭐ %d W",

	tutorStart = "▶ Let's play!",
	tutorSkip = "Skip ✕",
	cheer = "👍 Nice!",
	steps = {
		{ title = "Move", text = "Move with WASD or the arrow keys. On a phone, drag on the left of the screen.\nGo to the 🌻 sunflower!", label = "Sunflower" },
		{ title = "Dig a seed", text = "Stand still by the sunflower and a seed pops out.\nMoving or bonking starts it over!", label = "Hold still!" },
		{ title = "Go home", text = "You've got a seed! Bring it to the 🏠 home on the sand at the left to win.\nCarrying slows you a little, and one bonk makes you drop it.", label = "Home!" },
		{ title = "Bonk", text = "Right next to a rival, press Space to bonk! On a phone, tap 👊.\nA bonked hamster goes back to its nest. Miss, and you freeze for a moment!", label = "Bonk!" },
		{
			title = "Throw",
			text = "Holding a seed, hold F and let go to throw it where you face. On a phone, the 🌻 button.\nEveryone in the line goes down, but the seed is gone!",
			label = "This way!",
			again = "So close! Face the rival and throw again.",
		},
		{ title = "Snatch", text = "Stick close to a rival holding a seed to snatch it.\nWhoever lost it can't take it back for 1 second.", label = "Get close!" },
		{ title = "Warp", text = "Step into a purple 🌀 swirl to warp to your nest. Empty paws only.\nUse it to cut off a rival heading home!", label = "In you go!" },
		{ title = "Done!", text = "Press ▶ Let's play! and a real round starts right away!\nFrom 1:20 it's overtime: home grows, and a bonk stuns for a moment." },
	},

	homeSign = "🏠 HOME",
	homeHint = "Bring seeds here!",
	swirlSign = "🌀 Warp to nest",
}

Lang.WORDS = WORDS

-- Korean for a Korean Roblox language, English for any other.
function Lang.use(locale: string?)
	Lang.code = if type(locale) == "string" and locale:lower():sub(1, 2) == "ko" then "ko" else "en"
end

-- The player's language. In Studio, ReplicatedStorage's "Locale" attribute
-- (say "en-us") stands in for it, to see the other language.
function Lang.pick(player: Player)
	local forced = game:GetService("ReplicatedStorage"):GetAttribute("Locale")
	Lang.use(if type(forced) == "string" and forced ~= "" then forced else player.LocaleId)
end

function Lang.t(key: string, ...: any): any
	local word = WORDS[Lang.code][key]
	if word == nil then
		word = WORDS.ko[key]
	end
	if type(word) == "function" then
		return word(...)
	elseif type(word) == "string" and select("#", ...) > 0 then
		return word:format(...)
	end
	return word
end

return Lang

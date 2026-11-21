-- Checks the game's words: English has every word Korean has, of the same kind,
-- with the same blanks to fill, and every one can be shown.
--   node roblox/tools/wrap.mjs && luau roblox/test/lang.luau

local shim = require("./shim")
local Lang = shim.require(shim.game:GetService("ReplicatedStorage"):WaitForChild("Lang"))

local failures = 0
local function check(ok, what)
	if not ok then
		failures += 1
		print("FAIL  " .. what)
	end
end

local function blanks(word)
	local list = {}
	for spec in word:gmatch("%%[%d%.]*[%a%%]") do
		table.insert(list, spec)
	end
	return table.concat(list, " ")
end

-- Sample values for the words that are functions, by key.
local SAMPLES = {
	gotSeedMate = { "구름" },
	gotSeedFoe = { "초코" },
	alarmMate = { "콩이" },
	alarmFoe = { "Bean" },
	feedBonk = { "a", true, "b" },
	multiBanner = { "a", "Double!", true },
	win = { "a · b", 2 },
}

local function same(ko, en, path)
	check(type(ko) == type(en), path .. ": Korean is a " .. type(ko) .. ", English a " .. type(en))
	if type(ko) ~= type(en) then
		return
	end
	if type(ko) == "string" then
		check(blanks(ko) == blanks(en), ("%s: blanks %q in Korean, %q in English"):format(path, blanks(ko), blanks(en)))
		check(en ~= "", path .. ": empty in English")
	elseif type(ko) == "table" then
		for key, value in ko do
			same(value, en[key], path .. "." .. tostring(key))
		end
		for key in en do
			check(ko[key] ~= nil, path .. "." .. tostring(key) .. ": only in English")
		end
	end
end

local ko, en = Lang.WORDS.ko, Lang.WORDS.en
for key, value in ko do
	if type(value) == "function" or type(en[key]) == "function" then
		-- Either may be a plain format string in one language and a function in
		-- the other: both must give a string from the same values.
		for _, code in { "ko", "en" } do
			Lang.code = code
			local ok, out = pcall(Lang.t, key, table.unpack(SAMPLES[key] or { "x" }))
			check(ok and type(out) == "string" and out ~= "", key .. " in " .. code .. ": " .. tostring(out))
		end
	else
		same(value, en[key], key)
	end
end
for key in en do
	check(ko[key] ~= nil, key .. ": only in English")
end

-- Every tutorial step has its words, the drills a word over the spot.
for code, words in Lang.WORDS do
	for i, step in words.steps do
		check(type(step.title) == "string" and type(step.text) == "string", ("%s step %d: title and text"):format(code, i))
		check(i == #words.steps or type(step.label) == "string", ("%s step %d: a label"):format(code, i))
	end
end

-- Who gets which.
Lang.use("ko-kr")
check(Lang.code == "ko", "ko-kr is Korean")
Lang.use("en-us")
check(Lang.code == "en", "en-us is English")
Lang.use("es-es")
check(Lang.code == "en", "Spanish gets English")
Lang.use(nil)
check(Lang.code == "en", "no language gets English")

-- The Korean particle after a name.
check(Lang.subject("구름") == "구름이", "구름이")
check(Lang.subject("초코") == "초코가", "초코가")
check(Lang.subject("Tester") == "Tester가", "Tester가")

-- Formatted words come out filled in.
Lang.code = "en"
check(Lang.t("startsIn", 5, 1, 2) == "Starting in 5 s · 1/2 ready", "startsIn: " .. Lang.t("startsIn", 5, 1, 2))
check(Lang.t("win", "Cloud", 1) == "🏆 Cloud wins!", "one winner")
check(Lang.t("win", "Cloud · Choco", 2) == "🏆 Cloud · Choco win!", "two winners")
Lang.code = "ko"
check(Lang.t("gotSeedFoe", "구름") == "🌻 구름이 씨를 물었어요! 막아요!", "Korean seed banner")

if failures > 0 then
	print(("%d checks failed"):format(failures))
	os.exit(1)
end
print("words: Korean and English agree")

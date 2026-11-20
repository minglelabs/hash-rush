-- Small seeded random number generator, so a bot with the same seed plays the
-- same way every time. The same one as the web game's (mulberry32), number for
-- number.

-- 32-bit multiply: a plain product of two 32-bit numbers does not fit a double.
local function imul(a, b)
	local al = bit32.band(a, 0xFFFF)
	local bl = bit32.band(b, 0xFFFF)
	local cross = bit32.band(bit32.rshift(a, 16) * bl + al * bit32.rshift(b, 16), 0xFFFF)
	return (al * bl + cross * 0x10000) % 0x100000000
end

-- Returns a function that gives the next number in [0, 1).
return function(seed: number): () -> number
	local a = math.floor(seed) % 0x100000000
	return function()
		a = (a + 0x6D2B79F5) % 0x100000000
		local t = imul(bit32.bxor(a, bit32.rshift(a, 15)), bit32.bor(a, 1))
		t = bit32.bxor(t, (t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61))) % 0x100000000)
		return bit32.bxor(t, bit32.rshift(t, 14)) / 0x100000000
	end
end

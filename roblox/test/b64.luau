-- Base64 text to a buffer, for the numbers Node hands the tests.
local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local value = table.create(256, 0)
for i = 1, #ALPHABET do
	value[string.byte(ALPHABET, i)] = i - 1
end

return function(text)
	local from = buffer.fromstring(text)
	local out = buffer.create(#text // 4 * 3)
	local at = 0
	for i = 0, #text - 4, 4 do
		local n = value[buffer.readu8(from, i)] * 262144
			+ value[buffer.readu8(from, i + 1)] * 4096
			+ value[buffer.readu8(from, i + 2)] * 64
			+ value[buffer.readu8(from, i + 3)]
		buffer.writeu8(out, at, n // 65536)
		buffer.writeu8(out, at + 1, n // 256 % 256)
		buffer.writeu8(out, at + 2, n % 256)
		at += 3
	end
	-- Without the bytes the padding stood for.
	local pad = if string.sub(text, -2) == "==" then 2 elseif string.sub(text, -1) == "=" then 1 else 0
	if pad == 0 then
		return out
	end
	local trimmed = buffer.create(at - pad)
	buffer.copy(trimmed, 0, out, 0, at - pad)
	return trimmed
end

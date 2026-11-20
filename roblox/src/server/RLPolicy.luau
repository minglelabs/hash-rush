--!native
-- Runs the trained policy from its packed weights (weights/, made by
-- tools/pack_weights.py). Ported from the web game's src/ai/policy.js: normalise,
-- one linear layer, residual blocks with LayerNorm, then the heads.
-- The web game keeps every layer's result as a 32-bit float and adds up in
-- doubles; this does the same in the same order, so the two give the same logits.
-- Nothing here touches the game, so it also runs outside Roblox.

local RLPolicy = {}

local readf32 = buffer.readf32
local writef32 = buffer.writef32

local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

-- Base64 text to bytes, written into `out` from `at`. Returns where it stopped.
-- The padding at the very end decodes as zero bytes, which nothing reads.
local function decode64(text, value, out, at)
	local from = buffer.fromstring(text)
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
	return at
end

local function half(h)
	local e = h // 1024 % 32
	local f = h % 1024
	local v
	if e == 0 then
		v = math.ldexp(f, -24)
	elseif e == 31 then
		v = if f == 0 then math.huge else 0 / 0
	else
		v = math.ldexp(1 + f / 1024, e - 15)
	end
	return if h >= 32768 then -v else v
end

-- index: what weights/RLSolo returns. chunks: the base64 texts, in order.
-- Returns { meta, logits(obs), act(obs, temperature, random) }.
function RLPolicy.load(index, chunks)
	local total = 0
	local where = {} -- [tensor name] = byte offset of its first number
	for _, tensor in index.tensors do
		where[tensor[1]] = total * 4
		total += tensor[2]
	end

	local value = table.create(256, 0)
	for i = 1, #ALPHABET do
		value[string.byte(ALPHABET, i)] = i - 1
	end
	local halves = buffer.create(total * 2 + 3)
	local at = 0
	for _, text in chunks do
		at = decode64(text, value, halves, at)
	end
	assert(at >= total * 2, "the weight modules are shorter than their index says")
	local W = buffer.create(total * 4)
	for i = 0, total - 1 do
		writef32(W, i * 4, half(buffer.readu16(halves, i * 2)))
	end

	local meta = index.meta
	local heads = index.heads
	local obs = meta.obs
	local width = meta.width
	local blocks = meta.blocks
	local outputs = 0
	for _, size in heads do
		outputs += size
	end

	-- What each input is divided by after its mean is taken off.
	local spread = table.create(obs, 0)
	for i = 0, obs - 1 do
		spread[i + 1] = math.sqrt(readf32(W, where.var + i * 4) + 1e-6)
	end

	-- Every layer's result, reused from one call to the next.
	local x0 = buffer.create(obs * 4)
	local x = buffer.create(width * 4)
	local h = buffer.create(width * 4)
	local up = buffer.create(width * 8)
	local out = buffer.create(outputs * 4)
	-- Where in a row of weights the inputs that are not zero sit.
	local live = buffer.create(width * 8)

	-- out[r] = b[r] + the sum over c of w[r][c] * x[c]. Sizes are in bytes.
	local function linear(w, b, rows, cols, from, to)
		for r = 0, rows - 4, 4 do
			local s = readf32(W, b + r)
			local row = w + r * (cols // 4)
			for c = 0, cols - 16, 16 do
				s += readf32(W, row + c) * readf32(from, c)
				s += readf32(W, row + c + 4) * readf32(from, c + 4)
				s += readf32(W, row + c + 8) * readf32(from, c + 8)
				s += readf32(W, row + c + 12) * readf32(from, c + 12)
			end
			for c = cols - cols % 16, cols - 4, 4 do
				s += readf32(W, row + c) * readf32(from, c)
			end
			writef32(to, r, s)
		end
	end

	local function layerNorm(g, b, from, to)
		local mean = 0
		for i = 0, width * 4 - 4, 4 do
			mean += readf32(from, i)
		end
		mean /= width
		local varc = 0
		for i = 0, width * 4 - 4, 4 do
			local d = readf32(from, i) - mean
			varc += d * d
		end
		local std = math.sqrt(varc / width + 1e-5)
		for i = 0, width * 4 - 4, 4 do
			writef32(to, i, (readf32(from, i) - mean) / std * readf32(W, g + i) + readf32(W, b + i))
		end
	end

	-- obs: `meta.obs` numbers, counted from 1. Returns the logits as 32-bit floats
	-- in a buffer that the next call overwrites.
	local function logits(input)
		for i = 0, obs - 1 do
			-- Through the buffer first, as the web game's observation is 32-bit too.
			writef32(x0, i * 4, input[i + 1])
			local v = (readf32(x0, i * 4) - readf32(W, where.mean + i * 4)) / spread[i + 1]
			writef32(x0, i * 4, math.clamp(v, -5, 5))
		end
		linear(where["inp.weight"], where["inp.bias"], width * 4, obs * 4, x0, x)
		for k = 0, blocks - 1 do
			local name = `blocks.{k}.`
			layerNorm(where[name .. "norm.weight"], where[name .. "norm.bias"], x, h)
			linear(where[name .. "up.weight"], where[name .. "up.bias"], width * 8, width * 4, h, up)
			-- About half of these come out below zero and count for nothing, so the
			-- way back down skips them. A skipped zero adds nothing: same sum.
			local n = 0
			for c = 0, width * 8 - 4, 4 do
				if readf32(up, c) > 0 then
					buffer.writeu32(live, n, c)
					n += 4
				end
			end
			local w = where[name .. "down.weight"]
			local b = where[name .. "down.bias"]
			for r = 0, width * 4 - 4, 4 do
				local s = readf32(W, b + r)
				local row = w + r * width * 2
				for j = 0, n - 4, 4 do
					local c = buffer.readu32(live, j)
					s += readf32(W, row + c) * readf32(up, c)
				end
				-- Into a 32-bit float before it is added on, as the web game does.
				writef32(h, r, s)
				writef32(x, r, readf32(x, r) + readf32(h, r))
			end
		end
		layerNorm(where["norm.weight"], where["norm.bias"], x, h)
		linear(where["pi.weight"], where["pi.bias"], outputs * 4, width * 4, h, out)
		return out
	end

	local weight = table.create(outputs, 0)
	local picks = table.create(#heads, 0)

	-- One choice per head, counted from 0: move 0-8, bonk 0/1, throw 0/1, in a
	-- table that the next call overwrites. `temperature` 0 always takes the
	-- likeliest; 1 plays as it was trained. `random` returns a number in [0, 1).
	local function act(input, temperature, random)
		local l = logits(input)
		local first = 0
		for k, size in heads do
			local best = 0
			for i = 1, size - 1 do
				if readf32(l, (first + i) * 4) > readf32(l, (first + best) * 4) then
					best = i
				end
			end
			if temperature > 0 then
				local top = readf32(l, (first + best) * 4)
				local sum = 0
				for i = 0, size - 1 do
					weight[i + 1] = math.exp((readf32(l, (first + i) * 4) - top) / temperature)
					sum += weight[i + 1]
				end
				local roll = random() * sum
				best = size - 1
				for i = 0, size - 1 do
					roll -= weight[i + 1]
					if roll <= 0 then
						best = i
						break
					end
				end
			end
			picks[k] = best
			first += size
		end
		return picks
	end

	return { meta = meta, logits = logits, act = act }
end

return RLPolicy

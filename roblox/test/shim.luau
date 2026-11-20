-- Just enough of Roblox to load the game's ModuleScripts under the `luau`
-- command line: a `game` with services, Instances that know their children, a
-- `require` that takes an Instance, and `Random`.
--
-- The command line gives a required file no way to see globals set from outside,
-- so the modules are wrapped first: `node roblox/tools/wrap.mjs` copies each one to
-- test/out/tree/<where it sits in the game>.luau as a function of the globals it
-- may use, and lists them in test/out/modules.luau. Then, from a file in test/:
--
--   local shim = require("./shim")
--   local Sim = shim.require(shim.game:GetService("ReplicatedStorage"):WaitForChild("Sim"))
--
-- ReplicatedStorage holds src/shared, ServerScriptService holds src/server with
-- its folders. Scripts (*.server.luau, *.client.luau) are left out.

local shim = {}

local Instance = {}
Instance.__index = function(self, key)
	return Instance[key] or rawget(self, "children")[key]
end

local function instance(name, className, parent)
	local self = setmetatable({ Name = name, ClassName = className, Parent = parent, children = {} }, Instance)
	if parent then
		parent.children[name] = self
	end
	return self
end

function Instance:FindFirstChild(name)
	return self.children[name]
end

function Instance:WaitForChild(name)
	return self.children[name] or error(`{self.Name} has no child {name}`, 2)
end

function Instance:GetChildren()
	local list = {}
	for _, child in self.children do
		table.insert(list, child)
	end
	table.sort(list, function(a, b)
		return a.Name < b.Name
	end)
	return list
end

function Instance:IsA(className)
	return self.ClassName == className
end

function Instance:GetService(name)
	return self.children[name] or instance(name, name, self)
end

shim.game = instance("Game", "DataModel", nil)

-- Not Roblox's generator: the same calls, other numbers. Seeded, so a run repeats.
local Random = {}
Random.__index = Random

function Random.new(seed)
	return setmetatable({ state = (seed or 1) % 2147483647 }, Random)
end

function Random:NextNumber(min, max)
	self.state = (self.state * 48271 + 12345) % 2147483647
	local u = self.state / 2147483647
	return if min then min + u * (max - min) else u
end

function Random:NextInteger(min, max)
	return min + math.floor(self:NextNumber() * (max - min + 1))
end

function Random:Clone()
	return setmetatable({ state = self.state }, Random)
end

shim.Random = Random

local loaded = {}

-- What a ModuleScript returns, run once, as Roblox's require does.
function shim.require(module)
	local result = loaded[module]
	if result == nil then
		assert(module.ClassName == "ModuleScript", `{module.Name} is not a ModuleScript`)
		result = require(module.file)(module, shim.game, shim.require, Random)
		loaded[module] = result
	end
	return result
end

-- The tree tools/wrap.mjs wrote: paths like "ServerScriptService/weights/RLSolo01".
local ok, paths = pcall(require, "./out/modules")
assert(ok, "run `node roblox/tools/wrap.mjs` first")
for _, path in paths do
	local at = shim.game
	local names = string.split(path, "/")
	for i, name in names do
		local child = at.children[name]
		if not child then
			child = if i == 1 then at:GetService(name) else instance(name, if i == #names then "ModuleScript" else "Folder", at)
		end
		at = child
	end
	at.file = "./out/tree/" .. path
end

return shim

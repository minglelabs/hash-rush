#!/bin/sh
# Checks the Roblox port of the learned bot against the web game, then times it.
# Needs node and the luau command line. Takes a few minutes.
#   sh roblox/test/run.sh
set -e
cd "$(dirname "$0")/../.."

# The Roblox modules, wrapped so they load outside Roblox (test/shim.luau).
node roblox/tools/wrap.mjs
# Rounds played in the web game, and its map and numbers, into roblox/test/out.
node roblox/tools/trace.mjs

# The same map and tuning values? The same rounds, seen and played the same?
luau roblox/test/parity.luau
luau --codegen roblox/test/crosscheck.luau

luau --codegen roblox/test/bench.luau

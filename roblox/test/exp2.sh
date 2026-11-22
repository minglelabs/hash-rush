# exp2.sh level guard(0/1) [mode]
cd /Users/nam/hash-rush/.claude/worktrees/remote-access-lag-issue-a3b862
for w in 0 1 2 3 4 5 6 7 8 9; do luau --codegen roblox/test/exp.luau -a $1 $((w*1000003+11)) 40 1 100 10 0.15 ${3:-solo} $2 ${4:-0} ${5:-10} & done | awk -v t="$*" '$1=="L"{tt+=$2;b+=$3;p+=$4;n++; next} {w+=$1; k+=$2; d+=$3} END {printf "%-14s win %4.1f%%  kills %.2f deaths %.2f | lost: thrown %.2f bonked %.2f picked %.2f\n", t, 100*w/n, k/n, d/n, tt/n,b/n,p/n}'
wait

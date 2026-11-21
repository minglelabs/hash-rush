#!/bin/sh
# Saves the Roblox store's pictures from art.html with headless Chrome:
# icon.png (512×512), thumb-en.png and thumb-ko.png (1920×1080), into roblox/store/.
#   sh roblox/tools/store/render.sh
set -e
cd "$(dirname "$0")/../../.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT=5289
OUT=roblox/store
mkdir -p "$OUT"

python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1

shot() { # name, size, query
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=8000 --window-size="$2" --screenshot="$PWD/$OUT/$1" \
    "http://localhost:$PORT/roblox/tools/store/art.html?$3" 2>/dev/null
  echo "$OUT/$1"
}
shot icon.png 512,512 "kind=icon"
shot thumb-en.png 1920,1080 "kind=thumb&lang=en"
shot thumb-ko.png 1920,1080 "kind=thumb&lang=ko"

#!/usr/bin/env python3
"""Builds HashRush.rbxlx, a place file Roblox Studio opens directly, from src/.
Does what `rojo build` does with default.project.json, for whoever has no Rojo."""
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).parent


def script(kind, name, path):
    source = (ROOT / path).read_text(encoding="utf-8")
    assert "]]>" not in source
    return (f'<Item class="{kind}"><Properties><string name="Name">{escape(name)}</string>'
            f'<ProtectedString name="Source"><![CDATA[{source}]]></ProtectedString></Properties></Item>')


def service(kind, props="", children=""):
    return f'<Item class="{kind}"><Properties><string name="Name">{kind}</string>{props}</Properties>{children}</Item>'


def colour(name, v):
    return f'<Color3 name="{name}"><R>{v}</R><G>{v}</G><B>{v}</B></Color3>'


place = "".join([
    '<roblox version="4">',
    service("Workspace", '<bool name="StreamingEnabled">false</bool>'),
    service("Players", '<bool name="CharacterAutoLoads">false</bool>'),
    service("Lighting", '<bool name="GlobalShadows">false</bool><float name="Brightness">2</float>'
            '<string name="TimeOfDay">12:00:00</string>' + colour("Ambient", 0.75) + colour("OutdoorAmbient", 0.75)),
    service("ReplicatedStorage", children=script("ModuleScript", "Config", "src/shared/Config.luau")
            + script("ModuleScript", "Snapshot", "src/shared/Snapshot.luau")),
    service("ServerScriptService", children=script("ModuleScript", "Sim", "src/server/Sim.luau")
            + script("ModuleScript", "Map", "src/server/Map.luau")
            + script("Script", "Round", "src/server/Round.server.luau")),
    service("StarterPlayer", children='<Item class="StarterPlayerScripts"><Properties>'
            '<string name="Name">StarterPlayerScripts</string></Properties>'
            + script("LocalScript", "Input", "src/client/Input.client.luau")
            + script("LocalScript", "View", "src/client/View.client.luau") + '</Item>'),
    '</roblox>',
])
(ROOT / "HashRush.rbxlx").write_text(place, encoding="utf-8")
print("HashRush.rbxlx", len(place), "bytes")

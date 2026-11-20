#!/usr/bin/env python3
"""Builds HashRush.rbxlx, a place file Roblox Studio opens directly, from src/.
Does what `rojo build` does with default.project.json, for whoever has no Rojo:
src/shared goes to ReplicatedStorage, src/server to ServerScriptService and
src/client to StarterPlayerScripts. `x.server.luau` is a Script, `x.client.luau`
a LocalScript, any other `.luau` a ModuleScript, and a folder is a Folder."""
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).parent


def script(path):
    name = path.name[: -len(".luau")]
    kind = "ModuleScript"
    for suffix, cls in ((".server", "Script"), (".client", "LocalScript")):
        if name.endswith(suffix):
            name, kind = name[: -len(suffix)], cls
    source = path.read_text(encoding="utf-8")
    assert "]]>" not in source, path
    return (f'<Item class="{kind}"><Properties><string name="Name">{escape(name)}</string>'
            f'<ProtectedString name="Source"><![CDATA[{source}]]></ProtectedString></Properties></Item>')


def tree(folder):
    out = []
    for path in sorted(folder.iterdir()):
        if path.is_dir():
            out.append(f'<Item class="Folder"><Properties><string name="Name">{escape(path.name)}</string></Properties>'
                       f'{tree(path)}</Item>')
        elif path.suffix == ".luau":
            out.append(script(path))
    return "".join(out)


def service(kind, props="", children=""):
    return f'<Item class="{kind}"><Properties><string name="Name">{kind}</string>{props}</Properties>{children}</Item>'


def colour(name, v):
    return f'<Color3 name="{name}"><R>{v}</R><G>{v}</G><B>{v}</B></Color3>'


place = "".join([
    '<roblox version="4">',
    service("Workspace", '<bool name="StreamingEnabled">false</bool>'),
    service("Players", '<bool name="CharacterAutoLoads">false</bool>'),
    service("Lighting", '<bool name="GlobalShadows">false</bool><float name="Brightness">2</float>'
            '<string name="TimeOfDay">15:00:00</string><float name="EnvironmentSpecularScale">0</float>' + colour("Ambient", 0.75) + colour("OutdoorAmbient", 0.75)),
    service("ReplicatedStorage", children=tree(ROOT / "src/shared")),
    service("ServerScriptService", children=tree(ROOT / "src/server")),
    service("StarterPlayer", children='<Item class="StarterPlayerScripts"><Properties>'
            '<string name="Name">StarterPlayerScripts</string></Properties>' + tree(ROOT / "src/client") + '</Item>'),
    '</roblox>',
])
(ROOT / "HashRush.rbxlx").write_text(place, encoding="utf-8")
print("HashRush.rbxlx", len(place), "bytes")

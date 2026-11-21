// Wraps the game's ModuleScripts so they load under the `luau` command line with
// test/shim.luau standing in for Roblox. Each becomes a function of the Roblox
// globals a module may use; see shim.luau.
// It lives here and not in test/ because `node --test` runs every script in a
// folder called test.
//   node roblox/tools/wrap.mjs

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const out = join(here, '..', 'test', 'out');
const PLACES = { shared: 'ReplicatedStorage', server: 'ServerScriptService', client: 'StarterPlayerScripts' };

function modules(dir, at) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...modules(join(dir, entry.name), `${at}/${entry.name}`));
    else if (/^[^.]+\.luau$/.test(entry.name)) found.push([join(dir, entry.name), `${at}/${entry.name.slice(0, -5)}`]);
  }
  return found;
}

rmSync(join(out, 'tree'), { recursive: true, force: true });
const paths = [];
for (const [folder, service] of Object.entries(PLACES)) {
  for (const [file, path] of modules(join(src, folder), service)) {
    const to = join(out, 'tree', `${path}.luau`);
    mkdirSync(dirname(to), { recursive: true });
    // On one line, so an error's line number is the module's own plus one.
    // The few Roblox globals beyond these come from the shim's `env`.
    writeFileSync(to, `return function(script, game, require, Random, env) local task, Vector2, Vector3, Color3 = env.task, env.Vector2, env.Vector3, env.Color3\n${readFileSync(file, 'utf8')}\nend\n`);
    paths.push(path);
  }
}
paths.sort();
writeFileSync(join(out, 'modules.luau'), `return {\n${paths.map((p) => `\t"${p}",\n`).join('')}}\n`);
console.log(`wrapped ${paths.length} modules into ${out}`);

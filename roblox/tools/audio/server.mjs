// Serves the game's files and render.html, and saves what the page renders into
// out/. Open http://localhost:5288/roblox/tools/audio/render.html in a browser,
// press both buttons, then run build.py.
//   node roblox/tools/audio/server.mjs
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..', '..');
const out = join(here, 'out');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
await mkdir(out, { recursive: true });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname.startsWith('/save/')) {
      const name = url.pathname.slice(6).replace(/[^a-z0-9._-]/gi, '');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      await writeFile(join(out, name), Buffer.concat(chunks));
      res.end('ok');
      return;
    }
    const file = join(root, normalize(url.pathname));
    if (!file.startsWith(root)) throw new Error('outside the repository');
    res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch (err) {
    res.statusCode = 404;
    res.end(String(err));
  }
}).listen(5288, () => console.log('http://localhost:5288/roblox/tools/audio/render.html'));

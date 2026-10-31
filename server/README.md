# Hash Rush game server (G2)

Rooms run on the server instead of a player's browser. The server plays the
host's part of the existing protocol (`src/client/main.js`), so the page joins
the same way it joins a player's room. Nobody is the host, so nobody leaving
stops a round, and no browser decides the result.

- Simulation: `src/sim` (the same code the page runs), 60 ticks a second.
- Snapshots: 30 a second, or at once when something happens.
- Empty seats up to 4 are filled with `bot:hard`. Up to 8 players; more watch.
- A player who leaves mid-round is replaced by a computer.
- After a round: results for 9 s, then the lobby for 8 s, then the next round.

## Play against it

Open the game with `?server=` and `?room=`:

```
https://minglelabs.github.io/hash-rush/?server=wss://<game-server-host>&room=<roomId>
```

Without `?server=` the page keeps using peer-to-peer rooms as before.
In mingle, one chat room is one game room: use the chat room id as `room`.

## API

| Path | What |
| --- | --- |
| `GET /health` | `{ ok, rooms, players }` |
| `WS /rooms/<roomId>` | room messages; `?map=<id>&teams=1` only when the room is first made |

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 8080 | set by Railway |
| `HOST` | `0.0.0.0` | bind address; use `127.0.0.1` locally behind a tunnel |
| `ALLOWED_ORIGINS` | any | comma list of page origins allowed to connect |
| `MAX_ROOMS` | 500 | new rooms beyond this get 503 |
| `HASH_RUSH_TICKET_SECRET` | unset | same as mingle's; when set, only holders of a mingle entry ticket for that room can join (`?ticket=`), under their chat name, and each lobby seat carries its ticket's `userId` |
| `RESULTS_URL` + `RESULTS_SECRET` | unset | POST each finished round (header `x-hash-rush-secret`); unset = log only |

## Run and test

```bash
cd server && npm install
npm test          # room logic, a whole round included
npm start         # ws://localhost:8080/rooms/<id>
```

## Deploy to Railway

1. New service from this repo. Keep the root directory at the repo root.
2. Set the config file path to `server/railway.json` (Dockerfile build,
   Singapore region, health check `/health`).
3. Generate a public domain. Set `ALLOWED_ORIGINS` to the page origins,
   e.g. `https://minglelabs.github.io,https://minglelabs.app`.
4. One replica only: rooms live in memory, so two replicas would split a room.

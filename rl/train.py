"""Self-play training for Hash Rush bots.

The game itself runs in Node (rl/env.js, the real simulation); this file is the
learner. The pieces, all light enough for a laptop:

  * PPO with GAE, one policy shared by every seat (the seats differ only in what
    they see), acting 15 times a second with a factored action: move x bonk x throw.
  * A SimBa-style network (Lee et al., ICLR 2025): running observation
    normalisation, residual MLP blocks, LayerNorm. Small, but it trains stably.
  * A league of past selves with prioritised fictitious self-play (AlphaStar's
    PFSP): opponents the learner still loses to are picked more often, so it
    cannot forget how to beat an old trick.
  * A curriculum of the game's scripted bots: most rounds start out against the
    easy bot, which wins by carrying the seed home, so bonking alone loses. Once
    the learner wins as often as the bots do, the next level joins, and at the
    end the bots thin out in favour of self-play.
  * Reward: the score table's own weights (bonk 1, throw 2, stop 1, seed 2,
    goal 5, super 3) plus a win bonus bigger than any of them.

Run:  python3 rl/train.py --name first --minutes 30
"""

import argparse
import json
import math
import os
import random
import subprocess
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = os.path.dirname(os.path.abspath(__file__))
HEADS = (9, 2, 2)  # move, bonk, throw
# The ladder: (share of rounds with scripted bots, bot levels that may sit in).
STAGES = [(0.7, [0]), (0.7, [0, 1]), (0.6, [0, 1, 2]), (0.35, [0, 1, 2]), (0.5, [0, 1, 2, 3])]
STAGE_NAMES = ["easy", "easy+normal", "all bots", "mostly self-play", "with the ace bot"]


# ---------- environment workers ----------


class Workers:
    """Several Node processes, each running a batch of rounds, stepped together."""

    def __init__(self, workers, envs, seed, settings):
        self.procs = []
        for w in range(workers):
            p = subprocess.Popen(["node", os.path.join(HERE, "env.js")], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            p.stdin.write((json.dumps({**settings, "envs": envs, "seed": seed * 1000 + w + 1}) + "\n").encode())
            p.stdin.flush()
            self.procs.append(p)
        head = [json.loads(p.stdout.readline()) for p in self.procs]
        self.obs_dim = head[0]["obs"]
        self.P = head[0]["maxPlayers"]
        self.E = envs
        self.N = workers * envs
        ep = self.E * self.P
        self.frame = 4 * ep * self.obs_dim + 4 * ep + 4 * ep + self.E + ep + ep

    def _read(self):
        obs, rew, score, done, role, win = [], [], [], [], [], []
        ep = self.E * self.P
        for p in self.procs:
            buf = p.stdout.read(self.frame)
            if len(buf) != self.frame:
                raise RuntimeError("an environment worker stopped")
            o = 0
            obs.append(np.frombuffer(buf, np.float32, ep * self.obs_dim, o).reshape(self.E, self.P, self.obs_dim))
            o += 4 * ep * self.obs_dim
            rew.append(np.frombuffer(buf, np.float32, ep, o).reshape(self.E, self.P))
            o += 4 * ep
            score.append(np.frombuffer(buf, np.float32, ep, o).reshape(self.E, self.P))
            o += 4 * ep
            done.append(np.frombuffer(buf, np.uint8, self.E, o))
            o += self.E
            role.append(np.frombuffer(buf, np.uint8, ep, o).reshape(self.E, self.P))
            o += ep
            win.append(np.frombuffer(buf, np.uint8, ep, o).reshape(self.E, self.P))
        return tuple(np.concatenate(x) for x in (obs, rew, score, done, role, win))

    def first(self):
        return self._read()

    def step(self, actions, bot_env, levels):
        head = bytes([int(round(bot_env * 100)), sum(1 << l for l in levels)])
        for w, p in enumerate(self.procs):
            p.stdin.write(head + actions[w * self.E : (w + 1) * self.E].tobytes())
            p.stdin.flush()
        return self._read()

    def close(self):
        for p in self.procs:
            p.stdin.close()
            p.terminate()


# ---------- the network ----------


class Block(nn.Module):
    def __init__(self, width):
        super().__init__()
        self.norm = nn.LayerNorm(width)
        self.up = nn.Linear(width, width * 2)
        self.down = nn.Linear(width * 2, width)

    def forward(self, x):
        return x + self.down(F.relu(self.up(self.norm(x))))


class Policy(nn.Module):
    def __init__(self, obs_dim, width=128, blocks=2):
        super().__init__()
        self.register_buffer("mean", torch.zeros(obs_dim))
        self.register_buffer("var", torch.ones(obs_dim))
        self.register_buffer("count", torch.tensor(1e-4))
        self.inp = nn.Linear(obs_dim, width)
        self.blocks = nn.ModuleList(Block(width) for _ in range(blocks))
        self.norm = nn.LayerNorm(width)
        self.pi = nn.Linear(width, sum(HEADS))
        self.v = nn.Linear(width, 1)
        nn.init.orthogonal_(self.pi.weight, 0.01)
        nn.init.zeros_(self.pi.bias)
        nn.init.orthogonal_(self.v.weight, 1.0)

    @torch.no_grad()
    def observe(self, x):
        """Fold a batch into the running mean and variance of the observations."""
        n = x.shape[0]
        if n == 0:
            return
        mean, var = x.mean(0), x.var(0, unbiased=False)
        total = self.count + n
        delta = mean - self.mean
        self.var.copy_((self.var * self.count + var * n + delta * delta * self.count * n / total) / total)
        self.mean.add_(delta * n / total)
        self.count.copy_(total)

    def forward(self, obs):
        x = ((obs - self.mean) / torch.sqrt(self.var + 1e-6)).clamp(-5, 5)
        x = self.inp(x)
        for b in self.blocks:
            x = b(x)
        x = self.norm(x)
        return self.pi(x), self.v(x).squeeze(-1)

    def dists(self, logits):
        return [torch.distributions.Categorical(logits=l) for l in torch.split(logits, HEADS, dim=-1)]

    @torch.no_grad()
    def act(self, obs):
        logits, value = self(obs)
        ds = self.dists(logits)
        a = torch.stack([d.sample() for d in ds], -1)
        logp = sum(d.log_prob(a[:, i]) for i, d in enumerate(ds))
        return a, logp, value

    def evaluate(self, obs, actions):
        logits, value = self(obs)
        ds = self.dists(logits)
        logp = sum(d.log_prob(actions[:, i]) for i, d in enumerate(ds))
        entropy = sum(d.entropy() for d in ds)
        return logp, entropy, value


def export_json(model, path, meta):
    """Plain numbers, so the browser can run the policy without any library."""
    out = {"meta": meta, "heads": HEADS}
    for k, v in model.state_dict().items():
        out[k] = v.detach().cpu().flatten().tolist() if v.ndim else float(v)
        out[k + ".shape"] = list(v.shape)
    with open(path, "w") as f:
        json.dump(out, f)


# ---------- the league ----------


class League:
    """Past selves to play against. Each keeps a running record of how often the
    learner beats it, and the ones it loses to are drawn more often."""

    def __init__(self, make, size, power):
        self.make = make
        self.size = size
        self.power = power
        self.members = []  # {model, wins, games, born}

    def add(self, model, born):
        clone = self.make()
        clone.load_state_dict(model.state_dict())
        clone.eval()
        entry = {"model": clone, "wins": 1.0, "games": 2.0, "born": born}
        if len(self.members) < self.size:
            self.members.append(entry)
        else:
            # Keep the oldest as an anchor and the rest spread over history.
            self.members[random.randrange(1, self.size)] = entry

    def pick(self):
        if not self.members:
            return -1
        p = np.array([m["wins"] / m["games"] for m in self.members])
        w = (1 - p) ** self.power + 0.02
        return int(np.random.choice(len(self.members), p=w / w.sum()))

    def record(self, i, won):
        m = self.members[i]
        # A slow average, so the record follows the learner as it changes.
        m["wins"] = m["wins"] * 0.99 + (1.0 if won else 0.0)
        m["games"] = m["games"] * 0.99 + 1.0


# ---------- training ----------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="run")
    ap.add_argument("--minutes", type=float, default=30)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 4))
    ap.add_argument("--envs", type=int, default=48, help="rounds per worker")
    ap.add_argument("--steps", type=int, default=128, help="decisions per rollout")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--width", type=int, default=256)
    ap.add_argument("--blocks", type=int, default=3)
    ap.add_argument("--frame-skip", type=int, default=4, help="game ticks (1/60 s) per decision")
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--gamma", type=float, default=0.997)
    ap.add_argument("--lam", type=float, default=0.95)
    ap.add_argument("--clip", type=float, default=0.2)
    ap.add_argument("--entropy", type=float, default=0.01)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch", type=int, default=2048)
    ap.add_argument("--reward-scale", type=float, default=0.1)
    ap.add_argument("--self-play", type=float, default=0.5, help="share of rounds where every seat is the learner")
    ap.add_argument("--league", type=int, default=16)
    ap.add_argument("--snapshot-every", type=int, default=10)
    ap.add_argument("--pfsp-power", type=float, default=1.0)
    ap.add_argument("--bot-env", type=float, default=0.15, help="share of rounds with scripted bots, when the curriculum is off")
    ap.add_argument("--no-curriculum", action="store_true", help="every bot level from the start, at --bot-env")
    ap.add_argument("--stage", type=int, default=-1, help="curriculum stage to start from (0 easy bots only); default: where the resumed run stopped")
    ap.add_argument("--promote-after", type=int, default=1000, help="bot rounds to judge a stage by")
    ap.add_argument("--win", type=float, default=30)
    ap.add_argument("--lose", type=float, default=0)
    ap.add_argument("--head-start", type=float, default=0.3, help="share of seats in bot-free rounds that start at the flower")
    ap.add_argument("--team-spirit", type=float, default=0.5, help="share of a teammate's pay each hamster gets in team rounds")
    ap.add_argument("--shape", type=float, default=1, help="weight of the progress pay; 0 turns it off")
    ap.add_argument("--maps", default="all", help="comma separated map ids, or all")
    ap.add_argument("--teams", type=float, default=0.5, help="share of rounds played in teams of 2 to 4 sides")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--resume", default="")
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(4)
    dev = torch.device(args.device)
    out_dir = os.path.join(HERE, "runs", args.name)
    os.makedirs(out_dir, exist_ok=True)

    stage = max(0, args.stage)
    if args.resume and args.stage < 0:
        try:
            with open(os.path.splitext(args.resume)[0] + ".json") as f:
                stage = int(json.load(f)["meta"].get("stage", 0))
        except (OSError, ValueError, KeyError):
            pass
    stage = min(stage, len(STAGES) - 1)
    spar = lambda: (args.bot_env, [0, 1, 2]) if args.no_curriculum else STAGES[stage]
    settings = {"botEnv": spar()[0], "botLevels": spar()[1], "win": args.win, "lose": args.lose, "shape": args.shape, "teams": args.teams, "frameSkip": args.frame_skip, "headStart": args.head_start, "teamSpirit": args.team_spirit}
    if args.maps != "all":
        settings["maps"] = args.maps.split(",")
    env = Workers(args.workers, args.envs, args.seed, settings)
    N, P, D, T = env.N, env.P, env.obs_dim, args.steps

    make = lambda: Policy(D, args.width, args.blocks).to(dev)
    model = make()
    if args.resume:
        model.load_state_dict(torch.load(args.resume, map_location=dev))
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4, eps=1e-5)
    league = League(make, args.league, args.pfsp_power)

    obs, _, _, _, role, _ = env.first()
    # Who plays each seat: -1 nobody we control, 0 the learner, k a league member (k-1).
    assign = np.full((N, P), -1, np.int64)
    opponent = np.full(N, -1, np.int64)

    def seat(n):
        policy = role[n] == 1
        assign[n] = -1
        opponent[n] = -1
        k = league.pick() if random.random() >= args.self_play else -1
        if k < 0:
            assign[n][policy] = 0
            return
        opponent[n] = k
        seats = np.flatnonzero(policy)
        mine = np.random.rand(len(seats)) < 0.5
        if not mine.any():
            mine[np.random.randint(len(seats))] = True
        # Against a past self alone there is nobody to play: keep one seat each.
        if mine.all() and len(seats) > 1 and not (role[n] > 1).any():
            mine[np.random.randint(len(seats))] = False
        assign[n][seats[mine]] = 0
        assign[n][seats[~mine]] = k + 1

    for n in range(N):
        seat(n)

    b_obs = np.zeros((T, N, P, D), np.float32)
    b_act = np.zeros((T, N, P, 3), np.int64)
    b_logp = np.zeros((T, N, P), np.float32)
    b_val = np.zeros((T + 1, N, P), np.float32)
    b_rew = np.zeros((T, N, P), np.float32)
    b_done = np.zeros((T, N), np.float32)
    b_mask = np.zeros((T, N, P), bool)

    log_path = os.path.join(out_dir, "log.csv")
    with open(log_path, "w") as f:
        f.write("iter,minutes,decisions,sps,stage,episodes,learner_score,win_vs_bots,fair_share,win_vs_league,entropy,value_loss,kl\n")
    stats = {k: [] for k in ("score", "bot_win", "bot_fair", "league_win")}
    start = time.time()
    it = 0
    total = 0
    actions = np.zeros((N, P, 3), np.uint8)
    # Against the stage's newest bot level: rounds, the learner's wins and seats, the bots' wins and seats.
    judge = np.zeros(5)
    meta = lambda: {"iter": it, "decisions": total, "obs": D, "width": args.width, "blocks": args.blocks, "stage": stage, "frameSkip": args.frame_skip}

    print(f"{N} rounds on {args.workers} workers, obs {D}, {sum(p.numel() for p in model.parameters())} weights, device {dev}")
    while (time.time() - start) / 60 < args.minutes:
        it += 1
        t0 = time.time()
        for t in range(T):
            learner = assign == 0
            x = torch.from_numpy(obs[learner]).to(dev)
            a, logp, val = model.act(x)
            actions[:] = 0
            actions[learner] = a.cpu().numpy()
            b_obs[t] = obs
            b_mask[t] = learner
            b_act[t][learner] = a.cpu().numpy()
            b_logp[t][learner] = logp.cpu().numpy()
            b_val[t] = 0
            b_val[t][learner] = val.cpu().numpy()
            for k in np.unique(assign[assign > 0]):
                sel = assign == k
                oa, _, _ = league.members[k - 1]["model"].act(torch.from_numpy(obs[sel]).to(dev))
                actions[sel] = oa.cpu().numpy()

            was = assign.copy()
            had_bots = (role > 1).any(1)
            players = (role > 0).sum(1)
            before = role
            obs, rew, score, done, role, win = env.step(actions, *spar())
            b_rew[t] = rew * args.reward_scale
            b_done[t] = done
            for n in np.flatnonzero(done):
                mine = was[n] == 0
                won = bool(win[n][mine].any())
                stats["score"].append(float(score[n][mine].mean()))
                if had_bots[n]:
                    stats["bot_win"].append(float(win[n][mine].mean()))
                    stats["bot_fair"].append(1.0 / players[n])
                    top = before[n] == 2 + STAGES[stage][1][-1]
                    if top.any() and mine.any():
                        judge += (1, win[n][mine].sum(), mine.sum(), win[n][top].sum(), top.sum())
                if opponent[n] >= 0:
                    league.record(opponent[n], won)
                    stats["league_win"].append(1.0 if won else 0.0)
                seat(n)
        total += T * N

        # Value of where the rollout stopped, for the seats still being learned.
        learner = assign == 0
        with torch.no_grad():
            _, last = model(torch.from_numpy(obs[learner]).to(dev))
        b_val[T] = 0
        b_val[T][learner] = last.cpu().numpy()

        adv = np.zeros((T, N, P), np.float32)
        run = np.zeros((N, P), np.float32)
        for t in reversed(range(T)):
            alive = (1.0 - b_done[t])[:, None]
            delta = b_rew[t] + args.gamma * b_val[t + 1] * alive - b_val[t]
            run = delta + args.gamma * args.lam * alive * run
            adv[t] = run
        ret = adv + b_val[:T]

        m = b_mask
        d_obs = torch.from_numpy(b_obs[m]).to(dev)
        d_act = torch.from_numpy(b_act[m]).to(dev)
        d_logp = torch.from_numpy(b_logp[m]).to(dev)
        d_adv = torch.from_numpy(adv[m]).to(dev)
        d_adv = (d_adv - d_adv.mean()) / (d_adv.std() + 1e-8)
        d_ret = torch.from_numpy(ret[m]).to(dev)
        model.observe(d_obs)

        frac = min(1.0, (time.time() - start) / 60 / args.minutes)
        for g in opt.param_groups:
            g["lr"] = args.lr * (1 - 0.8 * frac)
        size = d_obs.shape[0]
        kl = ent_mean = v_loss = 0.0
        stop = False
        for _ in range(args.epochs):
            order = torch.randperm(size, device=dev)
            for i in range(0, size, args.batch):
                idx = order[i : i + args.batch]
                logp, entropy, value = model.evaluate(d_obs[idx], d_act[idx])
                if idx.numel() < 2:
                    continue
                a = d_adv[idx]
                ratio = torch.exp(logp - d_logp[idx])
                pg = -torch.min(ratio * a, ratio.clamp(1 - args.clip, 1 + args.clip) * a).mean()
                vl = F.smooth_l1_loss(value, d_ret[idx])
                loss = pg + 0.5 * vl - args.entropy * entropy.mean()
                opt.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 0.5)
                opt.step()
                kl = float((d_logp[idx] - logp).mean().detach())
                ent_mean, v_loss = float(entropy.mean().detach()), float(vl.detach())
                if kl > 0.03:
                    stop = True
                    break
            if stop:
                break

        # Up a stage once the learner's seats win as often as the newest bots' seats.
        if not args.no_curriculum and judge[0] >= args.promote_after:
            mine_rate, bot_rate = judge[1] / judge[2], judge[4] and judge[3] / judge[4]
            print(f"stage {stage} ({STAGE_NAMES[stage]}): learner wins {mine_rate:.2f} of its seats, the bots {bot_rate:.2f}", flush=True)
            if mine_rate >= bot_rate and stage < len(STAGES) - 1:
                stage += 1
                print(f"-> stage {stage} ({STAGE_NAMES[stage]})", flush=True)
            judge[:] = 0

        if it % args.snapshot_every == 0:
            league.add(model, it)
            torch.save(model.state_dict(), os.path.join(out_dir, "policy.pt"))
            export_json(model, os.path.join(out_dir, "policy.json"), meta())

        mean = lambda k: float(np.mean(stats[k])) if stats[k] else float("nan")
        minutes = (time.time() - start) / 60
        sps = T * N / (time.time() - t0)
        row = [it, round(minutes, 2), total, int(sps), stage, len(stats["score"]), round(mean("score"), 2), round(mean("bot_win"), 3), round(mean("bot_fair"), 3), round(mean("league_win"), 3), round(ent_mean, 3), round(v_loss, 4), round(kl, 4)]
        with open(log_path, "a") as f:
            f.write(",".join(str(v) for v in row) + "\n")
        if it % 5 == 0 or it == 1:
            print(f"it {it:4d}  stage {stage}  {minutes:5.1f}m  {total/1e6:6.2f}M decisions  {int(sps):6d}/s  score {mean('score'):5.2f}  win vs bots {mean('bot_win'):.2f} (fair {mean('bot_fair'):.2f})  vs league {mean('league_win'):.2f}  ent {ent_mean:.2f}", flush=True)
            stats = {k: [] for k in stats}

    torch.save(model.state_dict(), os.path.join(out_dir, "policy.pt"))
    export_json(model, os.path.join(out_dir, "policy.json"), meta())
    env.close()
    print(f"saved {out_dir}/policy.pt and policy.json")


if __name__ == "__main__":
    main()

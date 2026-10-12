"""Learns from the scripted bots before any self-play, like AlphaGo did from
recorded games: the policy copies what the bots do, and the value head learns
who is ahead (the discounted reward that followed, win bonus included).

The bots already nibble seeds and run them home, which PPO alone never found by
chance. Copying alone walks into a hedge the bots never touch and stays there, so
a few DAgger rounds follow: the copy plays some seats itself, and learns what the
bot would have done in the spots it got itself into. Training then starts from
here instead of from random play:

  python3 rl/pretrain.py --name pre
  python3 rl/train.py --name long --minutes 180 --resume rl/runs/pre/policy.pt
"""

import argparse
import os
import subprocess
import time

import numpy as np
import torch
import torch.nn.functional as F

from train import HEADS, HERE, Policy, export_json

def record(args, out_dir, samples, round_, policy=""):
    """Bot games from several Node processes at once."""
    each = samples // args.workers
    parts = [os.path.join(out_dir, f"demo{w}") for w in range(args.workers)]
    extra = [policy, str(args.share)] if policy else []
    procs = [
        subprocess.Popen(["node", os.path.join(HERE, "demo.js"), p, str(each), str(args.seed * 1000 + round_ * 100 + w), str(args.gamma), str(args.frame_skip)] + extra)
        for w, p in enumerate(parts)
    ]
    for p in procs:
        if p.wait() != 0:
            raise RuntimeError("a demo recorder failed")
    act = np.concatenate([np.fromfile(p + ".act", np.uint8).reshape(-1, 3) for p in parts])
    ret = np.concatenate([np.fromfile(p + ".ret", np.float32) for p in parts])
    win = np.concatenate([np.fromfile(p + ".win", np.uint8) for p in parts])
    obs = np.concatenate([np.fromfile(p + ".obs", np.float32) for p in parts]).reshape(len(act), -1)
    for p in parts:
        for ext in ("obs", "act", "ret", "win"):
            os.remove(f"{p}.{ext}")
    return obs, act, ret, win


def meta(args, model):
    return {"iter": 0, "decisions": 0, "obs": model.mean.shape[0], "width": args.width, "blocks": args.blocks, "stage": 0, "frameSkip": args.frame_skip}


def fit(args, model, opt, data):
    obs = torch.from_numpy(data[0])
    act = torch.from_numpy(data[1].astype(np.int64))
    ret = torch.from_numpy(data[2]) * args.reward_scale
    win = torch.from_numpy(data[3])
    held = torch.rand(len(act)) < 0.05
    train, test = (~held).nonzero().squeeze(1), held.nonzero().squeeze(1)

    def losses(idx):
        logits, value = model(obs[idx])
        pi = sum(F.cross_entropy(l, act[idx, i]) for i, l in enumerate(torch.split(logits, HEADS, dim=-1)))
        return pi, F.smooth_l1_loss(value, ret[idx]), value, logits

    for ep in range(args.epochs):
        order = train[torch.randperm(len(train))]
        for i in range(0, len(order) - args.batch + 1, args.batch):
            pi, vl, _, _ = losses(order[i : i + args.batch])
            opt.zero_grad()
            (pi + 0.5 * vl).backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        with torch.no_grad():
            pi, vl, value, logits = losses(test)
            hit = (logits[:, : HEADS[0]].argmax(-1) == act[test, 0]).float().mean()
            # How well the value tells the eventual winners from the rest.
            w = win[test] == 1
            gap = value[w].mean() - value[~w].mean() if w.any() and (~w).any() else float("nan")
        print(f"  epoch {ep + 1}  policy loss {pi:.3f}  move matches the bot {hit:.2f}  value loss {vl:.3f}  value winners - losers {gap:+.2f}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="pre")
    ap.add_argument("--samples", type=int, default=2_000_000, help="bot decisions to copy first")
    ap.add_argument("--dagger", type=int, default=3, help="rounds where the copy plays and the bots correct it")
    ap.add_argument("--dagger-samples", type=int, default=1_000_000, help="decisions recorded per DAgger round")
    ap.add_argument("--share", type=float, default=0.5, help="share of seats the copy plays in a DAgger round")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    ap.add_argument("--epochs", type=int, default=3, help="passes over the data after each recording")
    ap.add_argument("--batch", type=int, default=4096)
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--width", type=int, default=256)
    ap.add_argument("--blocks", type=int, default=3)
    # Must match train.py, or the value head learns the wrong scale.
    ap.add_argument("--gamma", type=float, default=0.997)
    ap.add_argument("--reward-scale", type=float, default=0.1)
    ap.add_argument("--frame-skip", type=int, default=4)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    torch.set_num_threads(os.cpu_count() or 4)
    out_dir = os.path.join(HERE, "runs", args.name)
    os.makedirs(out_dir, exist_ok=True)

    model = None
    data = None
    for round_ in range(args.dagger + 1):
        t0 = time.time()
        policy = ""
        if model is not None:
            policy = os.path.join(out_dir, "policy.json")
            export_json(model, policy, meta(args, model))
        new = record(args, out_dir, args.samples if round_ == 0 else args.dagger_samples, round_, policy)
        data = new if data is None else [np.concatenate([a, b]) for a, b in zip(data, new)]
        what = "bots only" if round_ == 0 else f"DAgger round {round_}, copy plays {args.share:.0%} of seats"
        print(f"{what}: {len(new[1])} decisions in {(time.time() - t0) / 60:.1f}m, {len(data[1])} in all", flush=True)
        if model is None:
            model = Policy(data[0].shape[1], args.width, args.blocks)
            model.observe(torch.from_numpy(data[0]))
            opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
        fit(args, model, opt, data)

    torch.save(model.state_dict(), os.path.join(out_dir, "policy.pt"))
    export_json(model, os.path.join(out_dir, "policy.json"), meta(args, model))
    print(f"saved {out_dir}/policy.pt and policy.json")


if __name__ == "__main__":
    main()

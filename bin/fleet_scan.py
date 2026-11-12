#!/usr/bin/env python3
"""FLEET collector: one JSON snapshot of every live Claude Code session.

Read-only over Claude Code's own files:
  ~/.claude/sessions/<pid>.json            live sessions (alive if /proc/<pid> exists)
  $XDG_RUNTIME_DIR/claude-hud/s-<sid>/     Claude Core HUD hook state (phase, tools, agents)
  ~/.claude/projects/<slug>/<sid>.jsonl    transcripts (feed, tokens, cost), read incrementally

Its only write is its own cache: $XDG_RUNTIME_DIR/claude-fleet/cache.json, holding the
byte offset reached in each transcript, so each run parses only the lines that are new.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta

HOME = os.path.expanduser("~")
CLAUDE = os.path.join(HOME, ".claude")
RT = os.environ.get("XDG_RUNTIME_DIR") or f"/tmp/claude-{os.getuid()}"
HUD = os.path.join(RT, "claude-hud") if os.path.isdir(os.path.join(RT, "claude-hud")) else f"/tmp/claude-hud-{os.getuid()}"
CACHE_DIR = os.path.join(RT, "claude-fleet")
CACHE = os.path.join(CACHE_DIR, "cache.json")
CACHE_VERSION = 3
GIT_EVERY = 20  # seconds between `git diff --shortstat` runs per folder
READ_BUDGET = 24 * 1024 * 1024   # bytes of transcript parsed per run; a big backlog catches up over runs
FEED_KEEP = 80
DAYS = 7

# $ per million tokens: input, output, cache write (5m), cache read. API list prices; an
# estimate of what the usage would cost on the API (a subscription bills differently).
PRICES = [
    ("fable-5-2", 8, 40, 10, 0.20), ("mythos-5-2", 8, 40, 10, 0.20),
    ("fable", 10, 50, 12.5, 1.0), ("mythos", 10, 50, 12.5, 1.0),
    ("opus-5-5", 4, 20, 5, 0.20), ("opus", 5, 25, 6.25, 0.50),
    ("sonnet-5", 2, 10, 2.5, 0.10), ("sonnet", 3, 15, 3.75, 0.30),
    ("haiku-5", 0.10, 0.50, 0.125, 0.01), ("haiku", 1, 5, 1.25, 0.10),
]


def price(model):
    m = (model or "").lower()
    for key, *p in PRICES:
        if key in m:
            return p
    return PRICES[5][1:]  # unknown: Opus-tier, the conservative guess


def cost(model, u):
    pi, po, pw, pr = price(model)
    return (u.get("in", 0) * pi + u.get("out", 0) * po + u.get("cw", 0) * pw + u.get("cr", 0) * pr) / 1e6


def short_model(model):
    m = (model or "").replace("claude-", "")
    return m or "?"


def read_text(path, default=""):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return default


def alive(pid):
    return os.path.isdir(f"/proc/{pid}")


def slug(cwd):
    return "".join(c if c.isalnum() else "-" for c in cwd)


def iso_to_epoch(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def local_day(epoch):
    return datetime.fromtimestamp(epoch).strftime("%Y-%m-%d")


def detail_of(inp):
    if not isinstance(inp, dict):
        return ""
    for k in ("description", "command", "file_path", "notebook_path", "pattern", "url", "query",
              "subagent_type", "skill", "prompt"):
        v = inp.get(k)
        if isinstance(v, str) and v:
            v = " ".join(v.split())
            if k in ("file_path", "notebook_path"):
                v = v.rsplit("/", 1)[-1]
            return v[:90]
    return ""


def hud_state(sid):
    d = os.path.join(HUD, f"s-{sid}")
    out = {"phase": "", "phaseSince": 0, "tools": [], "agents": [], "calls": 0}
    if not os.path.isdir(d):
        return out
    ph = read_text(os.path.join(d, "phase")).strip().split("\t")
    if len(ph) == 2:
        out["phaseSince"] = int(ph[0] or 0)
        out["phase"] = ph[1]
    try:
        out["calls"] = os.path.getsize(os.path.join(d, "calls"))
    except OSError:
        pass
    td = os.path.join(d, "tools")
    for f in sorted(os.listdir(td)) if os.path.isdir(td) else []:
        p = read_text(os.path.join(td, f)).rstrip("\n").split("\t")
        if len(p) >= 2:
            out["tools"].append({"tool": p[1], "detail": p[2] if len(p) > 2 else "", "since": int(p[0] or 0)})
    rows = {}
    rd = os.path.join(d, "agentrows")
    for f in os.listdir(rd) if os.path.isdir(rd) else []:
        p = read_text(os.path.join(rd, f)).rstrip("\n").split("\t")
        if len(p) >= 7:
            rows[p[6]] = {"tokens": int(p[2] or 0), "ctx": int(p[3] or 0), "status": p[5]}
    ad = os.path.join(d, "agents")
    for f in sorted(os.listdir(ad)) if os.path.isdir(ad) else []:
        p = read_text(os.path.join(ad, f)).rstrip("\n").split("\t")
        if len(p) >= 2:
            task = p[2] if len(p) > 2 else ""
            r = rows.get(task, {})
            out["agents"].append({"id": f, "type": p[1], "task": task, "since": int(p[0] or 0),
                                  "tokens": r.get("tokens", 0), "ctx": r.get("ctx", 0)})
    return out


def git_head(cwd):
    """Branch name from .git/HEAD, walking up; no subprocess."""
    d = cwd
    while d and d != "/":
        g = os.path.join(d, ".git")
        if os.path.isfile(g):  # worktree or submodule: "gitdir: <path>"
            line = read_text(g).strip()
            if line.startswith("gitdir:"):
                g = os.path.join(d, line[7:].strip())
        if os.path.isdir(g):
            head = read_text(os.path.join(g, "HEAD")).strip()
            return head[16:] if head.startswith("ref: refs/heads/") else head[:7]
        d = os.path.dirname(d)
    return ""


def git_diff(cwd, cache, now):
    """Lines added/removed vs HEAD, refreshed at most every GIT_EVERY seconds."""
    g = cache.setdefault("git", {})
    hit = g.get(cwd)
    if hit and now - hit["t"] < GIT_EVERY:
        return hit["add"], hit["del"]
    add = rem = 0
    try:
        out = subprocess.run(["git", "-C", cwd, "diff", "--shortstat", "HEAD"], capture_output=True,
                             text=True, timeout=2).stdout
        for part in out.split(","):
            n = int("".join(c for c in part if c.isdigit()) or 0)
            if "insertion" in part:
                add = n
            elif "deletion" in part:
                rem = n
    except Exception:
        pass
    g[cwd] = {"t": now, "add": add, "del": rem}
    return add, rem


def load_cache():
    try:
        c = json.loads(read_text(CACHE, "{}"))
        if c.get("v") == CACHE_VERSION:
            return c
    except Exception:
        pass
    return {"v": CACHE_VERSION, "files": {}, "feed": []}


def save_cache(c):
    os.makedirs(CACHE_DIR, mode=0o700, exist_ok=True)
    tmp = CACHE + f".{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(c, f, separators=(",", ":"))
    os.replace(tmp, CACHE)


def scan_file(path, entry, budget, feed_sid, feed, names):
    """Parse new complete lines of one transcript; returns bytes consumed."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return 0
    off = entry.get("off", 0)
    if size < off:  # rewritten: start over
        entry.clear()
        off = 0
    if size == off or budget <= 0:
        return 0
    with open(path, "rb") as f:
        f.seek(off)
        chunk = f.read(min(size - off, budget))
    end = chunk.rfind(b"\n")
    if end < 0:
        return 0
    chunk = chunk[: end + 1]
    entry["off"] = off + len(chunk)
    days = entry.setdefault("days", {})
    last_id = entry.get("lastId")
    for raw in chunk.split(b"\n"):
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except Exception:
            continue
        if row.get("type") != "assistant":
            continue
        msg = row.get("message") or {}
        ts = iso_to_epoch(row.get("timestamp", ""))
        model = msg.get("model") or ""
        u = msg.get("usage")
        mid = msg.get("id")
        if u and mid != last_id and model and model != "<synthetic>":
            last_id = mid
            day = local_day(ts) if ts else local_day(time.time())
            dm = days.setdefault(day, {}).setdefault(model, {"in": 0, "out": 0, "cw": 0, "cr": 0})
            dm["in"] += u.get("input_tokens", 0) or 0
            dm["out"] += u.get("output_tokens", 0) or 0
            dm["cw"] += u.get("cache_creation_input_tokens", 0) or 0
            dm["cr"] += u.get("cache_read_input_tokens", 0) or 0
            if not row.get("isSidechain"):
                entry["ctx"] = (u.get("input_tokens", 0) or 0) + (u.get("cache_creation_input_tokens", 0) or 0) \
                    + (u.get("cache_read_input_tokens", 0) or 0)
                entry["model"] = model
        if feed_sid:
            for b in msg.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    feed.append({"t": ts, "sid": feed_sid, "name": names.get(feed_sid, feed_sid[:8]),
                                 "tool": b.get("name", "?"), "detail": detail_of(b.get("input")),
                                 "agent": bool(row.get("isSidechain") or "/subagents/" in path)})
    entry["lastId"] = last_id
    return len(chunk)


def main():
    now = time.time()
    cache = load_cache()
    files = cache["files"]
    feed = cache.get("feed", [])

    # 1. live sessions
    sessions = []
    sd = os.path.join(CLAUDE, "sessions")
    for f in os.listdir(sd) if os.path.isdir(sd) else []:
        if not f.endswith(".json"):
            continue
        try:
            s = json.loads(read_text(os.path.join(sd, f)))
        except Exception:
            continue
        pid = s.get("pid")
        if not pid or not alive(pid) or s.get("kind", "interactive") != "interactive":
            continue
        sessions.append(s)
    names = {s["sessionId"]: s.get("name") or os.path.basename(s.get("cwd", "")) for s in sessions}

    # 2. transcripts: live sessions first (feed), then anything touched in the last 7 days (cost)
    budget = READ_BUDGET
    live_paths = {}
    for s in sessions:
        base = os.path.join(CLAUDE, "projects", slug(s.get("cwd", "")))
        main_t = os.path.join(base, s["sessionId"] + ".jsonl")
        live_paths[main_t] = s["sessionId"]
        sub = os.path.join(base, s["sessionId"], "subagents")
        for g in os.listdir(sub) if os.path.isdir(sub) else []:
            if g.endswith(".jsonl"):
                live_paths[os.path.join(sub, g)] = s["sessionId"]
    cutoff = now - DAYS * 86400
    recent = []
    pd = os.path.join(CLAUDE, "projects")
    for root, _, fs in os.walk(pd):
        for g in fs:
            if g.endswith(".jsonl"):
                p = os.path.join(root, g)
                try:
                    if os.path.getmtime(p) >= cutoff:
                        recent.append(p)
                except OSError:
                    pass
    is_first = {p: p not in files for p in live_paths}
    for p in list(live_paths) + [p for p in recent if p not in live_paths]:
        entry = files.setdefault(p, {})
        # the very first read of a live transcript would flood the feed with history
        feed_sid = live_paths.get(p) if not is_first.get(p, True) else None
        budget -= scan_file(p, entry, budget, feed_sid, feed, names)
    pending = sum(max(0, os.path.getsize(p) - files.get(p, {}).get("off", 0)) for p in recent if os.path.exists(p))

    # drop entries for files gone or older than the window
    keep = set(recent) | set(live_paths)
    for p in list(files):
        if p not in keep:
            del files[p]
    feed = sorted(feed, key=lambda e: e["t"])[-FEED_KEEP:]
    cache["feed"] = feed

    # 3. cost roll-up
    today = local_day(now)
    day_keys = [(datetime.fromtimestamp(now) - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(DAYS - 1, -1, -1)]
    per_day = {d: 0.0 for d in day_keys}
    models = {}
    tot = {"in": 0, "out": 0, "cw": 0, "cr": 0}
    for p, e in files.items():
        for d, ms in (e.get("days") or {}).items():
            for m, u in ms.items():
                c = cost(m, u)
                if d in per_day:
                    per_day[d] += c
                if d == today:
                    models[short_model(m)] = models.get(short_model(m), 0) + c
                    for k in tot:
                        tot[k] += u[k]

    def session_cost(sid, cwd):
        base = os.path.join(CLAUDE, "projects", slug(cwd))
        c, toks = 0.0, 0
        for p, e in files.items():
            if p.startswith(os.path.join(base, sid)):
                for ms in (e.get("days") or {}).values():
                    for m, u in ms.items():
                        c += cost(m, u)
                        toks += u["in"] + u["out"] + u["cw"] + u["cr"]
        return c, toks

    out_sessions = []
    for s in sorted(sessions, key=lambda s: s.get("startedAt", 0)):
        sid = s["sessionId"]
        h = hud_state(sid)
        main_t = os.path.join(CLAUDE, "projects", slug(s.get("cwd", "")), sid + ".jsonl")
        e = files.get(main_t, {})
        c, toks = session_cost(sid, s.get("cwd", ""))
        branch = git_head(s.get("cwd", ""))
        added, removed = git_diff(s.get("cwd", ""), cache, now) if branch else (0, 0)
        phase = h["phase"] or ("thinking" if s.get("status") == "busy" else "idle")
        if any(t["tool"] in ("AskUserQuestion", "ExitPlanMode") for t in h["tools"]):
            phase = "waiting"
        out_sessions.append({
            "pid": s["pid"], "sid": sid, "name": names[sid], "cwd": s.get("cwd", ""),
            "status": s.get("status", ""), "phase": phase,
            "phaseSince": h["phaseSince"] or int((s.get("statusUpdatedAt") or 0) / 1000),
            "startedAt": int((s.get("startedAt") or 0) / 1000),
            "tools": h["tools"], "agents": h["agents"], "calls": h["calls"],
            "model": short_model(e.get("model", "")), "ctx": e.get("ctx", 0),
            "cost": round(c, 4), "tokens": toks, "transcript": main_t,
            "branch": branch, "added": added, "removed": removed,
        })

    save_cache(cache)
    total_in = tot["in"] + tot["cw"] + tot["cr"]
    json.dump({
        "now": int(now),
        "sessions": out_sessions,
        "feed": feed[-40:],
        "cost": {
            "today": round(per_day.get(today, 0), 4),
            "tokens": sum(tot.values()),
            "cacheHit": round(tot["cr"] / total_in, 3) if total_in else 0,
            "days": [{"date": d, "usd": round(per_day[d], 4)} for d in day_keys],
            "models": {m: round(v, 4) for m, v in sorted(models.items(), key=lambda kv: -kv[1])},
            "pendingBytes": pending,
        },
    }, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()

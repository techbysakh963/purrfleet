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
import stat
import subprocess
import tempfile
import sys
import time
from datetime import datetime, timedelta

HOME = os.path.expanduser("~")
CLAUDE = os.path.join(HOME, ".claude")
RT = os.environ.get("XDG_RUNTIME_DIR") or ""
HUD = os.path.join(RT, "claude-hud") if RT and os.path.isdir(os.path.join(RT, "claude-hud")) else f"/tmp/claude-hud-{os.getuid()}"
# the cache lives in a private per-user folder, never a shared temp folder
CACHE_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(HOME, ".cache"), "purrfleet")
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


def to_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def ls(d):
    """A folder's entries, or none when it vanished (the HUD removes them as tools finish)."""
    try:
        return os.listdir(d)
    except OSError:
        return []


def hud_state(sid):
    d = os.path.join(HUD, f"s-{sid}")
    out = {"phase": "", "phaseSince": 0, "tools": [], "agents": [], "calls": 0}
    if not os.path.isdir(d):
        return out
    ph = read_text(os.path.join(d, "phase")).strip().split("\t")
    if len(ph) == 2:
        out["phaseSince"] = to_int(ph[0])
        out["phase"] = ph[1]
    try:
        out["calls"] = os.path.getsize(os.path.join(d, "calls"))
    except OSError:
        pass
    td = os.path.join(d, "tools")
    for f in sorted(ls(td)):
        p = read_text(os.path.join(td, f)).rstrip("\n").split("\t")
        if len(p) >= 2:
            out["tools"].append({"tool": p[1], "detail": p[2] if len(p) > 2 else "", "since": to_int(p[0])})
    rows = {}
    rd = os.path.join(d, "agentrows")
    for f in ls(rd):
        p = read_text(os.path.join(rd, f)).rstrip("\n").split("\t")
        if len(p) >= 7:
            rows[p[6]] = {"tokens": to_int(p[2]), "ctx": to_int(p[3]), "status": p[5]}
    ad = os.path.join(d, "agents")
    for f in sorted(ls(ad)):
        p = read_text(os.path.join(ad, f)).rstrip("\n").split("\t")
        if len(p) >= 2:
            task = p[2] if len(p) > 2 else ""
            r = rows.get(task, {})
            out["agents"].append({"id": f, "type": p[1], "task": task, "since": to_int(p[0]),
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


# ── system: what everything Claude-related costs the machine ─────────────────

CLK = os.sysconf("SC_CLK_TCK")
PAGE = os.sysconf("SC_PAGE_SIZE")
HISTORY = 40


def proc_table():
    """pid → (ppid, ticks, rss bytes, argv) for this user's processes."""
    uid = os.getuid()
    out = {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            if os.stat(f"/proc/{d}").st_uid != uid:
                continue
            raw = read_text(f"/proc/{d}/stat")
            rest = raw[raw.rindex(")") + 2:].split()  # fields after "(comm)"
            ppid, ticks = int(rest[1]), int(rest[11]) + int(rest[12])
            rss = int(read_text(f"/proc/{d}/statm").split()[1]) * PAGE
            with open(f"/proc/{d}/cmdline", "rb") as f:
                argv = [a.decode("utf-8", "replace") for a in f.read().split(b"\0") if a]
            out[int(d)] = (ppid, ticks, rss, argv)
        except (OSError, ValueError, IndexError):
            continue
    return out


def classify(argv):
    base = os.path.basename(argv[0]) if argv else ""
    line = " ".join(argv[:3]).lower()
    if base == "claude" or "/claude/versions/" in line or line.endswith("/bin/claude"):
        return "Claude Code"
    if base == "codex" or "/codex" in line:
        return "Codex"
    if base in ("agy", "jetski") or "antigravity" in line:
        return "Antigravity"
    return None


def system(cache, now):
    table = proc_table()
    prev = cache.get("ticks", {})
    roots = {pid for pid, (_, _, _, argv) in table.items() if classify(argv) == "Claude Code"}

    def group_of(pid):
        own = classify(table[pid][3])
        if own:
            return own
        seen, p = 0, table[pid][0]
        while p in table and seen < 40:
            if p in roots:
                line = " ".join(table[pid][3]).lower()
                if "fleet_scan" in line:
                    return "FLEET"
                return "MCP servers" if "mcp" in line else "tools & shells"
            p, seen = table[p][0], seen + 1
        return None

    groups, procs, ticks_now = {}, [], {}
    for pid, (_ppid, ticks, rss, argv) in table.items():
        g = group_of(pid)
        if not g:
            continue
        ticks_now[str(pid)] = [ticks, now]
        old = prev.get(str(pid))
        cpu = 0.0
        if old and now > old[1]:
            cpu = max(0.0, (ticks - old[0]) / CLK / (now - old[1]) * 100)
        agg = groups.setdefault(g, {"name": g, "count": 0, "cpu": 0.0, "rssMb": 0.0})
        agg["count"] += 1
        agg["cpu"] += cpu
        agg["rssMb"] += rss / 1048576
        procs.append({"pid": pid, "group": g, "cpu": round(cpu, 1), "rssMb": round(rss / 1048576, 1),
                      "cmd": " ".join(os.path.basename(a) if i == 0 else a for i, a in enumerate(argv[:4]))[:90]})
    cache["ticks"] = ticks_now
    hist = cache.setdefault("hist", {})
    order = ["Claude Code", "MCP servers", "tools & shells", "Codex", "Antigravity", "FLEET"]
    out_groups = []
    for name in order:
        g = groups.get(name, {"name": name, "count": 0, "cpu": 0.0, "rssMb": 0.0})
        h = (hist.get(name, []) + [round(g["cpu"], 1)])[-HISTORY:]
        hist[name] = h
        out_groups.append({**g, "cpu": round(g["cpu"], 1), "rssMb": round(g["rssMb"]), "history": h})
    mem = {}
    for line in read_text("/proc/meminfo").splitlines():
        k, _, v = line.partition(":")
        mem[k] = int(v.split()[0]) if v.split() else 0
    total = mem.get("MemTotal", 0) // 1024
    return {
        "groups": out_groups,
        "top": sorted(procs, key=lambda x: (-x["cpu"], -x["rssMb"]))[:6],
        "memTotalMb": total,
        "memUsedMb": total - mem.get("MemAvailable", 0) // 1024,
        "load": [float(x) for x in read_text("/proc/loadavg").split()[:3]],
        "cores": os.cpu_count() or 1,
    }


def load_cache():
    try:
        c = json.loads(read_text(CACHE, "{}"))
        if c.get("v") == CACHE_VERSION:
            return c
    except Exception:
        pass
    return {"v": CACHE_VERSION, "files": {}, "feed": []}


def private_dir(path):
    """Creates the folder 0700 and refuses one that is a link or someone else's."""
    os.makedirs(path, mode=0o700, exist_ok=True)
    st = os.lstat(path)
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
        raise PermissionError(f"{path} is not a private folder of this user")
    if st.st_mode & 0o077:
        os.chmod(path, 0o700)


def save_cache(c):
    private_dir(CACHE_DIR)
    fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, prefix=".cache-")  # O_EXCL, 0600
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(c, f, separators=(",", ":"))
        os.replace(tmp, CACHE)
    except BaseException:
        os.unlink(tmp)
        raise


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
        if len(chunk) >= budget and budget >= READ_BUDGET // 2:
            # one record larger than a whole read: skip past it rather than stall on it forever
            entry["off"] = off + len(chunk)
            return len(chunk)
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
        # one odd record is skipped, never the whole snapshot
        if not isinstance(row, dict) or row.get("type") != "assistant":
            continue
        msg = row.get("message")
        if not isinstance(msg, dict):
            continue
        ts = iso_to_epoch(row.get("timestamp", ""))
        model = msg.get("model") or ""
        u = msg.get("usage") if isinstance(msg.get("usage"), dict) else None
        mid = msg.get("id")
        if u and mid != last_id and model and model != "<synthetic>":
            last_id = mid
            day = local_day(ts) if ts else local_day(time.time())
            dm = days.setdefault(day, {}).setdefault(model, {"in": 0, "out": 0, "cw": 0, "cr": 0})
            dm["in"] += to_int(u.get("input_tokens"))
            dm["out"] += to_int(u.get("output_tokens"))
            dm["cw"] += to_int(u.get("cache_creation_input_tokens"))
            dm["cr"] += to_int(u.get("cache_read_input_tokens"))
            if not row.get("isSidechain"):
                entry["ctx"] = to_int(u.get("input_tokens")) + to_int(u.get("cache_creation_input_tokens")) \
                    + to_int(u.get("cache_read_input_tokens"))
                entry["model"] = model
        if feed_sid:
            content = msg.get("content")
            for b in content if isinstance(content, list) else []:
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

    sysinfo = system(cache, now)
    save_cache(cache)
    total_in = tot["in"] + tot["cw"] + tot["cr"]
    json.dump({
        "now": int(now),
        "sys": sysinfo,
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

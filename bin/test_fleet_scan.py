"""Config-dir scoping of the collector. Run: python3 -m unittest bin/test_fleet_scan.py
Every run uses a fake HOME in a temp dir; the real ~/.claude is never read or written."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

SCAN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fleet_scan.py")


def _env(home, config_dir):
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDE_CONFIG_DIR", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR")}
    env.update(HOME=home, XDG_RUNTIME_DIR=os.path.join(home, "run"))
    if config_dir is not None:
        env["CLAUDE_CONFIG_DIR"] = config_dir
    return env


def run(home, config_dir=None):
    """The collector's [CLAUDE, CACHE_DIR] under this environment (import only, no scan)."""
    code = f"import sys, json; sys.path.insert(0, {os.path.dirname(SCAN)!r}); import fleet_scan as f; print(json.dumps([f.CLAUDE, f.CACHE_DIR]))"
    out = subprocess.run([sys.executable, "-I", "-c", code], env=_env(home, config_dir), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def scan(home, config_dir=None):
    out = subprocess.run([sys.executable, "-I", SCAN], env=_env(home, config_dir), capture_output=True, text=True, check=True)
    return {s["sid"] for s in json.loads(out.stdout)["sessions"]}


def add_session(config_dir, sid, cwd):
    os.makedirs(os.path.join(config_dir, "sessions"), exist_ok=True)
    with open(os.path.join(config_dir, "sessions", f"{sid}.json"), "w") as f:
        # this test's own pid, so the collector sees the session as alive
        json.dump({"sessionId": sid, "cwd": cwd, "pid": os.getpid(), "kind": "interactive"}, f)


class ConfigDir(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        os.makedirs(os.path.join(self.home, "run"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_unset_uses_dot_claude_and_plain_cache(self):
        h = self.home
        self.assertEqual(run(h), [f"{h}/.claude", f"{h}/.cache/purrfleet"])
        # set to ~/.claude (with ~ and a trailing slash): exactly the same paths
        self.assertEqual(run(h, "~/.claude/"), [f"{h}/.claude", f"{h}/.cache/purrfleet"])

    def test_other_config_dir_scans_it_with_its_own_cache(self):
        h = self.home
        x = f"{h}/.claude-x"
        self.assertEqual(run(h, x), [x, f"{h}/.cache/purrfleet-claude-x"])
        add_session(x, "sid-x", h)
        self.assertEqual(scan(h, x), {"sid-x"})
        self.assertTrue(os.path.isfile(f"{h}/.cache/purrfleet-claude-x/snapshot.json"))
        self.assertFalse(os.path.exists(f"{h}/.cache/purrfleet"))

    def test_setups_do_not_see_each_others_sessions(self):
        h = self.home
        add_session(f"{h}/.claude", "sid-main", h)
        add_session(f"{h}/.claude-x", "sid-x", h)
        self.assertEqual(scan(h), {"sid-main"})
        self.assertEqual(scan(h, f"{h}/.claude-x"), {"sid-x"})


if __name__ == "__main__":
    unittest.main()

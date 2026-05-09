#!/usr/bin/env bash
# One-time installer for the cc-ops skill in your local Claude Code.
# After running this once, every future `claude` session on your Mac will be
# able to run ClaudeClaw operational commands (restart, deploy, status, logs,
# extractor, decay, insights) without prompting you for permission.
#
# Usage:
#   ./bin/install-cc-ops.sh
#
# Then in any Terminal:
#   claude
#   > restart the dashboard
#   (Claude runs ./bin/restart.sh dashboard with no prompt)

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
SKILLS_DIR="$CLAUDE_DIR/skills"
SETTINGS="$CLAUDE_DIR/settings.json"

mkdir -p "$SKILLS_DIR"

# 1. Copy the cc-ops skill folder into the user-skills directory.
if [ -d "$REPO/skills/cc-ops" ]; then
  cp -R "$REPO/skills/cc-ops" "$SKILLS_DIR/"
  echo "✓ skill installed: $SKILLS_DIR/cc-ops/"
else
  echo "✗ skills/cc-ops not found in repo — pull latest: git pull origin main"
  exit 1
fi

# 2. Merge auto-allow permissions into ~/.claude/settings.json.
#    Safe merge — preserves existing settings, just adds rules.
python3 - <<'PY'
import json, os, pathlib

p = pathlib.Path.home() / ".claude" / "settings.json"
data = json.loads(p.read_text()) if p.exists() and p.read_text().strip() else {}

# Auto-allow rules for ClaudeClaw ops. Glob-style patterns match how the
# Bash tool checks invocations.
RULES = [
    "Bash(./bin/restart.sh*)",
    "Bash(./bin/setup-launchd.sh*)",
    "Bash(./bin/install-cc-ops.sh*)",
    "Bash(./bin/launchd-wrap.sh*)",
    "Bash(./bin/backup.sh*)",
    "Bash(./bin/extract-week.py*)",
    "Bash(./bin/inject-test.py*)",
    "Bash(./deploy.sh*)",
    "Bash(launchctl list*)",
    "Bash(launchctl bootout*)",
    "Bash(launchctl bootstrap*)",
    "Bash(launchctl kickstart*)",
    "Bash(launchctl print*)",
    "Bash(curl -s http://localhost:*)",
    "Bash(curl http://localhost:*)",
    "Bash(curl -sf http://localhost:*)",
    "Bash(pkill -f tsx*)",
    "Bash(pkill -f bridge*)",
    "Bash(pkill -f dashboard*)",
    "Bash(pkill -f warroom*)",
    "Bash(pkill -f scheduler*)",
    "Bash(pkill -f consolidator*)",
    "Bash(pkill -f memory.consolidator*)",
    "Bash(pkill -f memory.decay*)",
    "Bash(lsof -ti tcp:*)",
    "Bash(lsof -ti tcp:3141*)",
    "Bash(lsof -ti tcp:3142*)",
    "Bash(lsof -ti tcp:7860*)",
    "Bash(lsof -ti tcp:7861*)",
    "Bash(tail -*)",
    "Bash(head -*)",
    "Bash(cat ~/Library/Logs/claudeclaw/*)",
    "Bash(python3 -m memory.*)",
    "Bash(python3 -m memory.extractor*)",
    "Bash(python3 -m memory.insights*)",
    "Bash(python3 -m memory.decay*)",
    "Bash(python3 -m memory.consolidator*)",
    "Bash(python3 bin/*)",
    "Bash(./.venv/bin/python*)",
    "Bash(sqlite3 store/claudeclaw.db*)",
    "Bash(sqlite3 ~/claudeclaw/store/claudeclaw.db*)",
    "Bash(git status*)",
    "Bash(git log --oneline*)",
    "Bash(git diff --stat*)",
    "Bash(git pull*)",
    "Bash(open http://localhost:*)",
    "Bash(echo*)",
    "Bash(ls*)",
    "Bash(grep*)",
]

perms = data.setdefault("permissions", {})
existing = set(perms.get("allow", []))
new = sorted(existing | set(RULES))
added = len(new) - len(existing)
perms["allow"] = new

p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(data, indent=2) + "\n")
print(f"✓ {p} updated: {added} rules added, {len(new)} total")
PY

echo ""
echo "Done. Future Claude Code sessions can now run all cc-ops commands without prompting."
echo ""
echo "Try it:"
echo '  claude'
echo '  > "fix the dashboard, it'\''s showing exit code 1"'

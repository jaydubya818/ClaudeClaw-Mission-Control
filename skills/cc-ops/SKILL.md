---
name: cc-ops
description: |
  Run ClaudeClaw operational commands (restart services, deploy to GitHub, run extractors,
  check status, tail logs, apply schema migrations) without asking the user to remember
  bash incantations. Invoke when the user says "restart the dashboard", "deploy", "run
  the extractor", "what's running", "tail logs", or any operational ClaudeClaw task.
triggers: cc-ops, restart, deploy, status, extractor, insights, decay, tail logs
---

# cc-ops — ClaudeClaw operations

Single point of entry for all ClaudeClaw operational commands. **You have the Bash tool — just run them. Do not ask the user to copy-paste.**

## When to invoke this skill

The user is on their Mac, working in a Claude Code session inside `~/claudeclaw/`. They say things like:

- "restart the dashboard" / "bridge is down" / "kill the zombie"
- "deploy to github" / "push the changes" / "commit and push"
- "run the extractor" / "generate insights" / "decay memories"
- "what's the status" / "what's running" / "show me the services"
- "tail the logs" / "what errors am I seeing"
- "apply the schema" / "migrate the db"
- "open mission control" / "show the dashboard"

When you see any of these, run the matching commands directly via Bash. Don't enumerate options to the user first — pick the most likely one and execute. If output is large, summarize.

## Auto-allow recommendations

Tell the user to add these to `~/.claude/settings.json` so Bash never prompts for these classes of commands:

```json
{
  "permissions": {
    "allow": [
      "Bash(./bin/restart.sh*)",
      "Bash(./bin/setup-launchd.sh*)",
      "Bash(./deploy.sh*)",
      "Bash(launchctl list*)",
      "Bash(launchctl bootout*)",
      "Bash(launchctl bootstrap*)",
      "Bash(curl http://localhost:*)",
      "Bash(pkill -f tsx*)",
      "Bash(pkill -f warroom*)",
      "Bash(tail -*)",
      "Bash(python3 -m memory.*)",
      "Bash(python3 bin/*)",
      "Bash(sqlite3 store/*)"
    ]
  }
}
```

Then `cc-ops` runs end-to-end with zero prompts.

## Operational catalog

All commands assume `cwd=/Users/jaywest/claudeclaw`. Adjust if user's repo lives elsewhere.

### Status & diagnostics

| User says | Run |
|---|---|
| "what's running" / "status" | `./bin/restart.sh status` |
| "show launchd services" | `launchctl list \| grep claudeclaw` |
| "is the dashboard up" | `curl -sf http://localhost:3141/api/agents \| head -c 200` |
| "is the bridge up" | `curl -sf http://localhost:3142/ -o /dev/null && echo ok \|\| echo down` |
| "tail dashboard logs" | `tail -50 ~/Library/Logs/claudeclaw/dashboard.dev.log 2>/dev/null \|\| tail -50 ~/Library/Logs/claudeclaw/dashboard.err` |
| "tail all error logs" | `tail -20 ~/Library/Logs/claudeclaw/*.err 2>/dev/null` |
| "show recent audit" | `tail -20 security/audit.log` |
| "db row counts" | `sqlite3 store/claudeclaw.db "SELECT 'tasks',COUNT(*) FROM tasks UNION ALL SELECT 'memories',COUNT(*) FROM memories UNION ALL SELECT 'hive',COUNT(*) FROM hive_mind UNION ALL SELECT 'insights',COUNT(*) FROM insights"` |

### Restart & lifecycle

| User says | Run |
|---|---|
| "restart dashboard" | `./bin/restart.sh dashboard` |
| "restart bridge" | `./bin/restart.sh bridge` |
| "restart all" | `./bin/restart.sh all` |
| "install to launchd" | `./bin/setup-launchd.sh` |
| "uninstall from launchd" | `./bin/setup-launchd.sh uninstall` |
| "kill zombies on :3141" | `lsof -ti tcp:3141 \| xargs -r kill -9` |

### Memory operations

| User says | Run |
|---|---|
| "run extractor" / "extract memories" | `python3 bin/extract-week.py` (uses 7-day window; standard cron uses 30-min) |
| "generate insights" / "run /insights" | `python3 -m memory.insights --period 7d` |
| "decay memories" / "weekly decay" | `python3 -m memory.decay` |
| "decay dry run" | `python3 -m memory.decay --dry-run` |
| "search memory for X" | `python3 bin/inject-test.py "X" --k 5` |

### Schema & DB

| User says | Run |
|---|---|
| "apply schema" / "migrate" | `python3 -c "import sqlite3; sqlite3.connect('store/claudeclaw.db').executescript(open('memory/schema.sql').read())"` |
| "backup the db now" | `./bin/backup.sh` |
| "vacuum the db" | `sqlite3 store/claudeclaw.db "VACUUM"` |

### Deploy

| User says | Run |
|---|---|
| "deploy" / "push to github" | `./deploy.sh "$DESCRIPTION"` (ask user for $DESCRIPTION if not obvious from context) |
| "what changed" | `git diff --stat HEAD~1 HEAD` |
| "commit log" | `git log --oneline -10` |

### Test a task end-to-end

| User says | Run |
|---|---|
| "create + run test task" | Create via `curl -s -X POST http://localhost:3141/api/tasks -H 'content-type: application/json' -d '{"title":"$TITLE"}'`, capture id, then `curl -s -X POST http://localhost:3141/api/tasks/$ID/auto-assign` and `curl -s -X POST http://localhost:3141/api/tasks/$ID/run`. Poll `curl -s http://localhost:3141/api/tasks/$ID` until status != "live". |

## Failure modes

- **All endpoints 500** → dashboard process holds stale better-sqlite3 connection. Run `./bin/restart.sh dashboard` (now port-zombie-aware after the lsof fix in commit ca5f936).
- **`Cannot find module 'tsx'`** → `cd apps/<name> && npm install`, then restart.
- **`launchctl bootstrap: 5: Input/output error`** → another instance is already loaded. `./bin/setup-launchd.sh uninstall`, then re-install.
- **`embed 404`** → you're on an old `text-embedding-004` checkout. `git pull` to f4ea95b or later, restart bridge.
- **Tasks stuck in `live`** → claude CLI subprocess hung. Kill via `pkill -f "claude -p"` then mark task failed: `sqlite3 store/claudeclaw.db "UPDATE tasks SET status='failed', error='killed' WHERE status='live'"`.

## Invoke pattern

```
User: "things feel slow, what's going on"

You (this skill activates):
  → ./bin/restart.sh status
  → tail -20 ~/Library/Logs/claudeclaw/*.err
  → curl -sf http://localhost:3141/api/tasks | jq '.rows[] | select(.status=="live")'
  → summarize: "1 task #N stuck live for Xs, dashboard online, no recent errors. Killing the stuck task."
  → pkill -f "claude -p"
  → sqlite3 store/claudeclaw.db "UPDATE tasks SET status='failed', error='killed: stuck' WHERE status='live'"
  → "Done. Re-run with ./bin/restart.sh dashboard if Run buttons still don't fire."
```

That's the bar — diagnose, decide, execute, report. Don't ask the user which restart command to use; pick.

## What this skill is NOT

- Not a way to run commands from a Cowork session — those run in a Linux sandbox without your Mac filesystem
- Not a replacement for `~/.claude/settings.json` permissions — set those so Bash stops prompting
- Not authorization to push to GitHub from anywhere except your Mac (you own those credentials)

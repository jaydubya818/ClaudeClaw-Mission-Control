# V3 Visual Guide — File Map

The V3 visual guide PDF (`docs/ClaudeClaw_V3_Visual_Guide.pdf`) maps to actual files in this repo as follows. Each row points to the implementation; if a file says "NOT YET BUILT", `IMPLEMENTATION_STATUS.md` tracks it.

| Page | Concept | Where it lives |
|---|---|---|
| 01 | The Wrapper (Telegram → Bridge → Claude Code brain) | `apps/bridge/src/index.ts` |
| 02 | Meta Agent (CLI + skill pattern) | `skills/meta-ads/SKILL.md` + `scheduler/cron.yaml` (`meta_ads_brief`) |
| 03 | AI OS layers (bottom/middle/top) | `ULTRA_PLAN.md` §2 + `CLAUDE.md` "File Layout" |
| 04 | Mission Control kanban + auto-assign | `apps/dashboard/public/index.html` + `apps/dashboard/src/assign.ts` |
| 05 | Scheduler + cron translation layer | `scheduler/runner.ts` + `scheduler/cron-to-english.ts` |
| 06 | Agents tab — `agent.yaml` + `CLAUDE.md` | `agents/<name>/agent.yaml` + `agents/<name>/CLAUDE.md` |
| 07 | Unified Chat tab | `apps/dashboard/public/index.html` (NOT YET — see status doc) |
| 08 | Memories — 3-layer hybrid recall | `memory/schema.sql` (FTS5 + embeddings + importance) + `memory/inject.ts` |
| 09 | Hive Mind views (list / 2D / 3D) | `apps/dashboard/src/routes/agents.ts` (list ✅; 2D + 3D NOT YET) |
| 10 | Audit log | `security/audit.log` (append-only by `apps/bridge/src/index.ts`) |
| 11 | War Room — `/standup` + `/discuss` | `apps/warroom/standup.py` + `apps/warroom/server.py` |
| 12 | OS = data engineering | `CLAUDE.md` "File Layout" + this doc |
| 13 | Project vs global hierarchy | `CLAUDE.md` "Hierarchy" + per-project `.claude/` overrides |
| 14 | Add your first agent (5 steps) | `agents/_template/` |
| 15 | Where everyone starts (chaos) | (motivational; no file) |
| 16 | Group the files (6 buckets) | (Jay's home directory; no repo file) |
| 17 | Untangle the tools (skills/rules/CLIs) | `skills/` + `CLAUDE.md` + global CLIs in `~/.claude/` |
| 18 | Build the hierarchy (global vs project) | Same as p13 |
| 19 | Layer on the bridge | `apps/bridge/` (Telegram = top layer) |

## Kill switches (V3 p4 + p5)
| Switch | Env var | Code path |
|---|---|---|
| Auto-assign | `MISSION_AUTO_ASSIGN_ENABLED` | `apps/dashboard/src/routes/tasks.ts` |
| Scheduler | `SCHEDULER_ENABLED` | `scheduler/runner.ts` |
| Kill phrase | `KILL_PHRASE` | `apps/bridge/src/index.ts` |

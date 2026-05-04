# ClaudeClaw — Mission Control (V3)

Personal AI command center on top of Claude Code. **5 agents · voice + text war room · mission control kanban · 3-layer memory · auto-boot via launchd · Telegram bridge.**

> The brain is replaceable. The wrapper stays. Today it's Claude Code; tomorrow you swap.

## What's in this repo

```
claudeclaw/
├── CLAUDE.md                ← global rules (V3 p13/p18)
├── agents/                  ← agent.yaml + CLAUDE.md per agent (V3 p6)
│   ├── _template/           ← copy this to add an agent (V3 p14)
│   ├── main/  comms/  content/  ops/  research/
├── skills/                  ← reusable capabilities, inherited by every agent (V3 p17)
│   ├── _template/
│   ├── meta-ads/  insights/  suggestions/  memory/
├── apps/
│   ├── bridge/              ← SDK ↔ Telegram (~200 LOC core)
│   ├── dashboard/           ← Hono :3141 (mission control UI)
│   └── warroom/             ← Pipecat :7860 (voice + text meetings)
├── memory/                  ← schema, extractor, consolidator, 5-layer inject
├── scheduler/               ← cron.yaml + runner + English translation
├── security/                ← allowlist, exfil-guard, audit log
├── infra/                   ← launchd plists + cloudflared config
├── store/                   ← SQLite db (gitignored)
├── docs/
│   ├── ClaudeClaw_V3_Visual_Guide.pdf
│   ├── V3_VISUAL_GUIDE.md   ← PDF page → code-file map
│   └── IMPLEMENTATION_STATUS.md   ← every spec'd feature × build status
└── ULTRA_PLAN.md            ← full architecture spec
```

## The 5 agents

| Agent | Role | Model | Voice |
|---|---|---|---|
| **Main** | Triage / delegate. Routes 9/10 requests. | Opus | Charon |
| **Comms** | Master of Whisperers — email, DMs, replies. | Sonnet | Aoede |
| **Content** | Royal Bard — scripts, thumbnails, posts. | Sonnet | Leda |
| **Ops** | Master of War — finances, vendors, ops. **Read-only on money.** | Sonnet | Alnilam |
| **Research** | Grand Maester — analysis, deep dives. | Sonnet | Kore |

Add a sixth in 90 seconds — copy `agents/_template/`, rename, edit yaml + md, register your Telegram bot token. (V3 p14)

## Quickstart

```bash
# 1. Deps
cd apps/bridge && npm install
cd ../dashboard && npm install
cd ../warroom && pip install -r requirements.txt

# 2. Configure
cp .env.example .env          # fill in tokens
cp security/allowlist.json.example security/allowlist.json

# 3. Init DB
sqlite3 store/claudeclaw.db < memory/schema.sql

# 4. Run the bridge (Phase 1 — Main only)
cd apps/bridge && npm run dev
```

Message your Telegram bot. Reply within 5s with a cost footer.

## Service map

| Service | Port | Entrypoint |
|---|---|---|
| Bridge | — | `apps/bridge/src/index.ts` |
| Dashboard | 3141 | `apps/dashboard/src/server.ts` |
| War Room | 7860 | `apps/warroom/server.py` |
| Scheduler | — | `scheduler/runner.ts` |
| Consolidator | — | `memory/consolidator.py` (cron 30m) |

## Auto-boot (macOS)

```bash
cp infra/launchd/*.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.claudeclaw.bridge.plist
# repeat for the other 4 plists
```

## Remote access

```bash
cloudflared tunnel --config infra/cloudflared/config.yml run
```

## Kill switches (V3 p4 + p5)

```bash
MISSION_AUTO_ASSIGN_ENABLED=false   # force manual task routing
SCHEDULER_ENABLED=false             # halt all cron missions without restart
KILL_PHRASE="seven kingdoms fall"   # text or voice → halts sessions, clears secrets
```

Plus per-message `/kill` from Telegram.

## War Room slash commands (V3 p11)

```
/standup                  → all agents report 24h activity. Main consolidates.
/standup @comms @ops      → only those agents.
/discuss <topic>          → each agent's angle. Main synthesizes the call.
```

Parser: `apps/warroom/standup.py`. Wired into the WS handler in `server.py`.

## Status

See **[`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)** for the full feature × build-state matrix. As of this commit:

- **Foundation, memory, bridge, war-room voice, mission-control backend:** ✅ built
- **Newly added in V3 alignment pass:** kill switches, `/standup` + `/discuss` parser, skills folder, agent.yaml, top-level CLAUDE.md, cron English translator, three new scheduled missions
- **Top 5 remaining gaps:** Hive Mind 2D graph, /standup runtime wiring, insights extractor, suggestions endpoint, schedule UI tab

## Disclaimer

Personal local tool. Anthropic ToS gray area for SDK + subscription combo (per Apr-4 third-party harness ban — re-check before any distribution). Not legal advice. Not for commercial use.

## Read next

- `ULTRA_PLAN.md` — full architecture
- `docs/V3_VISUAL_GUIDE.md` — visual guide → file map
- `docs/IMPLEMENTATION_STATUS.md` — what's built vs. what's not
- `CLAUDE.md` — global rules every agent obeys

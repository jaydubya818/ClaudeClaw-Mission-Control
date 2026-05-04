# ClaudeClaw V3 — Develop · Configure · Test Roadmap

This is the working plan for taking the current codebase to feature parity with the V3 walkthrough and beyond. Status as of the last push (`main` @ `origin/main`).

**Source material reviewed:**
- `docs/ClaudeClaw_V3_Visual_Guide.pdf` (19 pages)
- 24-min Mission Control walkthrough transcript
- 22-min War Room + V0→V3 evolution transcript
- `ULTRA_PLAN.md` (architecture spec)
- `docs/IMPLEMENTATION_STATUS.md` (current build state)

---

## 0 · Status snapshot

| Area | State |
|---|---|
| Bridge (Telegram ↔ SDK ↔ agents) | ✅ |
| 6 agents (Main, Meta, Comms, Content, Ops, Research) | ✅ |
| Hive mind table + cross-agent query | ✅ |
| 3-layer memory (FTS5 + 768-dim embeddings + importance) | ✅ |
| Memory extractor (Gemini Flash, every 30 min) | ✅ |
| Memory consolidator (cosine merge + decay) | ✅ |
| Mission Control kanban | ✅ |
| Auto-assign via Gemini Flash | ✅ |
| Scheduled tasks (cron.yaml + DB-editable) | ✅ |
| Schedule UI editor with friendly DAYS picker | ✅ |
| Dashboard SPA (sidebar, 9 pages) | ✅ |
| `/standup` + `/discuss` parser + runner | ✅ |
| Hive Mind list view + 2D Cytoscape graph | ✅ |
| Insights extractor (Gemini Flash → insights table) | ✅ |
| Suggestions endpoint (LLM split recommender) | ✅ |
| Audit log (file + DB) | ✅ |
| Usage tracking schema | ✅ (no writer yet) |
| Kill switches (mission auto-assign, scheduler, kill phrase) | ✅ |
| ExfilGuard + chat-ID allowlist | ✅ |
| launchd plists for 5 services | ✅ |
| Cloudflare Tunnel | ✅ (config in `infra/cloudflared/`) |
| War Room voice (Pipecat + Gemini Live) | ✅ |
| War Room text mode (UI exists; client server.py) | 🟡 (server done; standalone UI not yet wired) |
| Hive Mind 3D brain | ❌ (placeholder; intentional skip — see Phase D) |
| Daily.co meeting integration | ❌ |
| Pika avatar | ❌ (expensive; feature-flagged off) |
| `/dashboard` Telegram cmd → tunnel URL | ❌ |
| Agent CRUD from dashboard (full create flow) | 🟡 (info modal only) |
| Drag-and-drop kanban | ❌ |
| PIN auth (proper) | 🟡 (cookie-based; no rotation) |
| Idle auto-lock | ❌ |
| Memory interview workflow | ❌ |
| Usage writer in bridge | ❌ |

---

## 1 · Phase A — Close known gaps from V3 spec (1–2 weeks)

These are items already named in the transcripts/PDF that the build is missing.

### A1. Usage writer in bridge `[2h]`
**Why:** Usage table exists in schema; nothing populates it. Bridge already gets cost+token counts from the SDK response.
**Where:** `apps/bridge/src/index.ts` after each `query()` call.
**Test:** Send 3 Telegram messages, confirm `usage` table has 3 rows with non-zero `cost_usd`.

### A2. `/dashboard` Telegram command `[1h]`
**Why:** V3 transcript ch.18 — return the Cloudflare tunnel URL on demand from your phone.
**Where:** `apps/bridge/src/index.ts` add slash command handler.
**Implementation:**
```ts
case "/dashboard":
  const url = process.env.DASHBOARD_PUBLIC_URL ?? "(set DASHBOARD_PUBLIC_URL in .env)";
  return bot.sendMessage(chatId, `🔗 ${url}`);
```
**Test:** Type `/dashboard` in Telegram; reply contains the URL.

### A3. Agent creation full flow (from dashboard) `[4h]`
**Why:** Currently the "+ New Agent" button shows an info modal only. V3 transcript ch.11 walks through the actual create flow.
**Where:** `apps/dashboard/src/routes/agents.ts` — add `POST /api/agents` endpoint that:
1. Validates name (lowercase, 2-12 chars, snake_case).
2. Copies `agents/_template/` → `agents/<name>/`.
3. Patches new `agent.yaml` with provided fields (model, role, voice).
4. Patches new `CLAUDE.md` with provided persona text.
5. Updates `voices.yaml` if voice provided.
6. Returns a Telegram BotFather link for token capture.

**Test:** Click + New Agent → fill form → submit → `agents/sales/` appears with valid yaml; agent listed in `/api/agents`.

### A4. Drag-and-drop kanban `[3h]`
**Why:** Transcript ch.7 explicitly demos "create a new task and drag and drop it to the agent of your choice."
**Where:** `apps/dashboard/public/index.html` — wire `Sortable.js` (one CDN script) onto the `.kanban-col` containers; on drop, call `/api/tasks/:id/assign`.
**Test:** Drag a task card from Inbox to Comms column → API call fires → card appears in Comms after refresh.

### A5. War Room standalone UI `[6h]`
**Why:** Screenshot 3 shows a dedicated text-mode interface with TEAM sidebar (S/M/L sizes), agent picker, /standup → "reflecting" indicators per agent.
**Where:** New: `apps/warroom/public/text-mode.html` plus `pubsub` over the existing WS connection.
**Implementation sketch:**
- Three layout sizes; localStorage persists choice.
- Sidebar lists agents with last-completed-task preview from `hive_mind`.
- Pin selector at top of each agent card.
- Reflecting indicator while agent's `claude -p` subprocess is running.

**Test:** Open `/text-mode.html`; type `/standup`; see "reflecting" then per-agent reply then Main consolidation.

### A6. PIN auth proper `[2h]`
**Why:** Current implementation: static cookie comparison. Need rotation + idle auto-lock per V3 plan §9.
**Where:** `apps/dashboard/src/server.ts`.
**Improvements:**
- HMAC-signed cookie with timestamp.
- Re-prompt if cookie age > 15 min.
- Configurable via `DASHBOARD_PIN_TTL_SEC`.

**Test:** Set TTL to 60s; wait 90s; reload; redirected to `/unlock.html`.

### A7. Pinned-agent UI in War Room `[1h]`
**Why:** Backend already supports `{type: "pin", agent: "comms"}`; UI doesn't expose it.
**Where:** `apps/warroom/public/app.js` — add a pin selector next to the agent list.
**Test:** Click pin on Comms; subsequent voice queries route to Comms regardless of utterance.

### A8. `/insights` slash command `[1h]`
**Why:** Extractor exists (`memory/insights.py`); not yet a slash command.
**Where:** `apps/bridge/src/index.ts` — handle `/insights` by spawning the Python script and returning the rendered output.
**Test:** Type `/insights` in Telegram; reply contains last 7d insights ranked by confidence.

**Phase A total:** ~20 hours.

---

## 2 · Phase B — Features from second transcript (2–3 weeks)

### B1. Daily.co meeting integration `[1 day]`
**Why:** Transcript 2 ch.4 demos the experimental "Google Meet" with Main agent. Lets you see + talk to the agent face-to-face (with Pika avatar — see B2 — or just video).
**Architecture:**
1. New endpoint `POST /api/meeting/create` → uses Daily.co REST API to create a room, returns URL.
2. Pipecat extension (`apps/warroom/meeting.py`) joins the Daily.co room as a participant; pipes audio into the existing pipeline; uses screen-share or solid-color video unless Pika is wired.
3. Telegram slash command `/meeting` → returns Daily.co URL.
**Cost:** Daily.co free tier covers 10K participant-minutes/mo. Sufficient for personal use.
**Env:** `DAILY_API_KEY`, `DAILY_DOMAIN`.
**Test:** `/meeting` → click URL → join → speak → Main responds in audio + caption.

### B2. Pika avatar (feature-flagged off by default) `[3 days]`
**Why:** Transcript 2: "eyewateringly expensive." Implement but gate behind `PIKA_ENABLED=false` so it doesn't burn money.
**Architecture:** Pika receives Gemini Live's audio output; produces a talking-head video stream; Pipecat routes that into the Daily.co room as a video track.
**Cost note:** Add a hard cost cap: if `daily_pika_spend_usd > 5` for the day, auto-disable.
**Test:** Toggle on; join meeting; see avatar lip-sync to agent speech.

### B3. Memory interview workflow `[4h]`
**Why:** Transcript ch.14: "you want Claude Code to interview you on how you want to deal with fresh memories and how you want to deal with fading memories." This is a one-time setup that personalizes everyone's memory system.
**Where:** New: `memory/interview.py`.
**Behavior:**
1. Asks ~15 questions: which memory types decay vs. persist, your decay tolerance, what to pin globally vs per-agent, embed model preference, etc.
2. Writes config to `memory/config.yaml`.
3. Extractor + consolidator + inject read this config on next run.
**Test:** `python -m memory.interview` → answer 15 q → `memory/config.yaml` written; restart bridge; behavior reflects config.

### B4. Multi-channel parity (Slack + Discord) `[3 days]`
**Why:** Transcript 2: "if you wanted to swap Telegram for Slack or Discord, you can do that. You just have to set up the connection."
**Where:** New: `apps/bridge/src/channels/{slack,discord}.ts`. Each implements the same `Channel` interface that the bridge consumes.
**Test:** Configure both adapters with bot tokens; send same message via Slack and Discord; both get responses with cost footer.

### B5. Standup picker (persistent set) `[2h]`
**Why:** Transcript 2 ch.16: "go to the picker, and then I can select who should always be in our standups when we do our daily meetings."
**Where:** Settings page in dashboard + standup_runner respects the pick.
**Test:** Pick {Comms, Ops, Meta} → run `/standup` (no tags) → only those three respond.

**Phase B total:** ~9 days.

---

## 3 · Phase C — Recommended enhancements (no spec; pure quality of life)

### C1. Streaming responses to Telegram `[1 day]`
**Why:** Currently Telegram waits for the full SDK response. Streaming makes long replies feel instant.
**Where:** `apps/bridge/src/index.ts` — use `editMessageText` to update the same Telegram message every 500ms with growing token stream.
**Test:** Ask Main for a 500-word essay; first 50 chars appear within 1.5s; full reply within ~10s vs ~30s currently.

### C2. SQLite WAL backup automation `[2h]`
**Why:** `store/claudeclaw.db` is the source of truth for agents, memories, hive_mind, scheduled tasks, audit. One bad upgrade and everything is gone.
**Where:** New: `infra/launchd/com.claudeclaw.backup.plist` runs `sqlite3 .backup` nightly to `~/Library/Application Support/ClaudeClaw/backups/YYYYMMDD.db`.
**Retention:** Keep last 14 daily, last 8 weekly.
**Test:** Manually run `launchctl start com.claudeclaw.backup`; backup file appears with correct size.

### C3. Audit log rotation `[1h]`
**Why:** `security/audit.log` is append-only forever. After 6 months it'll be tens of MB.
**Where:** `apps/bridge/src/index.ts` — rotate when file > 10 MB; gzip + datestamp; keep 6 rotations.
**Test:** Force-grow file past threshold; restart bridge; verify rotation happened.

### C4. Mobile-responsive dashboard `[1 day]`
**Why:** Current SPA assumes >1000px viewport. Phone access via the Cloudflare tunnel is the whole point — but it's unusable today.
**Where:** Add `@media (max-width: 768px)` rules: collapse sidebar to bottom nav; stack kanban columns vertically; condense agent cards.
**Test:** iPhone Safari → tunnel URL → all 9 pages usable.

### C5. Cost dashboard widget `[3h]`
**Why:** Usage page exists but only shows 30-day rollup. Want a daily sparkline + month-to-date burn projection.
**Where:** `apps/dashboard/public/index.html` Usage page — add Chart.js sparkline reading from `/api/usage/daily`.
**Test:** With 30 days of data: sparkline renders; "MTD: $X. Projected: $Y" shows.

### C6. Health check endpoints `[1h]`
**Why:** No quick way to verify all 5 services are alive after launchd boot.
**Where:**
- Bridge: `GET /healthz` on the internal port already exists; expose it
- Dashboard: `/healthz` returns `{ ok: true, db: <bytes>, uptime: <s> }`
- War Room: already has `/healthz`
- Scheduler: needs new HTTP server for `/healthz`
- Consolidator: same
**Test:** New `bin/healthcheck.sh` curls all 5; exits non-zero if any fail.

### C7. Plugin folder convention `[2h]`
**Why:** V3 emphasizes "global vs project-level" skills. Make this concrete: a `plugins/` folder at the repo root that's auto-loaded on bridge start, each plugin = one skill.
**Where:** New: `plugins/` with a `README.md` for the conventions.
**Test:** Drop a `plugins/test-plugin/SKILL.md`; it appears in skill registry without restart.

### C8. Two-Mac sync (multi-instance) `[1 week]`
**Why:** You travel + have a Mac Mini at home. Want both to share hive_mind + memories without conflicts.
**Approach:** Litestream → S3 (or B2) → both Macs read+write. Conflict resolution: last-write-wins on `tasks` and `memories`; append-only on `hive_mind` and `audit`.
**Test:** Send task on Mac A; verify it appears on Mac B's dashboard within 60s.

### C9. Voice mode in dashboard (no separate war room) `[2 days]`
**Why:** Currently War Room is its own page on `:7860`. Embed it directly in the dashboard so there's one URL.
**Where:** Dashboard's War Room page hosts the WebSocket client inline; iframe to `:7860` removed.
**Test:** Click War Room → speak → audio replies; no second tab opened.

### C10. Per-agent rate limits `[2h]`
**Why:** A bug in your code or a runaway scheduled task could burn your monthly Claude Code allotment in minutes.
**Where:** `apps/bridge/src/index.ts` — soft cap of 50 turns/agent/day; hard cap of 200; warn in audit when approaching, block at hard cap.
**Test:** Force 51 turns; warning logs appear; force 201; bridge replies "rate limit reached" until next day.

**Phase C total:** ~3 weeks if all done.

---

## 4 · Phase D — Explicitly skipped (low ROI)

| Item | Why skipped |
|---|---|
| 3D brain visualization | 2MB three.js + custom mesh; 2D graph already covers daily inspection |
| Layout switcher (kanban / table / timeline) | Single layout matches actual workflow; alternatives are eye candy |
| Self-hosted vector DB (Qdrant/Pinecone) | SQLite + 768-dim BLOB scales fine to 1M memories; migration cost > value at personal scale |
| Pika avatar default-on | Cost is the problem (ch.4 transcript 2 quote: "eyewateringly expensive") |
| Marketplace UI for plugins | Folder convention (C7) is simpler and matches Claude Code's plugin model |

---

## 5 · Configuration checklist (pre-launch)

Before any of the above ships, confirm:

```bash
# Required
ANTHROPIC_API_KEY=                # OR Claude Code subscription
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=        # comma-separated; allowlist
TELEGRAM_PRIMARY_CHAT_ID=         # for scheduled deliveries
GEMINI_API_KEY=                   # auto-assign + memory + Live voice
DB_PATH=./store/claudeclaw.db

# Recommended
DASHBOARD_PIN=                    # 6 digits; locks the web UI
DASHBOARD_PUBLIC_URL=             # for /dashboard slash command (B/A2)
KILL_PHRASE="seven kingdoms fall" # voice or text → halts active sessions
SCHEDULER_ENABLED=true
MISSION_AUTO_ASSIGN_ENABLED=true

# Phase B
DAILY_API_KEY=                    # B1 meeting integration
DAILY_DOMAIN=                     # your Daily.co subdomain
PIKA_API_KEY=                     # B2 — leave unset to disable
PIKA_ENABLED=false
SLACK_BOT_TOKEN=                  # B4
DISCORD_BOT_TOKEN=                # B4

# Operational
DASHBOARD_PIN_TTL_SEC=900         # A6 — 15 min
RATE_LIMIT_TURNS_PER_DAY=200      # C10
DAILY_BACKUP_BUCKET=              # C2 — optional offsite
```

---

## 6 · Test protocol — what to verify on `localhost:3141`

After Phase A ships, this is the smoke-test sequence:

1. **Mission Control** (`/#mission`)
   - Counts top-right show `N active · M unassigned · K total`.
   - "+ New Task" → modal → create → appears in Inbox column.
   - Click "Auto" on the new card → routes to a specialist within 3s.
   - Drag the card to another column → reassigns.

2. **Scheduled** (`/#scheduled`)
   - Shows code-managed missions + user-editable section.
   - "+ New scheduled task" → editor modal → friendly DAYS picker works → save → appears in user-editable list.
   - Toggle pause/resume → pill flips.
   - Run-now → new row appears in Mission Control queued.

3. **Agents** (`/#agents`)
   - 6 cards show: Main, Meta, Comms, Content, Ops, Research with model dropdowns.
   - Change Main's model from Opus to Sonnet → `agents/main/agent.yaml` shows new model on disk.
   - Click 📄 on Meta → modal shows yaml + CLAUDE.md.
   - Click ⏻ Stop → status flips; runtime json file updates.

4. **Chat** (`/#chat`)
   - Filter chips: All / per-agent.
   - Filter to Comms → only Comms turns.
   - "Turns today" count > 0 if any activity.

5. **Memories** (`/#memories`)
   - Search "gmail" → results scoped to that keyword.
   - Importance distribution buckets render with bars.
   - Pin something → appears below; delete it → vanishes.
   - Insights section shows after running `python -m memory.insights`.

6. **Hive Mind** (`/#hive`)
   - Tab toggle: List / 2D / 3D.
   - List view shows WHEN/AGENT/ACTION/SUMMARY columns.
   - 2D view: Cytoscape graph renders; agent supernodes; task nodes.
   - 3D view: placeholder copy with "show 2D instead" CTA.
   - Filter chips: All / main / meta / comms / content / ops / research.
   - Period dropdown changes graph density.

7. **Usage** (`/#usage`)
   - Once A1 is done: shows real cost rollup.

8. **Audit** (`/#audit`)
   - Shows DB rows OR file tail of `security/audit.log`.

9. **War Room** (`/#warroom`)
   - Online dot if `:7860` reachable.
   - "Voice mode" button opens new tab to `:7860?mode=voice`.

10. **Settings** (`/#settings`)
    - Scheduler toggle flips and persists.

---

## 7 · Honest constraints

**I cannot test on `http://localhost:3141` from this sandbox.** The server runs on your Mac. After each phase you ship, send a screenshot of any page that looks off and I'll iterate.

**I cannot push to GitHub.** Mount permissions block `.git/`; sandbox has no auth credentials. After every working commit, you run:
```bash
cd ~/claudeclaw && ./deploy.sh "Phase A: <what changed>"
```

**Daily.co + Pika + Live voice need real network access.** These can be coded statically in the sandbox, but full E2E test requires your tokens + your machine.

---

## 8 · Suggested sequencing

If I were prioritizing for highest daily-use ROI:

1. **A1 (usage writer) + A8 (`/insights` slash)** — half a day; instantly fills two empty pages.
2. **A2 (`/dashboard` slash)** — one hour; you get the URL on your phone.
3. **A3 (agent creation flow)** — half a day; matches the screenshot UX.
4. **C2 + C3 (backup + log rotation)** — half a day; protects what you've built.
5. **A4 (drag-and-drop)** — half a day; matches the V3 video.
6. **A5 (war room standalone UI)** — full day; makes the existing screenshot real.
7. **C4 (mobile-responsive dashboard)** — full day; makes the tunnel URL useful on phone.
8. **B3 (memory interview)** — half a day; cleans up memory junk.
9. **B1 (Daily.co)** — full day; the experimental tier.
10. **C8 (multi-Mac sync)** — week-long project; do it when you actually need it.

Everything else is opportunistic.

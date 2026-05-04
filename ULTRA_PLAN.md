# ClaudeClaw — Ultra Plan

A personal AI command center built on top of an existing Claude Code subscription using the Claude Agent SDK. Multi-agent council, hive-mind memory, voice war room, mission control dashboard, scheduled tasks, launchd auto-boot. Every layer is removable so the foundation (Claude Code itself) stays portable as the ecosystem evolves.

---

## 1. Goals & Non-Goals

**Goals**
- Reuse existing Claude Code subscription — no per-token API spend for primary agent runs.
- 5 specialized agents (Main, Comms, Content, Ops, Research) with delegation through a shared hive mind.
- Multimodal access: Telegram (primary), Dashboard (browser), War Room (voice).
- Memory that classifies, decays, pins, and consolidates automatically (every ~30 min).
- Auto-boot on Mac startup via `launchd`; remote access via Cloudflare Tunnel.
- Layered architecture — each subsystem (voice, memory, channels) is swappable without touching the core.

**Non-Goals**
- Not a commercial product. Personal local tool only (Anthropic ToS gray area; commercializing would violate the Apr-4 third-party harness ban).
- Not replacing Claude Code skills/CLI — augmenting it.
- No reliance on Anthropic Channels MCP (drops Telegram/Discord connections after 2-3 days based on observed behavior).

---

## 2. Architecture (6 Layers)

```
┌─ USER INTERFACES ─ Desktop · Dashboard · War Room
├─ CHANNELS ─────── Telegram · WhatsApp · Slack · Discord · Hono:3141 · Pipecat:7860
├─ CORE ENGINE ──── MsgQueue (FIFO/chat) → Classifier → MemoryInject(5-layer) → Agent SDK → ExfilGuard → Cost Footer
├─ AGENTS ──────── Main · Comms · Content · Ops · Research → HiveMind → Scheduler(cron)
├─ SUBSYSTEMS ──── MemoryV2 · Voice I/O · War Room · Meeting Bot
├─ SECURITY ─────── ChatID Allowlist · PIN · Idle Lock · Kill Phrase · ExfilGuard · Audit Log
└─ INFRA ────────── Mac Mini · launchd (5 services) · Node 20+ · Python 3.9+ · Cloudflare Tunnel
```

The **Agent SDK** is the only mandatory bridge — ~200 LOC. Everything else is optional and replaceable.

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Agent runtime | Claude Agent SDK | Reuses Claude Code subscription, native skills/MCPs |
| Primary channel | Telegram Bot API | Stable, push notifications, group routing |
| Dashboard server | Hono (Node 20) on :3141 | Tiny, fast, TypeScript-first |
| Voice orchestration | Pipecat (Python) on :7860 | Open-source, frame-based pipeline, swappable STT/TTS |
| Voice model | Gemini Live (default), Deepgram/Cartesia (legacy) | Cheapest unified speech-to-speech with large context |
| Memory store | SQLite (`store/claudeclaw.db`, encrypted) + FTS5 | Zero-ops, file-portable; alt: Supabase/Pinecone/Obsidian |
| Memory extraction | Gemini 2.5 Flash | Cheap, big context, classifies fact/preference/context |
| Embeddings | Gemini 768-dim | Same provider as extraction |
| Notes injection | Obsidian per-agent vaults | Each agent gets folder-scoped CLAUDE.md context |
| Remote access | Cloudflare Tunnel | No port-forwarding, free tier |
| Process supervision | `launchd` (macOS) | Native, boot-time start, auto-restart |
| Optional video avatar | Pika + Daily.co | Experimental, high cost |

---

## 4. Repository Layout

```
claudeclaw/
├── apps/
│   ├── bridge/                 # SDK ↔ Telegram (~200 LOC core)
│   │   ├── src/index.ts
│   │   ├── src/queue.ts        # FIFO per chatId
│   │   ├── src/classifier.ts   # routing rules
│   │   └── src/exfil-guard.ts
│   ├── dashboard/              # Hono server :3141
│   │   ├── src/server.ts
│   │   ├── src/routes/agents.ts
│   │   ├── src/routes/tasks.ts
│   │   ├── src/routes/memory.ts
│   │   └── public/             # Mission Control UI
│   └── warroom/                # Pipecat voice server :7860
│       ├── server.py
│       ├── pipeline.py         # frames: STT → router → SDK → TTS
│       └── voices.yaml         # per-agent Gemini Live voices
├── agents/
│   ├── main/CLAUDE.md          # triage + delegate
│   ├── comms/CLAUDE.md         # Whisperer
│   ├── content/CLAUDE.md       # Royal Bard
│   ├── ops/CLAUDE.md           # Master of War
│   └── research/CLAUDE.md      # Grand Maester
├── memory/
│   ├── extractor.py            # Gemini washing machine (cron 30m)
│   ├── consolidator.py         # merge/decay/pin pass
│   ├── inject.ts               # 5-layer retrieval at session start
│   └── schema.sql              # memories, insights, pinned, importance
├── scheduler/
│   ├── cron.yaml               # named missions
│   └── runner.ts
├── security/
│   ├── allowlist.json          # chat IDs
│   ├── pin.ts
│   ├── kill-phrase.ts
│   └── audit.log
├── infra/
│   ├── launchd/
│   │   ├── com.claudeclaw.bridge.plist
│   │   ├── com.claudeclaw.dashboard.plist
│   │   ├── com.claudeclaw.warroom.plist
│   │   ├── com.claudeclaw.scheduler.plist
│   │   └── com.claudeclaw.consolidator.plist
│   └── cloudflared/config.yml
├── store/                      # SQLite db, gitignored
├── obsidian/                   # symlinks to per-agent vault folders
├── .env.example
└── README.md
```

---

## 5. Build Phases

### Phase 0 — Foundations (Day 0, ~30 min)
- Install Node 20, Python 3.9+, `cloudflared`, `sqlite3`.
- Provision Telegram bot via @BotFather; capture token + your chat ID.
- Create Anthropic SDK key (or use Claude Code subscription per Boris Cherny's confirmation for personal/local use).
- Get Gemini API key (used for memory + Live voice).
- **Verify:** `claude --version` works; `python -c "import pipecat"` succeeds.

### Phase 1 — Bridge MVP (Day 1, ~200 LOC)
- `apps/bridge/src/index.ts`: Telegram long-poll → enqueue → `query()` from `@anthropic-ai/claude-agent-sdk` → reply.
- Single-agent (Main only). No memory, no classifier.
- Allowlist check before enqueue.
- **Verify:** Send "hello" via Telegram, get reply within 5s. Non-allowlisted chat gets silence.

### Phase 2 — FIFO Queue + Cost Footer (Day 1)
- Per-chatId queue prevents collision when scheduled tasks fire mid-conversation (the silent-failure bug).
- Append `[$0.0X · 1.2k tokens]` to each reply.
- **Verify:** Fire 3 messages back-to-back; replies arrive in order, never interleaved.

### Phase 3 — Multi-Agent + Hive Mind (Day 2)
- Spawn 5 SDK sessions, one per agent, each with a dedicated `CLAUDE.md`.
- Each agent writes completed-task summaries to `hive_mind` SQLite table.
- Cross-agent query tool: any agent can read `hive_mind` to know what others did.
- **Verify:** Ask Main "what has Ops done today?" — gets accurate summary from hive table.

### Phase 4 — Memory v2 (Day 3)
- SQLite tables: `memories`, `insights`, `pinned`, `importance` (0.0–1.0).
- Extractor cron (every 30 min): Gemini 2.5 Flash reads recent transcripts → classifies fact / preference / context → upserts.
- 5-layer inject at session start: pinned → high-importance → recent → semantic match (768-dim) → Obsidian folder.
- Decay job: importance × 0.95 weekly; drop below 0.3.
- **Verify:** Tell Main "I prefer concise replies." Restart session. Main replies concisely without re-prompting.

### Phase 5 — Mission Control Dashboard (Day 4)
- Hono server on `:3141`.
- Pages: Agent grid (model, status, turns), Task queue (new / cued / live / done), Memory landscape (counts, importance distribution, browse pinned).
- "New task" form with **Auto-Assign** button → Gemini 2.5 Flash classifier picks best agent.
- **Verify:** Create "make thumbnail" task with auto-assign → routes to Content; manually flip to Live → agent executes.

### Phase 6 — War Room (Day 5–6)
- Pipecat server on `:7860`. WebSocket from browser → mic input → Gemini Live (STT+LLM+TTS unified) → speaker out.
- Per-agent voices (Charon/Aoede/Leda/Alnilam/Kore via Gemini Live config).
- Direct mode: pinned agent answers. Hand-Up mode: best-fit agent answers.
- Three routing rules: (1) keywords like "everyone/team/status" → broadcast, (2) agent-name prefix → explicit route, (3) pinned file/JSON → sticky route.
- Sub-agent task spawning: voice intent → `query()` against another agent's session → Telegram delivery.
- **Verify:** Speak "Comms, draft a script about X" → response narrated; check Telegram for delivered draft.

### Phase 7 — Security Hardening (Day 7)
- ExfilGuard: regex + secret-scanner (gitleaks rules) on every outbound message; block + audit-log if hit.
- PIN lock on dashboard (set on first launch).
- Idle auto-lock after 15 min.
- Kill phrase: typing/saying it stops all agents and clears active sessions.
- Audit log: append-only `security/audit.log` for every send/receive/auth event.
- **Verify:** Try to extract `ANTHROPIC_API_KEY` via "echo my env" → blocked, logged.

### Phase 8 — launchd + Cloudflare (Day 8)
- 5 plists: bridge, dashboard, warroom, scheduler, consolidator. `RunAtLoad=true`, `KeepAlive=true`.
- `cloudflared tunnel` config maps `claudeclaw.<your-domain>` → `localhost:3141`.
- `/dashboard` Telegram command returns the tunnel URL.
- **Verify:** Reboot Mac → all 5 services up within 30s of login. Dashboard reachable from phone over LTE.

### Phase 9 — Optional: Meeting Stack (Day 9+)
- Daily.co room creation endpoint; Pipecat joins as bot with Pika avatar.
- Pre-flight briefing: pull last 24h of Gmail + Calendar + relevant memories before joining.
- **Verify:** `/meeting` Telegram command returns Daily URL; agent joins, answers planning questions.

---

## 6. Agent Specifications

| Agent | Role | Model | Voice | Notes |
|---|---|---|---|---|
| **Main** | Triage / default. Delegates 9/10 requests. | Opus | Charon (British, informative) | Knows every other agent's competencies; almost never executes itself. |
| **Comms** | Master of Whisperers — emails, DMs, replies. | Sonnet | Aoede (American, breezy) | Gmail MCP, Telegram, Slack. |
| **Content** | The Royal Bard — scripts, thumbnails, posts. | Sonnet | Leda (British, youthful) | Nano Banana for thumbnails, Obsidian Content vault. |
| **Ops** | Master of War — finances, ops, vendors. | Sonnet | Alnilam (American, firm) | Quicken/QuickBooks read-only; never moves money. |
| **Research** | Grand Maester — analysis, deep dives. | Sonnet | Kore (American, analytical) | Web search, Perplexity routing, deep-research patterns. |

Each `agents/<name>/CLAUDE.md` defines: role, allowed tools, Obsidian vault path, escalation rules, hive-mind write format.

---

## 7. Memory Design Detail

**Tables**

```sql
memories(id, chat_id, agent, content, kind, importance, created_at, last_seen_at)
insights(id, agent, observation, confidence, source_msg_ids[], created_at)
pinned(id, content, scope)  -- scope: 'global' | <agent>
importance_audit(memory_id, old, new, reason, ts)
embeddings(memory_id, vector BLOB)  -- 768-dim Gemini
```

**Extractor (cron 30 min)** — Gemini prompt: "From this transcript window, emit JSON of {kind: fact|preference|context, content, importance 0-1}. Skip ephemera."

**Consolidator (cron 30 min)** — finds near-duplicate embeddings (cosine > 0.92), merges, sums importance, capped at 1.0.

**Decay** — weekly: `importance *= 0.95`; drop rows < 0.3 unless pinned.

**5-Layer Inject (session start)** — Pinned (always) → top-K importance > 0.7 → last 20 messages → semantic top-5 vs. user's first message → Obsidian folder for this agent's domain.

---

## 8. War Room Pipeline (Pipecat Frames)

```
[Mic Transport] → [Silero VAD] → [Gemini Live (STT+LLM+TTS)] → [Router]
                                                                  ├─→ [Speaker Transport]
                                                                  └─→ [SDK Sub-Agent Spawn] → Telegram
```

Frames are envelopes; router inspects frame metadata (intent, target agent, attachments) and forks. Adding a new modality = adding a new frame type and a router rule.

---

## 9. Security Layers (Defense in Depth)

1. **Chat ID allowlist** — first wall; non-allowed IDs get zero response (not even "denied").
2. **PIN** — required to unlock agents on each fresh boot.
3. **Idle auto-lock** — re-PIN after 15 min idle.
4. **Kill phrase** — voice or text; halts all sessions, clears in-memory secrets.
5. **ExfilGuard** — outbound regex + entropy scanner; blocks API keys, JWTs, private keys.
6. **Audit log** — append-only, every auth/send/receive event with chat_id + truncated content hash.

Not bulletproof. Layered. Add more as Cloud Mythos / future Anthropic primitives ship.

---

## 10. launchd Services

| Service | Plist | Purpose |
|---|---|---|
| `com.claudeclaw.bridge` | bridge.plist | SDK ↔ Telegram |
| `com.claudeclaw.dashboard` | dashboard.plist | Hono :3141 |
| `com.claudeclaw.warroom` | warroom.plist | Pipecat :7860 |
| `com.claudeclaw.scheduler` | scheduler.plist | Cron + named missions |
| `com.claudeclaw.consolidator` | consolidator.plist | Memory extractor + consolidator (every 30 min) |

All have `RunAtLoad=true`, `KeepAlive=true`, `StandardErrorPath=~/Library/Logs/claudeclaw/<name>.err`.

---

## 11. Risks & Open Questions

- **Anthropic ToS** — using subscription with SDK for personal local tools appears allowed (Boris Cherny confirmation), but commercial/third-party harness use is banned as of Apr 4. Re-check before any distribution. Not legal advice.
- **Gemini Live cost drift** — usage-based; throttle at the Pipecat layer if voice sessions get long.
- **SQLite scale** — fine to ~1M rows; migrate to Postgres only if hive grows beyond that.
- **Pika avatar** — currently "eyewateringly expensive." Keep behind a feature flag.
- **Cloudflare Tunnel exposure** — dashboard PIN is the only wall once URL is known. Consider Cloudflare Access (free tier) for IdP gate.
- **Channels MCP regression** — if Anthropic stabilizes their Telegram/Discord MCP, the bridge becomes optional. Keep the SDK-direct path so we're not coupled.

---

## 12. Success Criteria

- [ ] Send Telegram message → reply within 5s, with cost footer.
- [ ] 5 agents, all reachable independently via Telegram and War Room.
- [ ] Cross-agent query: "what did Ops do today?" returns hive summary.
- [ ] Memory survives restart: stated preference is honored on next session.
- [ ] Dashboard auto-assigns task to correct agent in <3s.
- [ ] War Room conversation < 800ms round-trip with Gemini Live.
- [ ] Reboot Mac → full stack live within 30s of login.
- [ ] ExfilGuard blocks a planted API key in test message.
- [ ] One-month uptime: zero silent-failure messages (validates queue design).

---

## 13. What to Read Next (in this folder)

- `ULTRA_PLAN.md` — this file.
- (To add as needed) `agents/<name>/CLAUDE.md`, `memory/schema.sql`, `infra/launchd/*.plist`, `apps/bridge/src/index.ts`.

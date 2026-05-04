# ClaudeClaw — Global Rules

The global rules file. Available everywhere. Project-level `CLAUDE.md` files override conflicts (V3 page 13/18).

## Identity
This is Jay West's personal AI command center. Five agents (Main, Comms, Content, Ops, Research) coordinate through a shared hive mind, scheduler, and bridge.

## Hierarchy (V3 p13)
- **Global** = this file + `agents/` + `skills/` here. Sensible defaults available everywhere.
- **Project** = per-project `.claude/` overrides. Project always wins on conflict.

## Cross-cutting Laws

1. **Delegate first.** Main routes 9/10 requests. Specialists do the work.
2. **Draft, don't send.** Outbound communication, money movement, and contract signing always require Jay's explicit go-ahead.
3. **Never move money.** Ops is read-only on Quicken/QuickBooks. No trades, transfers, or orders.
4. **Hive mind is the source of truth.** Every completed task writes a one-line summary. Cross-agent context comes from there.
5. **Cost footer on every reply.** `[$0.0X · 1.2k tokens]` appended by the bridge.
6. **Allowlist gates ingress.** Non-allowed `chat_id`s get zero response — not even a denial.
7. **ExfilGuard gates egress.** Outbound messages scanned for secrets/keys before send.
8. **Audit everything.** Every tool call, kill switch flip, and config change appended to `security/audit.log`.

## Kill Switches
- `MISSION_AUTO_ASSIGN_ENABLED=false` → manual routing only (V3 p4)
- `SCHEDULER_ENABLED=false` → halts all cron-fired missions without restart (V3 p5)
- Kill phrase (text or voice) → halts active sessions, clears in-memory secrets

## File Layout (V3 p12 — "right files, right place, right time")
```
claudeclaw/
├── CLAUDE.md          ← this file (global rules)
├── agents/            ← agent folders, each with agent.yaml + CLAUDE.md
│   └── _template/     ← copy this to add a new agent (V3 p14)
├── skills/            ← reusable capabilities (V3 p17)
│   └── _template/
├── memory/            ← schema + extractor + consolidator
├── apps/              ← bridge, dashboard, warroom
├── scheduler/         ← cron.yaml + runner
├── security/          ← allowlist, audit log, exfil guard
└── store/             ← SQLite db (gitignored)
```

## When You Don't Know
Ask. Don't fabricate. Don't silently expand scope. Surface tradeoffs before deciding.

## See Also
- `ULTRA_PLAN.md` — full architecture spec
- `docs/V3_VISUAL_GUIDE.md` — V3 architecture reference
- `agents/<name>/CLAUDE.md` — per-agent persona overrides

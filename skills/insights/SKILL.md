---
name: insights
description: Generate higher-order insights from the memories table — patterns, contradictions, blind spots Jay hasn't articulated. Used by /insights slash command.
triggers: /insights, generate insights, what patterns, what should I know
---

# Insights

V3 transcript ch.14 — Gemini scans memories and surfaces things Jay doesn't know about himself or his business.

## When to use
- `/insights` slash command (manual)
- Weekly cron mission `weekly_insights`
- After a Suggestions run flags an unusual pattern

## Inputs
- `period`: `7d` | `30d` | `90d` (default `30d`)
- `agent`: optional — scope to one agent's memories
- `min_confidence`: float 0–1 (default 0.6)

## Behavior
1. Pull memories from SQLite where `created_at >= now - period`
2. Send to Gemini 2.5 Flash with prompt:
   > "From these memories, emit JSON of insights: {observation, confidence 0-1, evidence_memory_ids[]}. Look for contradictions, recurring blockers, taste shifts, productive tensions. Skip the obvious."
3. Filter `confidence >= min_confidence`
4. Upsert into `insights` table
5. Render top 5 to user

## Output format
```
INSIGHTS — last {period}
━━━━━━━━━━━━━━━━━━━━━
1. {observation}
   confidence: {0.XX} · evidence: {n memories}
2. ...
```

## Tools used
- SQLite read on `memories` and `insights` tables
- Gemini 2.5 Flash (cheap workhorse)

## Cost notes
- ~$0.01 per /insights invocation (1 Flash call, 30 days of memories ≈ 50K tokens)

## See also
- `memory/extractor.py` — populates the memories this skill reads
- `skills/suggestions/SKILL.md` — agent-overburden detector, sibling skill

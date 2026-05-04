---
name: memory
description: Search, pin, decay, and inspect memories. V3 transcript ch.14 — the memory palace skill.
triggers: /memory, /pin, /forget, search memory, what do you know about
---

# Memory

V3 transcript ch.14 — searchable memory palace with importance/salience/recency.

## When to use
- `/memory <query>` — search across memories table
- `/pin <id|content>` — mark memory as pinned (never decays, injected every session)
- `/forget <id>` — soft-delete a memory
- "what do you know about X" — natural language search
- `/insights` — see [skills/insights/SKILL.md](../insights/SKILL.md)

## Inputs
- `query`: string — keyword or natural language
- `limit`: int (default 10)
- `agent_scope`: optional — filter by agent

## Behavior
**Search:**
1. FTS5 keyword pass on `memories.content`
2. Embedding similarity pass (Gemini 768-dim, cosine)
3. Merge + dedupe + rank by `salience = importance * 0.6 + recency * 0.3 + match_score * 0.1`
4. Return top N

**Pin:**
1. Insert into `pinned` table with `scope`
2. Force `importance = 1.0` on source memory; bypass weekly decay

**Decay (cron, weekly):**
1. `UPDATE memories SET importance = importance * 0.95 WHERE id NOT IN (SELECT memory_id FROM pinned)`
2. `DELETE FROM memories WHERE importance < 0.3 AND id NOT IN pinned`
3. Audit each change to `importance_audit`

## Output format (search)
```
MEMORY — "{query}" — {n} hits
━━━━━━━━━━━━━━━━━━━━━━━
[{id}] ({importance}) {kind}: {content}
       agent={agent} · {created_at_human}
       {📌 pinned if applicable}
```

## Tools used
- SQLite (FTS5, regular reads)
- Gemini embeddings 768-dim

## Cost notes
- Embedding cost only on memory write (~$0.0001 per memory)
- Search itself is free (local SQLite)

## See also
- `memory/inject.ts` — how pinned + top-importance memories are loaded at session start
- `memory/extractor.py` — Gemini washing machine that creates memories from transcripts
- `memory/consolidator.py` — merges near-duplicates

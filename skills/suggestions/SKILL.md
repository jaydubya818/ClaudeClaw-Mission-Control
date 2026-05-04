---
name: suggestions
description: Detect when an existing agent is overburdened and propose a new agent to split the load. V3 transcript ch.11 — the Agents-tab Suggestions feature.
triggers: /suggest, suggest agent, who should I hire, agent overburdened
---

# Suggestions

V3 transcript ch.11 — Gemini scans recent hive_mind activity and recommends splitting overloaded agents.

## When to use
- `/suggest` slash command
- Weekly cron mission `weekly_agent_suggestions`
- When Mission Control shows an agent's queue depth > 2× others for 3+ days

## Inputs
- `period`: `7d` | `30d` (default `7d`)
- `min_evidence_count`: int (default 10) — minimum hive entries needed before suggesting

## Behavior
1. SELECT agent, COUNT(*) FROM hive_mind WHERE created_at >= now - period GROUP BY agent
2. Pull the top-busy agent's prompts/replies
3. Send to Gemini 2.5 Flash:
   > "Given these {n} tasks, are they all in the same role? If not, propose a new agent: {name, role, rationale, sample tasks to migrate}."
4. If response confidence > 0.7, render suggestion card to user
5. User clicks Accept → kicks off the Add-First-Agent flow (V3 page 14): copy `agents/_template/`, rename, scaffold

## Output format
```
SUGGESTION
━━━━━━━━━
Your {comms} agent is handling {N} tasks across {email, slack, telegram, whatsapp, school}.
Consider splitting:

NEW AGENT: {email_manager}
ROLE: {one-line}
TASKS TO MIGRATE: {list}

[Accept] [Dismiss] [Snooze 7d]
```

## Tools used
- SQLite read on `hive_mind`
- Gemini 2.5 Flash

## Cost notes
- ~$0.005 per run

## See also
- `agents/_template/` — what gets copied when user accepts a suggestion
- `apps/dashboard/src/routes/agents.ts` — would expose `/api/suggestions` endpoint (NOT YET BUILT)

"""
War Room slash commands — /standup and /discuss.

V3 transcript ch.3, ch.16:
- /standup [@agent ...]   → each agent gives a 24h status report from hive_mind.
                            Main consolidates if no specific agents tagged.
- /discuss <topic>        → each agent weighs in with their angle. Main consolidates last.

Both commands run agents in isolation (no cross-talk during their reply),
then route through Main for final consolidation. The agent doesn't see
other replies until consolidation, mirroring the standup discipline of
"give your update, don't react."
"""

import os
import re
import sqlite3
import time
from typing import Optional

DB_PATH = os.environ.get("DB_PATH", "./store/claudeclaw.db")
ALL_AGENTS = ["main", "comms", "content", "ops", "research", "meta"]


def parse_command(text: str) -> Optional[dict]:
    """Returns {'cmd': 'standup'|'discuss', 'agents': [...], 'topic': str} or None."""
    t = text.strip()
    if not t.startswith("/"):
        return None

    standup_match = re.match(r"^/standup(?:\s+(.+))?$", t, re.IGNORECASE)
    if standup_match:
        rest = standup_match.group(1) or ""
        # Accept space- or comma-separated tags, with or without leading @.
        tokens = re.split(r"[\s,]+", rest)
        agents = [
            tok.lstrip("@").lower()
            for tok in tokens
            if tok.lstrip("@").lower() in ALL_AGENTS
        ]
        return {
            "cmd": "standup",
            "agents": agents or [a for a in ALL_AGENTS if a != "main"],
            "topic": "",
        }

    discuss_match = re.match(r"^/discuss\s+(.+)$", t, re.IGNORECASE)
    if discuss_match:
        return {
            "cmd": "discuss",
            "agents": [a for a in ALL_AGENTS if a != "main"],
            "topic": discuss_match.group(1).strip(),
        }

    return None


def fetch_24h_summary(agent: str) -> list[dict]:
    """Pull the last 24h of hive_mind entries for one agent."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cutoff = int(time.time()) - 86400
    rows = conn.execute(
        """
        SELECT id, prompt, reply, created_at
        FROM hive_mind
        WHERE agent = ? AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 50
        """,
        (agent, cutoff),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def standup_prompt(agent: str, entries: list[dict]) -> str:
    """Per-agent standup prompt. Each agent runs in isolation."""
    if not entries:
        return (
            f"You are the {agent} agent. You have nothing in hive_mind for the last 24h. "
            f"Reply with one sentence: 'Nothing to report.'"
        )
    bullets = "\n".join(
        f"- {e['prompt'][:80]} → {e['reply'][:120]}" for e in entries[:20]
    )
    return (
        f"You are the {agent} agent. Give a 3-bullet standup of what you've done in the last 24h. "
        f"Be terse, no fluff, no preamble. Format:\n"
        f"WRAPPED: <one line>\nQUEUED: <one line>\nBLOCKED: <one line or 'none'>\n\n"
        f"Hive_mind activity:\n{bullets}"
    )


def discuss_prompt(agent: str, topic: str) -> str:
    return (
        f"You are the {agent} agent. The topic: {topic}\n\n"
        f"Give your unique angle in 2–3 sentences. Stay in your lane "
        f"({agent}'s expertise). Don't summarize others; you can't see them."
    )


def consolidate_prompt(replies: dict[str, str], topic: str = "") -> str:
    """Main agent's consolidation prompt. Sees all replies."""
    formatted = "\n\n".join(f"## {a}\n{r}" for a, r in replies.items())
    if topic:
        return (
            f"You are Main. Five agents weighed in on: {topic}\n\n"
            f"{formatted}\n\n"
            f"Consolidate in <=4 sentences. Surface the strongest disagreement. "
            f"Then state your call. No preamble."
        )
    return (
        f"You are Main. Standup replies:\n\n{formatted}\n\n"
        f"Synthesize: who's blocked, who needs attention, what should Jay do today. <=4 sentences."
    )

"""
Insight extractor — V3 transcript ch.14.

Reads recent memories + hive_mind, asks Gemini 2.5 Flash for higher-order
observations (contradictions, recurring blockers, taste shifts) and upserts
into the insights table.

Default cadence: weekly (Sunday 09:00, see scheduler/cron.yaml weekly_insights).
Manual invocation: /insights slash command via the bridge.

Usage:
    python3 -m memory.insights [--period 7d|30d|90d] [--agent main|comms|...]
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from typing import Optional

from google import genai
from google.genai import types

DB_PATH = os.environ.get("DB_PATH", "./store/claudeclaw.db")
MODEL = "gemini-2.5-flash"

_client: genai.Client | None = None
def _gclient() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client
DEFAULT_PERIOD_DAYS = 7
MIN_CONFIDENCE = 0.6
MAX_INSIGHTS_PER_RUN = 10

PROMPT = """You are an insight extractor for Jay's personal AI command center.

You see {n} memories from the last {days} days. Surface things Jay does NOT
already articulate to himself: contradictions, recurring blockers, taste shifts,
productive tensions, second-order effects.

Output a JSON array. Each item:
{{
  "observation": "<single sentence; Jay-readable, not internal jargon>",
  "confidence": <0.0-1.0>,
  "evidence_memory_ids": [<int>, ...]
}}

Rules:
- Skip the obvious. If Jay already knows it, do not surface it.
- Confidence ≥ 0.7 means: there's direct multi-memory evidence.
- Confidence 0.5–0.7: pattern is suggestive but not conclusive.
- Confidence < 0.5: do not output.
- Maximum {max_n} insights. Return fewer if signal is thin.
- No prose, no commentary — JSON array only.

MEMORIES:
"""


def parse_period(period: str) -> int:
    """'7d' → 7, '30d' → 30, '90d' → 90."""
    if not period.endswith("d"):
        raise ValueError(f"period must be like '7d': {period}")
    return int(period[:-1])


def fetch_memories(
    db: sqlite3.Connection, days: int, agent: Optional[str]
) -> list[dict]:
    cutoff = int(time.time()) - days * 86400
    sql = (
        "SELECT id, agent, content, kind, importance, created_at "
        "FROM memories WHERE created_at >= ?"
    )
    params: list = [cutoff]
    if agent:
        sql += " AND agent = ?"
        params.append(agent)
    sql += " ORDER BY importance DESC, created_at DESC LIMIT 500"
    rows = db.execute(sql, params).fetchall()
    return [
        {
            "id": r[0],
            "agent": r[1],
            "content": r[2],
            "kind": r[3],
            "importance": r[4],
            "created_at": r[5],
        }
        for r in rows
    ]


def call_gemini(memories: list[dict], days: int) -> list[dict]:
    if not memories:
        return []
    if "GEMINI_API_KEY" not in os.environ:
        raise RuntimeError("GEMINI_API_KEY unset")
    transcript = "\n".join(
        f"[id={m['id']} agent={m['agent']} kind={m['kind']} imp={m['importance']:.2f}] {m['content']}"
        for m in memories
    )
    prompt = PROMPT.format(
        n=len(memories), days=days, max_n=MAX_INSIGHTS_PER_RUN
    ) + transcript
    resp = _gclient().models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )
    try:
        items = json.loads(resp.text)
    except Exception as e:
        print(f"[insights] parse error: {e}", file=sys.stderr)
        return []
    return [
        i for i in items
        if isinstance(i, dict) and i.get("confidence", 0) >= MIN_CONFIDENCE
    ][:MAX_INSIGHTS_PER_RUN]


def upsert(db: sqlite3.Connection, agent: Optional[str], items: list[dict]) -> int:
    now = int(time.time())
    n = 0
    for it in items:
        evidence = it.get("evidence_memory_ids", [])
        db.execute(
            """INSERT INTO insights
               (agent, observation, confidence, source_msg_ids, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                agent or "all",
                it["observation"],
                float(it["confidence"]),
                json.dumps(evidence),
                now,
            ),
        )
        n += 1
    db.commit()
    return n


def render(items: list[dict], days: int) -> str:
    if not items:
        return f"INSIGHTS — last {days}d\n━━━━━━━━━━━━━\n(no high-confidence patterns)"
    out = [f"INSIGHTS — last {days}d", "━" * 13]
    for i, it in enumerate(items, 1):
        ev = it.get("evidence_memory_ids", [])
        out.append(
            f"{i}. {it['observation']}\n"
            f"   confidence: {it['confidence']:.2f} · evidence: {len(ev)} memories"
        )
    return "\n".join(out)


def run(period: str = "7d", agent: Optional[str] = None) -> dict:
    """Programmatic entry point. Returns {items, written, rendered}."""
    days = parse_period(period)
    db = sqlite3.connect(DB_PATH)
    try:
        memories = fetch_memories(db, days, agent)
        items = call_gemini(memories, days)
        written = upsert(db, agent, items)
    finally:
        db.close()
    return {
        "items": items,
        "written": written,
        "memory_count": len(memories),
        "rendered": render(items, days),
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--period", default="7d")
    p.add_argument("--agent", default=None)
    args = p.parse_args()
    result = run(period=args.period, agent=args.agent)
    print(result["rendered"])
    print(f"\n[insights] wrote {result['written']} rows from {result['memory_count']} memories")
    return 0


if __name__ == "__main__":
    sys.exit(main())

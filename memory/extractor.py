"""
Memory extractor — runs every 30 min via launchd.

Reads the last 30 min of hive_mind rows, asks Gemini 2.5 Flash to classify
each observation into {fact, preference, context} with an importance score,
upserts into memories + embeddings.
"""

import json
import os
import sqlite3
import struct
import sys
import time
from pathlib import Path

from google import genai
from google.genai import types

DB_PATH = os.environ.get("DB_PATH", "./store/claudeclaw.db")
WINDOW_SECONDS = 30 * 60
EXTRACTION_MODEL = "gemini-2.5-flash"
EMBEDDING_MODEL = "gemini-embedding-001"  # 768-dim
EMBEDDING_DIMS = 768

# Lazy-instantiated client; reused across calls.
_client: genai.Client | None = None
def _gclient() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client

PROMPT = """You are a memory classifier for a personal AI system.

From the transcript window below, emit a JSON array. Each item:
{
  "kind": "fact" | "preference" | "context",
  "content": "<single self-contained sentence>",
  "importance": <0.0-1.0>
}

Rules:
- Skip ephemera (greetings, confirmations, "ok", "thanks").
- Facts = objective, verifiable info about Jay, his business, his tools.
- Preferences = stated likes/dislikes/styles.
- Context = situational state likely to matter again.
- Importance: 1.0 for identity/credentials, 0.8 for recurring habits, 0.5 for project-specific, 0.3 for one-off.
- No prose, no commentary — JSON array only.

TRANSCRIPT:
"""


def fetch_window(db: sqlite3.Connection) -> list[dict]:
    cutoff = int(time.time()) - WINDOW_SECONDS
    rows = db.execute(
        "SELECT agent, prompt, reply, created_at FROM hive_mind WHERE created_at >= ? ORDER BY created_at",
        (cutoff,),
    ).fetchall()
    return [{"agent": a, "prompt": p, "reply": r, "ts": ts} for a, p, r, ts in rows]


def classify(window: list[dict]) -> list[dict]:
    if not window:
        return []
    transcript = "\n\n".join(
        f"[{m['agent']}] USER: {m['prompt']}\n[{m['agent']}] REPLY: {m['reply']}"
        for m in window
    )
    resp = _gclient().models.generate_content(
        model=EXTRACTION_MODEL,
        contents=PROMPT + transcript,
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )
    try:
        return json.loads(resp.text)
    except Exception as e:
        print(f"[extractor] parse error: {e}", file=sys.stderr)
        return []


def embed(text: str) -> bytes:
    result = _gclient().models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
        config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMS),
    )
    vec = result.embeddings[0].values
    return struct.pack(f"{len(vec)}f", *vec)


def upsert(db: sqlite3.Connection, agent: str, item: dict) -> None:
    now = int(time.time())
    cur = db.execute(
        """INSERT INTO memories (agent, content, kind, importance, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (agent, item["content"], item["kind"], float(item["importance"]), now, now),
    )
    mid = cur.lastrowid
    try:
        db.execute(
            "INSERT OR REPLACE INTO embeddings (memory_id, vector) VALUES (?, ?)",
            (mid, embed(item["content"])),
        )
    except Exception as e:
        print(f"[extractor] embed error for mem {mid}: {e}", file=sys.stderr)


def main() -> int:
    db = sqlite3.connect(DB_PATH)
    try:
        window = fetch_window(db)
        if not window:
            print("[extractor] empty window; nothing to do")
            return 0
        # Group by agent to keep extraction focused.
        by_agent: dict[str, list[dict]] = {}
        for m in window:
            by_agent.setdefault(m["agent"], []).append(m)
        total = 0
        for agent, msgs in by_agent.items():
            items = classify(msgs)
            for item in items:
                upsert(db, agent, item)
                total += 1
        db.commit()
        print(f"[extractor] upserted {total} memories across {len(by_agent)} agents")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

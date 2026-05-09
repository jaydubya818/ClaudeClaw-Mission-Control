#!/usr/bin/env python3
"""Test the memory inject flow from the command line.

Connects to the same DB the dashboard uses, embeds your query string,
runs the same cosine ranking inject.ts uses, and prints the top-K with
their actual scores so you can see what the agent would see.

Usage:
    python bin/inject-test.py "what do I know about netflix"
    python bin/inject-test.py --agent comms "draft email to dan"
    python bin/inject-test.py --k 10 "claude api features"
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

DB_PATH = os.environ.get("DB_PATH", str(REPO / "store" / "claudeclaw.db"))


def cosine(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    num = sum(a[i] * b[i] for i in range(n))
    da = sum(x * x for x in a) ** 0.5
    db = sum(x * x for x in b) ** 0.5
    return num / (da * db) if da and db else 0.0


def buf_to_floats(buf: bytes) -> list[float]:
    n = len(buf) // 4
    return list(struct.unpack(f"{n}f", buf))


def embed_query(text: str) -> list[float]:
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    r = client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(output_dimensionality=768),
    )
    return list(r.embeddings[0].values)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("query")
    p.add_argument("--agent", default="main")
    p.add_argument("--k", type=int, default=5)
    args = p.parse_args()

    print(f"== inject preview for agent={args.agent} ==")
    print(f"Q: {args.query!r}\n")

    qv = embed_query(args.query)

    db = sqlite3.connect(DB_PATH)
    rows = db.execute(
        """SELECT m.id, m.agent, m.content, m.importance, m.kind, e.vector
           FROM memories m JOIN embeddings e ON e.memory_id = m.id"""
    ).fetchall()
    if not rows:
        print("(no memories with embeddings yet)")
        return 0

    scored = []
    for mid, magent, content, imp, kind, vec in rows:
        v = buf_to_floats(vec)
        score = cosine(qv, v)
        if magent != args.agent:
            score -= 0.10  # cross-agent penalty
        scored.append((score, mid, magent, kind, imp, content))
    scored.sort(reverse=True)

    print(f"top {args.k} of {len(scored)} memories (with embeddings):\n")
    for score, mid, magent, kind, imp, content in scored[: args.k]:
        marker = "•" if magent == args.agent else "↗"
        print(f"  {marker} score={score:.3f}  id={mid}  {magent}/{kind} imp={imp:.2f}")
        print(f"     {content[:200]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

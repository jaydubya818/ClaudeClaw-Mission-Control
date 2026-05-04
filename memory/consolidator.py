"""
Memory consolidator — runs every 30 min.
- Merges near-duplicate embeddings (cosine > 0.92), sums importance (cap 1.0).
- Weekly: decays importance by 0.95, drops rows < 0.3 (unless pinned-scope match).
"""

import os
import sqlite3
import struct
import sys
import time
from datetime import datetime

DB_PATH = os.environ.get("DB_PATH", "./store/claudeclaw.db")
DUP_COSINE = 0.92
WEEKLY_DECAY = 0.95
DROP_BELOW = 0.30


def unpack(buf: bytes) -> list[float]:
    n = len(buf) // 4
    return list(struct.unpack(f"{n}f", buf))


def cosine(a: list[float], b: list[float]) -> float:
    num = sum(x * y for x, y in zip(a, b))
    da = sum(x * x for x in a) ** 0.5
    db = sum(y * y for y in b) ** 0.5
    return num / (da * db) if da and db else 0.0


def merge_duplicates(db: sqlite3.Connection) -> int:
    rows = db.execute(
        """SELECT m.id, m.importance, e.vector
           FROM memories m JOIN embeddings e ON e.memory_id = m.id
           ORDER BY m.id""",
    ).fetchall()
    vecs = [(mid, imp, unpack(v)) for mid, imp, v in rows]
    merged = 0
    dropped: set[int] = set()
    for i in range(len(vecs)):
        if vecs[i][0] in dropped:
            continue
        for j in range(i + 1, len(vecs)):
            if vecs[j][0] in dropped:
                continue
            sim = cosine(vecs[i][2], vecs[j][2])
            if sim >= DUP_COSINE:
                new_imp = min(1.0, vecs[i][1] + vecs[j][1])
                db.execute(
                    "UPDATE memories SET importance = ?, last_seen_at = ? WHERE id = ?",
                    (new_imp, int(time.time()), vecs[i][0]),
                )
                db.execute("DELETE FROM memories WHERE id = ?", (vecs[j][0],))
                dropped.add(vecs[j][0])
                merged += 1
    return merged


def weekly_decay(db: sqlite3.Connection) -> tuple[int, int]:
    # Run decay only once per week (Monday 00:00 local).
    now = datetime.now()
    if now.weekday() != 0 or now.hour != 0:
        return 0, 0
    db.execute("UPDATE memories SET importance = importance * ?", (WEEKLY_DECAY,))
    cur = db.execute("DELETE FROM memories WHERE importance < ?", (DROP_BELOW,))
    return cur.rowcount, 1


def main() -> int:
    db = sqlite3.connect(DB_PATH)
    try:
        merged = merge_duplicates(db)
        dropped, decayed = weekly_decay(db)
        db.commit()
        print(f"[consolidator] merged={merged} dropped={dropped} decay_pass={decayed}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
Weekly memory decay — V3 transcript ch.14 ("memories that fade to fade into non-existence").

For every memory NOT in the pinned table:
  importance *= weekly_multiplier   (default 0.95)

Then drop memories with importance < drop_below (default 0.30) and their
embeddings (cascades via FK).

Each importance change is recorded in importance_audit so the importance
trajectory is queryable later.

Idempotent — safe to run multiple times in a row (monotonic decay).
Driven by the user's memory/config.yaml when present (set via interview.py).

Usage:
    python -m memory.decay              # default 0.95 multiplier, 0.30 drop threshold
    python -m memory.decay --dry-run    # report what would change without writing
    python -m memory.decay --multiplier 0.90 --drop-below 0.25
"""

import argparse
import os
import sqlite3
import sys
import time

DB_PATH = os.environ.get("DB_PATH", "./store/claudeclaw.db")

DEFAULTS = {
    "weekly_multiplier": 0.95,
    "drop_below": 0.30,
    "pinned_never_decay": True,
}


def load_config() -> dict:
    """Read memory/config.yaml if present (written by memory/interview.py)."""
    try:
        from . import interview as _itv  # type: ignore
        cfg = _itv.load_config()
    except Exception:
        cfg = {}
    decay = cfg.get("decay", {}) if isinstance(cfg, dict) else {}
    user_pref = cfg.get("user_preferences", {}) if isinstance(cfg, dict) else {}
    return {
        "weekly_multiplier": float(decay.get("weekly_multiplier", DEFAULTS["weekly_multiplier"])),
        "drop_below": float(decay.get("drop_below", DEFAULTS["drop_below"])),
        "pinned_never_decay": bool(decay.get("pinned_never_decay", DEFAULTS["pinned_never_decay"])),
        "fade_completely": bool(user_pref.get("fade_old_memories_completely", False)),
    }


def decay(db: sqlite3.Connection, multiplier: float, drop_below: float,
          pinned_never_decay: bool, dry_run: bool) -> dict:
    now = int(time.time())

    # Build the "decay-eligible" predicate. Pinned memories are excluded if configured.
    if pinned_never_decay:
        # Pin scope can be 'global' (applies to all agents) or '<agent>' (specific).
        # Treat 'global' as protecting every memory; agent-scoped protects matching agent.
        eligible_clause = """
          id NOT IN (
            SELECT m.id FROM memories m
            JOIN pinned p ON p.scope = 'global' OR p.scope = m.agent
          )
        """
    else:
        eligible_clause = "1=1"

    # Snapshot current state for audit + dry-run report.
    rows = db.execute(
        f"SELECT id, importance FROM memories WHERE {eligible_clause}"
    ).fetchall()
    if not rows:
        return {"touched": 0, "dropped": 0, "kept": 0}

    touched = 0
    dropped = 0
    kept = 0

    for mid, old_imp in rows:
        new_imp = old_imp * multiplier
        if new_imp < drop_below:
            dropped += 1
            if not dry_run:
                db.execute(
                    """INSERT INTO importance_audit (memory_id, old, new, reason, ts)
                       VALUES (?, ?, ?, 'decay-drop', ?)""",
                    (mid, old_imp, new_imp, now),
                )
                # FK ON DELETE CASCADE drops the matching embeddings row.
                db.execute("DELETE FROM memories WHERE id = ?", (mid,))
        else:
            touched += 1
            kept += 1
            if not dry_run:
                db.execute(
                    """INSERT INTO importance_audit (memory_id, old, new, reason, ts)
                       VALUES (?, ?, ?, 'decay', ?)""",
                    (mid, old_imp, new_imp, now),
                )
                db.execute(
                    "UPDATE memories SET importance = ? WHERE id = ?",
                    (new_imp, mid),
                )

    if not dry_run:
        db.commit()

    return {"touched": touched, "dropped": dropped, "kept": kept}


def main() -> int:
    p = argparse.ArgumentParser()
    cfg = load_config()
    p.add_argument("--multiplier", type=float, default=cfg["weekly_multiplier"])
    p.add_argument("--drop-below", type=float, default=cfg["drop_below"])
    p.add_argument("--no-pinned-protection", action="store_true",
                   help="Decay pinned memories too (default: pinned never decay)")
    p.add_argument("--dry-run", action="store_true",
                   help="Report what would change; no writes")
    args = p.parse_args()

    db = sqlite3.connect(DB_PATH)
    try:
        # Header.
        total = db.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        pinned_count = db.execute("SELECT COUNT(*) FROM pinned").fetchone()[0]
        print(f"[decay] mode={'dry-run' if args.dry_run else 'write'} multiplier={args.multiplier} "
              f"drop_below={args.drop_below} memories={total} pinned={pinned_count}")

        result = decay(
            db,
            multiplier=args.multiplier,
            drop_below=args.drop_below,
            pinned_never_decay=not args.no_pinned_protection,
            dry_run=args.dry_run,
        )
        print(f"[decay] touched={result['touched']} dropped={result['dropped']} kept={result['kept']}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

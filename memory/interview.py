"""
Memory interview — V3 transcript ch.14: "you want Claude Code to interview you
on how you want to deal with fresh memories and how you want to deal with
fading memories and important memories."

Asks ~15 questions and writes memory/config.yaml. The extractor, consolidator,
and inject all read this config on next run; defaults baked in for first-run
behavior before this script is run.

Usage:
    python -m memory.interview [--non-interactive]   # uses defaults if -n
"""

import argparse
import os
import sys
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(__file__).parent / "config.yaml"
DEFAULTS: dict[str, Any] = {
    "extractor": {
        "model": "gemini-2.5-flash",
        "window_minutes": 30,
        "min_importance_to_keep": 0.3,
        "skip_ephemera": True,
    },
    "decay": {
        "weekly_multiplier": 0.95,    # importance *= this each week
        "drop_below": 0.3,            # remove memories with importance < this
        "pinned_never_decay": True,
    },
    "consolidator": {
        "cosine_threshold": 0.92,     # merge near-duplicates above this similarity
        "merged_importance_cap": 1.0,
    },
    "inject": {
        "max_pinned": 20,             # always-included pinned memories
        "max_high_importance": 5,
        "max_recent": 20,
        "max_semantic_match": 5,
        "include_obsidian_folder": True,
    },
    "embeddings": {
        "model": "text-embedding-004",
        "dimensions": 768,
    },
    "kinds": ["fact", "preference", "context"],
    "user_preferences": {
        "fade_old_memories_completely": False,   # if False, archive instead of delete
        "auto_pin_identity": True,                # auto-pin name/email/etc
        "trust_self_reported_importance": False,
    },
}

QUESTIONS: list[dict[str, Any]] = [
    {
        "key": "extractor.window_minutes",
        "q": "How often should memories be extracted from your conversations? (minutes)",
        "type": "int",
        "default": 30,
        "valid": lambda v: 5 <= v <= 1440,
    },
    {
        "key": "decay.weekly_multiplier",
        "q": "How fast should old memories fade? (0.85 = aggressive, 0.95 = gentle, 0.99 = barely)",
        "type": "float",
        "default": 0.95,
        "valid": lambda v: 0.5 <= v <= 1.0,
    },
    {
        "key": "decay.drop_below",
        "q": "Importance threshold below which memories are dropped (0.0-1.0)",
        "type": "float",
        "default": 0.3,
        "valid": lambda v: 0.0 <= v <= 1.0,
    },
    {
        "key": "decay.pinned_never_decay",
        "q": "Should pinned memories *never* decay? (yes/no)",
        "type": "bool",
        "default": True,
    },
    {
        "key": "consolidator.cosine_threshold",
        "q": "Similarity threshold for merging duplicate memories (0.85-0.99)",
        "type": "float",
        "default": 0.92,
        "valid": lambda v: 0.7 <= v <= 0.99,
    },
    {
        "key": "inject.max_pinned",
        "q": "Max pinned memories injected per session (1-50)",
        "type": "int",
        "default": 20,
        "valid": lambda v: 1 <= v <= 50,
    },
    {
        "key": "inject.max_high_importance",
        "q": "Max high-importance memories injected per session (1-20)",
        "type": "int",
        "default": 5,
        "valid": lambda v: 1 <= v <= 20,
    },
    {
        "key": "inject.max_recent",
        "q": "Max recent (last 24h) memories injected per session (5-50)",
        "type": "int",
        "default": 20,
        "valid": lambda v: 5 <= v <= 50,
    },
    {
        "key": "inject.max_semantic_match",
        "q": "Max semantic-search matches injected per session (1-15)",
        "type": "int",
        "default": 5,
        "valid": lambda v: 1 <= v <= 15,
    },
    {
        "key": "inject.include_obsidian_folder",
        "q": "Auto-inject the agent's Obsidian folder context per session? (yes/no)",
        "type": "bool",
        "default": True,
    },
    {
        "key": "user_preferences.fade_old_memories_completely",
        "q": "When importance drops below threshold, delete completely or archive? (delete=yes / archive=no)",
        "type": "bool",
        "default": False,
    },
    {
        "key": "user_preferences.auto_pin_identity",
        "q": "Auto-pin identity facts (name, email, address) globally? (yes/no)",
        "type": "bool",
        "default": True,
    },
    {
        "key": "user_preferences.trust_self_reported_importance",
        "q": "Trust the LLM's self-reported importance score, or down-weight to 0.5 by default? (trust=yes / down-weight=no)",
        "type": "bool",
        "default": False,
    },
    {
        "key": "extractor.skip_ephemera",
        "q": "Skip greetings, confirmations, 'ok', 'thanks' from memory? (yes/no)",
        "type": "bool",
        "default": True,
    },
    {
        "key": "embeddings.model",
        "q": "Embedding model? (text-embedding-004 = Gemini 768-dim cheap default)",
        "type": "str",
        "default": "text-embedding-004",
        "valid": lambda v: len(v) > 3,
    },
]


def get_dotted(d: dict, key: str) -> Any:
    parts = key.split(".")
    cur = d
    for p in parts:
        cur = cur[p]
    return cur


def set_dotted(d: dict, key: str, value: Any) -> None:
    parts = key.split(".")
    cur = d
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value


def parse_input(raw: str, qtype: str) -> Any:
    raw = raw.strip()
    if qtype == "int":
        return int(raw)
    if qtype == "float":
        return float(raw)
    if qtype == "bool":
        return raw.lower() in {"y", "yes", "true", "1", "ok"}
    return raw


def render_yaml(data: dict, indent: int = 0) -> str:
    """Minimal YAML emitter — no PyYAML dep needed."""
    lines = []
    pad = "  " * indent
    for k, v in data.items():
        if isinstance(v, dict):
            lines.append(f"{pad}{k}:")
            lines.append(render_yaml(v, indent + 1))
        elif isinstance(v, list):
            lines.append(f"{pad}{k}:")
            for item in v:
                lines.append(f"{pad}  - {item}")
        elif isinstance(v, bool):
            lines.append(f"{pad}{k}: {'true' if v else 'false'}")
        elif isinstance(v, str):
            lines.append(f"{pad}{k}: {v}")
        else:
            lines.append(f"{pad}{k}: {v}")
    return "\n".join(lines)


def run_interview(non_interactive: bool = False) -> dict:
    config = {k: v.copy() if isinstance(v, dict) else v for k, v in DEFAULTS.items()}

    if non_interactive:
        return config

    print("=" * 60)
    print("ClaudeClaw memory interview — 15 questions, ~5 minutes")
    print("Press Enter to accept the default shown in [brackets].")
    print("=" * 60)

    for i, q in enumerate(QUESTIONS, 1):
        default = q["default"]
        default_str = "yes" if (q["type"] == "bool" and default) else \
                      "no" if (q["type"] == "bool" and not default) else \
                      str(default)
        while True:
            try:
                raw = input(f"\n[{i}/{len(QUESTIONS)}] {q['q']}\n      [default: {default_str}] > ")
            except (EOFError, KeyboardInterrupt):
                print("\n(interrupted — using defaults for the rest)")
                return config
            if not raw.strip():
                value = default
                break
            try:
                value = parse_input(raw, q["type"])
                if "valid" in q and not q["valid"](value):
                    print(f"      → out of range, try again")
                    continue
                break
            except (ValueError, TypeError) as e:
                print(f"      → couldn't parse ({e}); try again")
        set_dotted(config, q["key"], value)

    return config


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--non-interactive", "-n", action="store_true",
                        help="skip prompts, write defaults")
    parser.add_argument("--output", "-o", default=str(CONFIG_PATH),
                        help=f"output path (default {CONFIG_PATH})")
    args = parser.parse_args()

    config = run_interview(args.non_interactive)
    out = render_yaml(config)
    Path(args.output).write_text(
        "# Generated by memory/interview.py\n"
        "# Edit by re-running the interview or by hand. Re-read on next extractor/inject run.\n"
        "\n" + out + "\n"
    )
    print(f"\n✓ Wrote {args.output}")
    print("  Run `python -m memory.extractor` to verify the new settings take effect.")
    return 0


def load_config() -> dict:
    """Public API used by extractor/consolidator/inject."""
    if CONFIG_PATH.exists():
        try:
            import yaml as _yaml  # type: ignore
            return _yaml.safe_load(CONFIG_PATH.read_text())
        except ImportError:
            # PyYAML not installed — fall back to defaults silently.
            pass
    return DEFAULTS


if __name__ == "__main__":
    sys.exit(main())

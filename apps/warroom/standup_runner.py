"""
Standup/Discuss runner — wires the parser in standup.py to actual agent invocations.

Strategy:
- Each agent runs in isolation (no cross-talk during reply, mirrors the
  V3 transcript design at ch.16).
- Agents are invoked via the Anthropic Claude Agent SDK using their per-agent
  CLAUDE.md as system context. We shell out to `claude` CLI in non-interactive
  mode, which leverages Jay's existing Claude Code subscription.
- Main runs LAST and sees all the other replies for consolidation.
- Result is returned as text-mode chat (no audio).

This is intentionally subprocess-based rather than direct SDK so the war room
remains language-agnostic and reuses the same auth path as the bridge.
"""

import asyncio
import json
import shutil
import sqlite3
import os
from pathlib import Path
from typing import Optional

from standup import (
    ALL_AGENTS,
    consolidate_prompt,
    discuss_prompt,
    fetch_24h_summary,
    parse_command,
    standup_prompt,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
AGENT_ROOT = REPO_ROOT / "agents"
DB_PATH = os.environ.get("DB_PATH", str(REPO_ROOT / "store" / "claudeclaw.db"))
CLAUDE_CMD = os.environ.get("CLAUDE_CMD", "claude")
MAX_PER_AGENT_CHARS = 1500   # cap each agent's reply before consolidation
TURN_TIMEOUT_SEC = 60


def _agent_cwd(agent: str) -> Path:
    """Working directory for `claude` so it picks up the agent's CLAUDE.md."""
    p = AGENT_ROOT / agent
    if not p.exists():
        raise FileNotFoundError(f"agent dir missing: {p}")
    return p


async def _invoke_agent(agent: str, prompt: str) -> str:
    """Non-interactive `claude -p '<prompt>'` from the agent's folder.

    Falls back to a stub message if `claude` is not on PATH (e.g. in CI).
    """
    if not shutil.which(CLAUDE_CMD):
        return f"(stub: {CLAUDE_CMD} not on PATH; would invoke {agent} with prompt of {len(prompt)} chars)"

    proc = await asyncio.create_subprocess_exec(
        CLAUDE_CMD,
        "-p",
        prompt,
        cwd=str(_agent_cwd(agent)),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={**os.environ, "CLAUDE_NONINTERACTIVE": "1"},
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=TURN_TIMEOUT_SEC
        )
    except asyncio.TimeoutError:
        proc.kill()
        return f"(timeout after {TURN_TIMEOUT_SEC}s)"

    if proc.returncode != 0:
        err = stderr.decode("utf-8", errors="replace")[:300]
        return f"(error: {err})"

    text = stdout.decode("utf-8", errors="replace").strip()
    if len(text) > MAX_PER_AGENT_CHARS:
        text = text[:MAX_PER_AGENT_CHARS] + "…[truncated]"
    return text


async def run_command(text: str) -> Optional[dict]:
    """Run a /standup or /discuss command end-to-end.

    Returns:
        {"cmd": str, "replies": {agent: text}, "consolidated": str}
        or None if the input is not a recognized command.
    """
    parsed = parse_command(text)
    if not parsed:
        return None

    cmd = parsed["cmd"]
    agents = parsed["agents"]
    topic = parsed["topic"]

    # Build per-agent prompts.
    if cmd == "standup":
        prompts = {a: standup_prompt(a, fetch_24h_summary(a)) for a in agents}
    else:  # discuss
        prompts = {a: discuss_prompt(a, topic) for a in agents}

    # Run all agents in parallel, isolated.
    results = await asyncio.gather(
        *[_invoke_agent(a, p) for a, p in prompts.items()],
        return_exceptions=True,
    )
    replies: dict[str, str] = {}
    for a, r in zip(agents, results):
        replies[a] = (
            f"(exception: {type(r).__name__}: {r})" if isinstance(r, BaseException) else r
        )

    # Main consolidates, sees all replies.
    consolidated = await _invoke_agent(
        "main", consolidate_prompt(replies, topic if cmd == "discuss" else "")
    )

    # Append a hive_mind row so future /standup runs see this turn.
    try:
        _record_hive(cmd, replies, consolidated, topic)
    except Exception as e:
        print(f"[standup_runner] hive write failed: {e}")

    return {"cmd": cmd, "topic": topic, "replies": replies, "consolidated": consolidated}


def _record_hive(cmd: str, replies: dict, consolidated: str, topic: str) -> None:
    import time
    db = sqlite3.connect(DB_PATH)
    try:
        prompt_summary = f"/{cmd}" + (f" {topic}" if topic else "")
        reply_summary = f"{len(replies)} agents replied; consolidated by main"
        db.execute(
            "INSERT INTO hive_mind (agent, prompt, reply, created_at) VALUES (?, ?, ?, ?)",
            ("main", prompt_summary, reply_summary, int(time.time())),
        )
        db.commit()
    finally:
        db.close()


# CLI entrypoint for testing without the WS layer.
if __name__ == "__main__":
    import sys
    text = " ".join(sys.argv[1:]) or "/standup"
    result = asyncio.run(run_command(text))
    print(json.dumps(result, indent=2))

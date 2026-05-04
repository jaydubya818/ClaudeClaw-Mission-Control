"""
B1 — Pipecat extension: join a Daily.co room as an agent.

Receives POST /join-meeting from the dashboard's meeting route, then spawns
a Pipecat session that:
  1. Connects to the given Daily.co room URL via DailyTransport.
  2. Pipes audio to Gemini Live with the agent's system instruction.
  3. Streams Gemini's audio back into the room.

This is a separate process from the main warroom WebSocket server because
the Daily.co transport has its own event loop and pulling audio from a room
is full-duplex by nature.

Usage (from dashboard via POST):
    curl -X POST http://localhost:7861/join-meeting \\
         -H 'content-type: application/json' \\
         -d '{"url": "https://you.daily.co/cc-abc", "agent": "main"}'

Env:
    DAILY_API_KEY      Daily.co REST + transport token
    GEMINI_API_KEY     Gemini Live audio model

Deps (installed via apps/warroom/requirements.txt):
    pipecat-ai
    pipecat-ai[daily]   # transport
    pipecat-ai[gemini]  # service
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

sys.path.insert(0, str(Path(__file__).parent))

# Optional Pipecat imports — guarded so the module loads even when deps
# aren't installed yet (you can deploy the route without the avatar wiring).
try:
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import PipelineRunner
    from pipecat.pipeline.task import PipelineTask
    from pipecat.transports.services.daily import DailyTransport, DailyParams  # type: ignore
    from pipecat.services.gemini_multimodal_live import GeminiMultimodalLiveLLMService  # type: ignore
    HAVE_PIPECAT = True
except ImportError as _e:
    HAVE_PIPECAT = False
    _PIPECAT_ERR = str(_e)


# Per-agent system prompts — mirrors apps/warroom/server.py.
AGENT_PROMPTS = {
    "main": (
        "You are Main, the triage agent in Jay's command center. "
        "You're in a video meeting. Crisp, conversational, 1-2 sentences. "
        "Delegate to specialists by name when appropriate."
    ),
    "comms": (
        "You are Comms — Jay's communications specialist. "
        "Conversational, warm. Drafts emails, replies, and posts. "
        "You're in a video meeting; speak briefly."
    ),
    "content": (
        "You are Content — Jay's creative specialist. Scripts, hooks, "
        "thumbnails. Playful but not silly. Brief in voice mode."
    ),
    "ops": (
        "You are Ops — Jay's operations specialist. Calendar, finances, "
        "vendors. Numerate, terse. Numbers over vibes."
    ),
    "research": (
        "You are Research — Jay's deep-research specialist. Cite sources. "
        "TL;DR first; details on follow-up."
    ),
    "meta": (
        "You are Meta — Jay's paid acquisition specialist for Meta ads. "
        "Numerate, link-heavy. Never push spend changes; draft and hand off."
    ),
}


_active_sessions: dict[str, asyncio.Task] = {}


async def run_session(room_url: str, agent: str) -> None:
    """Long-running task: join the room, run the pipeline, exit on disconnect."""
    if not HAVE_PIPECAT:
        print(f"[meeting] pipecat not installed: {_PIPECAT_ERR}", file=sys.stderr)
        return

    daily_token = os.environ.get("DAILY_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not daily_token or not gemini_key:
        print("[meeting] DAILY_API_KEY or GEMINI_API_KEY unset", file=sys.stderr)
        return

    system_prompt = AGENT_PROMPTS.get(agent, AGENT_PROMPTS["main"])

    transport = DailyTransport(
        room_url,
        daily_token,
        f"ClaudeClaw·{agent}",
        DailyParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    llm = GeminiMultimodalLiveLLMService(
        api_key=gemini_key,
        system_instruction=system_prompt,
    )

    pipeline = Pipeline([transport.input(), llm, transport.output()])
    task = PipelineTask(pipeline)
    runner = PipelineRunner()

    try:
        await runner.run(task)
    except Exception as e:
        print(f"[meeting] session ended: {e}", file=sys.stderr)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    # Cancel all active sessions on shutdown.
    for t in list(_active_sessions.values()):
        t.cancel()


app = FastAPI(lifespan=lifespan)


@app.get("/healthz")
def healthz():
    return {"ok": True, "have_pipecat": HAVE_PIPECAT, "active_sessions": len(_active_sessions)}


@app.post("/join-meeting")
async def join_meeting(req: Request):
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"error": "bad json"}, status_code=400)
    url = body.get("url")
    agent = (body.get("agent") or "main").lower()
    if not url:
        return JSONResponse({"error": "url required"}, status_code=400)
    if agent not in AGENT_PROMPTS:
        return JSONResponse({"error": f"agent must be one of {list(AGENT_PROMPTS)}"}, status_code=400)

    # If already in this room with this agent, no-op.
    key = f"{url}#{agent}"
    if key in _active_sessions and not _active_sessions[key].done():
        return {"ok": True, "note": "session already running"}

    task = asyncio.create_task(run_session(url, agent))
    _active_sessions[key] = task
    return {"ok": True, "agent": agent, "have_pipecat": HAVE_PIPECAT}


def main() -> int:
    port = int(os.environ.get("WARROOM_MEETING_PORT", 7861))
    uvicorn.run(app, host="127.0.0.1", port=port)
    return 0


if __name__ == "__main__":
    sys.exit(main())

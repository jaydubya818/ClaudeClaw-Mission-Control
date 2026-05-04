"""
Pipecat pipeline — Silero VAD → Gemini Live (unified STT+LLM+TTS) → Router.

Kept minimal: swap to Deepgram/Cartesia by replacing the Gemini Live service
with pipecat.services.deepgram + pipecat.services.cartesia nodes.
"""

import os

from pipecat.frames.frames import EndFrame, TextFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.google.llm import GoogleLLMService  # Gemini
from pipecat.transports.websocket.server import WebsocketServerTransport
from pipecat.audio.vad.silero import SileroVADAnalyzer

from delegate import parse_delegation, spawn


class Router(FrameProcessor):
    """
    Routes TextFrames per ULTRA_PLAN.md §8:
      1. Broadcast keywords (everyone/team/status update) → Main fans out.
      2. Agent-name prefix → explicit route.
      3. Sticky pin (from client "pin" msg) → fallback.
    If a delegation intent is detected ("Comms, draft …" / "Tell Ops to …"),
    spawn a sub-agent task via the bridge loopback endpoint. The spoken
    response stays in the room; the drafted output is delivered to Telegram.
    """

    def __init__(self, voices: dict):
        super().__init__()
        self.voices = voices
        self.pinned = "main"

    def set_pin(self, agent: str) -> None:
        if agent in self.voices:
            self.pinned = agent

    async def process_frame(self, frame, direction: FrameDirection):
        if isinstance(frame, TextFrame) and direction == FrameDirection.DOWNSTREAM:
            text = frame.text or ""
            parsed = parse_delegation(text)
            if parsed:
                agent, task = parsed
                ok = spawn(agent, task)
                note = f"Delegated to {agent}." if ok else f"Delegation to {agent} failed."
                frame.metadata = {**(frame.metadata or {}), "delegated": ok, "agent": agent}
                frame.text = note
            else:
                frame.metadata = {**(frame.metadata or {}), "agent": self.pinned}
        await self.push_frame(frame, direction)


async def run_pipeline(ws, voices: dict) -> None:
    transport = WebsocketServerTransport(
        websocket=ws,
        vad_analyzer=SileroVADAnalyzer(),
    )

    llm = GoogleLLMService(
        api_key=os.environ["GEMINI_API_KEY"],
        model="gemini-2.0-flash-exp",  # Live model handle; update when GA
    )

    router = Router(voices)

    pipeline = Pipeline(
        [
            transport.input(),
            router,
            llm,
            transport.output(),
        ]
    )
    task = PipelineTask(pipeline)
    runner = PipelineRunner()
    await runner.run(task)

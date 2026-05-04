"""
War Room — direct Gemini Live proxy.

Browser <-> WS <-> this server <-> WS <-> Gemini Live (BidiGenerateContent)

The client streams 16kHz PCM16 mic audio as binary WS frames. This server
forwards each chunk to Gemini Live; Gemini streams back 24kHz PCM16 audio
(binary to client) and transcripts (JSON to client). The active agent
(pinned via JSON control message) picks the voice + system instruction.
"""

import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from typing import Optional

import websockets
import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import uvicorn

sys.path.insert(0, str(Path(__file__).parent))
from delegate import parse_delegation, spawn  # noqa: E402
from standup_runner import run_command as run_standup_command  # noqa: E402

load_dotenv()

VOICES = yaml.safe_load((Path(__file__).parent / "voices.yaml").read_text())["agents"]
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get(
    "WARROOM_MODEL", "models/gemini-2.5-flash-native-audio-latest"
)
UPSTREAM = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
    f"?key={GEMINI_API_KEY}"
)

AGENT_PROMPTS = {
    "main": "You are Main, the triage agent and voice of Jay's command center. "
            "Crisp, confident, 1-2 sentences. Route tasks to Comms, Content, Ops, "
            "or Research by name when appropriate.",
    "comms": "You are Comms, master of whisperers. You draft messages - email, "
             "Slack, Telegram replies - in Jay's voice. Conversational and warm.",
    "content": "You are Content, the royal bard. Creative writing, scripts, posts. "
               "Playful but not silly.",
    "ops": "You are Ops, master of war. Schedules, logistics, money. Short, "
           "declarative sentences. Numbers over vibes.",
    "research": "You are Research, grand maester. Facts, analysis, citations. "
                "TL;DR first, details on request.",
    "meta": "You are Meta, master of paid acquisition on Facebook/Instagram. "
            "Pull ad performance via meta-ads-cli. Numerate, terse, link-heavy. "
            "Never push spend changes — always draft and hand off to Jay.",
}


def setup_msg(agent: str) -> str:
    voice = VOICES.get(agent, VOICES["main"])["voice"]
    system = AGENT_PROMPTS.get(agent, AGENT_PROMPTS["main"])
    return json.dumps({
        "setup": {
            "model": MODEL,
            "generation_config": {
                "response_modalities": ["AUDIO"],
                "speech_config": {
                    "voice_config": {"prebuilt_voice_config": {"voice_name": voice}}
                },
            },
            "system_instruction": {"parts": [{"text": system}]},
            "output_audio_transcription": {},
            "input_audio_transcription": {},
        }
    })


app = FastAPI()


@app.get("/healthz")
def healthz():
    return {"ok": True, "model": MODEL, "agents": list(VOICES.keys())}



class Session:
    """One browser WS <-> one Gemini Live WS."""

    def __init__(self, client_ws: WebSocket):
        self.client = client_ws
        self.up: Optional[websockets.ClientConnection] = None
        self.agent = "main"
        self.user_turn_text = ""

    async def open_upstream(self, agent: str) -> None:
        self.agent = agent
        if self.up:
            try:
                await self.up.close()
            except Exception:
                pass
        self.up = await websockets.connect(UPSTREAM, max_size=2**22)
        await self.up.send(setup_msg(agent))
        ack = await self.up.recv()
        print(f"[warroom] upstream setup ack ({agent}, {len(ack)}b)", flush=True)
        await self.client.send_text(json.dumps({
            "type": "ready", "agent": agent, "voice": VOICES[agent]["voice"]
        }))


    async def _handle_command(self, text: str) -> None:
        """Run /standup or /discuss; stream the consolidated reply back as transcript."""
        try:
            await self.client.send_text(json.dumps({
                "type": "transcript", "role": "system",
                "text": f"running {text} ..."
            }))
            result = await run_standup_command(text)
            if result is None:
                await self.client.send_text(json.dumps({
                    "type": "error", "text": f"unrecognized command: {text}"
                }))
                return
            for agent, reply in result["replies"].items():
                await self.client.send_text(json.dumps({
                    "type": "transcript", "role": agent, "text": reply
                }))
            await self.client.send_text(json.dumps({
                "type": "transcript", "role": "main", "text": result["consolidated"]
            }))
            await self.client.send_text(json.dumps({"type": "command_complete"}))
        except Exception as e:
            await self.client.send_text(json.dumps({
                "type": "error", "text": f"command failed: {e}"
            }))

    async def client_to_upstream(self) -> None:
        try:
            while True:
                msg = await self.client.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                if "bytes" in msg and msg["bytes"] is not None:
                    b64 = base64.b64encode(msg["bytes"]).decode()
                    await self.up.send(json.dumps({
                        "realtime_input": {
                            "media_chunks": [
                                {"mime_type": "audio/pcm;rate=16000", "data": b64}
                            ]
                        }
                    }))
                elif "text" in msg and msg["text"] is not None:
                    try:
                        obj = json.loads(msg["text"])
                    except Exception:
                        continue
                    t = obj.get("type")
                    if t == "pin":
                        new_agent = obj.get("agent", "main").lower()
                        if new_agent in VOICES and new_agent != self.agent:
                            await self.open_upstream(new_agent)
                    elif t == "mode":
                        pass
                    elif t == "command":
                        # V3 transcript ch.3, ch.16 — /standup, /discuss
                        cmd_text = obj.get("text", "")
                        await self._handle_command(cmd_text)
        except (WebSocketDisconnect, asyncio.CancelledError):
            return
        except Exception as e:
            print(f"[warroom] client->upstream error: {e}", flush=True)


    async def upstream_to_client(self) -> None:
        try:
            async for raw in self.up:
                try:
                    ev = json.loads(raw)
                except Exception:
                    continue
                sc = ev.get("server_content", {}) or ev.get("serverContent", {})

                mt = sc.get("model_turn") or sc.get("modelTurn") or {}
                for part in mt.get("parts", []):
                    inline = part.get("inline_data") or part.get("inlineData")
                    if inline and inline.get("data"):
                        audio = base64.b64decode(inline["data"])
                        await self.client.send_bytes(audio)
                    if "text" in part and part["text"]:
                        await self.client.send_text(json.dumps({
                            "type": "transcript", "role": "agent", "text": part["text"]
                        }))

                out_tx = sc.get("output_transcription") or sc.get("outputTranscription")
                if out_tx and out_tx.get("text"):
                    await self.client.send_text(json.dumps({
                        "type": "transcript", "role": "agent", "text": out_tx["text"]
                    }))

                in_tx = sc.get("input_transcription") or sc.get("inputTranscription")
                if in_tx and in_tx.get("text"):
                    chunk = in_tx["text"]
                    self.user_turn_text += chunk
                    await self.client.send_text(json.dumps({
                        "type": "transcript", "role": "you", "text": chunk
                    }))


                if sc.get("turn_complete") or sc.get("turnComplete"):
                    text = self.user_turn_text.strip()
                    self.user_turn_text = ""
                    if text:
                        parsed = parse_delegation(text)
                        if parsed:
                            who, task = parsed
                            ok = spawn(who, task)
                            await self.client.send_text(json.dumps({
                                "type": "delegation",
                                "agent": who, "task": task, "ok": ok,
                            }))
                    await self.client.send_text(json.dumps({"type": "turn_complete"}))
        except (websockets.ConnectionClosed, asyncio.CancelledError):
            return
        except Exception as e:
            print(f"[warroom] upstream->client error: {e}", flush=True)


@app.websocket("/ws")
async def ws(ws: WebSocket):
    if not GEMINI_API_KEY:
        await ws.accept()
        await ws.send_text(json.dumps({"type": "error", "text": "GEMINI_API_KEY unset"}))
        await ws.close(code=1011)
        return

    await ws.accept()
    session = Session(ws)
    try:
        await session.open_upstream("main")
    except Exception as e:
        print(f"[warroom] setup failed: {e}", flush=True)
        try:
            await ws.send_text(json.dumps({"type": "error", "text": f"setup failed: {e}"}))
        except Exception:
            pass
        await ws.close(code=1011)
        return

    await asyncio.gather(
        session.client_to_upstream(),
        session.upstream_to_client(),
        return_exceptions=True,
    )
    try:
        if session.up:
            await session.up.close()
    except Exception:
        pass


PUBLIC = Path(__file__).parent / "public"
app.mount("/", StaticFiles(directory=PUBLIC, html=True), name="public")


def main() -> int:
    port = int(os.environ.get("WARROOM_PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
    return 0


if __name__ == "__main__":
    sys.exit(main())

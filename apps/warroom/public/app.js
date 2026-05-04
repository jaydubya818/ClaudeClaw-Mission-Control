// War Room client — mic PCM16 → WS → Gemini Live → PCM playback + transcripts.

const AGENTS = [
  { name: 'Main',     role: 'The Hand of the King',   pinned: true  },
  { name: 'Research', role: 'Grand Maester',          pinned: false },
  { name: 'Comms',    role: 'Master of Whisperers',   pinned: false },
  { name: 'Content',  role: 'The Royal Bard',         pinned: false },
  { name: 'Ops',      role: 'Master of War',          pinned: false },
];

let active = 'Main';
let mode = 'direct';
let ws = null;
let micOn = false;

let mediaStream = null;
let micCtx = null;       // AudioContext for capture
let workletNode = null;
let analyzer = null;

let playCtx = null;      // AudioContext for playback @24kHz
let playAt = 0;          // next playback start time (ctx clock)

renderAgents();
document.getElementById('m-direct').onclick = () => setMode('direct');
document.getElementById('m-handup').onclick = () => setMode('handup');

function renderAgents() {
  document.getElementById('agents').innerHTML = AGENTS.map(a => `
    <div class="agent ${a.name===active?'active':''}" onclick="pick('${a.name}')">
      <span class="dot"></span>
      <div>
        <div class="name">${a.name}</div>
        <div class="sub">${a.role}</div>
      </div>
      ${a.pinned ? '<span class="pin">PINNED</span>' : ''}
    </div>
  `).join('');
}

function pick(name) {
  active = name;
  AGENTS.forEach(a => a.pinned = (a.name === name));
  renderAgents();
  send({ type: 'pin', agent: name.toLowerCase() });
}

function setMode(m) {
  mode = m;
  document.getElementById('m-direct').classList.toggle('on', m==='direct');
  document.getElementById('m-handup').classList.toggle('on', m==='handup');
  send({ type: 'mode', mode: m });
}

const escapeHtml = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]);

function log(role, text) {
  const chat = document.getElementById('chat');
  // Coalesce with previous bubble from the same role (Gemini streams small chunks).
  const last = chat.lastElementChild;
  if (last && last.dataset.role === role) {
    last.querySelector('.body').innerHTML += escapeHtml(text);
  } else {
    const el = document.createElement('div');
    el.className = 'msg';
    el.dataset.role = role;
    el.innerHTML = `<div class="role ${role==='you'?'you':'agent'}">${role.toUpperCase()}</div><div class="body">${escapeHtml(text)}</div>`;
    chat.appendChild(el);
  }
  chat.scrollTop = chat.scrollHeight;
}

function logMeta(text) {
  const chat = document.getElementById('chat');
  const el = document.createElement('div');
  el.className = 'msg';
  el.dataset.role = 'meta';
  el.innerHTML = `<div class="role agent" style="opacity:.6">SYSTEM</div><div class="body" style="color:#8b93a7">${escapeHtml(text)}</div>`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

async function toggleMic() {
  if (!micOn) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      logMeta('mic permission denied: ' + e.message);
      return;
    }

    // Capture side — use device default sample rate; worklet resamples to 16kHz.
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    await micCtx.audioWorklet.addModule('/pcm-worklet.js');
    const source = micCtx.createMediaStreamSource(mediaStream);

    analyzer = micCtx.createAnalyser();
    analyzer.fftSize = 256;
    source.connect(analyzer);

    workletNode = new AudioWorkletNode(micCtx, 'pcm16-downsampler');
    workletNode.port.onmessage = (ev) => {
      if (ws && ws.readyState === 1) ws.send(ev.data);
    };
    source.connect(workletNode);
    // Sink the worklet so process() keeps being called. Volume 0 = silent.
    const silent = micCtx.createGain();
    silent.gain.value = 0;
    workletNode.connect(silent);
    silent.connect(micCtx.destination);

    // Playback side — Gemini Live emits 24kHz PCM16.
    playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    playAt = playCtx.currentTime;

    connectWS();
    drawMeter();
    micOn = true;
    document.getElementById('mic').classList.remove('off');
  } else {
    try { mediaStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { workletNode?.disconnect(); } catch {}
    try { await micCtx?.close(); } catch {}
    try { await playCtx?.close(); } catch {}
    try { ws?.close(); } catch {}
    micOn = false;
    document.getElementById('mic').classList.add('off');
    document.getElementById('bar').style.width = '0';
  }
}

function connectWS() {
  const url = `ws://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => logMeta(`connected · mode: ${mode} · pinned: ${active}`);
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'transcript' && msg.role) log(msg.role, msg.text);
      else if (msg.type === 'ready') logMeta(`agent=${msg.agent} voice=${msg.voice}`);
      else if (msg.type === 'delegation') logMeta(`→ delegated to ${msg.agent}: ${msg.task} [${msg.ok ? 'ok' : 'failed'}]`);
      else if (msg.type === 'turn_complete') {
        // Insert a divider between turns
        const chat = document.getElementById('chat');
        if (chat.lastElementChild && chat.lastElementChild.dataset.role !== 'divider') {
          const d = document.createElement('div');
          d.dataset.role = 'divider';
          d.style.cssText = 'border-top:1px dashed #20232b;margin:10px 0';
          chat.appendChild(d);
        }
      } else if (msg.type === 'error') {
        logMeta('⚠️ ' + msg.text);
      }
    } else {
      playPCM24(e.data);
    }
  };
  ws.onerror = () => logMeta('⚠️ ws error');
  ws.onclose = () => logMeta('disconnected');
}

function send(obj) { ws?.readyState === 1 && ws.send(JSON.stringify(obj)); }

function playPCM24(arrayBuffer) {
  if (!playCtx) return;
  // Gemini Live sends 24kHz mono PCM16 little-endian
  const i16 = new Int16Array(arrayBuffer);
  if (i16.length === 0) return;
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / (i16[i] < 0 ? 0x8000 : 0x7fff);

  const buf = playCtx.createBuffer(1, f32.length, 24000);
  buf.copyToChannel(f32, 0);
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  src.connect(playCtx.destination);

  const now = playCtx.currentTime;
  const startAt = Math.max(now, playAt);
  src.start(startAt);
  playAt = startAt + buf.duration;
}

function drawMeter() {
  if (!micOn) return;
  const buf = new Uint8Array(analyzer.frequencyBinCount);
  analyzer.getByteFrequencyData(buf);
  const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
  document.getElementById('bar').style.width = Math.min(100, avg) + '%';
  requestAnimationFrame(drawMeter);
}

function end() {
  toggleMic();
  logMeta('meeting ended');
}

import { createServer } from "node:http";

const SAMPLE_RATE = 44_100;
const FRAMES_PER_CHUNK = 4_410; // 100ms

const MOOD_PROFILES = {
  calming: { tempoBpm: 72, rootHz: 174.61, scale: [0, 3, 5, 7, 10], brightness: 0.35 },
  "deep-focus": { tempoBpm: 86, rootHz: 164.81, scale: [0, 2, 3, 5, 7, 10], brightness: 0.4 },
  flow: { tempoBpm: 102, rootHz: 146.83, scale: [0, 2, 4, 5, 7, 9, 11], brightness: 0.55 },
  uplift: { tempoBpm: 124, rootHz: 130.81, scale: [0, 2, 4, 7, 9, 11], brightness: 0.7 },
  neutral: { tempoBpm: 96, rootHz: 146.83, scale: [0, 2, 4, 5, 7, 9, 11], brightness: 0.5 },
};

let control = null;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    sendHtml(res, HOME_HTML);
    return;
  }

  if (req.method === "GET" && url.pathname === "/state") {
    sendJson(res, 200, ensureControl().snapshot());
    return;
  }

  if (req.method === "POST" && url.pathname === "/command") {
    try {
      const body = await readJsonBody(req);
      const next = ensureControl().applyCommand(body);
      sendJson(res, 200, { ok: true, state: next });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/agent") {
    try {
      const body = await readJsonBody(req);
      const command = mapAgentEventToCommand(body?.event);
      const next = ensureControl().applyCommand(command);
      sendJson(res, 200, { ok: true, state: next, command });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/audio") {
    streamAudio(res);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`🎧 Beatly procedural audio server listening on http://localhost:${port}`);
  console.log(`   - UI:     http://localhost:${port}/`);
  console.log(`   - Audio:  http://localhost:${port}/audio`);
  console.log(`   - State:  http://localhost:${port}/state`);
  console.log(`   - Command endpoint: POST /command`);
});

function streamAudio(res) {
  res.writeHead(200, {
    "Content-Type": "audio/wav",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  res.write(createStreamingWavHeader(SAMPLE_RATE));

  const synth = new ProceduralSynth(() => ensureControl().step(FRAMES_PER_CHUNK));
  const timer = setInterval(() => {
    const chunk = synth.render(FRAMES_PER_CHUNK);
    res.write(chunk);
  }, Math.round((FRAMES_PER_CHUNK / SAMPLE_RATE) * 1_000));

  const close = () => clearInterval(timer);
  res.on("close", close);
  res.on("error", close);
}

class SoundscapeControl {
  #current;
  #target;
  #start;
  #samplesLeft = 0;
  #samplesTotal = 1;

  constructor(initial) {
    this.#current = { ...initial };
    this.#target = { ...initial };
    this.#start = { ...initial };
  }

  snapshot() {
    return {
      current: { ...this.#current },
      target: { ...this.#target },
      transitionSamplesLeft: this.#samplesLeft,
    };
  }

  applyCommand(command) {
    if (!command || typeof command !== "object") {
      throw new Error("Command must be a JSON object");
    }

    const transitionMs = clamp(Math.trunc(toNumber(command.transitionMs, 900)), 0, 20_000);

    const nextTarget = {
      mood: validMood(command.mood) ? command.mood : this.#target.mood,
      intensity: clamp01(toNumber(command.intensity, this.#target.intensity)),
      warmth: clamp01(toNumber(command.warmth, this.#target.warmth)),
      sparkle: clamp01(toNumber(command.sparkle, this.#target.sparkle)),
      pulse: clamp01(toNumber(command.pulse, this.#target.pulse)),
      space: clamp01(toNumber(command.space, this.#target.space)),
    };

    this.#start = { ...this.#current };
    this.#target = nextTarget;
    this.#samplesTotal = Math.max(1, Math.floor((transitionMs / 1_000) * SAMPLE_RATE));
    this.#samplesLeft = this.#samplesTotal;

    return this.snapshot();
  }

  step(frames) {
    if (this.#samplesLeft <= 0) {
      this.#current = { ...this.#target };
      return { ...this.#current };
    }

    const consumed = Math.min(frames, this.#samplesLeft);
    this.#samplesLeft -= consumed;

    const progress = 1 - this.#samplesLeft / this.#samplesTotal;
    const eased = easeInOutCubic(progress);

    this.#current = {
      mood: eased < 0.5 ? this.#start.mood : this.#target.mood,
      intensity: mix(this.#start.intensity, this.#target.intensity, eased),
      warmth: mix(this.#start.warmth, this.#target.warmth, eased),
      sparkle: mix(this.#start.sparkle, this.#target.sparkle, eased),
      pulse: mix(this.#start.pulse, this.#target.pulse, eased),
      space: mix(this.#start.space, this.#target.space, eased),
    };

    return { ...this.#current };
  }
}

class ProceduralSynth {
  #phase = {
    padA: 0,
    padB: 0,
    bass: 0,
    lead: 0,
    kick: 0,
    lfo: 0,
  };

  #clockFrames = 0;
  #lowpass = 0;
  #delayBuffer = new Float32Array(Math.floor(SAMPLE_RATE * 0.7));
  #delayIdx = 0;

  constructor(getState) {
    this.getState = getState;
  }

  render(frames) {
    const state = this.getState();
    const profile = MOOD_PROFILES[state.mood] ?? MOOD_PROFILES.neutral;
    const out = Buffer.allocUnsafe(frames * 2);

    const secPerBeat = 60 / profile.tempoBpm;
    const progression = [0, 5, 3, 4];

    for (let i = 0; i < frames; i += 1) {
      const t = this.#clockFrames / SAMPLE_RATE;
      const beat = t / secPerBeat;
      const beatInBar = beat % 4;
      const bar = Math.floor(beat / 4);

      const chordDegree = progression[bar % progression.length] ?? 0;
      const scale = profile.scale;
      const root = semitone(profile.rootHz, scale[chordDegree % scale.length] ?? 0);

      const padA = this.#osc("triangle", "padA", root * 0.5);
      const padB = this.#osc("sine", "padB", root * 1.01);
      const pad = (padA * 0.26 + padB * 0.22) * (0.88 - state.intensity * 0.2);

      const bassEnv = 0.65 + 0.35 * Math.sin(2 * Math.PI * (beatInBar % 1));
      const bass = this.#osc("sine", "bass", root * 0.25) * (0.16 + state.warmth * 0.26) * bassEnv;

      const arpStep = Math.floor(beat * (2 + Math.floor(state.pulse * 2))) % scale.length;
      const leadHz = semitone(root, scale[arpStep] ?? 0) * (1 + state.sparkle * 0.005);
      const gate = 1 - ((beat * 2) % 1);
      const lead = this.#osc("saw", "lead", leadHz) * gate * (0.08 + state.intensity * 0.22 + state.sparkle * 0.1);

      const kickEnv = Math.exp(-12 * (beatInBar % 1));
      const kickFreq = 46 + state.pulse * 24;
      const kick = this.#osc("sine", "kick", kickFreq) * kickEnv * (0.08 + state.pulse * 0.22);

      const shimmer = (Math.random() * 2 - 1) * (0.004 + state.sparkle * 0.02);

      let dry = pad + bass + lead + kick + shimmer;

      const cutoff = 0.02 + profile.brightness * 0.16 + state.intensity * 0.12;
      this.#lowpass += (dry - this.#lowpass) * cutoff;
      dry = this.#lowpass;

      const delayLength = Math.floor(SAMPLE_RATE * (0.15 + state.space * 0.5));
      const read = (this.#delayIdx - delayLength + this.#delayBuffer.length) % this.#delayBuffer.length;
      const delayed = this.#delayBuffer[read] ?? 0;
      const wet = dry + delayed * (0.18 + state.space * 0.38);
      this.#delayBuffer[this.#delayIdx] = dry + delayed * 0.45;
      this.#delayIdx = (this.#delayIdx + 1) % this.#delayBuffer.length;

      const mastered = Math.tanh(wet * 1.5) * 0.85;
      out.writeInt16LE(floatToInt16(mastered), i * 2);

      this.#clockFrames += 1;
    }

    return out;
  }

  #osc(wave, phaseKey, hz) {
    const p = this.#phase[phaseKey] ?? 0;
    const next = (p + hz / SAMPLE_RATE) % 1;
    this.#phase[phaseKey] = next;

    switch (wave) {
      case "sine":
        return Math.sin(2 * Math.PI * next);
      case "triangle":
        return 2 * Math.abs(2 * next - 1) - 1;
      case "saw":
        return 2 * next - 1;
      default:
        return 0;
    }
  }
}

function ensureControl() {
  if (control !== null) {
    return control;
  }

  control = new SoundscapeControl({
    mood: "flow",
    intensity: 0.62,
    warmth: 0.58,
    sparkle: 0.38,
    pulse: 0.64,
    space: 0.4,
  });

  return control;
}

function mapAgentEventToCommand(event) {
  switch (event) {
    case "task.started":
      return { mood: "deep-focus", intensity: 0.63, pulse: 0.55, sparkle: 0.26, transitionMs: 900 };
    case "task.blocked":
      return { mood: "calming", intensity: 0.42, warmth: 0.7, space: 0.55, transitionMs: 1200 };
    case "task.completed":
      return { mood: "uplift", intensity: 0.82, pulse: 0.86, sparkle: 0.62, transitionMs: 700 };
    case "agent.idle":
      return { mood: "neutral", intensity: 0.3, pulse: 0.3, sparkle: 0.2, transitionMs: 1400 };
    default:
      return { mood: "flow", intensity: 0.6, transitionMs: 900 };
  }
}

function createStreamingWavHeader(sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(0x7fffffff, 4); // pseudo infinite length
  header.write("WAVE", 8);

  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);

  header.write("data", 36);
  header.writeUInt32LE(0x7fffffff - 44, 40);
  return header;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 64) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        resolve(text.length === 0 ? {} : JSON.parse(text));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function semitone(freq, offset) {
  return freq * 2 ** (offset / 12);
}

function floatToInt16(v) {
  const c = Math.max(-1, Math.min(1, v));
  return c < 0 ? Math.round(c * 0x8000) : Math.round(c * 0x7fff);
}

function validMood(mood) {
  return typeof mood === "string" && mood in MOOD_PROFILES;
}

function toNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function easeInOutCubic(t) {
  if (t < 0.5) {
    return 4 * t * t * t;
  }
  return 1 - ((-2 * t + 2) ** 3) / 2;
}

const HOME_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Beatly Procedural Soundscape</title>
  <style>
    :root {
      color-scheme: dark;
      --bg-a: #0c1019;
      --bg-b: #180f25;
      --card: rgba(255,255,255,0.08);
      --stroke: rgba(255,255,255,0.16);
      --text: #ecf2ff;
      --muted: #a9b8d4;
      --accent: #7c92ff;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color: var(--text);
      background:
        radial-gradient(1200px 700px at 10% -10%, #2b3f7e70, transparent),
        radial-gradient(1000px 700px at 90% 110%, #7228b255, transparent),
        linear-gradient(120deg, var(--bg-a), var(--bg-b));
      padding: 24px;
    }

    .wrap {
      max-width: 900px;
      margin: 0 auto;
      display: grid;
      gap: 18px;
    }

    .card {
      border: 1px solid var(--stroke);
      background: var(--card);
      border-radius: 16px;
      padding: 16px;
      backdrop-filter: blur(10px);
      box-shadow: 0 16px 36px rgba(0,0,0,0.28);
    }

    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0; color: var(--muted); }

    .moods { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }

    button {
      background: #ffffff16;
      border: 1px solid var(--stroke);
      color: var(--text);
      border-radius: 999px;
      padding: 8px 14px;
      cursor: pointer;
    }

    button:hover { border-color: #ffffff66; }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .control {
      display: grid;
      gap: 6px;
      border: 1px solid #ffffff1f;
      border-radius: 12px;
      padding: 10px;
      background: #00000022;
    }

    label { font-size: 13px; color: var(--muted); display: flex; justify-content: space-between; }
    input[type="range"] { width: 100%; accent-color: var(--accent); }

    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    audio { width: 100%; }
    pre { margin: 0; font-size: 12px; color: #d6e2ff; white-space: pre-wrap; }

    @media (max-width: 760px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>🎧 Beatly Procedural Soundscape</h1>
      <p>Live server-generated soundtrack. Control it as human or from an agent command.</p>
      <div class="row" style="margin-top: 12px">
        <audio id="audio" controls autoplay src="/audio"></audio>
      </div>
      <div class="moods" id="moods"></div>
    </div>

    <div class="card grid" id="sliders"></div>

    <div class="card">
      <div class="row">
        <button data-event="task.started">Agent: task.started</button>
        <button data-event="task.blocked">Agent: task.blocked</button>
        <button data-event="task.completed">Agent: task.completed</button>
        <button data-event="agent.idle">Agent: agent.idle</button>
      </div>
      <pre id="state" style="margin-top: 10px"></pre>
    </div>
  </div>

  <script>
    const moods = ["calming", "deep-focus", "flow", "uplift", "neutral"];
    const sliderDefs = [
      ["intensity", 0.62],
      ["warmth", 0.58],
      ["sparkle", 0.38],
      ["pulse", 0.64],
      ["space", 0.40],
    ];

    let selectedMood = "flow";
    const values = Object.fromEntries(sliderDefs);

    const moodWrap = document.getElementById("moods");
    const sliders = document.getElementById("sliders");
    const stateNode = document.getElementById("state");

    moods.forEach((mood) => {
      const b = document.createElement("button");
      b.textContent = mood;
      b.onclick = () => {
        selectedMood = mood;
        push({ mood });
      };
      moodWrap.appendChild(b);
    });

    sliderDefs.forEach(([name, initial]) => {
      const card = document.createElement("div");
      card.className = "control";
      card.innerHTML =
        '<label><span>' + name + '</span><strong id="v-' + name + '">' + initial.toFixed(2) + '</strong></label>' +
        '<input type="range" min="0" max="1" step="0.01" value="' + initial + '" id="' + name + '" />';
      sliders.appendChild(card);

      const input = card.querySelector("input");
      const valueNode = card.querySelector("strong");
      input.addEventListener("input", () => {
        const value = Number(input.value);
        values[name] = value;
        valueNode.textContent = value.toFixed(2);
        throttledPush();
      });
    });

    document.querySelectorAll("button[data-event]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const event = btn.getAttribute("data-event");
        await fetch("/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event }),
        });
        refreshState();
      });
    });

    let timer;
    function throttledPush() {
      clearTimeout(timer);
      timer = setTimeout(() => push({}), 120);
    }

    async function push(overrides) {
      const payload = {
        ...values,
        mood: selectedMood,
        transitionMs: 900,
        ...overrides,
      };

      await fetch("/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      refreshState();
    }

    async function refreshState() {
      const data = await fetch("/state").then((r) => r.json());
      stateNode.textContent = JSON.stringify(data, null, 2);
    }

    refreshState();
    setInterval(refreshState, 1000);
  </script>
</body>
</html>`;

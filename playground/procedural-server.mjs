import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distUrl = new URL("../dist/procedural/index.js", import.meta.url);
if (!existsSync(fileURLToPath(distUrl))) {
  console.error(
    "\n❌ dist/procedural/index.js not found. Run `npm run build` before starting the server.\n",
  );
  process.exit(1);
}

const {
  createProceduralEngine,
  MOOD_PALETTES,
  PROCEDURAL_STYLE_PROFILES,
} = await import(distUrl.href);

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAMES_PER_CHUNK = 4_800; // 100 ms @ 48 kHz
const CHUNK_INTERVAL_MS = Math.round((FRAMES_PER_CHUNK / SAMPLE_RATE) * 1000);
const VALID_MOODS = new Set(Object.keys(MOOD_PALETTES));
const VALID_STYLES = new Set(Object.keys(PROCEDURAL_STYLE_PROFILES));

const RANDOM_SCENES = [
  { genre: "Ambient drift", style: "ambient-wash", moods: ["calming", "neutral", "deep-focus"], intensity: [0.04, 0.28] },
  { genre: "Synthwave night drive", style: "synthwave-drive", moods: ["flow", "uplift", "deep-focus"], intensity: [0.52, 0.88] },
  { genre: "Dub techno chamber", style: "dub-tech", moods: ["deep-focus", "neutral", "flow"], intensity: [0.34, 0.72] },
  { genre: "Noir jazz lounge", style: "noir-waltz", moods: ["calming", "neutral", "deep-focus"], intensity: [0.18, 0.54] },
  { genre: "Arcade rush", style: "arcade-sprint", moods: ["uplift", "flow"], intensity: [0.72, 0.98] },
  { genre: "Cosmic drone field", style: "cosmic-drone", moods: ["neutral", "calming"], intensity: [0.03, 0.24] },
];

let engine = null;
let currentScene = randomScene();

function buildEngine(scene) {
  return createProceduralEngine({
    mood: scene.mood,
    style: scene.style,
    sampleRate: SAMPLE_RATE,
    intensity: scene.intensity,
    seed: scene.seed,
  });
}

function ensureEngine() {
  if (engine) return engine;
  engine = buildEngine(currentScene);
  return engine;
}

function replaceEngine(scene) {
  currentScene = {
    ...scene,
    intensity: clamp01(scene.intensity ?? 0.5),
    seed: (scene.seed ?? ((Math.random() * 0xffff_ffff) >>> 0)) >>> 0,
  };
  engine = buildEngine(currentScene);
  return engine;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/")      return sendHtml(res, HOME_HTML);
  if (req.method === "GET" && url.pathname === "/state") return sendJson(res, 200, snapshot());
  if (req.method === "GET" && url.pathname === "/audio") return streamAudio(res);

  if (req.method === "POST" && url.pathname === "/command") {
    try {
      const body = await readJsonBody(req);
      applyCommand(body);
      return sendJson(res, 200, { ok: true, state: snapshot() });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  }

  if (req.method === "POST" && url.pathname === "/randomize") {
    const scene = randomScene();
    replaceEngine(scene);
    return sendJson(res, 200, { ok: true, state: snapshot() });
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`🎧 Beatly  —  http://localhost:${port}`);
  console.log(`   audio:  http://localhost:${port}/audio   (${SAMPLE_RATE} Hz, ${CHANNELS}ch)`);
});

function streamAudio(res) {
  res.writeHead(200, {
    "Content-Type": "audio/wav",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(streamingWavHeader(SAMPLE_RATE, CHANNELS));
  const pcm = new Float32Array(FRAMES_PER_CHUNK * CHANNELS);
  const out = Buffer.allocUnsafe(FRAMES_PER_CHUNK * CHANNELS * 2);

  const tick = () => {
    const eng = ensureEngine();
    eng.renderInto(pcm, FRAMES_PER_CHUNK, CHANNELS);
    for (let i = 0; i < pcm.length; i += 1) {
      const v = pcm[i];
      const c = v < -1 ? -1 : v > 1 ? 1 : v;
      out.writeInt16LE(c < 0 ? Math.round(c * 0x8000) : Math.round(c * 0x7fff), i * 2);
    }
    res.write(out);
  };

  const timer = setInterval(tick, CHUNK_INTERVAL_MS);
  const close = () => clearInterval(timer);
  res.on("close", close);
  res.on("error", close);
}

function streamingWavHeader(sampleRate, channels) {
  const h = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  h.write("RIFF", 0);
  h.writeUInt32LE(0x7fffffff, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(0x7fffffff - 44, 40);
  return h;
}

function applyCommand(cmd) {
  if (!cmd || typeof cmd !== "object") throw new Error("Command must be a JSON object");
  if (cmd.randomize === true) {
    replaceEngine(randomScene());
    return;
  }
  const eng = ensureEngine();
  if (typeof cmd.mood === "string" && VALID_MOODS.has(cmd.mood)) {
    eng.setMood(cmd.mood);
    currentScene.mood = cmd.mood;
  }
  if (typeof cmd.style === "string" && VALID_STYLES.has(cmd.style)) {
    eng.setStyle(cmd.style);
    currentScene.style = cmd.style;
    currentScene.genre = PROCEDURAL_STYLE_PROFILES[cmd.style].label;
  }
  if (typeof cmd.intensity === "number" && Number.isFinite(cmd.intensity)) {
    const transitionMs = typeof cmd.transitionMs === "number" ? cmd.transitionMs : 180;
    eng.setIntensity(cmd.intensity, transitionMs);
    currentScene.intensity = clamp01(cmd.intensity);
  }
  if (typeof cmd.seed === "number" && Number.isFinite(cmd.seed)) {
    currentScene.seed = cmd.seed >>> 0;
    replaceEngine(currentScene);
  }
}

function randomScene() {
  const base = RANDOM_SCENES[(Math.random() * RANDOM_SCENES.length) | 0];
  const mood = base.moods[(Math.random() * base.moods.length) | 0];
  const intensity = lerp(base.intensity[0], base.intensity[1], Math.random());
  return {
    genre: base.genre,
    style: base.style,
    mood,
    intensity,
    seed: (Math.random() * 0xffff_ffff) >>> 0,
  };
}

function snapshot() {
  const state = ensureEngine().state;
  return {
    ...state,
    genre: currentScene.genre,
  };
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
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        resolve(text.length === 0 ? {} : JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const HOME_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Beatly</title>
  <style>
    :root {
      color-scheme: dark;
      --bg-a: #0a0d14;
      --bg-b: #120a1d;
      --card: rgba(255,255,255,0.06);
      --stroke: rgba(255,255,255,0.12);
      --text: #ecf2ff;
      --muted: #98a7c3;
      --accent: #8ea3ff;
      --accent-2: #8effd4;
      --accent-dim: #8ea3ff33;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color: var(--text);
      background:
        radial-gradient(900px 600px at 10% -10%, #2a3e7260, transparent),
        radial-gradient(900px 600px at 90% 110%, #5b1f9a44, transparent),
        linear-gradient(120deg, var(--bg-a), var(--bg-b));
      padding: 48px 24px;
      display: grid;
      place-items: center;
    }
    .wrap { width: 100%; max-width: 620px; display: grid; gap: 20px; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.02em; opacity: 0.9; }
    .subtitle { margin: 4px 0 0; color: var(--muted); font-size: 13px; }

    .toolbar {
      display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
    }
    button.primary, .moods button {
      background: transparent;
      border: 1px solid var(--stroke);
      color: var(--text);
      padding: 12px 14px;
      border-radius: 12px;
      font-size: 13px;
      letter-spacing: 0.02em;
      cursor: pointer;
      transition: background 120ms, border-color 120ms, transform 120ms;
    }
    button.primary {
      background: linear-gradient(180deg, #91a6ff30, #91a6ff18);
      border-color: #9eb0ff88;
      font-weight: 600;
    }
    button.primary:hover, .moods button:hover { border-color: #ffffff66; transform: translateY(-1px); }

    .hero {
      display: grid; gap: 12px;
      padding: 20px;
      border: 1px solid var(--stroke);
      border-radius: 16px;
      background: var(--card);
    }
    .genre {
      display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline;
    }
    .genre strong { font-size: 22px; color: var(--accent-2); }
    .genre small { color: var(--muted); }

    .moods { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
    .moods button.active {
      background: var(--accent-dim);
      border-color: var(--accent);
    }

    .intensity {
      display: grid; gap: 10px;
      padding: 18px 20px;
      border: 1px solid var(--stroke);
      border-radius: 14px;
      background: var(--card);
    }
    .intensity-head { display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); }
    .intensity-head strong { color: var(--text); font-weight: 600; }
    input[type="range"] { width: 100%; accent-color: var(--accent); }

    audio { width: 100%; border-radius: 999px; }

    .state {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px; color: var(--muted);
      display: flex; gap: 16px; flex-wrap: wrap;
      justify-content: center;
    }
    .state span strong { color: var(--text); font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <div>
      <h1>Beatly playground</h1>
      <p class="subtitle">Hit <strong>Random genre</strong> to rebuild the engine with a new style, mood, intensity, and seed.</p>
    </div>

    <div class="hero">
      <div class="genre">
        <div>
          <small>current scene</small><br />
          <strong id="genre">Synthwave drive</strong>
        </div>
        <div class="toolbar">
          <button class="primary" id="randomize">🎲 Random genre</button>
        </div>
      </div>
      <audio id="audio" controls autoplay src="/audio"></audio>
    </div>

    <div class="moods" id="moods"></div>

    <div class="intensity">
      <div class="intensity-head">
        <span>intensity</span>
        <strong id="intensity-value">0.50</strong>
      </div>
      <input type="range" id="intensity" min="0" max="1" step="0.01" value="0.5" />
    </div>

    <div class="state" id="state"></div>
  </div>

  <script>
    const MOODS = ["calming", "deep-focus", "flow", "uplift", "neutral"];
    let currentMood = "flow";
    let currentIntensity = 0.5;

    const audio = document.getElementById("audio");
    const genreNode = document.getElementById("genre");
    const moodsWrap = document.getElementById("moods");
    const intensity = document.getElementById("intensity");
    const intensityValue = document.getElementById("intensity-value");
    const stateNode = document.getElementById("state");

    function reloadAudio() {
      const wasPlaying = !audio.paused;
      audio.src = "/audio?t=" + Date.now();
      audio.load();
      if (wasPlaying) audio.play().catch(() => {});
    }

    MOODS.forEach((m) => {
      const b = document.createElement("button");
      b.textContent = m;
      b.dataset.mood = m;
      if (m === currentMood) b.classList.add("active");
      b.onclick = () => {
        currentMood = m;
        for (const el of moodsWrap.children) el.classList.toggle("active", el.dataset.mood === m);
        push();
      };
      moodsWrap.appendChild(b);
    });

    let pushTimer;
    intensity.addEventListener("input", () => {
      currentIntensity = Number(intensity.value);
      intensityValue.textContent = currentIntensity.toFixed(2);
      clearTimeout(pushTimer);
      pushTimer = setTimeout(push, 120);
    });

    document.getElementById("randomize").addEventListener("click", async () => {
      const r = await fetch("/randomize", { method: "POST" }).then((res) => res.json());
      syncFromState(r.state);
      reloadAudio();
    });

    async function push() {
      await fetch("/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mood: currentMood,
          intensity: currentIntensity,
          transitionMs: 220,
        }),
      });
    }

    function syncFromState(s) {
      if (!s) return;
      currentMood = s.mood;
      currentIntensity = Number(s.intensity ?? currentIntensity);
      intensity.value = currentIntensity.toFixed(2);
      intensityValue.textContent = currentIntensity.toFixed(2);
      genreNode.textContent = s.genre || s.styleLabel || s.style || "Unknown";
      for (const el of moodsWrap.children) el.classList.toggle("active", el.dataset.mood === currentMood);
      stateNode.innerHTML =
        '<span>mood <strong>' + s.mood + '</strong></span>' +
        '<span>style <strong>' + (s.styleLabel || s.style) + '</strong></span>' +
        '<span>bar <strong>' + s.bar + '</strong></span>' +
        '<span>tempo <strong>' + s.tempoBpm.toFixed(1) + '</strong> bpm</span>' +
        '<span>seed <strong>' + s.seed.toString(16) + '</strong></span>';
    }

    async function refreshState() {
      try {
        const s = await fetch("/state").then((r) => r.json());
        syncFromState(s);
      } catch {}
    }

    refreshState();
    setInterval(refreshState, 1000);
  </script>
</body>
</html>`;

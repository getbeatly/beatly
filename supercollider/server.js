// Node server: spawns scsynth, generates music, streams OSC bundles to it,
// and exposes a tiny HTTP API + static web UI.
//
// Run:  node server.js     then open http://localhost:8080

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import osc from 'osc';

import { PROFILES, GENRES, makeGenerator, resolveProfileId, splitProfileId, listProfileIds } from './music.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SC_PORT = 57110;
const HTTP_PORT = 8080;
const SYNTHDEFS_DIR = join(__dirname, 'synthdefs');

// Group ids — see build_synthdefs.scd header comment.
// IMPORTANT: voice-group ids and per-note ids must live in disjoint ranges,
// otherwise scsynth's auto-allocator (also ranged from ~1000) collides with
// our group ids and /g_new gets 'duplicate node ID'.
const GROUP = { CLEAR: 50, FX: 200, MASTER: 300 };
let currentVoicesGroup = 100000;
const nextVoicesGroupId = () => ++currentVoicesGroup;

// Persistent FX synth ids (so we can /n_free and /n_set them).
const FX_NODE = { REVERB: 90001, DELAY: 90002, MASTER: 90003 };

// ---------------- spawn scsynth ----------------
try {
  const r = spawnSync('ss', ['-lunp']);
  const line = String(r.stdout).split('\n').find((l) => l.includes(`:${SC_PORT} `));
  const pid = line && line.match(/pid=(\d+)/)?.[1];
  if (pid) {
    console.log(`! killing stale scsynth pid=${pid}`);
    process.kill(Number(pid), 'SIGKILL');
    await new Promise((r) => setTimeout(r, 300));
  }
} catch {}
console.log('▶ spawning scsynth...');
const sc = spawn(
  'scsynth',
  ['-u', String(SC_PORT), '-o', '2', '-i', '0'],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SC_JACK_DEFAULT_OUTPUTS: process.env.SC_JACK_DEFAULT_OUTPUTS
        ?? 'system:playback_1,system:playback_2',
    },
  }
);
// filter scsynth's stdout/stderr: hide the expected stale-bundle noise
function pipeFiltered(stream, out) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (/FAILURE IN SERVER \/s_new (Group \d+ not found|duplicate node ID)/.test(line)) continue;
      out.write(line + '\n');
    }
  });
}
pipeFiltered(sc.stdout, process.stdout);
pipeFiltered(sc.stderr, process.stderr);
sc.on('exit', (code) => { console.log(`scsynth exited (${code})`); process.exit(code ?? 0); });
process.on('SIGINT',  () => sc.kill('SIGINT'));
process.on('SIGTERM', () => sc.kill('SIGTERM'));

// ---------------- OSC client ----------------
const udp = new osc.UDPPort({
  localAddress: '127.0.0.1', localPort: 0,
  remoteAddress: '127.0.0.1', remotePort: SC_PORT,
  metadata: false,
});
udp.open();
await new Promise((res) => udp.once('ready', res));

udp.on('message', (m) => {
  if (m.address !== '/fail') return;
  // Expected: stale /s_new bundles targeting a freed voices group land
  // here after a profile switch. Drop them quietly.
  const [cmd, reason] = m.args ?? [];
  if (cmd === '/s_new' && /Group \d+ not found/.test(String(reason))) return;
  console.error('scsynth /fail:', m.args);
});

async function waitForServer(timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const handler = (msg) => { if (msg.address === '/status.reply') resolve(true); };
      udp.on('message', handler);
      udp.send({ address: '/status', args: [] });
      setTimeout(() => { udp.off('message', handler); resolve(false); }, 200);
    });
    if (ok) return true;
  }
  return false;
}
console.log('▶ waiting for scsynth...');
if (!(await waitForServer())) { console.error('scsynth did not respond'); process.exit(1); }
console.log('✓ scsynth ready');

// Load synthdefs
udp.send({ address: '/d_loadDir', args: [SYNTHDEFS_DIR] });
await new Promise((r) => setTimeout(r, 500));
console.log('✓ synthdefs loaded');

// ---------------- bus / group / FX setup ----------------
function send(address, ...args) { udp.send({ address, args }); }
function bundle(timeTagSecondsFromNow, packets) {
  udp.send({ timeTag: osc.timeTag(Math.max(0, timeTagSecondsFromNow)), packets });
}

// 1. Create static groups: CLEAR -> [voices inserted here] -> FX -> MASTER
send('/g_new', GROUP.CLEAR,  1, 0);
send('/g_new', GROUP.FX,     1, 0);
send('/g_new', GROUP.MASTER, 1, 0);

// 2. Initial voices group (between CLEAR and FX)
send('/g_new', currentVoicesGroup, 2, GROUP.FX);  // 2 = before FX

// 3. Bus clearer at head of CLEAR group (zeros send buses every block)
send('/s_new', 'sysClear', -1, 0, GROUP.CLEAR);

// 4. Reverb + ping-pong delay in FX group
spawnFx();

// 5. Master in MASTER group (final processing on 0,1)
send('/s_new', 'master', FX_NODE.MASTER, 0, GROUP.MASTER);

console.log('✓ FX chain up');

function spawnFx() {
  send('/s_new', 'reverb',    FX_NODE.REVERB, 0, GROUP.FX,
       'in', 4, 'out', 0, 'mix', 1.0, 'room', 0.85, 'damp', 0.4);
  send('/s_new', 'pingDelay', FX_NODE.DELAY,  1, GROUP.FX,
       'in', 6, 'out', 0, 'time', 0.375, 'fb', 0.5, 'mix', 0.6);
}

// quick audible self-test
send('/s_new', 'kick', -1, 0, currentVoicesGroup, 'amp', 0.85);

// ---------------- scheduler ----------------
let nodeId = 1000;
const allocId = () => ++nodeId;

let state = {
  profile: resolveProfileId('lofi') ?? 'lofi.classic',
  seed: Math.floor(Math.random() * 1e9),
  generator: null,
  startTime: 0,
  nextBarIndex: 0,
  running: true,
  lastAgentEvent: null,
};

function applyProfileFx(profile) {
  const beatSec = 60 / profile.bpm;
  const r = profile.reverb ?? { room: 0.85, damp: 0.4, mix: 0.7 };
  const d = profile.delay  ?? { beats: 0.375, fb: 0.5, mix: 0.5 };
  send('/n_set', FX_NODE.REVERB, 'room', r.room, 'damp', r.damp, 'mix', r.mix);
  send('/n_set', FX_NODE.DELAY,  'time', d.beats * beatSec, 'fb', d.fb, 'mix', d.mix);
  console.log(`  reverb room=${r.room} damp=${r.damp} mix=${r.mix}`);
  console.log(`  delay  ${(d.beats * beatSec).toFixed(3)}s fb=${d.fb} mix=${d.mix}`);
}

function hardResetAudio() {
  const oldGroup = currentVoicesGroup;
  const newGroup = nextVoicesGroupId();
  // Bundle everything so scsynth executes the swap atomically, in order.
  bundle(0, [
    { address: '/g_new',     args: [newGroup, 2, GROUP.FX] }, // 2 = before FX
    { address: '/g_freeAll', args: [oldGroup] },
    { address: '/n_free',    args: [oldGroup] },
    { address: '/n_free',    args: [FX_NODE.REVERB] },
    { address: '/n_free',    args: [FX_NODE.DELAY] },
    { address: '/s_new', args: ['reverb',    FX_NODE.REVERB, 0, GROUP.FX,
                                'in', 4, 'out', 0, 'mix', 1.0, 'room', 0.85, 'damp', 0.4] },
    { address: '/s_new', args: ['pingDelay', FX_NODE.DELAY,  1, GROUP.FX,
                                'in', 6, 'out', 0, 'time', 0.375, 'fb', 0.5, 'mix', 0.6] },
  ]);
}

let firstBuild = true;
function rebuildGenerator(now) {
  if (!firstBuild) hardResetAudio();   // skip on initial boot to avoid races
  firstBuild = false;
  state.generator = makeGenerator(state.profile, state.seed);
  state.startTime = now + 0.25;
  state.nextBarIndex = 0;
  applyProfileFx(state.generator.profile);
  console.log(`♪ profile=${state.profile} seed=${state.seed} bpm=${state.generator.bpm} group=${currentVoicesGroup}`);
}

const nowSec = () => Date.now() / 1000;
const LOOKAHEAD = 0.4;  // tight: limits how many stale events can leak on switch

function tick() {
  if (!state.running || !state.generator) return;
  const now = nowSec();
  const horizon = now + LOOKAHEAD;
  const barSec = (60 / state.generator.profile.bpm) * 4;

  while (true) {
    const barStart = state.startTime + state.nextBarIndex * barSec;
    if (barStart > horizon) break;

    const { events } = state.generator.nextBar();
    for (const ev of events) {
      sendNoteAt(barStart + ev.time, ev.def, ev.args);
    }
    state.nextBarIndex++;
  }
}

function sendNoteAt(absTime, defName, args) {
  // /s_new defName id addAction(0=head) target(group) [name val name val ...]
  const argList = [defName, allocId(), 0, currentVoicesGroup];
  for (const [k, v] of Object.entries(args)) argList.push(k, Number(v));
  bundle(absTime - nowSec(), [{ address: '/s_new', args: argList }]);
}

// init
rebuildGenerator(nowSec());
setInterval(tick, 100);

// ---------------- HTTP API + static UI ----------------
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
};

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

function applyControl(body) {
  let dirty = false;
  // Accept either a full "genre.variant" id, a short "genre", or separate
  // `genre` + `variant` fields. Always normalize to a full "genre.variant".
  const requestedProfile = body.profile ?? body.genre ?? null;
  if (requestedProfile) {
    let variant = body.variant;
    // If a genre was selected without an explicit variant, pick one at random.
    if (!variant && body.genre && !body.profile) {
      const genre = GENRES[body.genre];
      if (genre && genre.variantIds?.length) {
        variant = genre.variantIds[Math.floor(Math.random() * genre.variantIds.length)];
      }
    }
    const resolved = resolveProfileId(requestedProfile, variant);
    if (resolved && PROFILES[resolved]) {
      state.profile = resolved; dirty = true;
    }
  } else if (body.variant && state.profile) {
    const { genreId } = splitProfileId(state.profile);
    const resolved = resolveProfileId(genreId, body.variant);
    if (resolved && PROFILES[resolved]) {
      state.profile = resolved; dirty = true;
    }
  }
  if (body.seed !== undefined) {
    state.seed = body.seed >>> 0; dirty = true;
  }
  if (body.randomize) {
    state.seed = Math.floor(Math.random() * 1e9); dirty = true;
  }
  if (body.running !== undefined) state.running = !!body.running;
  if (dirty) {
    rebuildGenerator(nowSec());
  }

  const { genreId, variantId } = splitProfileId(state.profile);
  return {
    profile: state.profile,
    genre: genreId,
    variant: variantId,
    seed: state.seed,
    bpm: state.generator?.profile.bpm ?? null,
    bar: state.nextBarIndex,
    running: state.running,
    profiles: listProfileIds(),
    genres: Object.values(GENRES).map((g) => ({
      id: g.id,
      defaultVariant: g.defaultVariant,
      variants: g.variantIds,
    })),
    lastAgentEvent: state.lastAgentEvent,
  };
}

function controlFromAgentEvent(event, seed) {
  switch (event) {
    case 'task.started':
      return { profile: 'deepFocus', running: true, seed };
    case 'task.blocked':
      return { profile: 'calming', running: true, seed };
    case 'task.completed':
      return { profile: 'uplift', running: true, seed };
    case 'agent.idle':
      return { profile: 'ambient', running: true, seed };
    case 'agent.error':
      return { profile: 'dub', running: true, seed };
    case 'agent.breakthrough':
      return { profile: 'techno', running: true, seed };
    case 'session.stop':
      return { running: false, seed };
    default:
      return null;
  }
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(applyControl({})));
      return;
    }
    if ((url.pathname === '/api/control' || url.pathname === '/api/command') && req.method === 'POST') {
      const body = await readJsonBody(req);
      const nextState = applyControl(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, state: nextState }));
      return;
    }
    if ((url.pathname === '/api/agent' || url.pathname === '/api/event') && req.method === 'POST') {
      const body = await readJsonBody(req);
      const event = body.event ?? body.type;
      const control = controlFromAgentEvent(event, body.seed);
      if (control === null) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Unknown agent event: ${event}` }));
        return;
      }

      state.lastAgentEvent = event;
      const nextState = applyControl(control);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, event, state: nextState }));
      return;
    }
    if (url.pathname === '/api/panic' && req.method === 'POST') {
      hardResetAudio();
      res.writeHead(200); res.end('ok');
      return;
    }

    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = join(__dirname, 'public', path);
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': STATIC_TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    res.writeHead(404); res.end(String(e.message || e));
  }
});

http.listen(HTTP_PORT, () => console.log(`▶ web UI:  http://localhost:${HTTP_PORT}`));

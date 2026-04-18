import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const skillDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = findRuntimeRoot(skillDir);

const { BeatlyConductor } = await import(pathToFileURL(path.join(runtimeRoot, "dist/index.js")).href);
const { SuperColliderHelloAdapter } = await import(pathToFileURL(path.join(runtimeRoot, "dist/adapters.js")).href);
const { createBeatlySkill } = await import(pathToFileURL(path.join(runtimeRoot, "dist/skill.js")).href);

const [mode, ...args] = process.argv.slice(2);

const adapter = new SuperColliderHelloAdapter({
  autostart: true,
  serverCwd: path.join(runtimeRoot, "supercollider"),
});
await adapter.ensureReady();

if (mode === "state") {
  console.log(JSON.stringify(await adapter.getState(), null, 2));
  process.exit(0);
}

const conductor = new BeatlyConductor({ adapters: [adapter] });
const skill = createBeatlySkill(conductor);
await skill.start({ agentId: "pi-skill", sessionId: "pi-skill", running: true });

if (mode === "event") {
  const event = args[0];
  if (!event) {
    throw new Error("Missing event");
  }
  console.log(JSON.stringify(await skill.handleEvent({ type: event, timestamp: new Date() }), null, 2));
  process.exit(0);
}

if (mode === "update") {
  const [status, summary = "", focus = "", cognitiveLoad = "", energy = ""] = args;
  if (!status) {
    throw new Error("Missing status");
  }

  const signal = {};
  if (focus !== "") signal.focus = Number(focus);
  if (cognitiveLoad !== "") signal.cognitiveLoad = Number(cognitiveLoad);
  if (energy !== "") signal.energy = Number(energy);

  console.log(JSON.stringify(await skill.handleUpdate({
    type: "agent.update",
    status,
    summary: summary || undefined,
    signal,
    timestamp: new Date(),
  }), null, 2));
  process.exit(0);
}

if (mode === "override") {
  const [genre, running = "true", seed = ""] = args;
  if (!genre) {
    throw new Error("Missing genre");
  }
  console.log(JSON.stringify(await skill.override({
    genre,
    running: running !== "false",
    seed: seed === "" ? undefined : Number(seed),
    reason: "pi-skill.override",
  }), null, 2));
  process.exit(0);
}

throw new Error(`Unknown mode: ${mode}`);

function findRuntimeRoot(startDir) {
  const candidates = [];
  let current = startDir;

  while (true) {
    candidates.push(current, path.join(current, "runtime"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, "dist", "index.js")) &&
      existsSync(path.join(candidate, "supercollider", "server.js"))
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Could not locate Beatly runtime from ${startDir}. Expected dist/ and supercollider/ in an ancestor or runtime/ directory.`,
  );
}

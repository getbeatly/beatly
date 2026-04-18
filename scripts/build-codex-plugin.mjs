import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "codex-plugin");
const pluginManifestDir = path.join(pluginRoot, ".codex-plugin");

buildTypescript();
preparePluginRoot();
copyRuntime();
writePluginManifest();
writePluginPackageJson();
installRuntimeDependencies();

console.log(`Built Codex plugin at ${pluginRoot}`);

function buildTypescript() {
  execFileSync("npm", ["run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function preparePluginRoot() {
  mkdirSync(pluginManifestDir, { recursive: true });

  for (const entry of ["dist", "supercollider", "skills", "node_modules", "package.json", "package-lock.json", "LICENSE"]) {
    rmIfExists(path.join(pluginRoot, entry));
  }
}

function copyRuntime() {
  copyDir(path.join(repoRoot, "dist"), path.join(pluginRoot, "dist"));
  copyDir(path.join(repoRoot, "supercollider"), path.join(pluginRoot, "supercollider"));
  copyDir(path.join(repoRoot, "skills"), path.join(pluginRoot, "skills"));
  cpSync(path.join(repoRoot, "LICENSE"), path.join(pluginRoot, "LICENSE"));
}

function writePluginManifest() {
  const manifest = {
    name: "beatly",
    version: "0.1.0",
    description: "Live soundtrack controls for coding agents. Requires system-wide SuperCollider.",
    author: {
      name: "Beatly",
      url: "https://beatly.dev",
    },
    homepage: "https://beatly.dev",
    repository: "https://github.com/getbeatly/beatly",
    license: "MIT",
    keywords: ["beatly", "music", "agents", "supercollider", "codex-plugin"],
    skills: "./skills/",
    interface: {
      displayName: "Beatly",
      shortDescription: "Live soundtrack controls for coding agents",
      longDescription:
        "Control Beatly playback, agent-reactive soundtrack updates, and the local jukebox from Codex. Requires system-wide SuperCollider with scsynth and sclang on PATH.",
      developerName: "Beatly",
      category: "Productivity",
      capabilities: ["Read", "Write"],
      websiteURL: "https://beatly.dev",
      brandColor: "#FF2E88",
      defaultPrompt: [
        "Start Beatly and play something warm.",
        "Switch Beatly to a more energetic genre.",
        "Show me the Beatly state and current playback.",
      ],
    },
  };

  writeFileSync(path.join(pluginManifestDir, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writePluginPackageJson() {
  const pkg = {
    name: "beatly-codex-plugin-runtime",
    private: true,
    type: "module",
    dependencies: {
      osc: "^2.4.5",
    },
  };

  writeFileSync(path.join(pluginRoot, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
}

function installRuntimeDependencies() {
  execFileSync("npm", ["install", "--omit=dev"], {
    cwd: pluginRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function copyDir(from, to) {
  if (!existsSync(from)) {
    throw new Error(`Missing required path: ${from}`);
  }
  cpSync(from, to, { recursive: true });
}

function rmIfExists(target) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
}

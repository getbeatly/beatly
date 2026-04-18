import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(repoRoot, ".build", "distributions");
const target = parseTarget(process.argv.slice(2));
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

buildTypescript();
prepareBuildRoot(target);

if (target === "all" || target === "codex") {
  buildCodexPlugin();
}

if (target === "all" || target === "claude-code") {
  buildClaudeCodeBundle();
}

if (target === "all" || target === "pi") {
  buildPiPackage();
}

console.log(`Built Beatly distributions in ${buildRoot}`);

function parseTarget(args) {
  const arg = args.find((entry) => entry.startsWith("--target="));
  if (!arg) return "all";
  const value = arg.slice("--target=".length);
  if (!["all", "codex", "claude-code", "pi"].includes(value)) {
    throw new Error(`Unknown target: ${value}`);
  }
  return value;
}

function buildTypescript() {
  execFileSync("npm", ["run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function prepareBuildRoot(selectedTarget) {
  mkdirSync(buildRoot, { recursive: true });

  if (selectedTarget === "all") {
    rmIfExists(buildRoot);
    mkdirSync(buildRoot, { recursive: true });
    return;
  }

  rmIfExists(path.join(buildRoot, selectedTarget));
}

function buildCodexPlugin() {
  const pluginRoot = path.join(buildRoot, "codex", "beatly");
  mkdirSync(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  assembleRuntimeBundle({ root: pluginRoot, mode: "root" });

  writeFileSync(
    path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    `${JSON.stringify(createCodexPluginManifest(), null, 2)}\n`,
  );

  writeFileSync(
    path.join(pluginRoot, "README.md"),
    [
      "# Beatly Codex plugin",
      "",
      "Built from the main Beatly repo.",
      "",
      "Install with a Codex marketplace entry that points to this plugin directory.",
      "",
      "Hard dependency:",
      "",
      "- SuperCollider installed system-wide",
      "- `scsynth` on `PATH`",
      "- `sclang` on `PATH`",
      "",
    ].join("\n"),
  );
}

function buildClaudeCodeBundle() {
  const bundleRoot = path.join(buildRoot, "claude-code", "beatly");
  assembleRuntimeBundle({ root: bundleRoot, mode: "skill-runtime" });

  writeFileSync(
    path.join(bundleRoot, "INSTALL.md"),
    [
      "# Beatly for Claude Code",
      "",
      "This bundle is built from the main Beatly repo.",
      "",
      "Suggested install:",
      "",
      "```bash",
      "mkdir -p ~/.claude/skills",
      `ln -s ${bundleRoot} ~/.claude/skills/beatly`,
      "```",
      "",
      "Hard dependency:",
      "",
      "- SuperCollider installed system-wide",
      "- `scsynth` on `PATH`",
      "- `sclang` on `PATH`",
      "",
    ].join("\n"),
  );
}

function buildPiPackage() {
  const outDir = path.join(buildRoot, "pi");
  mkdirSync(outDir, { recursive: true });
  execFileSync("npm", ["pack", "--pack-destination", outDir], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function assembleRuntimeBundle({ root, mode }) {
  mkdirSync(root, { recursive: true });
  rmIfExists(path.join(root, "dist"));
  rmIfExists(path.join(root, "supercollider"));
  rmIfExists(path.join(root, "skills"));
  rmIfExists(path.join(root, "runtime"));
  rmIfExists(path.join(root, "node_modules"));
  rmIfExists(path.join(root, "package.json"));
  rmIfExists(path.join(root, "package-lock.json"));
  rmIfExists(path.join(root, "LICENSE"));

  if (mode === "root") {
    copyDir(path.join(repoRoot, "dist"), path.join(root, "dist"));
    copyDir(path.join(repoRoot, "supercollider"), path.join(root, "supercollider"));
    copyDir(path.join(repoRoot, "skills"), path.join(root, "skills"));
    installRuntimeDependencies(root);
  } else if (mode === "skill-runtime") {
    copyDir(path.join(repoRoot, "skills", "beatly"), root);
    copyDir(path.join(repoRoot, "dist"), path.join(root, "runtime", "dist"));
    copyDir(path.join(repoRoot, "supercollider"), path.join(root, "runtime", "supercollider"));
    installRuntimeDependencies(path.join(root, "runtime"));
  } else {
    throw new Error(`Unknown bundle mode: ${mode}`);
  }

  cpSync(path.join(repoRoot, "LICENSE"), path.join(root, "LICENSE"));
}

function installRuntimeDependencies(targetRoot) {
  writeFileSync(
    path.join(targetRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "beatly-runtime-bundle",
        private: true,
        type: "module",
        dependencies: pkg.dependencies,
      },
      null,
      2,
    )}\n`,
  );

  execFileSync("npm", ["install", "--omit=dev"], {
    cwd: targetRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function createCodexPluginManifest() {
  return {
    name: "beatly",
    version: pkg.version,
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
}

function copyDir(from, to) {
  if (!existsSync(from)) {
    throw new Error(`Missing required path: ${from}`);
  }
  cpSync(from, to, { recursive: true });
}

function rmIfExists(targetPath) {
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }
}

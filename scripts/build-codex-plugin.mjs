import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

execFileSync("node", ["scripts/build-distributions.mjs", "--target=codex"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

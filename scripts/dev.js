import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const solverUrl = "http://127.0.0.1:8787/health";
const children = new Set();
let exiting = false;

async function solverIsRunning() {
  try {
    const response = await fetch(solverUrl, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function startNode(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function shutdown(exitCode = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(exitCode), 200).unref();
}

const existingSolver = await solverIsRunning();
if (existingSolver) {
  console.log("Solver API is already running on http://127.0.0.1:8787");
  console.log(`DEEPSEEK_API_KEY exists: ${Boolean(existingSolver.apiKeyConfigured)}`);
  if (!existingSolver.apiKeyConfigured) {
    console.warn("The existing solver has no DeepSeek API Key. Save quiz-app/.env, run npm run diagnose:env, then restart the solver service.");
  }
} else {
  const solver = startNode(resolve(projectRoot, "server", "solverServer.js"));
  solver.once("exit", (code) => {
    if (!exiting && code !== 0) {
      console.error("Solver API stopped unexpectedly. The website can continue, but AI completion is unavailable.");
    }
  });
}

const vite = startNode(
  resolve(projectRoot, "node_modules", "vite", "bin", "vite.js"),
  process.argv.slice(2),
);
vite.once("exit", (code) => shutdown(code ?? 0));

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));


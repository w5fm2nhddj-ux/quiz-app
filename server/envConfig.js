import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";

export function createDeepSeekEnvironmentLoader(projectRoot, options = {}) {
  const targetEnv = options.env ?? process.env;
  const loadDotenv = options.configImpl ?? config;
  const fileExists = options.existsImpl ?? existsSync;
  const candidates = [
    { label: "quiz-app/.env", path: resolve(projectRoot, ".env") },
    { label: "../.env", path: resolve(dirname(projectRoot), ".env") },
  ];
  const inheritedKey = String(targetEnv.DEEPSEEK_API_KEY ?? "").trim();
  let loadedFromFile = false;

  return function refreshDeepSeekEnvironment() {
    const attempts = [];
    let selected = null;
    let selectedKey = "";

    for (const candidate of candidates) {
      const isolatedEnv = {};
      const exists = fileExists(candidate.path);
      const result = exists
        ? loadDotenv({ path: candidate.path, quiet: true, processEnv: isolatedEnv })
        : { parsed: undefined };
      const value = String(isolatedEnv.DEEPSEEK_API_KEY ?? "").trim();
      attempts.push({
        file: candidate.label,
        exists,
        loaded: exists && !result.error,
        hasKey: Boolean(value),
      });
      if (!selected && value) {
        selected = candidate.label;
        selectedKey = value;
      }
    }

    if (selectedKey) {
      targetEnv.DEEPSEEK_API_KEY = selectedKey;
      loadedFromFile = true;
    } else if (inheritedKey) {
      targetEnv.DEEPSEEK_API_KEY = inheritedKey;
      loadedFromFile = false;
      selected = "process environment";
    } else if (loadedFromFile) {
      delete targetEnv.DEEPSEEK_API_KEY;
      loadedFromFile = false;
    }

    const activeKey = String(targetEnv.DEEPSEEK_API_KEY ?? "").trim();
    return {
      loaded: attempts.some((attempt) => attempt.loaded),
      source: selected,
      keyExists: Boolean(activeKey),
      keyLength: activeKey.length,
      attempts,
    };
  };
}


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
  const managedKeys = [
    "DEEPSEEK_API_KEY",
    "AI_ADMIN_PASSWORD",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const inheritedValues = Object.fromEntries(
    managedKeys.map((key) => [key, String(targetEnv[key] ?? "").trim()]),
  );
  const loadedFromFile = Object.fromEntries(managedKeys.map((key) => [key, false]));

  return function refreshDeepSeekEnvironment() {
    const attempts = [];
    const selectedValues = Object.fromEntries(managedKeys.map((key) => [key, ""]));
    const selectedSources = Object.fromEntries(managedKeys.map((key) => [key, null]));

    for (const candidate of candidates) {
      const isolatedEnv = {};
      const exists = fileExists(candidate.path);
      const result = exists
        ? loadDotenv({ path: candidate.path, quiet: true, processEnv: isolatedEnv })
        : { parsed: undefined };
      const values = Object.fromEntries(
        managedKeys.map((key) => [key, String(isolatedEnv[key] ?? "").trim()]),
      );
      attempts.push({
        file: candidate.label,
        exists,
        loaded: exists && !result.error,
        hasKey: Boolean(values.DEEPSEEK_API_KEY),
        hasAdminPassword: Boolean(values.AI_ADMIN_PASSWORD),
        hasSupabaseUrl: Boolean(values.SUPABASE_URL),
        hasSupabaseServiceRoleKey: Boolean(values.SUPABASE_SERVICE_ROLE_KEY),
      });
      for (const key of managedKeys) {
        if (!selectedValues[key] && values[key]) {
          selectedValues[key] = values[key];
          selectedSources[key] = candidate.label;
        }
      }
    }

    for (const key of managedKeys) {
      if (selectedValues[key]) {
        targetEnv[key] = selectedValues[key];
        loadedFromFile[key] = true;
      } else if (inheritedValues[key]) {
        targetEnv[key] = inheritedValues[key];
        loadedFromFile[key] = false;
        selectedSources[key] = "process environment";
      } else if (loadedFromFile[key]) {
        delete targetEnv[key];
        loadedFromFile[key] = false;
      }
    }

    const activeKey = String(targetEnv.DEEPSEEK_API_KEY ?? "").trim();
    const activeAdminPassword = String(targetEnv.AI_ADMIN_PASSWORD ?? "").trim();
    const activeSupabaseUrl = String(targetEnv.SUPABASE_URL ?? "").trim();
    const activeSupabaseServiceRoleKey = String(targetEnv.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
    return {
      loaded: attempts.some((attempt) => attempt.loaded),
      source: selectedSources.DEEPSEEK_API_KEY,
      keyExists: Boolean(activeKey),
      keyLength: activeKey.length,
      adminPasswordConfigured: Boolean(activeAdminPassword),
      adminPasswordSource: selectedSources.AI_ADMIN_PASSWORD,
      questionCacheConfigured: Boolean(activeSupabaseUrl && activeSupabaseServiceRoleKey),
      questionCacheSource: selectedSources.SUPABASE_URL || selectedSources.SUPABASE_SERVICE_ROLE_KEY,
      attempts,
    };
  };
}


import assert from "node:assert/strict";
import { createDeepSeekEnvironmentLoader } from "../server/envConfig.js";

let projectKey = "mock-project-key";
let parentKey = "mock-parent-key";
let projectAdminPassword = "mock-project-admin";
let parentAdminPassword = "mock-parent-admin";
let projectSupabaseUrl = "https://project.example.invalid";
let projectSupabaseServiceRoleKey = "project-service-role-placeholder";
const env = {};
const loader = createDeepSeekEnvironmentLoader("D:\\workspace\\quiz-app", {
  env,
  existsImpl: () => true,
  configImpl({ path, processEnv }) {
    const isProjectFile = String(path).includes("quiz-app\\.env");
    const value = isProjectFile ? projectKey : parentKey;
    if (value) processEnv.DEEPSEEK_API_KEY = value;
    const adminPassword = isProjectFile ? projectAdminPassword : parentAdminPassword;
    if (adminPassword) processEnv.AI_ADMIN_PASSWORD = adminPassword;
    const supabaseUrl = isProjectFile ? projectSupabaseUrl : "";
    const supabaseServiceRoleKey = isProjectFile ? projectSupabaseServiceRoleKey : "";
    if (supabaseUrl) processEnv.SUPABASE_URL = supabaseUrl;
    if (supabaseServiceRoleKey) processEnv.SUPABASE_SERVICE_ROLE_KEY = supabaseServiceRoleKey;
    return { parsed: {
      DEEPSEEK_API_KEY: value,
      AI_ADMIN_PASSWORD: adminPassword,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
    } };
  },
});

let status = loader();
assert.equal(status.keyExists, true);
assert.equal(status.keyLength, projectKey.length);
assert.equal(status.source, "quiz-app/.env", "项目根目录 .env 必须优先");
assert.equal(status.adminPasswordConfigured, true);
assert.equal(status.adminPasswordSource, "quiz-app/.env");
assert.equal(env.AI_ADMIN_PASSWORD, projectAdminPassword);
assert.equal(status.questionCacheConfigured, true);
assert.equal(env.SUPABASE_URL, projectSupabaseUrl);
assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, projectSupabaseServiceRoleKey);

projectKey = "updated-key";
projectAdminPassword = "updated-admin-password";
status = loader();
assert.equal(env.DEEPSEEK_API_KEY, "updated-key", "保存 .env 后应能动态重新加载");
assert.equal(env.AI_ADMIN_PASSWORD, "updated-admin-password", "管理员密码应从项目根目录 .env 动态重新加载");

projectKey = "";
projectAdminPassword = "";
status = loader();
assert.equal(status.source, "../.env", "项目 .env 没有 Key 时才回退到上级目录");
assert.equal(env.DEEPSEEK_API_KEY, parentKey);
assert.equal(status.adminPasswordSource, "../.env", "管理员密码也应回退到上级 .env");
assert.equal(env.AI_ADMIN_PASSWORD, parentAdminPassword);

const inheritedEnv = { DEEPSEEK_API_KEY: "inherited-key" };
const inheritedLoader = createDeepSeekEnvironmentLoader("D:\\workspace\\quiz-app", {
  env: inheritedEnv,
  existsImpl: () => false,
});
const inheritedStatus = inheritedLoader();
assert.equal(inheritedStatus.source, "process environment");
assert.equal(inheritedStatus.keyLength, "inherited-key".length);

const inheritedAdminEnv = { AI_ADMIN_PASSWORD: "inherited-admin-password" };
const inheritedAdminLoader = createDeepSeekEnvironmentLoader("D:\\workspace\\quiz-app", {
  env: inheritedAdminEnv,
  existsImpl: () => false,
});
const inheritedAdminStatus = inheritedAdminLoader();
assert.equal(inheritedAdminStatus.adminPasswordConfigured, true);
assert.equal(inheritedAdminStatus.adminPasswordSource, "process environment");

console.log("Environment loader tests passed: project priority, parent fallback, reload and safe diagnostics verified.");


import assert from "node:assert/strict";
import { createDeepSeekEnvironmentLoader } from "../server/envConfig.js";

let projectKey = "mock-project-key";
let parentKey = "mock-parent-key";
const env = {};
const loader = createDeepSeekEnvironmentLoader("D:\\workspace\\quiz-app", {
  env,
  existsImpl: () => true,
  configImpl({ path, processEnv }) {
    const isProjectFile = String(path).includes("quiz-app\\.env");
    const value = isProjectFile ? projectKey : parentKey;
    if (value) processEnv.DEEPSEEK_API_KEY = value;
    return { parsed: value ? { DEEPSEEK_API_KEY: value } : {} };
  },
});

let status = loader();
assert.equal(status.keyExists, true);
assert.equal(status.keyLength, projectKey.length);
assert.equal(status.source, "quiz-app/.env", "项目根目录 .env 必须优先");

projectKey = "updated-key";
status = loader();
assert.equal(env.DEEPSEEK_API_KEY, "updated-key", "保存 .env 后应能动态重新加载");

projectKey = "";
status = loader();
assert.equal(status.source, "../.env", "项目 .env 没有 Key 时才回退到上级目录");
assert.equal(env.DEEPSEEK_API_KEY, parentKey);

const inheritedEnv = { DEEPSEEK_API_KEY: "inherited-key" };
const inheritedLoader = createDeepSeekEnvironmentLoader("D:\\workspace\\quiz-app", {
  env: inheritedEnv,
  existsImpl: () => false,
});
const inheritedStatus = inheritedLoader();
assert.equal(inheritedStatus.source, "process environment");
assert.equal(inheritedStatus.keyLength, "inherited-key".length);

console.log("Environment loader tests passed: project priority, parent fallback, reload and safe diagnostics verified.");


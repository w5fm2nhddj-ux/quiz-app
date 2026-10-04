import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeepSeekEnvironmentLoader } from "../server/envConfig.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loadEnvironment = createDeepSeekEnvironmentLoader(projectRoot);
const status = loadEnvironment();

// 安全诊断：只显示是否存在和长度，绝不输出 Key 内容。
console.log(`DEEPSEEK_API_KEY exists: ${status.keyExists}`);
console.log(`DEEPSEEK_API_KEY length: ${status.keyLength}`);
console.log(`cwd: ${process.cwd()}`);


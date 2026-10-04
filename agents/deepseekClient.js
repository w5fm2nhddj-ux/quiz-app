import OpenAI from "openai";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-flash";

let sharedClient;
let sharedApiKey;

export function getDeepSeekClient() {
  if (!process.env.DEEPSEEK_API_KEY) {
    const error = new Error("服务器没有配置 DEEPSEEK_API_KEY");
    error.code = "DEEPSEEK_API_KEY_MISSING";
    throw error;
  }
  if (!sharedClient || sharedApiKey !== process.env.DEEPSEEK_API_KEY) {
    sharedApiKey = process.env.DEEPSEEK_API_KEY;
    sharedClient = new OpenAI({
      apiKey: sharedApiKey,
      baseURL: DEEPSEEK_BASE_URL,
      timeout: 30_000,
      // 重试由题目队列统一控制，避免 SDK 和业务层叠加重试。
      maxRetries: 0,
    });
  }
  return sharedClient;
}

export function parseJsonContent(content) {
  if (typeof content !== "string" || !content.trim()) {
    const error = new Error("DeepSeek 返回了空内容");
    error.code = "EMPTY_MODEL_OUTPUT";
    throw error;
  }
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch (cause) {
    const error = new Error("DeepSeek 返回的 JSON 无法解析", { cause });
    error.code = "INVALID_MODEL_JSON";
    throw error;
  }
}


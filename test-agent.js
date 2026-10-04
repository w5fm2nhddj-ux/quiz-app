import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processQuizImport } from "./agents/mainAgent.js";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// 优先加载 quiz-app/.env；兼容当前工作区把 .env 放在 quiz-app 上一级的情况。
config({ path: resolve(projectRoot, ".env"), quiet: true });
if (!process.env.DEEPSEEK_API_KEY) {
  config({ path: resolve(projectRoot, "..", ".env"), quiet: true });
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error("没有找到 DEEPSEEK_API_KEY，请将它写入 quiz-app/.env 后重试。");
  }

  const result = await processQuizImport(`
请解析下面两道题。第一题保留原答案，第二题缺少答案时再交给解题 Subagent：

1. 股指期货属于以下哪类金融工具？
A. 股票
B. 金融衍生品
C. 债券
D. 基金

答案：B
解析：股指期货属于金融衍生工具。

2. 沪深300股指期货的标的指数是什么？
A. 上证50指数
B. 中证500指数
C. 沪深300指数
D. 科创50指数
    `);

  console.log("AI 服务：DeepSeek deepseek-flash");
  console.log("结构化结果：");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Agent 测试失败：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

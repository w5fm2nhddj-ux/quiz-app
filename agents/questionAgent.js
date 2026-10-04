import { z } from "zod";
import { DEEPSEEK_MODEL, getDeepSeekClient, parseJsonContent } from "./deepseekClient.js";

// 单道题的统一结构。后续写入题库前，可以直接映射到前端的 ImportedQuestion。
export const questionSchema = z.object({
  id: z.string().describe("题目编号；原文没有编号时返回空字符串"),
  question: z.string().describe("完整题干，不包含题号和选项"),
  type: z
    .enum(["single", "multiple", "true_false", "fill", "short_answer"])
    .describe("题型"),
  options: z.array(
    z.object({
      id: z.string().describe("选项编号，例如 A"),
      text: z.string().describe("选项内容"),
    }),
  ),
  answer: z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]),
  explanation: z.string().describe("答案解析；原文没有时返回空字符串"),
  knowledgePoints: z.array(z.string()).describe("知识点；无法判断时返回空数组"),
  source: z.string().describe("题目来源；无法判断时返回空字符串"),
  answerSource: z.enum(["source", "missing"]),
  confidence: z.null(),
  needsReview: z.boolean(),
});

export const questionParseResultSchema = z.object({
  questions: z.array(questionSchema),
});

export const questionParserSystemPrompt = `
你是刷题网站的题库解析 Subagent。

你的唯一任务是把用户提供的题库内容整理成结构化题目：
1. 保留题目原始顺序。
2. 识别题干、选项、答案和解析。
3. 判断题型：single、multiple、true_false、fill 或 short_answer。
4. 多选答案使用字符串数组，例如 ["A", "C"]。
5. 判断题答案使用 true 或 false，选项整理为 A=正确、B=错误。
6. 提取简短、明确的知识点；无法判断时返回空数组。
7. 原文没有答案时 answer 必须返回 null，answerSource 返回 missing，needsReview 返回 true；绝对不要代替 solver 解题。
8. 原文有答案时原样保留，answerSource 返回 source；不得覆盖或推测已有答案。
9. 原文没有解析时 explanation 返回空字符串，不要编造原文中不存在的事实。
10. confidence 固定返回 null；无法可靠识别的内容不要硬猜。

严格按照结构化输出格式返回结果。不要输出 Markdown、说明文字或代码围栏。
不要负责网页 UI、文件下载或其他业务逻辑。
  `;

export async function parseQuestionsWithDeepSeek(text, options = {}) {
  const client = options.client ?? getDeepSeekClient();
  const completion = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: questionParserSystemPrompt },
      { role: "user", content: `请解析下面的题库文本并返回 JSON：\n\n${text}` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 8000,
    stream: false,
  }, { signal: options.signal });
  return questionParseResultSchema.parse(parseJsonContent(completion.choices?.[0]?.message?.content));
}

import { z } from "zod";
import { DEEPSEEK_MODEL, getDeepSeekClient, parseJsonContent } from "./deepseekClient.js";

const answerSchema = z.union([z.string(), z.array(z.string()), z.boolean(), z.null()]);

export const relatedQuestionSchema = z.object({
  question: z.string().min(1).max(1000),
  answer: z.union([z.string(), z.array(z.string()), z.boolean()]),
  explanation: z.string().max(2000),
});

export const optionExplanationSchema = z.object({
  optionId: z.string().min(1).max(20),
  explanation: z.string().min(1).max(1000),
});

export const solverResultSchema = z.object({
  answer: answerSchema,
  explanation: z.string().max(4000),
  knowledgePoints: z.array(z.string().max(100)).max(8),
  optionExplanations: z.array(optionExplanationSchema).max(12).default([]),
  relatedQuestions: z.array(relatedQuestionSchema).max(2).default([]),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
});

export const solverSystemPrompt = `你是一个大学刷题学习助手。

你的任务不是只告诉学生答案，而是：
1. 判断题型；
2. 给出正确答案；
3. 给出简洁但完整的解题过程；
4. 提取本题核心知识点；
5. 根据本题知识点生成 1-2 道相关练习题；
6. 如果是选择题，明确返回选项字母，并在 optionExplanations 中逐项解释为什么正确或错误；非选择题返回空数组；
7. 不要编造不存在的法律条文、公式或数据；
8. 如果信息不足，应明确说明，answer 返回 null，confidence 不高于 0.5，needsReview 返回 true，且不要生成不可靠的相关题。

单选题 answer 返回字符串，例如 "B"；多选题返回数组，例如 ["A", "C"]；判断题返回布尔值；填空题返回标准答案文本；简答题返回参考答案。
选择题只能使用输入中存在的选项编号。confidence 必须在 0 到 1 之间，低于 0.8 时 needsReview 必须为 true。
输出必须是严格 JSON，不要输出 Markdown。JSON 字段必须包含 answer、explanation、knowledgePoints、optionExplanations、relatedQuestions、confidence、needsReview。`;

export async function solveWithDeepSeek(question, options = {}) {
  const client = options.client ?? getDeepSeekClient();
  const completion = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: solverSystemPrompt },
      {
        role: "user",
        content: `请解答下面这道题，并返回 JSON：\n${JSON.stringify({
          question: question.question,
          type: question.type,
          options: question.options,
          source: question.source,
        })}`,
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2500,
    stream: false,
  }, { signal: options.signal });

  return solverResultSchema.parse(parseJsonContent(completion.choices?.[0]?.message?.content));
}

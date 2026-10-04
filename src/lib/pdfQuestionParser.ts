import { parseTextQuestionRecords } from "@/importers/textQuestionParser";

// 兼容旧引用。PDF、Word、TXT、Markdown 现在统一使用同一个宽松解析器。
export function parsePdfQuestions(sourceText: string) {
  return parseTextQuestionRecords(sourceText);
}

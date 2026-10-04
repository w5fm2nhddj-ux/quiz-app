import type {
  AnswerSource,
  CanonicalField,
  FailedQuestionBlock,
  ImportResult,
  ImportStats,
  ImportedAnswer,
  ImportedDifficulty,
  ImportedOption,
  ImportedQuestion,
  ImportedQuestionType,
  TabularMapping,
} from "./types";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const optionIds = ["A", "B", "C", "D", "E", "F", "G", "H"];

const aliases: Record<CanonicalField, string[]> = {
  id: ["id", "题号", "序号", "编号"],
  question: ["question", "stem", "title", "题目", "题干", "问题", "试题"],
  type: ["type", "questiontype", "题型", "类型"],
  optionA: ["optiona", "a", "选项a", "a选项"],
  optionB: ["optionb", "b", "选项b", "b选项"],
  optionC: ["optionc", "c", "选项c", "c选项"],
  optionD: ["optiond", "d", "选项d", "d选项"],
  optionE: ["optione", "e", "选项e", "e选项"],
  optionF: ["optionf", "f", "选项f", "f选项"],
  optionG: ["optiong", "g", "选项g", "g选项"],
  optionH: ["optionh", "h", "选项h", "h选项"],
  answer: ["answer", "correctanswer", "答案", "正确答案", "参考答案", "答"],
  explanation: ["explanation", "analysis", "解析", "答案解析", "详解"],
  knowledgePoints: ["knowledgepoints", "knowledgepoint", "知识点", "考点"],
  source: ["source", "来源", "出处"],
  difficulty: ["difficulty", "难度", "难易度"],
};

export function createId(prefix = "question") {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random()}`;
}

export function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

export function list(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const valueText = text(value);
  return valueText ? valueText.split(/[|;,，、]/).map((item) => item.trim()).filter(Boolean) : [];
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[\s_\-:：()（）【】]/g, "");
}

function valueByAliases(record: Record<string, unknown>, field: CanonicalField) {
  const expected = aliases[field];
  return Object.entries(record).find(([key]) => expected.includes(normalizedKey(key)))?.[1];
}

function normalizeDifficulty(value: unknown): ImportedDifficulty {
  const valueText = normalizedKey(text(value));
  const difficultyMap: Record<string, Exclude<ImportedDifficulty, null>> = {
    easy: "easy", 简单: "easy", medium: "medium", 中等: "medium", hard: "hard", 困难: "hard",
  };
  return difficultyMap[valueText] ?? null;
}

function optionsFromRecord(record: Record<string, unknown>): ImportedOption[] {
  const rawOptions = record.options ?? record.选项;
  if (Array.isArray(rawOptions)) {
    return rawOptions.map((item, index) => {
      if (typeof item !== "object" || item === null) {
        return { id: optionIds[index] ?? String(index + 1), text: text(item) };
      }
      const option = item as Record<string, unknown>;
      return {
        id: text(option.id ?? option.key ?? option.label) || optionIds[index] || String(index + 1),
        text: text(option.text ?? option.value ?? option.content ?? option.选项内容),
      };
    }).filter((option) => option.text);
  }

  return optionIds.map((id) => ({
    id,
    text: text(valueByAliases(record, `option${id}` as CanonicalField)),
  })).filter((option) => option.text);
}

function normalizeAnswer(value: unknown, options: ImportedOption[]): ImportedAnswer {
  if (value == null || text(value) === "") return null;
  if (typeof value === "boolean") return value;

  const rawValues = Array.isArray(value) ? value.map(text).filter(Boolean) : [text(value)];
  const joined = rawValues.join(" ").replace(/^[【\[]|[】\]]$/g, "").trim();
  const upper = joined.toUpperCase();
  if (["正确", "对", "TRUE", "√", "✓"].includes(upper)) return true;
  if (["错误", "错", "FALSE", "×", "✕", "X"].includes(upper)) return false;

  const lettersOnly = upper.replace(/[\s,，、;；|/]+/g, "");
  if (/^[A-H]+$/.test(lettersOnly)) {
    const answers = [...new Set(lettersOnly.split(""))];
    return answers.length === 1 ? answers[0] : answers;
  }

  const matchedOption = options.find((option) => option.text === joined);
  if (matchedOption) return matchedOption.id;
  return joined;
}

function normalizeType(
  value: unknown,
  answer: ImportedAnswer,
  options: ImportedOption[],
  question: string,
): ImportedQuestionType {
  const valueText = normalizedKey(text(value));
  const typeMap: Record<string, ImportedQuestionType> = {
    single: "single", 单选: "single", 单选题: "single",
    multiple: "multiple", multi: "multiple", 多选: "multiple", 多选题: "multiple",
    truefalse: "true_false", boolean: "true_false", 判断: "true_false", 判断题: "true_false",
    fill: "fill", 填空: "fill", 填空题: "fill",
    shortanswer: "short_answer", short: "short_answer", 简答: "short_answer", 简答题: "short_answer",
  };
  if (typeMap[valueText]) return typeMap[valueText];
  if (typeof answer === "boolean" || /判断题|正确还是错误|对错/.test(question)) return "true_false";
  if (Array.isArray(answer) && answer.length > 1) return "multiple";
  if (options.length > 0) return "single";
  if (/填空|_{2,}|（\s*）|\(\s*\)/.test(question)) return "fill";
  return "short_answer";
}

function normalizeAnswerForType(answer: ImportedAnswer, type: ImportedQuestionType): ImportedAnswer {
  if (answer == null) return null;
  if (type === "multiple") return Array.isArray(answer) ? answer : [String(answer)];
  if (type === "true_false") {
    if (typeof answer === "boolean") return answer;
    const value = String(answer).toUpperCase();
    if (["A", "正确", "TRUE", "√"].includes(value)) return true;
    if (["B", "错误", "FALSE", "×", "X"].includes(value)) return false;
  }
  return Array.isArray(answer) && answer.length === 1 ? answer[0] : answer;
}

function answerExists(answer: ImportedAnswer) {
  if (answer === null) return false;
  if (typeof answer === "boolean") return true;
  if (Array.isArray(answer)) return answer.some((value) => String(value).trim().length > 0);
  return answer.trim().length > 0;
}

export function emptyImportStats(): ImportStats {
  return {
    rawTextLength: 0,
    processedTextLength: 0,
    detectedMarkers: 0,
    blocksCreated: 0,
    parsedQuestions: 0,
    failedBlocks: 0,
    sourceAnswers: 0,
    aiAnswers: 0,
    aiFailures: 0,
    missingAnswers: 0,
    needsReview: 0,
  };
}

export function normalizeRecord(raw: unknown, index: number, source: string): ImportedQuestion {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const question = text(valueByAliases(record, "question"));
  if (!question) throw new Error(`第 ${index + 1} 条记录缺少题干`);

  const options = optionsFromRecord(record);
  const initialAnswer = normalizeAnswer(valueByAliases(record, "answer"), options);
  const type = normalizeType(valueByAliases(record, "type"), initialAnswer, options, question);
  const answer = normalizeAnswerForType(initialAnswer, type);
  const hasAnswer = answerExists(answer);
  const storedSource = text(record.answerSource) as AnswerSource;
  const answerSource: AnswerSource = ["source", "ai", "manual", "missing"].includes(storedSource)
    ? storedSource
    : hasAnswer ? "source" : "missing";
  const parseWarnings = Array.isArray(record._parseWarnings) ? record._parseWarnings.map(text).filter(Boolean) : [];

  if (["single", "multiple"].includes(type) && options.length < 2) {
    parseWarnings.push(`只识别到 ${options.length} 个选项，已保留并标记人工确认。`);
  }
  if (type === "true_false" && options.length === 0) {
    options.push({ id: "A", text: "正确" }, { id: "B", text: "错误" });
  }
  if (!hasAnswer && !parseWarnings.some((warning) => warning.includes("没有答案"))) {
    parseWarnings.push("原题没有答案，将进入 AI 解题队列。 ");
  }

  const rawConfidence = record.confidence;
  const confidence = typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? rawConfidence : null;
  const needsReview = Boolean(record.needsReview) || !hasAnswer || confidence !== null && confidence < 0.8 || parseWarnings.some((warning) => warning.includes("人工确认"));

  return {
    id: text(valueByAliases(record, "id")) || createId(),
    question,
    type,
    options,
    answer,
    explanation: text(valueByAliases(record, "explanation")),
    knowledgePoints: list(valueByAliases(record, "knowledgePoints")),
    source: text(valueByAliases(record, "source")) || source,
    difficulty: normalizeDifficulty(valueByAliases(record, "difficulty")),
    answerSource,
    confidence,
    needsReview,
    parseWarnings: [...new Set(parseWarnings)],
  };
}

function applyQuestionStats(stats: ImportStats, questions: ImportedQuestion[], failedCount: number) {
  return {
    ...stats,
    parsedQuestions: questions.length,
    failedBlocks: failedCount,
    sourceAnswers: questions.filter((question) => question.answerSource === "source").length,
    aiAnswers: questions.filter((question) => question.answerSource === "ai").length,
    missingAnswers: questions.filter((question) => question.answerSource === "missing").length,
    needsReview: questions.filter((question) => question.needsReview).length,
  };
}

export function recordsToResult(
  records: unknown[],
  details: Pick<ImportResult, "suggestedName" | "suggestedSubject" | "source">,
  warnings: string[] = [],
  diagnostics?: { failedBlocks?: FailedQuestionBlock[]; stats?: ImportStats },
): ImportResult {
  const questions: ImportedQuestion[] = [];
  const errors: string[] = [];
  const failedBlocks = [...(diagnostics?.failedBlocks ?? [])];
  records.forEach((record, index) => {
    try {
      questions.push(normalizeRecord(record, index, details.source));
    } catch (error) {
      const reason = error instanceof Error ? error.message : `第 ${index + 1} 条记录解析失败`;
      errors.push(reason);
      failedBlocks.push({
        index: index + 1,
        marker: `记录 ${index + 1}`,
        rawText: typeof record === "string" ? record : JSON.stringify(record),
        reason,
      });
    }
  });
  if (failedBlocks.length > 0) warnings.push("部分题块需要人工确认，原始内容已保留。 ");
  const baseStats = diagnostics?.stats ?? {
    ...emptyImportStats(),
    detectedMarkers: records.length,
    blocksCreated: records.length,
  };
  const stats = applyQuestionStats(baseStats, questions, failedBlocks.length);
  return {
    success: questions.length > 0,
    questions,
    warnings: [...new Set(warnings)],
    errors,
    failedBlocks,
    stats,
    total: Math.max(stats.detectedMarkers, questions.length + failedBlocks.length),
    ...details,
  };
}

export function detectMapping(rows: Record<string, unknown>[]): TabularMapping {
  const headers = Object.keys(rows[0] ?? {});
  const fields: Partial<Record<CanonicalField, string>> = {};
  (Object.keys(aliases) as CanonicalField[]).forEach((field) => {
    const exact = headers.find((header) => aliases[field].includes(normalizedKey(header)));
    const fuzzy = headers.find((header) => aliases[field].some((alias) => normalizedKey(header).includes(alias) || alias.includes(normalizedKey(header))));
    if (exact ?? fuzzy) fields[field] = exact ?? fuzzy;
  });
  const uncertainFields = (["question"] as CanonicalField[]).filter((field) => !fields[field]);
  return { headers, fields, uncertainFields, rows };
}

export function mappedRows(mapping: TabularMapping) {
  return mapping.rows.map((row) => {
    const mapped: Record<string, unknown> = {};
    Object.entries(mapping.fields).forEach(([field, header]) => {
      if (header) mapped[field] = row[header];
    });
    return mapped;
  });
}

export function tabularResult(
  mapping: TabularMapping,
  details: Pick<ImportResult, "suggestedName" | "suggestedSubject" | "source">,
): ImportResult {
  const warnings = mapping.uncertainFields.length > 0 ? ["题干列无法确定，请在预览页手动确认列映射。"] : [];
  return { ...recordsToResult(mappedRows(mapping), details, warnings), mapping };
}

export function failureResult(message: string, name: string, source: string): ImportResult {
  return {
    success: false,
    questions: [],
    warnings: [],
    errors: [message],
    failedBlocks: [],
    stats: emptyImportStats(),
    total: 0,
    suggestedName: name,
    suggestedSubject: "未分类",
    source,
  };
}

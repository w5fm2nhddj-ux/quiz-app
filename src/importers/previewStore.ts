import type { ImportPreviewPayload } from "./types";
import { emptyImportStats } from "./utils";

const STORAGE_KEY = "zhidian.import-preview.v1";
let memoryValue: ImportPreviewPayload | null = null;

function migratePayload(payload: ImportPreviewPayload): ImportPreviewPayload {
  const questions = (payload.result.questions ?? []).map((question) => {
    const hasAnswer = question.answer !== null && (
      typeof question.answer === "boolean"
      || (Array.isArray(question.answer)
        ? question.answer.some((value) => String(value).trim().length > 0)
        : question.answer.trim().length > 0)
    );
    return {
      ...question,
      answerSource: question.answerSource ?? (hasAnswer ? "source" : "missing"),
      confidence: question.confidence ?? null,
      needsReview: question.needsReview ?? !hasAnswer,
      parseWarnings: question.parseWarnings ?? [],
    };
  });
  const baseStats = payload.result.stats ?? emptyImportStats();
  return {
    ...payload,
    result: {
      ...payload.result,
      questions,
      failedBlocks: payload.result.failedBlocks ?? [],
      stats: {
        ...baseStats,
        parsedQuestions: questions.length,
        sourceAnswers: questions.filter((question) => question.answerSource === "source").length,
        aiAnswers: questions.filter((question) => question.answerSource === "ai").length,
        missingAnswers: questions.filter((question) => question.answerSource === "missing").length,
        needsReview: questions.filter((question) => question.needsReview).length,
      },
    },
  };
}

export const importPreviewStore = {
  save(payload: ImportPreviewPayload) {
    memoryValue = migratePayload(payload);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memoryValue));
    } catch {
      // 数据较大时 sessionStorage 可能超限，当前标签页仍可使用内存中的预览。
    }
  },
  load(): ImportPreviewPayload | null {
    if (memoryValue) return memoryValue;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      memoryValue = raw ? migratePayload(JSON.parse(raw) as ImportPreviewPayload) : null;
      return memoryValue;
    } catch {
      return null;
    }
  },
  clear() {
    memoryValue = null;
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // 清理失败不影响题库保存。
    }
  },
};

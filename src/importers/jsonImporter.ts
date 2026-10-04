import type { FileImporter } from "./types";
import { failureResult, recordsToResult, text } from "./utils";

export const jsonImporter: FileImporter = {
  extensions: ["json"],
  async import(file, source = `文件导入：${file.name}`) {
    const fallbackName = file.name.replace(/\.[^.]+$/, "");
    try {
      const data: unknown = JSON.parse(await file.text());
      if (Array.isArray(data)) {
        return recordsToResult(data, {
          suggestedName: fallbackName,
          suggestedSubject: "未分类",
          source,
        });
      }
      if (!data || typeof data !== "object") {
        return failureResult("JSON 根节点必须是题目数组或题库对象。", fallbackName, source);
      }
      const root = data as Record<string, unknown>;
      const records = Array.isArray(root.questions) ? root.questions : Array.isArray(root.题目) ? root.题目 : null;
      if (!records) return failureResult("JSON 中没有找到 questions 数组。", fallbackName, source);
      return recordsToResult(records, {
        suggestedName: text(root.name ?? root.题库名称) || fallbackName,
        suggestedSubject: text(root.subject ?? root.科目) || "未分类",
        source: text(root.source ?? root.来源) || source,
      });
    } catch (error) {
      return failureResult(
        error instanceof Error ? `JSON 解析失败：${error.message}` : "JSON 解析失败。",
        fallbackName,
        source,
      );
    }
  },
};

import type { FileImporter } from "./types";
import { detectMapping, failureResult, tabularResult } from "./utils";

export const excelImporter: FileImporter = {
  extensions: ["xlsx", "xls"],
  async import(file, source = `文件导入：${file.name}`) {
    const name = file.name.replace(/\.[^.]+$/, "");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows: Record<string, unknown>[] = [];
      workbook.SheetNames.forEach((sheetName) => {
        rows.push(...XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" }));
      });
      if (rows.length === 0) return failureResult("Excel 中没有可读取的数据行。", name, source);
      const result = tabularResult(detectMapping(rows), {
        suggestedName: name,
        suggestedSubject: "未分类",
        source,
      });
      if (workbook.SheetNames.length > 1) result.warnings.push(`已按工作表顺序合并 ${workbook.SheetNames.length} 个工作表。`);
      return result;
    } catch (error) {
      return failureResult(
        error instanceof Error ? `Excel 解析失败：${error.message}` : "Excel 解析失败。",
        name,
        source,
      );
    }
  },
};

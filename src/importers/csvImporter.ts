import type { FileImporter } from "./types";
import { detectMapping, failureResult, tabularResult } from "./utils";

export function parseCsvRows(content: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ""));
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

export const csvImporter: FileImporter = {
  extensions: ["csv"],
  async import(file, source = `文件导入：${file.name}`) {
    const name = file.name.replace(/\.[^.]+$/, "");
    const rows = parseCsvRows(await file.text());
    if (rows.length === 0) return failureResult("CSV 至少需要一行表头和一行题目数据。", name, source);
    return tabularResult(detectMapping(rows), {
      suggestedName: name,
      suggestedSubject: "未分类",
      source,
    });
  },
};

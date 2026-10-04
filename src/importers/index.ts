import { csvImporter } from "./csvImporter";
import { excelImporter } from "./excelImporter";
import { jsonImporter } from "./jsonImporter";
import { pdfImporter } from "./pdfImporter";
import { imageImporter, pptImporter } from "./placeholderImporters";
import { textImporter } from "./textImporter";
import type { CanonicalField, FileImporter, ImportResult, TabularMapping } from "./types";
import { failureResult, MAX_FILE_SIZE, tabularResult } from "./utils";
import { importQuestionUrl as importUrl } from "./urlImporter";
import { wordImporter } from "./wordImporter";

const importers: FileImporter[] = [
  excelImporter,
  csvImporter,
  wordImporter,
  pdfImporter,
  jsonImporter,
  textImporter,
  imageImporter,
  pptImporter,
];

export const SUPPORTED_EXTENSIONS = importers.flatMap((importer) => importer.extensions);
export const FILE_ACCEPT = SUPPORTED_EXTENSIONS.map((extension) => `.${extension}`).join(",");

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

async function verifySignature(file: File, extension: string) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (extension === "pdf" && !startsWith(0x25, 0x50, 0x44, 0x46)) return "文件扩展名是 PDF，但内容不是有效的 PDF。";
  if (["docx", "xlsx", "pptx"].includes(extension) && !startsWith(0x50, 0x4b)) return "文件内容与扩展名不一致（应为 Office Open XML 文件）。";
  if (["doc", "xls"].includes(extension) && !startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "文件内容与扩展名不一致（应为旧版 Office 文件）。";
  if (extension === "png" && !startsWith(0x89, 0x50, 0x4e, 0x47)) return "文件扩展名是 PNG，但内容不是有效的 PNG。";
  if (["jpg", "jpeg"].includes(extension) && !startsWith(0xff, 0xd8, 0xff)) return "文件扩展名是 JPG，但内容不是有效的 JPG。";
  return "";
}

export async function importQuestionFile(file: File, source?: string): Promise<ImportResult> {
  const extension = getExtension(file.name);
  const fallbackName = file.name.replace(/\.[^.]+$/, "") || "导入题库";
  const resolvedSource = source || `文件导入：${file.name}`;
  if (!file.size) return failureResult("文件为空，无法解析。", fallbackName, resolvedSource);
  if (file.size > MAX_FILE_SIZE) return failureResult("文件超过 10 MB 限制。", fallbackName, resolvedSource);

  const importer = importers.find((item) => item.extensions.includes(extension));
  if (!importer) {
    return failureResult(
      `不支持 .${extension || "未知"} 文件。支持：${SUPPORTED_EXTENSIONS.map((item) => `.${item}`).join("、")}。`,
      fallbackName,
      resolvedSource,
    );
  }

  try {
    const signatureError = await verifySignature(file, extension);
    if (signatureError) return failureResult(signatureError, fallbackName, resolvedSource);
    return await importer.import(file, resolvedSource);
  } catch (error) {
    return failureResult(
      error instanceof Error ? `文件解析失败：${error.message}` : "文件解析失败。",
      fallbackName,
      resolvedSource,
    );
  }
}

export function importQuestionUrl(rawUrl: string) {
  return importUrl(rawUrl, importQuestionFile);
}

export function reparseTabularImport(
  result: ImportResult,
  fields: Partial<Record<CanonicalField, string>>,
) {
  if (!result.mapping) return result;
  const mapping: TabularMapping = {
    ...result.mapping,
    fields,
    uncertainFields: (["question"] as CanonicalField[]).filter((field) => !fields[field]),
  };
  return tabularResult(mapping, {
    suggestedName: result.suggestedName,
    suggestedSubject: result.suggestedSubject,
    source: result.source,
  });
}

export type {
  AnswerSource,
  CanonicalField,
  FailedQuestionBlock,
  ImportPreviewPayload,
  ImportResult,
  ImportStats,
  ImportedAnswer,
  ImportedQuestion,
} from "./types";
export { createId, MAX_FILE_SIZE } from "./utils";

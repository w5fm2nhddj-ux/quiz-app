import type { FileImporter, ImportResult } from "./types";
import { parseTextQuestions } from "./textQuestionParser";
import { recordsToResult } from "./utils";

export function importTextContent(
  content: string,
  name: string,
  source: string,
): ImportResult {
  const parsed = parseTextQuestions(content);
  if (import.meta.env?.DEV) {
    console.info(`Detected question markers: ${parsed.stats.detectedMarkers}`);
    console.info(`Question blocks created: ${parsed.stats.blocksCreated}`);
    console.info(`Parsed successfully: ${parsed.stats.parsedQuestions}`);
    console.info(`Dropped: ${parsed.stats.failedBlocks}`);
    parsed.failedBlocks.forEach((block) => console.warn(`Dropped #${block.index}: ${block.reason}`));
  }
  const result = recordsToResult(
    parsed.records,
    { suggestedName: name, suggestedSubject: "未分类", source },
    parsed.warnings,
    { failedBlocks: parsed.failedBlocks, stats: parsed.stats },
  );
  if (parsed.records.length === 0) {
    result.errors.push("没有识别到明确题目，疑似题块已保留供人工确认。 ");
  }
  return result;
}

export const textImporter: FileImporter = {
  extensions: ["txt", "md", "markdown"],
  async import(file, source = `文件导入：${file.name}`) {
    return importTextContent(await file.text(), file.name.replace(/\.[^.]+$/, ""), source);
  },
};

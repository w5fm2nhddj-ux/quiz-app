import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTextQuestions } from "../src/importers/textQuestionParser";
import { recordsToResult } from "../src/importers/utils";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "tests", "fixtures", "mixed-question-formats.txt");
const rawText = await readFile(fixturePath, "utf8");
const parsed = parseTextQuestions(rawText);
const result = recordsToResult(
  parsed.records,
  { suggestedName: "诊断样本", suggestedSubject: "测试", source: "fixture" },
  parsed.warnings,
  { failedBlocks: parsed.failedBlocks, stats: parsed.stats },
);

console.log(`Detected question markers: ${result.stats.detectedMarkers}`);
console.log(`Question blocks created: ${result.stats.blocksCreated}`);
console.log(`Parsed successfully: ${result.stats.parsedQuestions}`);
console.log(`Dropped: ${result.stats.failedBlocks}`);
console.log(`Source answers: ${result.stats.sourceAnswers}`);
console.log(`Missing answers: ${result.stats.missingAnswers}`);
result.failedBlocks.forEach((block) => console.log(`Dropped #${block.index}: ${block.reason}`));

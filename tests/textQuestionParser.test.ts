import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTextQuestions } from "../src/importers/textQuestionParser";
import { detectMapping, recordsToResult, tabularResult } from "../src/importers/utils";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await readFile(resolve(root, "tests", "fixtures", "mixed-question-formats.txt"), "utf8");
const parsed = parseTextQuestions(fixture);
const result = recordsToResult(
  parsed.records,
  { suggestedName: "测试", suggestedSubject: "测试", source: "fixture" },
  parsed.warnings,
  { failedBlocks: parsed.failedBlocks, stats: parsed.stats },
);

assert.equal(parsed.stats.detectedMarkers, 5, "应识别 5 个题号");
assert.equal(parsed.stats.blocksCreated, 5, "应创建 5 个题块");
assert.equal(result.questions.length, 5, "缺答案和缺选项题也必须保留");
assert.equal(result.failedBlocks.length, 0);
assert.equal(result.stats.sourceAnswers, 2);
assert.equal(result.stats.missingAnswers, 3);
assert.equal(result.questions[1].answer, null);
assert.equal(result.questions[1].answerSource, "missing");
assert.equal(result.questions[2].options[0].text, "很长很长的 选项内容");
assert.equal(result.questions[3].type, "true_false");
assert.equal(result.questions[3].answer, true);
assert.equal(result.questions[4].type, "short_answer");

const variants = parseTextQuestions(`
2024. 年度报告
第 1 页
一、中文编号题？
（A）选项一 （B）选项二 （C）选项三
【答案】A B C
【解析】多选解析

(2) 小写和空格选项？
a 选项甲
b: 选项乙
答：b
详解：测试解析
`);
const variantResult = recordsToResult(variants.records, {
  suggestedName: "变体", suggestedSubject: "测试", source: "fixture",
}, variants.warnings, { failedBlocks: variants.failedBlocks, stats: variants.stats });

assert.equal(variantResult.questions.length, 2, "年份和页码不应被识别为题号");
assert.deepEqual(variantResult.questions[0].answer, ["A", "B", "C"]);
assert.equal(variantResult.questions[0].type, "multiple");
assert.equal(variantResult.questions[0].options.length, 3);
assert.equal(variantResult.questions[1].answer, "B");
assert.equal(variantResult.questions[1].explanation, "测试解析");

const pageLikeLine = parseTextQuestions("1. 第一题？ A. 甲 B. 乙 答案：A 2. 第二题？ A. 丙 B. 丁");
assert.equal(pageLikeLine.stats.detectedMarkers, 2, "PDF 同一行中的多个题号应被恢复");
const pageLikeResult = recordsToResult(pageLikeLine.records, {
  suggestedName: "单行", suggestedSubject: "测试", source: "fixture",
}, pageLikeLine.warnings, { failedBlocks: pageLikeLine.failedBlocks, stats: pageLikeLine.stats });
assert.equal(pageLikeResult.questions[0].question, "第一题?");
assert.equal(pageLikeResult.questions[0].options.length, 2);
assert.equal(pageLikeResult.questions[0].answer, "A");
assert.equal(pageLikeResult.questions[1].options.length, 2);

const failed = parseTextQuestions("6.\n7. 后一道有效题？");
assert.equal(failed.records.length, 1);
assert.equal(failed.failedBlocks.length, 1, "失败题块必须保留原文");
assert.equal(failed.failedBlocks[0].reason, "no question text");

const suspected = parseTextQuestions("这可能是一道题？\nA. 选项\n答案：A");
assert.equal(suspected.records.length, 0);
assert.equal(suspected.failedBlocks.length, 1, "没有题号但疑似题目的内容也必须进入人工确认区");

const tableResult = tabularResult(detectMapping([
  { 题干: "表格中有答案的题", 选项A: "甲", 选项B: "乙", 答案: "A" },
  { 题干: "表格中没有答案的题", 选项A: "甲", 选项B: "乙", 答案: "" },
]), { suggestedName: "表格", suggestedSubject: "测试", source: "fixture" });
assert.equal(tableResult.questions.length, 2, "Excel/CSV 缺答案行也必须保留");
assert.equal(tableResult.stats.sourceAnswers, 1);
assert.equal(tableResult.stats.missingAnswers, 1);

console.log("Parser tests passed: 5/5 fixture questions retained; format variants passed.");

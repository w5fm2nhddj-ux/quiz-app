import type { FailedQuestionBlock, ImportStats } from "./types";
import { preprocessQuestionText } from "./textPreprocessor";

export type TextQuestionRecord = Record<string, unknown> & {
  _parseWarnings?: string[];
  _rawBlock?: string;
};

export type TextParseResult = {
  records: TextQuestionRecord[];
  failedBlocks: FailedQuestionBlock[];
  warnings: string[];
  stats: ImportStats;
};

type Marker = { id: string; marker: string; questionText: string };
type QuestionBlock = { marker: Marker; lines: string[] };

const chineseNumber = "一二三四五六七八九十百";
const sectionHeadingPattern = /^(?:单项选择|单选|多项选择|多选|判断|填空|简答|选择|客观|主观|总则|概述|说明|注意事项)(?:题|部分|练习)?$/;

function markerFromLine(line: string): Marker | null {
  const patterns: RegExp[] = [
    /^第\s*(\d{1,4})\s*题\s*[:：.、-]?\s*(.*)$/,
    /^\(\s*(\d{1,4})\s*\)\s*(.*)$/,
    /^(\d{1,4})\s*([.、)])\s*(.*)$/,
    new RegExp(`^\\(\\s*([${chineseNumber}]+)\\s*\\)\\s*(.*)$`),
    new RegExp(`^([${chineseNumber}]+)\\s*([.、])\\s*(.*)$`),
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const isPunctuationPattern = match.length === 4;
    const id = match[1];
    const punctuation = isPunctuationPattern ? match[2] : "";
    const questionText = (isPunctuationPattern ? match[3] : match[2]).trim();

    const numericId = Number(id);
    if (Number.isFinite(numericId) && numericId >= 1900 && numericId <= 2099) return null;
    if (punctuation === "." && /^\d+(?:[.\d]|\s*(?:元|万元|%))/.test(questionText)) return null;
    if (/^(?:第?\s*\d+\s*条|条款|款|项)(?:\s|[:：]|$)/.test(questionText)) return null;
    if (sectionHeadingPattern.test(questionText.replace(/[：:]/g, "").trim())) return null;
    return { id, marker: line.slice(0, Math.max(1, line.length - questionText.length)).trim(), questionText };
  }
  return null;
}

function expandInlineFields(line: string) {
  const fieldStart = /\s+(?=(?:\(\s*[A-Ha-h]\s*\)|[A-Ha-h]\s*[.、):：]|(?:【\s*)?(?:正确\s*答案|参考\s*答案|多选\s*答案|答案\s*解析|答案|答|解析|详解|Answer|Explanation)(?:\s*】)?\s*[:：]?))/gi;
  return line.replace(fieldStart, "\n").split("\n").map((part) => part.trim()).filter(Boolean);
}

function optionFromLine(line: string) {
  const parenthesized = line.match(/^\(\s*([A-H])\s*\)\s*(.*)$/i);
  const punctuated = line.match(/^([A-H])\s*(?:[.、)）:：])\s*(.*)$/i);
  const spaced = line.match(/^([A-H])\s+(.+)$/i);
  const match = parenthesized ?? punctuated ?? spaced;
  return match ? { id: match[1].toUpperCase(), text: match[2].trim() } : null;
}

function labelledValue(line: string, labels: string[]) {
  const labelPattern = labels.join("|");
  return line.match(new RegExp(`^(?:【\\s*)?(?:${labelPattern})(?:\\s*】)?\\s*[:：]?\\s*(.*)$`, "i"));
}

function createStats(rawTextLength: number, processedTextLength: number): ImportStats {
  return {
    rawTextLength,
    processedTextLength,
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

function parseBlock(block: QuestionBlock, index: number) {
  const record: TextQuestionRecord = {
    id: block.marker.id,
    question: block.marker.questionText,
  };
  const parseWarnings: string[] = [];
  let activeField = "question";
  const expandedLines = block.lines.flatMap(expandInlineFields);

  for (const line of expandedLines) {
    const option = optionFromLine(line);
    const answer = labelledValue(line, ["正确\\s*答案", "参考\\s*答案", "多选\\s*答案", "答案", "答", "Answer"]);
    const explanation = labelledValue(line, ["答案\\s*解析", "解析", "详解", "Explanation"]);
    const knowledge = labelledValue(line, ["知识点", "考点", "Knowledge(?:\\s*Points?)?"]);
    const type = labelledValue(line, ["题型", "类型", "Type"]);

    if (option) {
      record[`option${option.id}`] = option.text;
      activeField = `option${option.id}`;
    } else if (answer) {
      record.answer = answer[1].trim();
      activeField = answer[1].trim() ? "afterAnswer" : "answer";
    } else if (explanation) {
      record.explanation = explanation[1].trim();
      activeField = "explanation";
    } else if (knowledge) {
      record.knowledgePoints = knowledge[1].trim();
      activeField = "knowledgePoints";
    } else if (type) {
      record.type = type[1].trim();
      activeField = "afterType";
    } else if (activeField === "question" || activeField === "explanation" || activeField === "knowledgePoints") {
      record[activeField] = `${String(record[activeField] ?? "")} ${line}`.trim();
    } else if (/^option[A-H]$/.test(activeField)) {
      record[activeField] = `${String(record[activeField] ?? "")} ${line}`.trim();
    } else if (activeField === "answer" && !record.answer) {
      record.answer = line;
      activeField = "afterAnswer";
    } else {
      parseWarnings.push(`未归类内容：${line.slice(0, 60)}`);
    }
  }

  const question = String(record.question ?? "").trim();
  if (!question) {
    return {
      failed: {
        index,
        marker: block.marker.marker,
        rawText: [block.marker.marker, ...block.lines].join("\n"),
        reason: "no question text",
      } satisfies FailedQuestionBlock,
    };
  }

  const optionCount = Object.keys(record).filter((key) => /^option[A-H]$/.test(key) && String(record[key]).trim()).length;
  if (optionCount === 0) parseWarnings.push("未识别到选项，已按最低保留标准保留题目。");
  if (!String(record.answer ?? "").trim()) parseWarnings.push("原题没有答案，将标记为待 AI 补全或人工确认。");
  if (!String(record.explanation ?? "").trim()) parseWarnings.push("原题没有解析。");
  record._parseWarnings = parseWarnings;
  record._rawBlock = [block.marker.marker, block.marker.questionText, ...block.lines].filter(Boolean).join("\n");
  return { record };
}

export function parseTextQuestions(sourceText: string): TextParseResult {
  const preprocessed = preprocessQuestionText(sourceText);
  const stats = createStats(sourceText.length, preprocessed.text.length);
  const lines = preprocessed.text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const blocks: QuestionBlock[] = [];
  const preamble: string[] = [];
  let current: QuestionBlock | null = null;

  for (const line of lines) {
    const marker = markerFromLine(line);
    if (marker) {
      stats.detectedMarkers += 1;
      if (current) blocks.push(current);
      const inlineParts = expandInlineFields(marker.questionText);
      current = {
        marker: { ...marker, questionText: inlineParts.shift() ?? "" },
        lines: inlineParts,
      };
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) blocks.push(current);
  stats.blocksCreated = blocks.length;

  const records: TextQuestionRecord[] = [];
  const failedBlocks: FailedQuestionBlock[] = [];
  blocks.forEach((block, blockIndex) => {
    const parsed = parseBlock(block, blockIndex + 1);
    if (parsed.record) records.push(parsed.record);
    else if (parsed.failed) failedBlocks.push(parsed.failed);
  });

  if (preamble.some((line) => /[?？]|^[A-Ha-h]\s*[.、):：]|答案|解析/.test(line))) {
    failedBlocks.unshift({
      index: 0,
      marker: "未识别题号",
      rawText: preamble.join("\n"),
      reason: "suspected question content before the first recognized marker",
    });
  }
  stats.parsedQuestions = records.length;
  stats.failedBlocks = failedBlocks.length;

  return { records, failedBlocks, warnings: preprocessed.warnings, stats };
}

// 保留旧函数签名，避免其他调用方在升级时立即中断。
export function parseTextQuestionRecords(sourceText: string) {
  return parseTextQuestions(sourceText).records;
}

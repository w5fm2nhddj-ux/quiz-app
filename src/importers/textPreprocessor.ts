export type PreprocessResult = {
  text: string;
  warnings: string[];
};

const pageNumberPattern = /^(?:第?\s*\d+\s*页(?:\s*[/共]\s*\d+\s*页?)?|[-—–]\s*\d+\s*[-—–]|\d+\s*\/\s*\d+)$/i;

function normalizeLine(line: string) {
  let normalized = line
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/^(\s*[A-Ha-h])\s+([.、):：])/, "$1$2")
    .trim();
  // 只处理明显的 OCR“逐字加空格”；普通中文字段之间的单个空格必须保留。
  const spacedChineseCount = normalized.match(/(?<=[\u3400-\u9FFF])\s+(?=[\u3400-\u9FFF])/g)?.length ?? 0;
  if (spacedChineseCount >= 3) {
    normalized = normalized.replace(/(?<=[\u3400-\u9FFF])\s+(?=[\u3400-\u9FFF])/g, "");
  }
  return normalized;
}

function repeatedHeaderFooterLines(pages: string[][]) {
  if (pages.length < 2) return new Set<string>();
  const counts = new Map<string, number>();
  pages.forEach((lines) => {
    const nonEmpty = lines.filter(Boolean);
    const candidates = [...nonEmpty.slice(0, 2), ...nonEmpty.slice(-2)];
    new Set(candidates).forEach((line) => {
      if (line.length >= 3 && line.length <= 100) counts.set(line, (counts.get(line) ?? 0) + 1);
    });
  });
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= Math.max(2, Math.ceil(pages.length * 0.6)))
      .map(([line]) => line),
  );
}

// PDF、Word、TXT、Markdown 共用的文本预处理，避免每个 importer 各写一套规则。
export function preprocessQuestionText(rawText: string): PreprocessResult {
  const warnings: string[] = [];
  const normalized = rawText
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    // PDF 有时把整页拼成一行；只在题号后紧跟文字时补回明显的题目边界。
    .replace(/([^\n])\s+(?=(?:第\s*\d{1,4}\s*题|[（(]\s*(?:\d{1,4}|[一二三四五六七八九十百]+)\s*[)）]|(?:\d{1,3}|[一二三四五六七八九十百]+)\s*[.．、)）])\s*[\u3400-\u9FFFA-Za-z“"'(（])/g, "$1\n");

  const pages = normalized.split(/\f/).map((page) => page.split("\n").map(normalizeLine));
  const repeatedLines = repeatedHeaderFooterLines(pages);
  if (repeatedLines.size > 0) warnings.push(`已移除 ${repeatedLines.size} 个重复页眉或页脚。`);

  const cleanedPages = pages.map((lines) => lines.filter((line) => {
    if (!line) return true;
    if (repeatedLines.has(line)) return false;
    return !pageNumberPattern.test(line);
  }));

  return {
    text: cleanedPages
      .map((lines) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim())
      .filter(Boolean)
      .join("\n")
      .trim(),
    warnings,
  };
}

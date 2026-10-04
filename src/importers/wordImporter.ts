import type { FileImporter } from "./types";
import { importTextContent } from "./textImporter";
import { failureResult } from "./utils";

export const wordImporter: FileImporter = {
  extensions: ["docx", "doc"],
  async import(file, source = `Word 导入：${file.name}`) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const name = file.name.replace(/\.[^.]+$/, "");
    if (extension === "doc") {
      return failureResult("旧版 .doc 为二进制格式，浏览器端无法可靠解析。请另存为 .docx，或接入后端转换服务。", name, source);
    }
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      const imported = importTextContent(result.value, name, source);
      result.messages.forEach((message) => imported.warnings.push(`Word：${message.message}`));
      return imported;
    } catch (error) {
      return failureResult(
        error instanceof Error ? `Word 解析失败：${error.message}` : "Word 解析失败。",
        name,
        source,
      );
    }
  },
};

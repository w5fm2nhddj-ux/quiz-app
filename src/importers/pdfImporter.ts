import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { FileImporter } from "./types";
import { importTextContent } from "./textImporter";
import { failureResult } from "./utils";

export const pdfImporter: FileImporter = {
  extensions: ["pdf"],
  async import(file, source = `PDF 导入：${file.name}`) {
    const name = file.name.replace(/\.[^.]+$/, "");
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let pageText = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          pageText += item.str;
          pageText += item.hasEOL ? "\n" : " ";
        }
        pages.push(pageText);
      }
      // 使用换页符保留分页边界，统一预处理器可据此去除重复页眉页脚。
      const extracted = pages.join("\n\f\n");
      if (extracted.replace(/\s/g, "").length < 20) {
        return failureResult("PDF 没有可提取文字，可能是扫描件。目前未配置 OCR。", name, source);
      }
      return importTextContent(extracted, name, source);
    } catch (error) {
      return failureResult(
        error instanceof Error ? `PDF 解析失败：${error.message}` : "PDF 解析失败。",
        name,
        source,
      );
    }
  },
};

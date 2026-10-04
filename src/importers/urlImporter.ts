import type { ImportResult } from "./types";
import { importTextContent } from "./textImporter";
import { failureResult, MAX_FILE_SIZE } from "./utils";

type FileImportFunction = (file: File, source?: string) => Promise<ImportResult>;

const mimeExtensions: Record<string, string> = {
  "application/pdf": "pdf",
  "application/json": "json",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
};

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  if (/^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function validateUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("链接格式不正确。");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 http 和 https 链接。");
  if (url.username || url.password) throw new Error("链接中不能包含用户名或密码。");
  if (isPrivateHost(url.hostname)) throw new Error("出于安全考虑，不允许访问本机或私有网络地址。");
  return url;
}

async function readLimitedResponse(response: Response) {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_FILE_SIZE) throw new Error("远程资源超过 10 MB 限制。");

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) throw new Error("远程资源超过 10 MB 限制。");
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_SIZE) {
      await reader.cancel();
      throw new Error("远程资源超过 10 MB 限制。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

function fileNameFromResponse(url: URL, response: Response, contentType: string) {
  const disposition = response.headers.get("content-disposition") || "";
  const utf8Name = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const simpleName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const pathName = decodeURIComponent(url.pathname.split("/").pop() || "");
  let name = utf8Name ? decodeURIComponent(utf8Name) : simpleName || pathName || "remote-file";
  if (!/\.[a-z0-9]+$/i.test(name)) {
    const extension = mimeExtensions[contentType];
    if (extension) name += `.${extension}`;
  }
  return name.replace(/[\\/:*?"<>|]/g, "-");
}

function htmlToText(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, noscript, svg, iframe, object, embed").forEach((node) => node.remove());
  const root = document.querySelector("article, main") ?? document.body;
  return {
    title: document.title.trim(),
    text: root?.textContent?.replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim() ?? "",
  };
}

export async function importQuestionUrl(
  rawUrl: string,
  importFile: FileImportFunction,
): Promise<ImportResult> {
  let url: URL;
  try {
    url = validateUrl(rawUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "链接格式不正确。";
    return failureResult(message, "网络题库", rawUrl);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/pdf,application/json,text/plain,*/*" },
    });
    if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}。`);

    const finalUrl = validateUrl(response.url || url.href);
    const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const bytes = await readLimitedResponse(response);

    if (contentType === "text/html" || (!mimeExtensions[contentType] && /\.html?$/i.test(finalUrl.pathname))) {
      const decoded = new TextDecoder().decode(bytes);
      const page = htmlToText(decoded);
      if (page.text.length < 20) return failureResult("网页正文为空，或内容需要登录/脚本加载。", page.title || "网页题库", finalUrl.href);
      const result = importTextContent(page.text, page.title || finalUrl.hostname, finalUrl.href);
      result.warnings.push("网页结构差异较大，请在预览页逐题检查识别结果。");
      return result;
    }

    const fileName = fileNameFromResponse(finalUrl, response, contentType);
    return importFile(new File([bytes], fileName, { type: contentType }), finalUrl.href);
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    const detail = isAbort
      ? "请求超过 15 秒，已停止。"
      : error instanceof Error ? error.message : "链接读取失败。";
    return failureResult(
      `无法读取链接：${detail} 浏览器可能受到 CORS 限制；可以先下载文件再上传，或接入受控的 Express 后端。`,
      "网络题库",
      url.href,
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

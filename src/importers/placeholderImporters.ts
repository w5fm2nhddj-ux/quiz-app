import type { FileImporter } from "./types";
import { failureResult } from "./utils";

export const imageImporter: FileImporter = {
  extensions: ["png", "jpg", "jpeg"],
  async import(file, source = `图片导入：${file.name}`) {
    return failureResult("图片 importer 已预留，但尚未配置 OCR 服务。", file.name, source);
  },
};

export const pptImporter: FileImporter = {
  extensions: ["pptx"],
  async import(file, source = `PPT 导入：${file.name}`) {
    return failureResult("PPTX importer 已预留，当前版本暂不解析幻灯片。", file.name, source);
  },
};

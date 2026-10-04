# 知点练习

使用 React + Vite 构建的本地刷题网站。当前版本支持题库管理、多格式导入、导入预览、localStorage 保存和基础刷题流程。

## 本地运行

```bash
npm install
npm run dev
```

默认访问 [http://localhost:5173](http://localhost:5173)。生产构建使用 `npm run build`。

## 支持情况

| 来源 | 当前处理方式 |
| --- | --- |
| `.xlsx`、`.xls`、`.csv` | 浏览器本地解析、智能匹配列名，可在预览页手动调整映射 |
| `.json` | 支持题目数组或带 `questions` 的题库对象 |
| `.docx` | 浏览器本地提取文本，再识别题目结构 |
| `.pdf` | 浏览器本地提取文字，再识别题目结构 |
| `.txt`、`.md` | 按题号、选项、答案、解析、知识点标记识别 |
| `.doc` | 仅识别格式并提示转换；旧版二进制 Word 建议另存为 `.docx` |
| `.png`、`.jpg`、`.jpeg` | 已预留 OCR importer，当前未接入 OCR 服务 |
| `.pptx` | 已预留 importer，当前未实现内容提取 |
| 公开链接 | 支持浏览器允许跨域访问的网页或文件；受 CORS 限制时提示下载后上传 |

文件大小上限为 10 MB。所有来源都会先进入导入预览，确认后才保存到 localStorage。

解析器会保留只有题干、缺少选项、缺少答案或缺少解析的题目，并在预览页标记 `needsReview`。无法可靠解析但疑似为题目的原始内容会进入 `failedBlocks`，不会静默删除。

## 统一题目结构

Importer 输出以下结构，刷题页面不需要了解原始文件格式：

```json
{
  "id": "question-1",
  "question": "1 + 1 等于多少？",
  "type": "single",
  "options": [
    { "id": "A", "text": "1" },
    { "id": "B", "text": "2" }
  ],
  "answer": "B",
  "explanation": "基础加法。",
  "knowledgePoints": ["加法"],
  "source": "课堂笔记",
  "difficulty": "easy"
}
```

`type` 支持 `single`、`multiple`、`true_false`、`fill`、`short_answer`。CSV/Excel 中的多选答案可使用 `|` 分隔，例如 `A|C`；导入后会统一转换成数组。

## Excel / CSV 推荐表头

```text
question,type,optionA,optionB,optionC,optionD,answer,explanation,knowledgePoints,source,difficulty
```

中英文列名都可以自动匹配。若“题干”无法确定，预览页会显示列映射选择器；答案列允许为空。

## Word / PDF / TXT / Markdown 推荐排版

```text
1. 下列哪一个数是质数？
A. 21
B. 29
C. 39
D. 51
答案：B
解析：29 只能被 1 和它本身整除。
知识点：质数与合数
```

支持 `1.`、`1、`、`1）`、`第 1 题` 等题号。扫描 PDF 没有可提取文字，需要先 OCR；当前版本会明确提示，不会让页面崩溃。

## 链接导入与后端边界

浏览器端链接导入只能读取目标网站允许 CORS 的公开资源，不会绕过登录、验证码、付费墙或访问权限。

如果要稳定支持任意公开网页、旧版 `.doc` 转换或服务端 OCR，建议增加 Node.js + Express 导入服务。后端必须实现：

- 只允许 `http/https`，拒绝带凭据的 URL；
- DNS 解析后拦截本机、内网、链路本地地址，并在每次重定向后重新校验，防止 SSRF；
- 限制下载大小、超时时间、重定向次数和允许的 MIME 类型；
- 根据文件签名验证真实格式，不执行宏、脚本或上传文件；
- 将网页当作不可信文本解析，不把远程 HTML 直接注入页面。

当前前端已经包含协议/私网字面地址检查、10 MB 限制、15 秒超时、扩展名白名单和常见文件签名校验；完整 SSRF 防护必须放在后端完成。

## DeepSeek AI 测试

项目根目录的 `agents/` 包含题库解析、缺失答案解题和流程协调模块。服务端通过官方 `openai` npm SDK 的 OpenAI 兼容接口调用 DeepSeek，模型固定为 `deepseek-flash`。

在 `quiz-app/.env` 中配置仅供 Node.js 使用的密钥：

```text
DEEPSEEK_API_KEY=你的密钥
```

然后运行：

```bash
npm run agent:test
```

测试会打印结构化题目 JSON。不要在 React 源码中读取或使用 `DEEPSEEK_API_KEY`，也不要把密钥改名为带 `VITE_` 前缀的变量，否则可能被打包到浏览器端。

### 启动缺失答案补全服务

AI 解题运行在本地 Node 进程中，React 前端不会接触 API Key。`npm run dev` 会同时启动 Vite 与解题服务；也可以只启动解题服务：

```bash
npm run agent:server
```

服务仅监听 `127.0.0.1:8787`。每批最多 10 道、并发最多 3 道、每题超时 30 秒并最多重试 2 次。原题已有答案的题不会进入 AI 队列。

导入预览不会自动调用模型。先点击“试跑最多 5 道”，确认效果后，再明确确认批量补全。批量模式每次向本地服务提交 10 道；每批完成立即保存进度，重试只发送仍缺答案的题目。

### VPN 与本地代理

如果 VPN 使用系统隧道/TUN，连接 VPN 后直接重启 `npm run dev` 即可，不需要设置代理环境变量。

如果 VPN 客户端提供 HTTP 或 Mixed 代理端口，在本机 `.env` 中配置占位符对应的实际本地端口：

```text
HTTPS_PROXY=http://127.0.0.1:<HTTP_OR_MIXED_PORT>
HTTP_PROXY=http://127.0.0.1:<HTTP_OR_MIXED_PORT>
NO_PROXY=localhost,127.0.0.1
```

也支持把协议为 `http://` 或 `https://` 的 `ALL_PROXY` 映射给 DeepSeek 的 HTTPS 请求，但推荐明确设置 `HTTPS_PROXY`。当前 Node.js 内置代理不支持 `socks5://`；如果客户端只有 SOCKS 端口，请开启 TUN，或改用客户端提供的 HTTP/Mixed 端口。

修改代理配置后必须重启 Node 服务。健康检查只返回是否启用代理、变量来源和协议类型，不会返回代理主机、端口、用户名、密码、完整 URL 或 API Key。不要关闭 TLS 证书校验，也不要使用 `VITE_` 前缀保存任何密钥或代理凭据。

开发诊断和测试命令：

```bash
npm run test:parser:diagnose
npm run test:parser
npm run test:solver
npm run test:solver-client
npm run test:proxy
```

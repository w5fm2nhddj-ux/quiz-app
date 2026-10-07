import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createId,
  reparseTabularImport,
  type CanonicalField,
  type ImportResult,
  type ImportedQuestion,
} from "@/importers";
import { importPreviewStore } from "@/importers/previewStore";
import {
  cacheOriginalAnswers,
  hasMissingAnswer,
  solveMissingAnswers,
  SolverClientError,
  type SolverProgress,
  type SolverDiagnostic,
  type SolverQuestionError,
} from "@/lib/aiSolverClient";
import {
  AI_REQUEST_BATCH_SIZE,
  AI_TRIAL_SIZE,
  canStartAiCompletion,
  createAiRunLock,
  type AiCompletionMode,
} from "@/lib/aiCompletionControl";
import {
  createAiCheckout,
  fetchAiAccess,
  unlockAiAdmin,
  type AiAccessSnapshot,
} from "@/lib/aiBillingClient";
import { questionBankRepository } from "@/lib/questionBankRepository";
import type { Question, QuestionType } from "@/types/quiz";

const fieldLabels: Partial<Record<CanonicalField, string>> = {
  question: "题干",
  type: "题型",
  optionA: "选项 A",
  optionB: "选项 B",
  optionC: "选项 C",
  optionD: "选项 D",
  answer: "答案",
  explanation: "解析",
  knowledgePoints: "知识点",
  difficulty: "难度",
};

const editableFields = Object.keys(fieldLabels) as CanonicalField[];
type AiStatus = "idle" | "running" | "done" | "partial" | "error";

type AiProgressState = {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
};

type AiErrorState = {
  title: string;
  action: string;
  code?: string;
  blocking?: boolean;
  diagnostic?: SolverDiagnostic;
} | null;

export function summarizeQuestionErrors(errors: SolverQuestionError[]): AiErrorState {
  if (errors.length === 0) return null;
  const codes = new Set(errors.map((error) => error.code));
  const diagnostic = errors.find((error) => error.diagnostic)?.diagnostic ?? undefined;
  if (codes.has("DEEPSEEK_API_KEY_MISSING")) {
    return {
      title: "云端缓存未命中的题目暂时无法调用 AI。",
      action: "请在服务端配置 DEEPSEEK_API_KEY；已命中的云端答案仍可直接使用。",
      code: "API_KEY_MISSING",
      blocking: true,
    };
  }
  if (codes.has("INSUFFICIENT_BALANCE")) {
    return {
      title: "云端缓存未命中的题目需要 AI 余额。",
      action: "缓存命中的答案已返回；充值或解锁管理员权限后可重试仍缺答案的题目。",
      code: "PAYMENT_REQUIRED",
    };
  }
  if (codes.has("QUESTION_CACHE_UNAVAILABLE")) {
    return {
      title: "云端题库暂时不可用，本次未调用 AI。",
      action: "请检查 Supabase 配置、数据库表和网络后重试；为避免意外产生 Token 费用，缓存状态不明时会暂停解题。",
      code: "QUESTION_CACHE_UNAVAILABLE",
      blocking: true,
    };
  }
  if (codes.has("QUOTA_EXHAUSTED")) {
    return {
      title: "DeepSeek API 额度、余额或消费上限不足。",
      action: "继续重试不会恢复。请在 DeepSeek 开放平台检查余额、充值状态和用量限制；处理后刷新页面再试跑。",
      code: "QUOTA_EXHAUSTED",
      blocking: true,
      diagnostic,
    };
  }
  if (codes.has("RATE_LIMIT_UNKNOWN")) {
    return {
      title: "DeepSeek 返回 429，但缺少可区分额度与临时限速的错误代码。",
      action: "在确认账户额度或限速原因前不要连续重试。请检查 DeepSeek 开放平台，处理后刷新页面。",
      code: "RATE_LIMIT_UNKNOWN",
      blocking: true,
      diagnostic,
    };
  }
  if (codes.has("MODEL_PERMISSION_DENIED") || codes.has("MODEL_NOT_FOUND_OR_DENIED")) {
    return {
      title: "当前项目没有所需模型权限，或模型配置无效。",
      action: "请确认服务端模型名为 deepseek-flash，并检查 DeepSeek 账号的模型访问权限；处理后刷新页面。",
      code: codes.has("MODEL_PERMISSION_DENIED") ? "MODEL_PERMISSION_DENIED" : "MODEL_NOT_FOUND_OR_DENIED",
      blocking: true,
      diagnostic,
    };
  }
  if (codes.has("DEEPSEEK_AUTH_ERROR")) {
    return {
      title: "模型请求未通过身份验证。",
      action: "请检查服务端 API Key 是否有效或已撤销，重启本地服务并刷新页面。",
      code: "DEEPSEEK_AUTH_ERROR",
      blocking: true,
      diagnostic,
    };
  }
  if (codes.has("MODEL_TIMEOUT")) {
    return { title: "部分模型请求超时。", action: "已成功的答案已经保存；请稍后只重试仍缺答案的题目。" };
  }
  if (codes.has("RATE_LIMITED")) {
    const retryAfter = diagnostic?.retryAfterSeconds;
    return {
      title: "部分请求暂时达到速率限制。",
      action: retryAfter != null
        ? `请至少等待 ${retryAfter} 秒，再小批量重试仍缺答案的题目。`
        : "请按限速窗口等待后，再小批量重试仍缺答案的题目。",
      code: "RATE_LIMITED",
      diagnostic,
    };
  }
  if (codes.has("MODEL_CONNECTION_ERROR")) {
    return { title: "处理过程中与 DeepSeek API 的连接中断。", action: "请检查网络；已成功的批次不会回滚。" };
  }
  if (codes.size === 1 && codes.has("NO_RELIABLE_ANSWER")) {
    return { title: "部分题目没有足够信息得出可靠答案。", action: "这些题保持缺答案并标记为待人工核对，不会自动编造答案。" };
  }
  return { title: `有 ${errors.length} 道题未能补全。`, action: "展开失败详情检查原因；重试时只会提交仍缺答案的题目。" };
}

function diagnosticText(diagnostic?: SolverDiagnostic | null) {
  if (!diagnostic) return "";
  const parts = [
    diagnostic.httpStatus != null ? `HTTP ${diagnostic.httpStatus}` : "",
    diagnostic.apiType ? `type=${diagnostic.apiType}` : "",
    diagnostic.apiCode ? `code=${diagnostic.apiCode}` : "",
    diagnostic.requestId ? `request=${diagnostic.requestId}` : "",
    diagnostic.reachedDeepSeek === true ? "已到达 DeepSeek" : diagnostic.reachedDeepSeek === false ? "未到达 DeepSeek" : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function answerToInput(answer: ImportedQuestion["answer"]) {
  if (answer === null) return "";
  if (typeof answer === "boolean") return answer ? "正确" : "错误";
  return Array.isArray(answer) ? answer.join("|") : answer;
}

function answerFromInput(value: string, type: ImportedQuestion["type"]): ImportedQuestion["answer"] {
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (type === "true_false") {
    if (["正确", "对", "TRUE", "√", "A"].includes(cleaned.toUpperCase())) return true;
    if (["错误", "错", "FALSE", "×", "X", "B"].includes(cleaned.toUpperCase())) return false;
  }
  if (type === "multiple") return cleaned.split(/[|,，、;\s]+/).filter(Boolean);
  return cleaned;
}

function answerToQuizValues(answer: ImportedQuestion["answer"]) {
  if (answer === null) return [];
  if (typeof answer === "boolean") return [answer ? "A" : "B"];
  return Array.isArray(answer) ? answer : [answer];
}

function toQuizQuestion(question: ImportedQuestion): Question {
  const typeMap: Record<ImportedQuestion["type"], QuestionType> = {
    single: "single",
    multiple: "multiple",
    true_false: "boolean",
    fill: "fill",
    short_answer: "short",
  };
  return {
    ...question,
    id: question.id || createId(),
    type: typeMap[question.type],
    answer: answerToQuizValues(question.answer),
    difficulty: question.difficulty ?? "",
    answerSource: question.answerSource,
    confidence: question.confidence,
    needsReview: question.needsReview,
  };
}

function mergeAiResult(current: ImportedQuestion[], incoming: ImportedQuestion[]) {
  const incomingById = new Map(incoming.map((question) => [question.id, question]));
  return current.map((question) => {
    if (!hasMissingAnswer(question)) return question;
    const solved = incomingById.get(question.id);
    if (!solved || hasMissingAnswer(solved)) return question;
    return {
      ...question,
      answer: solved.answer,
      explanation: solved.explanation,
      knowledgePoints: solved.knowledgePoints,
      optionExplanations: solved.optionExplanations,
      relatedQuestions: solved.relatedQuestions,
      answerSource: solved.answerSource ?? "ai",
      confidence: solved.confidence,
      needsReview: solved.needsReview,
    };
  });
}

export function ImportPreviewPage() {
  const navigate = useNavigate();
  const payload = useMemo(() => importPreviewStore.load(), []);
  const [result, setResult] = useState(payload?.result ?? null);
  const [name, setName] = useState(payload?.result.suggestedName ?? "导入题库");
  const [subject, setSubject] = useState(payload?.result.suggestedSubject ?? "未分类");
  const [source, setSource] = useState(payload?.result.source ?? "用户导入");
  const [message, setMessage] = useState("");
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiMode, setAiMode] = useState<AiCompletionMode | null>(null);
  const [aiProgress, setAiProgress] = useState<AiProgressState>({ total: 0, processed: 0, succeeded: 0, failed: 0 });
  const [aiError, setAiError] = useState<AiErrorState>(null);
  const [questionErrors, setQuestionErrors] = useState<SolverQuestionError[]>([]);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);
  const [trialSucceeded, setTrialSucceeded] = useState((payload?.result.stats.aiAnswers ?? 0) > 0);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [pendingAiMode, setPendingAiMode] = useState<AiCompletionMode | null>(null);
  const [billingAccess, setBillingAccess] = useState<AiAccessSnapshot | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const aiRunLock = useRef(createAiRunLock()).current;

  if (!result || !payload) {
    return (
      <main className="page-shell centered-state">
        <section className="empty-state">
          <span>⌁</span>
          <h1>没有待预览的导入内容</h1>
          <p>请先从“我的题库”上传文件或粘贴公开链接。</p>
          <Link className="primary-button" to="/">返回我的题库</Link>
        </section>
      </main>
    );
  }

  function persist(nextResult: typeof result) {
    if (!nextResult) return;
    setResult(nextResult);
    importPreviewStore.save({
      originalName: payload!.originalName,
      createdAt: payload!.createdAt,
      result: nextResult,
    });
  }

  function saveAiProgress(progress: SolverProgress) {
    setAiProgress({
      total: progress.total,
      processed: progress.processed,
      succeeded: progress.succeeded,
      failed: progress.failed,
    });
    setQuestionErrors(progress.errors);
    setResult((current) => {
      if (!current) return current;
      const questions = mergeAiResult(current.questions, progress.questions);
      const nextResult: ImportResult = {
        ...current,
        questions,
        stats: {
          ...current.stats,
          sourceAnswers: questions.filter((question) => question.answerSource === "source").length,
          aiAnswers: questions.filter((question) => question.answerSource === "ai").length,
          aiFailures: progress.failed,
          missingAnswers: questions.filter(hasMissingAnswer).length,
          needsReview: questions.filter((question) => question.needsReview).length,
        },
      };
      importPreviewStore.save({
        originalName: payload!.originalName,
        createdAt: payload!.createdAt,
        result: nextResult,
        aiAttempted: true,
      });
      return nextResult;
    });
  }

  async function performAiCompletion(mode: AiCompletionMode, batchConfirmed = false) {
    if (!result) return;
    if (!canStartAiCompletion(mode, batchConfirmed, trialSucceeded)) {
      if (mode === "batch" && !trialSucceeded) {
        setAiError({ title: "请先完成小批量试跑。", action: "至少成功补全 1 道题后，才会开放批量确认。" });
      } else {
        setShowBatchConfirm(true);
      }
      return;
    }
    if (!aiRunLock.tryStart()) return;
    const baseResult = result;
    const missingCount = baseResult.questions.filter(hasMissingAnswer).length;
    if (missingCount === 0) return;
    setAiStatus("running");
    setAiMode(mode);
    setAiProgress({ total: mode === "trial" ? Math.min(AI_TRIAL_SIZE, missingCount) : missingCount, processed: 0, succeeded: 0, failed: 0 });
    setQuestionErrors([]);
    setAiError(null);
    setMessage("");
    try {
      const solved = await solveMissingAnswers(baseResult.questions, {
        limit: mode === "trial" ? AI_TRIAL_SIZE : missingCount,
        // 试跑逐题发送：若第一题就暴露额度/权限问题，不再继续消耗其余试跑请求。
        batchSize: mode === "trial" ? 1 : AI_REQUEST_BATCH_SIZE,
        onProgress: saveAiProgress,
      });
      if (mode === "trial") {
        const wasMissing = new Set(baseResult.questions.filter(hasMissingAnswer).map((question) => question.id));
        const newlySolved = solved.questions.filter((question) => wasMissing.has(question.id) && !hasMissingAnswer(question)).length;
        if (newlySolved > 0) setTrialSucceeded(true);
      }
      setQuestionErrors(solved.errors);
      setAiError(summarizeQuestionErrors(solved.errors));
      setAiStatus(solved.errors.length > 0 ? "partial" : "done");
      const balanceBlockedCount = solved.errors.filter((item) => item.code === "INSUFFICIENT_BALANCE").length;
      if (balanceBlockedCount > 0) {
        setPendingAiMode(mode);
        setPaywallOpen(true);
        setBillingLoading(true);
        try {
          setBillingAccess(await fetchAiAccess(balanceBlockedCount));
        } catch {
          // 缓存命中结果已保留；计费面板稍后可重新打开。
        } finally {
          setBillingLoading(false);
        }
        setBillingError("云端缓存命中的答案已返回；剩余未命中题目需要 AI 余额。请充值或解锁管理员权限后重试。");
      }
    } catch (error) {
      if (error instanceof SolverClientError && error.code === "PAYMENT_REQUIRED") {
        const missing = result?.questions.filter(hasMissingAnswer).length ?? 1;
        const questionCount = mode === "trial" ? Math.min(AI_TRIAL_SIZE, missing) : missing;
        setPendingAiMode(mode);
        setPaywallOpen(true);
        setBillingLoading(true);
        try {
          setBillingAccess(await fetchAiAccess(Math.max(1, questionCount)));
        } catch {
          // 保留原始余额不足提示，避免二次查询失败覆盖主要错误。
        } finally {
          setBillingLoading(false);
        }
        setBillingError("缓存未命中的题目需要 AI 余额。请先充值或解锁管理员权限，再重新开始。");
      }
      setAiError(error instanceof SolverClientError
        ? {
            title: error.message,
            action: error.action,
            code: error.code,
            blocking: ["QUOTA_EXHAUSTED", "RATE_LIMIT_UNKNOWN", "API_KEY_INVALID", "MODEL_PERMISSION_DENIED", "MODEL_NOT_FOUND_OR_DENIED"].includes(error.code),
            diagnostic: error.diagnostic,
          }
        : { title: "AI 模型请求失败。", action: "已完成的批次和原题均已保留，请查看本地服务终端后重试。" });
      setAiStatus("error");
    } finally {
      aiRunLock.release();
    }
  }

  async function openPaywall(mode: AiCompletionMode) {
    if (!result || aiStatus === "running") return;
    const missing = result.questions.filter(hasMissingAnswer).length;
    const questionCount = mode === "trial" ? Math.min(AI_TRIAL_SIZE, missing) : missing;
    setPendingAiMode(mode);
    setPaywallOpen(true);
    setBillingLoading(true);
    setBillingError("");
    setCheckoutMessage("");
    try {
      setBillingAccess(await fetchAiAccess(Math.max(1, questionCount)));
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "无法读取 AI 计费信息。");
    } finally {
      setBillingLoading(false);
    }
  }

  function startTrial() {
    if (aiStatus === "running") return;
    setShowBatchConfirm(false);
    void openPaywall("trial");
  }

  function confirmBatchRun() {
    if (aiStatus === "running") return;
    setShowBatchConfirm(false);
    void openPaywall("batch");
  }

  async function unlockAdminAccess() {
    if (!adminPassword.trim()) {
      setBillingError("请输入管理员密钥。");
      return;
    }
    setBillingLoading(true);
    setBillingError("");
    try {
      await unlockAiAdmin(adminPassword);
      setAdminPassword("");
      if (pendingAiMode && result) {
        const missing = result.questions.filter(hasMissingAnswer).length;
        const questionCount = pendingAiMode === "trial" ? Math.min(AI_TRIAL_SIZE, missing) : missing;
        setBillingAccess(await fetchAiAccess(Math.max(1, questionCount)));
      }
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "管理员解锁失败。");
    } finally {
      setBillingLoading(false);
    }
  }

  async function beginCheckout(amountFen: number) {
    setBillingLoading(true);
    setBillingError("");
    setCheckoutMessage("");
    try {
      const result = await createAiCheckout(amountFen);
      setCheckoutMessage(result.message);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : "创建支付订单失败。");
    } finally {
      setBillingLoading(false);
    }
  }

  function confirmPaidAiRun() {
    if (!pendingAiMode || !billingAccess) return;
    const mode = pendingAiMode;
    setPaywallOpen(false);
    setBillingError("");
    setCheckoutMessage("");
    void performAiCompletion(mode, mode === "batch");
  }

  function updateQuestion(index: number, patch: Partial<ImportedQuestion>) {
    if (!result) return;
    const questions = result.questions.map((question, questionIndex) =>
      questionIndex === index ? { ...question, ...patch } : question,
    );
    const stats = {
      ...result.stats,
      parsedQuestions: questions.length,
      sourceAnswers: questions.filter((question) => question.answerSource === "source").length,
      aiAnswers: questions.filter((question) => question.answerSource === "ai").length,
      missingAnswers: questions.filter((question) => question.answerSource === "missing").length,
      needsReview: questions.filter((question) => question.needsReview).length,
    };
    persist({ ...result, questions, stats, success: questions.length > 0 });
  }

  function updateOption(questionIndex: number, optionIndex: number, text: string) {
    if (!result) return;
    const question = result.questions[questionIndex];
    const options = question.options.map((option, index) => index === optionIndex ? { ...option, text } : option);
    updateQuestion(questionIndex, { options });
  }

  function removeQuestion(index: number) {
    if (!result) return;
    const questions = result.questions.filter((_, questionIndex) => questionIndex !== index);
    const stats = {
      ...result.stats,
      parsedQuestions: questions.length,
      sourceAnswers: questions.filter((question) => question.answerSource === "source").length,
      aiAnswers: questions.filter((question) => question.answerSource === "ai").length,
      missingAnswers: questions.filter((question) => question.answerSource === "missing").length,
      needsReview: questions.filter((question) => question.needsReview).length,
    };
    persist({ ...result, questions, stats, success: questions.length > 0 });
  }

  function updateMapping(field: CanonicalField, header: string) {
    if (!result?.mapping) return;
    const fields = { ...result.mapping.fields };
    if (header) fields[field] = header;
    else delete fields[field];
    persist(reparseTabularImport(result, fields));
  }

  function confirmImport() {
    if (!result || result.questions.length === 0) {
      setMessage("没有可导入的题目。");
      return;
    }
    const invalidIndex = result.questions.findIndex((question) => !question.question.trim());
    if (invalidIndex >= 0) {
      setMessage(`第 ${invalidIndex + 1} 道题缺少题干，请先补充。`);
      return;
    }
    const now = new Date().toISOString();
    void cacheOriginalAnswers(result.questions).catch(() => {
      // 云端种子缓存失败不应阻止用户导入本地题库。
    });
    questionBankRepository.save({
      id: createId("bank"),
      name: name.trim() || "导入题库",
      subject: subject.trim() || "未分类",
      source: source.trim() || "用户导入",
      createdAt: now,
      updatedAt: now,
      questions: result.questions.map(toQuizQuestion),
    });
    importPreviewStore.clear();
    navigate("/", { replace: true, state: { importCount: result.questions.length } });
  }

  const failedCount = result.failedBlocks.length;
  const reviewCount = result.stats.needsReview + failedCount;
  const missingCount = result.questions.filter(hasMissingAnswer).length;
  const progressPercent = aiProgress.total > 0 ? Math.round(aiProgress.processed / aiProgress.total * 100) : 0;

  return (
    <main className="page-shell preview-shell">
      <div className="quiz-breadcrumb"><Link to="/">我的题库</Link><span>/</span><strong>导入预览</strong></div>

      <section className="preview-heading">
        <div>
          <span className="eyebrow">导入前最后检查</span>
          <h1>导入预览</h1>
          <p>内容还没有写入题库。可以修正识别结果、删除错误题目，再批量确认。</p>
        </div>
        <button className="primary-button" onClick={confirmImport}>确认导入 {result.questions.length} 道题</button>
      </section>

      <section className="preview-stats import-detail-stats" aria-label="解析统计">
        <div><span>总题数</span><strong>{result.total}</strong></div>
        <div className="success-stat"><span>成功识别</span><strong>{result.questions.length}</strong></div>
        <div className="error-stat"><span>人工确认</span><strong>{reviewCount}</strong></div>
        <div><span>原题答案</span><strong>{result.stats.sourceAnswers}</strong></div>
        <div><span>AI 补全</span><strong>{result.stats.aiAnswers}</strong></div>
        <div className="error-stat"><span>AI 失败</span><strong>{result.stats.aiFailures}</strong></div>
        <div><span>仍缺答案</span><strong>{result.stats.missingAnswers}</strong></div>
      </section>

      {missingCount > 0 && (
          <section className={`ai-solver-status panel-card status-${aiStatus}`}>
            <div className="ai-solver-main">
              <strong>
                {aiStatus === "running" && (aiMode === "trial" ? "正在试跑 5 道题…" : "正在分批补全答案…")}
                {aiStatus === "error" && "AI 补全已暂停"}
                {aiStatus === "partial" && "本次处理部分成功"}
                {aiStatus === "done" && "本次处理完成"}
                {aiStatus === "idle" && "检测到无答案题目"}
              </strong>
              <p>
                {aiStatus === "idle"
                  ? `仍有 ${missingCount} 道题缺少答案。系统不会自动提交，请先试跑少量题目。`
                  : `仍有 ${missingCount} 道题缺少答案；每次只发送仍缺答案的题目，已有答案不会覆盖。`}
              </p>

              {(aiStatus === "running" || aiProgress.processed > 0) && (
                <div className="ai-progress" aria-live="polite">
                  <div className="ai-progress-labels">
                    <span>进度 {aiProgress.processed} / {aiProgress.total}</span>
                    <span>成功 {aiProgress.succeeded} · 失败 {aiProgress.failed}</span>
                  </div>
                  <div className="ai-progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
                </div>
              )}

              {aiError && (
                <div className="ai-error-detail" role="alert">
                  <b>{aiError.title}</b>
                  <span>{aiError.action}</span>
                  {diagnosticText(aiError.diagnostic) && <small>脱敏诊断：{diagnosticText(aiError.diagnostic)}</small>}
                </div>
              )}

              {questionErrors.length > 0 && (
                <details className="ai-question-errors">
                  <summary>查看失败详情（{questionErrors.length} 道）</summary>
                  <ul>
                    {questionErrors.slice(0, 10).map((error) => (
                      <li key={`${error.id}-${error.code}`}>
                        <code>{error.id}</code>：{error.reason}
                        {diagnosticText(error.diagnostic) && <small>（{diagnosticText(error.diagnostic)}）</small>}
                      </li>
                    ))}
                  </ul>
                  {questionErrors.length > 10 && <p>其余 {questionErrors.length - 10} 道未展开显示。</p>}
                </details>
              )}

              {showBatchConfirm && aiStatus !== "running" && (
                <div className="ai-batch-confirm" role="alertdialog" aria-label="确认批量 AI 补全">
                  <p>将分批处理当前仍缺答案的 {missingCount} 道题，可能产生 API 费用。每批完成后立即保存，失败题保留并可单独重试。</p>
                  <div>
                    <button className="primary-button" onClick={confirmBatchRun}>确认并开始</button>
                    <button className="text-button" onClick={() => setShowBatchConfirm(false)}>取消</button>
                  </div>
                </div>
              )}
            </div>
            <div className="ai-solver-actions">
              <button className="secondary-button" disabled={aiStatus === "running" || aiError?.blocking} onClick={startTrial}>
                试跑最多 {Math.min(AI_TRIAL_SIZE, missingCount)} 道
              </button>
              <button
                className="primary-button"
                disabled={aiStatus === "running" || !trialSucceeded || aiError?.blocking}
                onClick={() => setShowBatchConfirm(true)}
                title={trialSucceeded ? "" : "请先成功试跑至少 1 道题"}
              >
                批量补全剩余 {missingCount} 道
              </button>
              {!trialSucceeded && <small className="ai-batch-hint">试跑成功后开放批量处理</small>}
              {aiError?.blocking && <small className="ai-batch-hint">请先处理上方账户或权限问题，然后刷新页面重新检查。</small>}
            </div>
          </section>
      )}

      {paywallOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card ai-paywall-card" role="dialog" aria-modal="true" aria-label="AI 解题计费">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">AI 解题计费</span>
                <h2>{billingAccess?.adminMode ? "管理员已解锁" : "确认本次 AI 费用"}</h2>
              </div>
              <button className="close-button" type="button" onClick={() => setPaywallOpen(false)}>×</button>
            </div>

            {billingLoading && <p className="billing-loading">正在读取余额与 Token 预估…</p>}

            {billingAccess && !billingLoading && (
              <>
                <div className="billing-summary-grid">
                  <div><span>预计 Token</span><strong>{billingAccess.quote.estimatedTotalTokens.toLocaleString()}</strong></div>
                  <div><span>未命中预计费用</span><strong>{billingAccess.adminMode ? "¥0.00" : `¥${(billingAccess.quote.estimatedUserChargeFen / 100).toFixed(2)}`}</strong></div>
                  <div><span>当前余额</span><strong>{billingAccess.adminMode ? "管理员" : `¥${(billingAccess.wallet.balanceFen / 100).toFixed(2)}`}</strong></div>
                </div>
                <div className="billing-breakdown">
                  <span>模型成本预估 <b>¥{(billingAccess.quote.estimatedProviderCostFen / 100).toFixed(2)}</b></span>
                  <span>平台服务费预估 <b>¥{(billingAccess.quote.estimatedPlatformFeeFen / 100).toFixed(2)}</b></span>
                  <small>最终按实际 Token 结算；管理员会话不扣余额。</small>
                </div>

                {!billingAccess.adminMode && billingAccess.wallet.balanceFen < billingAccess.quote.estimatedUserChargeFen && (
                  <div className="recharge-panel">
                    <strong>余额不足</strong>
                    <p>云端缓存命中免费；只有未命中、需要调用 AI 的题目才计费。真实支付渠道尚未接通时，只会创建待支付订单，不会直接增加余额。</p>
                    <div className="recharge-packages">
                      {[500, 1000, 3000].map((amountFen) => (
                        <button key={amountFen} type="button" className="recharge-package" disabled={billingLoading} onClick={() => void beginCheckout(amountFen)}>
                          <span>充值 ¥{(amountFen / 100).toFixed(0)}</span>
                          <small>{billingAccess.paymentConfigured ? "创建支付订单" : "查看支付接入状态"}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="admin-unlock-panel">
                  <span>管理员密钥</span>
                  <div>
                    <input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="仅管理员本人输入" />
                    <button type="button" className="secondary-button" disabled={billingLoading} onClick={() => void unlockAdminAccess()}>解锁</button>
                  </div>
                </div>
              </>
            )}

            {checkoutMessage && <p className="message-warning billing-message">{checkoutMessage}</p>}
            {billingError && <p className="message-error billing-error">{billingError}</p>}

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setPaywallOpen(false)}>取消</button>
              <button
                type="button"
                className="primary-button"
                disabled={
                  billingLoading
                  || !billingAccess
                }
                onClick={confirmPaidAiRun}
              >
                {billingAccess?.adminMode ? "管理员模式：查缓存并开始" : "查云端缓存并开始"}
              </button>
            </div>
          </section>
        </div>
      )}
      <section className="preview-settings panel-card">
        <label>题库名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>科目<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label>来源<input value={source} onChange={(event) => setSource(event.target.value)} /></label>
      </section>

      {result.mapping && (
        <section className="mapping-panel panel-card">
          <div>
            <h2>确认表格列映射</h2>
            <p>系统已尝试匹配列名。只有题干是必填项；没有答案的题也会保留。</p>
          </div>
          <div className="mapping-grid">
            {editableFields.map((field) => (
              <label key={field} className={result.mapping?.uncertainFields.includes(field) ? "mapping-uncertain" : ""}>
                {fieldLabels[field]}
                <select value={result.mapping?.fields[field] ?? ""} onChange={(event) => updateMapping(field, event.target.value)}>
                  <option value="">不导入</option>
                  {result.mapping?.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      {(result.warnings.length > 0 || result.errors.length > 0 || message) && (
        <section className="import-messages" aria-live="polite">
          {message && <p className="message-error">{message}</p>}
          {result.warnings.map((warning) => <p className="message-warning" key={warning}>{warning}</p>)}
          {result.errors.map((error, index) => <p className="message-error" key={`${error}-${index}`}>{error}</p>)}
        </section>
      )}

      {result.failedBlocks.length > 0 && (
        <section className="failed-blocks panel-card">
          <h2>需要人工确认的题块</h2>
          <p>这些原始内容没有被删除，可以展开检查。</p>
          {result.failedBlocks.map((block) => (
            <details key={`${block.index}-${block.marker}`}>
              <summary>题块 #{block.index}：{block.reason}</summary>
              <pre>{block.rawText}</pre>
            </details>
          ))}
        </section>
      )}

      <section className="preview-list">
        {result.questions.map((question, index) => (
          <article className="preview-question panel-card" key={`${question.id}-${index}`}>
            <div className="preview-question-head">
              <div><strong>第 {index + 1} 题</strong><span className={`answer-source source-${question.answerSource}`}>{question.answerSource === "source" ? "原题答案" : question.answerSource === "ai" ? "AI 生成答案" : question.answerSource === "manual" ? "人工答案" : "缺少答案"}</span></div>
              <button className="text-button danger-text" onClick={() => removeQuestion(index)}>删除此题</button>
            </div>
            <label>题干<textarea rows={2} value={question.question} onChange={(event) => updateQuestion(index, { question: event.target.value })} /></label>
            <div className="preview-row">
              <label>题型
                <select value={question.type} onChange={(event) => updateQuestion(index, { type: event.target.value as ImportedQuestion["type"] })}>
                  <option value="single">单选题</option><option value="multiple">多选题</option>
                  <option value="true_false">判断题</option><option value="fill">填空题</option>
                  <option value="short_answer">简答题</option>
                </select>
              </label>
              <label>难度
                <select value={question.difficulty ?? ""} onChange={(event) => updateQuestion(index, { difficulty: (event.target.value || null) as ImportedQuestion["difficulty"] })}>
                  <option value="">未设置</option><option value="easy">简单</option>
                  <option value="medium">中等</option><option value="hard">困难</option>
                </select>
              </label>
            </div>
            {question.options.length > 0 && (
              <div className="preview-options">
                {question.options.map((option, optionIndex) => (
                  <label key={`${option.id}-${optionIndex}`}><span>{option.id}</span><input value={option.text} onChange={(event) => updateOption(index, optionIndex, event.target.value)} /></label>
                ))}
              </div>
            )}
            <div className="preview-row">
              <label>答案<input value={answerToInput(question.answer)} onChange={(event) => {
                const answer = answerFromInput(event.target.value, question.type);
                updateQuestion(index, {
                  answer,
                  answerSource: answer === null ? "missing" : "manual",
                  confidence: null,
                  needsReview: answer === null,
                });
              }} placeholder="可以留空；多选用 | 分隔，如 A|C" /></label>
              <label>知识点<input value={question.knowledgePoints.join("、")} onChange={(event) => updateQuestion(index, { knowledgePoints: event.target.value.split(/[、,，|]/).map((item) => item.trim()).filter(Boolean) })} /></label>
            </div>
            <label>解析<textarea rows={2} value={question.explanation} onChange={(event) => updateQuestion(index, { explanation: event.target.value })} /></label>
            {question.answerSource === "ai" && <p className="ai-review-note">AI 生成答案{question.confidence !== null ? ` · 置信度 ${Math.round(question.confidence * 100)}%` : ""}，建议人工核对。</p>}
            {question.parseWarnings.length > 0 && <ul className="parse-warning-list">{question.parseWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          </article>
        ))}
        {result.questions.length === 0 && <div className="empty-state"><h2>没有成功识别的题目</h2><p>请查看上方错误信息，调整文件后重新上传。</p></div>}
      </section>

      <div className="preview-bottom-actions">
        <Link className="secondary-button" to="/">取消并返回</Link>
        <button className="primary-button" onClick={confirmImport}>确认导入</button>
      </div>
    </main>
  );
}

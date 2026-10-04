import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { questionBankRepository } from "@/lib/questionBankRepository";
import { isAiCompletionEnabled, SolverClientError } from "@/lib/aiSolverClient";
import {
  completeMissingQuestionAnswer,
  questionHasAnswer,
} from "@/lib/questionAnswerCompletion";
import {
  getWrongQuestions,
  recordWrongQuestion,
  removeWrongQuestion,
} from "@/lib/wrongQuestionTracker";
import type { Question } from "@/types/quiz";

const typeLabels = {
  single: "单选题",
  multiple: "多选题",
  boolean: "判断题",
  fill: "填空题",
  short: "简答题",
};

function sameAnswers(selected: string[], answer: string[]) {
  if (selected.length !== answer.length) return false;
  const expected = new Set(answer);
  return selected.every((item) => expected.has(item));
}

function difficultyLabel(question: Question) {
  return { easy: "简单", medium: "中等", hard: "困难", "": "未设置" }[question.difficulty];
}

export function QuizPage() {
  const { bankId = "" } = useParams();
  const location = useLocation();
  const [bankVersion, setBankVersion] = useState(0);
  const bank = useMemo(() => questionBankRepository.getById(bankId), [bankId, bankVersion]);
  const mode = new URLSearchParams(location.search).get("mode");
  const wrongQuestions = useMemo(() => getWrongQuestions(bankId), [bankId, bankVersion, location.search]);
  const drillQuestions = useMemo(() => {
    if (!bank) return [];
    if (mode !== "wrong") return bank.questions;
    const wrongIds = new Set(wrongQuestions.map((question) => question.questionId));
    return bank.questions.filter((question) => wrongIds.has(question.id));
  }, [bank, mode, wrongQuestions]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [complete, setComplete] = useState(false);
  const [aiStatus, setAiStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [aiMessage, setAiMessage] = useState("");
  const autoAttempted = useRef(new Set<string>());
  const aiRunning = useRef(false);
  const activeQuestion = drillQuestions[currentIndex];

  const completeCurrentAnswer = useCallback(async (questionId: string) => {
    if (!isAiCompletionEnabled()) {
      setAiStatus("idle");
      setAiMessage("当前离线版已关闭 AI 自动补全，题目答案需在导入预览中人工确认。");
      return;
    }
    if (aiRunning.current) return;
    aiRunning.current = true;
    setAiStatus("running");
    setAiMessage("正在请求 DeepSeek 解题…");
    try {
      const completed = await completeMissingQuestionAnswer(bankId, questionId);
      setBankVersion((value) => value + 1);
      setAiStatus("done");
      setAiMessage(completed.aiRequested
        ? completed.saved
          ? "DeepSeek 已补全并保存到当前题库，下次不会重复调用 API。"
          : "题目已有更新，已保留现有答案且没有覆盖。"
        : "已直接使用题库原答案，没有调用 DeepSeek。");
    } catch (error) {
      setAiStatus("error");
      setAiMessage(error instanceof SolverClientError
        ? `${error.message} ${error.action}`
        : error instanceof Error ? error.message : "AI 解题暂时失败，请重新尝试。");
    } finally {
      aiRunning.current = false;
    }
  }, [bankId]);

  useEffect(() => {
    if (!activeQuestion) return;
    setAiStatus("idle");
    setAiMessage("");
    const attemptKey = `${bankId}:${activeQuestion.id}`;
    if (!isAiCompletionEnabled()) {
      setAiMessage("当前版本已关闭 AI 自动补全，需在导入预览中人工核对答案。");
      return;
    }
    if (questionHasAnswer(activeQuestion) || autoAttempted.current.has(attemptKey)) return;
    autoAttempted.current.add(attemptKey);
    void completeCurrentAnswer(activeQuestion.id);
  }, [activeQuestion?.id, bankId, completeCurrentAnswer]);

  if (!bank) {
    return (
      <main className="page-shell centered-state">
        <h1>没有找到这个题库</h1>
        <p>题库可能已被删除，或链接已经失效。</p>
        <Link className="primary-button" to="/">返回我的题库</Link>
      </main>
    );
  }

  if (bank.questions.length === 0) {
    return (
      <main className="page-shell centered-state">
        <h1>{bank.name}</h1>
        <p>这个题库暂时没有题目，请先上传题库文件。</p>
        <Link className="primary-button" to="/">返回我的题库</Link>
      </main>
    );
  }

  if (mode === "wrong" && drillQuestions.length === 0) {
    return (
      <main className="page-shell centered-state">
        <h1>{bank.name}</h1>
        <p>当前错题本为空，先继续做题并答错后，错题会自动加入这里。</p>
        <div className="complete-actions">
          <Link className="primary-button" to={`/banks/${bankId}/practice`}>开始普通练习</Link>
          <Link className="secondary-button" to="/">返回题库</Link>
        </div>
      </main>
    );
  }

  // 前面的空状态已经返回，这里固定为有效题库，方便回调函数正确推断类型。
  const currentBank = bank;
  const question = drillQuestions[currentIndex];
  const supported = ["single", "multiple", "boolean"].includes(question.type);
  const hasAnswer = questionHasAnswer(question);
  const gradable = supported && hasAnswer;
  const correct = submitted && gradable && sameAnswers(selected, question.answer);
  const progress = ((currentIndex + (submitted ? 1 : 0)) / drillQuestions.length) * 100;

  function selectOption(optionId: string) {
    if (submitted) return;
    if (question.type === "multiple") {
      setSelected((previous) =>
        previous.includes(optionId)
          ? previous.filter((item) => item !== optionId)
          : [...previous, optionId],
      );
    } else setSelected([optionId]);
  }

  function submitAnswer() {
    if (selected.length === 0 || submitted) return;
    const isCorrect = sameAnswers(selected, question.answer);
    if (isCorrect) {
      removeWrongQuestion(bankId, question.id);
      setScore((value) => value + 1);
    } else {
      recordWrongQuestion(bankId, question, selected);
    }
    setSubmitted(true);
    setBankVersion((value) => value + 1);
  }

  function nextQuestion() {
    if (currentIndex === drillQuestions.length - 1) {
      setComplete(true);
      return;
    }
    setCurrentIndex((value) => value + 1);
    setSelected([]);
    setSubmitted(false);
  }

  function skipUnsupported() {
    if (currentIndex === drillQuestions.length - 1) setComplete(true);
    else {
      setCurrentIndex((value) => value + 1);
      setSelected([]);
      setSubmitted(false);
    }
  }

  function optionState(optionId: string) {
    if (!submitted) return selected.includes(optionId) ? "selected" : "";
    if (question.answer.includes(optionId)) return "correct";
    if (selected.includes(optionId)) return "incorrect";
    return "muted";
  }

  if (complete) {
    return (
      <main className="page-shell centered-state complete-state">
        <div className="completion-badge">✓</div>
        <span className="eyebrow">练习完成</span>
        <h1>完成了 {currentBank.name}</h1>
        <p>本次答对 <strong>{score}</strong> / {drillQuestions.length} 题</p>
        <div className="score-bar"><span style={{ width: `${(score / drillQuestions.length) * 100}%` }} /></div>
        <div className="complete-actions">
          <button className="primary-button" onClick={() => {
            setCurrentIndex(0);
            setSelected([]);
            setSubmitted(false);
            setScore(0);
            setComplete(false);
          }}>再练一次</button>
          <Link className="secondary-button" to="/">返回题库</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="quiz-shell">
      <div className="quiz-breadcrumb">
        <Link to="/">我的题库</Link><span>/</span><strong>{currentBank.name}</strong>
      </div>
      <div className="progress-block">
        <div className="progress-labels">
          <span>练习进度</span>
          <span><strong>{currentIndex + 1}</strong> / {drillQuestions.length}</span>
        </div>
        <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <article className="question-card">
        <div className="question-meta">
          <div>
            <span className="question-number">第 {currentIndex + 1} 题</span>
            <span className="type-tag">{typeLabels[question.type]}</span>
          </div>
          <span className="difficulty-tag">难度：{difficultyLabel(question)}</span>
        </div>

        {question.knowledgePoints.length > 0 && (
          <div className="knowledge-list">
            {question.knowledgePoints.map((point) => <span key={point}>{point}</span>)}
          </div>
        )}

        <h1>{question.question}</h1>
        {question.type === "multiple" && <p className="question-hint">本题有多个正确答案</p>}
        {question.answerSource === "ai" && <p className="ai-review-note">AI 生成答案{question.confidence != null ? ` · 置信度 ${Math.round(question.confidence * 100)}%` : ""}，建议人工核对。</p>}
        {!hasAnswer && (
          <p className="ai-review-note">
            {isAiCompletionEnabled()
              ? "这道题缺少答案，系统会自动请求 DeepSeek；失败时可在下方重试。"
              : "当前离线版已关闭 AI 自动补全，请在导入预览中人工确认答案后再开始刷题。"}
          </p>
        )}
        {aiMessage && <p className={`ai-review-note ${aiStatus === "error" ? "message-error" : ""}`} role="status">{aiMessage}</p>}

        {supported ? (
          <div className="options" role={question.type === "multiple" ? "group" : "radiogroup"} aria-label="答案选项">
            {question.options.map((option) => (
              <button
                key={option.id}
                className={`option ${optionState(option.id)}`}
                onClick={() => selectOption(option.id)}
                disabled={submitted || !hasAnswer}
                aria-pressed={selected.includes(option.id)}
              >
                <span className="option-letter">{option.id}</span>
                <span>{option.text}</span>
                {submitted && question.answer.includes(option.id) && <strong className="result-symbol">✓</strong>}
                {submitted && selected.includes(option.id) && !question.answer.includes(option.id) && <strong className="result-symbol">×</strong>}
              </button>
            ))}
          </div>
        ) : (
          <div className="future-type-note">
            <strong>该题型已成功导入</strong>
            <p>填空题和简答题的作答界面将在后续阶段开放。</p>
          </div>
        )}

        {submitted && (
          <section className={`explanation ${correct ? "success" : "error"}`}>
            <div className="explanation-heading"><span>{correct ? "✓" : "!"}</span><strong>{correct ? "回答正确" : "回答错误"}</strong></div>
            <p><b>正确答案</b>{question.answer.join("、")}</p>
            <p><b>解析</b>{question.explanation || "这道题暂时没有解析。"}</p>
            {question.optionExplanations && question.optionExplanations.length > 0 && (
              <div>
                <b>选项说明</b>
                {question.optionExplanations.map((item) => (
                  <p key={item.optionId}><strong>{item.optionId}</strong>：{item.explanation}</p>
                ))}
              </div>
            )}
          </section>
        )}

        {submitted && question.relatedQuestions && question.relatedQuestions.length > 0 && (
          <section className="explanation">
            <div className="explanation-heading"><span>↗</span><strong>相关练习题</strong></div>
            {question.relatedQuestions.map((related, index) => (
              <details key={`${related.question}-${index}`}>
                <summary>{index + 1}. {related.question}</summary>
                <p><b>答案</b>{Array.isArray(related.answer) ? related.answer.join("、") : String(related.answer)}</p>
                <p><b>解析</b>{related.explanation}</p>
              </details>
            ))}
          </section>
        )}

        <footer className="question-footer">
          <span>来源：{question.source || currentBank.source}</span>
          {!hasAnswer ? (
            <button className="primary-button" onClick={() => void completeCurrentAnswer(question.id)} disabled={aiStatus === "running"}>
              {aiStatus === "running" ? "DeepSeek 解题中…" : aiStatus === "error" ? "重新尝试补全答案" : "用 DeepSeek 补全答案"}
            </button>
          ) : gradable ? (
            submitted ? (
              <button className="primary-button" onClick={nextQuestion}>{currentIndex === drillQuestions.length - 1 ? "查看结果" : "下一题"} →</button>
            ) : (
              <button className="primary-button" onClick={submitAnswer} disabled={selected.length === 0}>提交答案</button>
            )
          ) : (
            <button className="primary-button" onClick={skipUnsupported}>继续下一题 →</button>
          )}
        </footer>
      </article>
    </main>
  );
}

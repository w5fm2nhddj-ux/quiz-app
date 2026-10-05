import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { questionBankRepository } from "@/lib/questionBankRepository";
import {
  clearWrongQuestions,
  getWrongQuestions,
  type WrongQuestionRecord,
} from "@/lib/wrongQuestionTracker";

const typeLabels: Record<WrongQuestionRecord["questionType"], string> = {
  single: "单选题",
  multiple: "多选题",
  boolean: "判断题",
  fill: "填空题",
  short: "简答题",
};

export function WrongQuestionsPage() {
  const { bankId = "" } = useParams();
  const bank = useMemo(() => questionBankRepository.getById(bankId), [bankId]);
  const [wrongQuestions, setWrongQuestions] = useState<WrongQuestionRecord[]>(() => getWrongQuestions(bankId));

  useEffect(() => {
    setWrongQuestions(getWrongQuestions(bankId));
  }, [bankId]);

  if (!bank) {
    return (
      <main className="page-shell centered-state">
        <h1>没有找到这个错题本</h1>
        <p>题库可能已被删除，或者本次复习记录不存在。</p>
        <Link className="primary-button" to="/">返回我的题库</Link>
      </main>
    );
  }

  const bankName = bank?.name ?? "当前题库";

  function handleClear() {
    if (!window.confirm(`确定清空“${bankName}”的错题本吗？`)) return;
    clearWrongQuestions(bankId);
    setWrongQuestions([]);
  }

  return (
    <main className="page-shell preview-shell">
      <header className="preview-heading">
        <div>
          <span className="eyebrow">错题复习</span>
          <h1>{bank.name}</h1>
          <p>你的错题会被本地保存，并在这里保留为下一轮复习的优先题目。</p>
        </div>
        <div className="hero-actions">
          <Link className="secondary-button" to={`/banks/${bank.id}/practice`}>返回练习</Link>
          <Link className="primary-button" to={`/banks/${bank.id}/practice?mode=wrong`}>开始错题刷题</Link>
        </div>
      </header>

      <section className="library-summary" aria-label="错题统计">
        <div><strong>{wrongQuestions.length}</strong><span>道错题</span></div>
        <div><strong>{bank.questions.length}</strong><span>总题数</span></div>
        <div><strong>{Math.max(0, bank.questions.length - wrongQuestions.length)}</strong><span>已掌握</span></div>
      </section>

      {wrongQuestions.length === 0 ? (
        <section className="empty-state panel-card" style={{ minHeight: 280, padding: "32px 24px" }}>
          <span>✓</span>
          <h2>目前还没有错题</h2>
          <p>继续练习并在回答错误时自动加入错题本，完成一次真正的复盘。</p>
        </section>
      ) : (
        <section className="wrong-list" style={{ display: "grid", gap: "16px" }}>
          {wrongQuestions.map((question, index) => (
            <article className="panel-card wrong-question-item" key={`${question.bankId}-${question.questionId}`} style={{ padding: "22px" }}>
              <div className="wrong-head" style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
                <span className="type-tag">{typeLabels[question.questionType]}</span>
                <span className="difficulty-tag">错题 #{index + 1}</span>
              </div>
              <h3 style={{ margin: "0 0 10px", fontSize: "20px", lineHeight: 1.5 }}>{question.questionText}</h3>
              <p style={{ margin: "0 0 8px", color: "#5f5b69" }}><strong>你的答案：</strong> {question.selectedOptions.length > 0 ? question.selectedOptions.join("、") : "未作答"}</p>
              <p style={{ margin: "0 0 18px", color: "#5f5b69" }}><strong>正确答案：</strong> {question.correctAnswer.length > 0 ? question.correctAnswer.join("、") : "暂无答案"}</p>
              <div className="wrong-actions" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <span style={{ color: "#9b98a5", fontSize: "12px" }}>最近复习：{new Date(question.lastAttemptedAt).toLocaleString("zh-CN")}</span>
                <Link className="primary-button" to={`/banks/${bankId}/practice?mode=wrong&questionId=${encodeURIComponent(question.questionId)}`}>重做这题</Link>
              </div>
            </article>
          ))}
        </section>
      )}

      {wrongQuestions.length > 0 && (
        <div className="modal-actions" style={{ marginTop: "20px", justifyContent: "flex-end" }}>
          <button type="button" className="secondary-button" onClick={handleClear}>清空错题本</button>
        </div>
      )}
    </main>
  );
}

"use client";

import { useState } from "react";
import questionsData from "@/data/questions.json";

type Option = {
  id: string;
  text: string;
};

type Question = {
  id: number;
  question: string;
  options: Option[];
  correctAnswer: string;
  explanation: string;
  knowledgePoint: string;
};

type QuizStage = "welcome" | "quiz" | "complete";

const questions = questionsData as Question[];

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="25" height="25">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a2 2 0 0 1 2 2v16a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H15a2 2 0 0 0-2 2v16a2 2 0 0 1 2-2h2.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path d="M12 2c.6 5.1 2.9 7.4 8 8-5.1.6-7.4 2.9-8 8-.6-5.1-2.9-7.4-8-8 5.1-.6 7.4-2.9 8-8Z" />
      <path d="M19 16c.2 2.1 1.2 3.1 3 3.5-1.8.4-2.8 1.4-3 3.5-.2-2.1-1.2-3.1-3-3.5 1.8-.4 2.8-1.4 3-3.5Z" />
    </svg>
  );
}

export default function Home() {
  const [stage, setStage] = useState<QuizStage>("welcome");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);

  const currentQuestion = questions[currentIndex];
  const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
  const progress = ((currentIndex + (isSubmitted ? 1 : 0)) / questions.length) * 100;

  function startQuiz() {
    setStage("quiz");
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setIsSubmitted(false);
    setScore(0);
  }

  function submitAnswer() {
    if (!selectedAnswer || isSubmitted) return;

    if (selectedAnswer === currentQuestion.correctAnswer) {
      setScore((previousScore) => previousScore + 1);
    }
    setIsSubmitted(true);
  }

  function goToNextQuestion() {
    if (currentIndex === questions.length - 1) {
      setStage("complete");
      return;
    }

    setCurrentIndex((previousIndex) => previousIndex + 1);
    setSelectedAnswer(null);
    setIsSubmitted(false);
  }

  function getOptionState(optionId: string) {
    if (!isSubmitted) return selectedAnswer === optionId ? "selected" : "";
    if (optionId === currentQuestion.correctAnswer) return "correct";
    if (optionId === selectedAnswer) return "incorrect";
    return "muted";
  }

  return (
    <main className="app-shell">
      <div className="background-orb orb-one" />
      <div className="background-orb orb-two" />

      <header className="site-header">
        <button className="brand" onClick={() => setStage("welcome")} aria-label="返回首页">
          <span className="brand-mark"><BookIcon /></span>
          <span>知点练习</span>
        </button>
        <span className="header-note">每天进步一点点</span>
      </header>

      {stage === "welcome" && (
        <section className="welcome-card panel-enter" aria-labelledby="welcome-title">
          <div className="eyebrow"><SparkleIcon /> 今日练习已准备好</div>
          <h1 id="welcome-title">把每一道题，<br /><span>变成你的底气。</span></h1>
          <p className="welcome-copy">
            用一组轻量练习检验所学，即时查看答案和解析。专注当下，稳步向前。
          </p>

          <div className="welcome-stats" aria-label="练习信息">
            <div><strong>{questions.length}</strong><span>道精选题目</span></div>
            <div className="stat-divider" />
            <div><strong>约 5</strong><span>分钟完成</span></div>
            <div className="stat-divider" />
            <div><strong>即时</strong><span>答案解析</span></div>
          </div>

          <button className="primary-button start-button" onClick={startQuiz}>
            开始今日练习 <ArrowRightIcon />
          </button>
          <p className="start-hint">无需登录 · 随时开始</p>
        </section>
      )}

      {stage === "quiz" && (
        <section className="quiz-wrap panel-enter" aria-live="polite">
          <div className="progress-block">
            <div className="progress-labels">
              <span>练习进度</span>
              <span><strong>{currentIndex + 1}</strong> / {questions.length}</span>
            </div>
            <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <article className="question-card">
            <div className="question-meta">
              <span className="question-number">第 {currentIndex + 1} 题</span>
              <span className="knowledge-tag">{currentQuestion.knowledgePoint}</span>
            </div>

            <h2>{currentQuestion.question}</h2>

            <div className="options" role="radiogroup" aria-label="请选择一个答案">
              {currentQuestion.options.map((option) => {
                const state = getOptionState(option.id);
                return (
                  <button
                    key={option.id}
                    className={`option ${state}`}
                    onClick={() => !isSubmitted && setSelectedAnswer(option.id)}
                    disabled={isSubmitted}
                    role="radio"
                    aria-checked={selectedAnswer === option.id}
                  >
                    <span className="option-letter">{option.id}</span>
                    <span className="option-text">{option.text}</span>
                    {isSubmitted && option.id === currentQuestion.correctAnswer && (
                      <span className="result-symbol" aria-label="正确答案">✓</span>
                    )}
                    {isSubmitted && option.id === selectedAnswer && !isCorrect && (
                      <span className="result-symbol" aria-label="你的答案错误">×</span>
                    )}
                  </button>
                );
              })}
            </div>

            {isSubmitted && (
              <div className={`explanation ${isCorrect ? "success" : "error"}`}>
                <div className="explanation-heading">
                  <span className="feedback-icon">{isCorrect ? "✓" : "!"}</span>
                  <strong>{isCorrect ? "回答正确，很棒！" : "再想一步，下次一定可以"}</strong>
                </div>
                <p><span>解析</span>{currentQuestion.explanation}</p>
              </div>
            )}

            <div className="card-footer">
              <span className="selection-hint">
                {isSubmitted ? `正确答案：${currentQuestion.correctAnswer}` : "选择你认为正确的答案"}
              </span>
              {!isSubmitted ? (
                <button className="primary-button" onClick={submitAnswer} disabled={!selectedAnswer}>
                  提交答案
                </button>
              ) : (
                <button className="primary-button" onClick={goToNextQuestion}>
                  {currentIndex === questions.length - 1 ? "查看结果" : "下一题"} <ArrowRightIcon />
                </button>
              )}
            </div>
          </article>
        </section>
      )}

      {stage === "complete" && (
        <section className="complete-card panel-enter" aria-labelledby="complete-title">
          <div className="completion-badge"><SparkleIcon /></div>
          <span className="completion-label">练习完成</span>
          <h1 id="complete-title">做得不错，继续保持！</h1>
          <p>每一次认真作答，都在让知识变得更牢固。</p>

          <div className="score-ring" style={{ "--score": `${(score / questions.length) * 360}deg` } as React.CSSProperties}>
            <div><strong>{score}</strong><span>/ {questions.length} 题</span></div>
          </div>
          <p className="score-message">
            正确率 <strong>{Math.round((score / questions.length) * 100)}%</strong>
          </p>

          <div className="complete-actions">
            <button className="primary-button" onClick={startQuiz}>再练一次 <ArrowRightIcon /></button>
            <button className="text-button" onClick={() => setStage("welcome")}>返回首页</button>
          </div>
        </section>
      )}

      <footer>保持好奇，答案就在下一步。</footer>
    </main>
  );
}

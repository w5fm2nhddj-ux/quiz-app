import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { QuestionBanksPage } from "@/pages/QuestionBanksPage";
import { QuizPage } from "@/pages/QuizPage";
import { ImportPreviewPage } from "@/pages/ImportPreviewPage";
import { WrongQuestionsPage } from "@/pages/WrongQuestionsPage";

export default function App() {
  return (
    <div className="app-shell">
      <div className="background-orb orb-one" />
      <div className="background-orb orb-two" />
      <AppHeader />
      <Routes>
        <Route path="/" element={<QuestionBanksPage />} />
        <Route path="/import/preview" element={<ImportPreviewPage />} />
        <Route path="/banks/:bankId/practice" element={<QuizPage />} />
        <Route path="/banks/:bankId/wrong" element={<WrongQuestionsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer className="site-footer">保持好奇，答案就在下一步。</footer>
    </div>
  );
}

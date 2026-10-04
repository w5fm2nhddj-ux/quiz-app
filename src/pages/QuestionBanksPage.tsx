import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { defaultQuestionBank } from "@/data/defaultQuestionBank";
import { createId, FILE_ACCEPT, importQuestionFile, importQuestionUrl } from "@/importers";
import { importPreviewStore } from "@/importers/previewStore";
import { questionBankRepository } from "@/lib/questionBankRepository";
import { getWrongQuestions } from "@/lib/wrongQuestionTracker";
import type { QuestionBank } from "@/types/quiz";

type EditorState = { name: string; subject: string; source: string };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

export function QuestionBanksPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [banks, setBanks] = useState<QuestionBank[]>(() => questionBankRepository.seedIfEmpty(defaultQuestionBank));
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [url, setUrl] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [message, setMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const state = location.state as { importCount?: number } | null;
    if (state?.importCount) {
      setMessage(`已成功导入 ${state.importCount} 道题。`);
      setBanks(questionBankRepository.list());
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  function refreshBanks() { setBanks(questionBankRepository.list()); }

  function openPreview(result: Awaited<ReturnType<typeof importQuestionFile>>, originalName: string) {
    importPreviewStore.save({ result, originalName, createdAt: new Date().toISOString() });
    navigate("/import/preview");
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMessage("");
    setIsImporting(true);
    try { openPreview(await importQuestionFile(file), file.name); }
    catch (error) { setMessage(error instanceof Error ? error.message : "文件解析失败，请检查格式。"); }
    finally { setIsImporting(false); }
  }

  async function handleUrlImport(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setMessage("");
    setIsImporting(true);
    try {
      const result = await importQuestionUrl(url);
      setShowUrlDialog(false);
      openPreview(result, url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "链接解析失败。"); }
    finally { setIsImporting(false); }
  }

  function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!editor?.name.trim()) return;
    const now = new Date().toISOString();
    questionBankRepository.save({
      id: createId("bank"), name: editor.name.trim(), subject: editor.subject.trim() || "未分类",
      source: editor.source.trim() || "用户创建", createdAt: now, updatedAt: now, questions: [],
    });
    setEditor(null);
    setMessage("题库已创建。你可以通过导入功能添加题目。");
    refreshBanks();
  }

  function deleteBank(bank: QuestionBank) {
    if (!window.confirm(`确定删除题库“${bank.name}”吗？此操作不可撤销。`)) return;
    questionBankRepository.remove(bank.id);
    refreshBanks();
  }

  function startRename(bank: QuestionBank) { setRenamingId(bank.id); setRenameValue(bank.name); }
  function saveRename(bankId: string) {
    const name = renameValue.trim();
    if (!name) return;
    questionBankRepository.rename(bankId, name);
    setRenamingId(null);
    refreshBanks();
  }

  const questionCount = banks.reduce((total, bank) => total + bank.questions.length, 0);

  return (
    <main className="page-shell">
      <section className="library-hero">
        <div><span className="eyebrow">你的专属学习空间</span><h1>我的题库</h1><p>从常见文件或公开链接导入题目，确认预览后再开始练习。</p></div>
        <div className="hero-actions import-actions">
          <button className="secondary-button" onClick={() => setEditor({ name: "", subject: "", source: "用户创建" })}>＋ 新建题库</button>
          <button className="secondary-button" onClick={() => setShowUrlDialog(true)} disabled={isImporting}>⌁ 链接导入</button>
          <button className="primary-button" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>{isImporting ? "正在解析…" : "↑ 上传文件"}</button>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept={FILE_ACCEPT} onChange={handleFileChange} />
        </div>
      </section>

      <section className="library-summary" aria-label="题库概览">
        <div><strong>{banks.length}</strong><span>个题库</span></div><div><strong>{questionCount}</strong><span>道题目</span></div><div><strong>本地</strong><span>安全存储</span></div>
      </section>
      {message && <div className="notice" role="status">{message}<button onClick={() => setMessage("")} aria-label="关闭提示">×</button></div>}

      <section className="section-heading">
        <div><h2>全部题库</h2><p>选择一个题库，开始今天的练习。</p></div>
        <span className="format-tip">Excel · CSV · Word · PDF · JSON · TXT · Markdown</span>
      </section>

      {banks.length === 0 ? <section className="empty-state"><span>⌁</span><h2>还没有题库</h2><p>上传文件、粘贴公开链接，或新建一个空题库开始。</p></section> : (
        <section className="bank-grid">
          {banks.map((bank, index) => (
            <article className="bank-card" key={bank.id}>
              <div className={`bank-cover cover-${index % 4}`}><span>{bank.subject.slice(0, 1) || "题"}</span><small>{bank.subject}</small></div>
              <div className="bank-content">
                <div className="bank-topline"><span>{bank.questions.length} 道题</span><span>{formatDate(bank.updatedAt)}</span></div>
                {renamingId === bank.id ? (
                  <div className="rename-row"><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => {
                    if (event.key === "Enter") saveRename(bank.id); if (event.key === "Escape") setRenamingId(null);
                  }} aria-label="新题库名称" /><button onClick={() => saveRename(bank.id)}>保存</button></div>
                ) : <h3>{bank.name}</h3>}
                <p className="bank-source">来源：{bank.source}</p>
                <div className="bank-actions">
                  {bank.questions.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
                      <Link className="practice-link" to={`/banks/${bank.id}/practice`}>开始刷题 →</Link>
                      {getWrongQuestions(bank.id).length > 0 && (
                        <Link className="practice-link" to={`/banks/${bank.id}/wrong`}>错题本 ({getWrongQuestions(bank.id).length})</Link>
                      )}
                    </div>
                  ) : <span className="disabled-link">暂无题目</span>}
                  <div><button className="icon-button" onClick={() => startRename(bank)} aria-label={`重命名 ${bank.name}`}>✎</button><button className="icon-button danger" onClick={() => deleteBank(bank)} aria-label={`删除 ${bank.name}`}>⌫</button></div>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {editor && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setEditor(null)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><span className="eyebrow">创建空题库</span><h2 id="editor-title">新建题库</h2></div><button className="close-button" onClick={() => setEditor(null)} aria-label="关闭">×</button></div>
            <form onSubmit={saveEditor}>
              <label>题库名称<input required value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} placeholder="例如：高中数学必修一" /></label>
              <label>科目<input value={editor.subject} onChange={(event) => setEditor({ ...editor, subject: event.target.value })} placeholder="例如：数学" /></label>
              <label>来源<input value={editor.source} onChange={(event) => setEditor({ ...editor, source: event.target.value })} placeholder="例如：课堂笔记" /></label>
              <div className="modal-actions"><button type="button" className="text-button" onClick={() => setEditor(null)}>取消</button><button type="submit" className="primary-button">保存题库</button></div>
            </form>
          </section>
        </div>
      )}

      {showUrlDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !isImporting && setShowUrlDialog(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="url-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><span className="eyebrow">公开资源</span><h2 id="url-title">从链接导入</h2></div><button className="close-button" onClick={() => setShowUrlDialog(false)} aria-label="关闭">×</button></div>
            <form onSubmit={handleUrlImport}>
              <label>题库或文件链接<input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/questions.pdf" /></label>
              <p className="modal-help">仅访问无需登录的公开链接，不会绕过验证码、付费墙或网站权限。受 CORS 限制的链接请先下载再上传。</p>
              <div className="modal-actions"><button type="button" className="text-button" onClick={() => setShowUrlDialog(false)}>取消</button><button type="submit" className="primary-button" disabled={isImporting}>{isImporting ? "正在读取…" : "读取并预览"}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

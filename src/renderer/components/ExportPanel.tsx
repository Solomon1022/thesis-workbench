import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";

const api = () => window.thesisWorkbench;

interface SnapshotInfo {
  id: string;
  name: string;
  contentJson: string;
  createdAt: number;
}

export function ExportPanel({ detail, onRestored }: { detail: ProjectDetail; onRestored: (projectId: string) => void }) {
  const projectId = detail.project.id;
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [snapName, setSnapName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setSnapshots(await a.snapshotList(projectId)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const backup = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    try {
      const r = await a.exportBackup(projectId);
      if (!("canceled" in r)) {
        setMessage("备份包已导出并确认存在：" + r.path + "（" + (r.size / 1024).toFixed(1) + " KB）。备份含项目全部内容与附件副本，不含任何密钥与绝对路径。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    try {
      const r = await a.exportRestore();
      if (!("canceled" in r)) {
        const missing = r.outcome.missingAttachments;
        setMessage("已恢复为新项目副本：「" + r.outcome.projectName + "」。原项目未被改动。" + (missing.length > 0 ? " 缺失附件：" + missing.join("；") : ""));
        onRestored(r.outcome.projectId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportDoc = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    try {
      const r = await a.exportDocx(projectId);
      if (!("canceled" in r)) {
        setMessage("DOCX 已导出并确认存在：" + r.path + "（" + (r.size / 1024).toFixed(1) + " KB）");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportPdfFile = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    try {
      const r = await a.exportPdf(projectId);
      if (!("canceled" in r)) {
        setMessage("PDF 已导出并确认存在：" + r.path + "（" + (r.size / 1024).toFixed(1) + " KB）");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createSnapshot = async () => {
    const a = api();
    if (!a) return;
    if (!snapName.trim()) { setError("请填写快照名称"); return; }
    try {
      await a.snapshotCreate(projectId, snapName.trim());
      setSnapName("");
      setMessage("快照已创建（含当前项目全部内容；附件文件不包含在快照内，恢复时按缺失提示）");
      void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const restoreSnapshot = async (id: string) => {
    const a = api();
    if (!a) return;
    try {
      const r = await a.snapshotRestore(id);
      setMessage("已从快照恢复为新项目副本：「" + r.projectName + "」。原项目未被改动。" + (r.missingAttachments.length > 0 ? " 缺失附件：" + r.missingAttachments.join("；") : ""));
      onRestored(r.projectId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <section className="card">
      <h2 className="card-title">导出、备份与快照</h2>
      <p className="muted">备份包（.zip）包含项目全部内容（阶段状态、正文、研究设计、文献与证据卡片、审阅意见、分析记录、附件副本）。不含 API 密钥、密码或绝对路径。恢复一律创建新项目副本，不覆盖现有项目。</p>

      <div className="lit-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void backup()}>导出项目备份包（ZIP）</button>
        <button className="btn" disabled={busy} onClick={() => void restore()}>从备份包恢复为新项目</button>
      </div>

      <h3 className="write-section h3" style={{ fontSize: 14, margin: "10px 0 4px" }}>文档导出（真实项目内容）</h3>
      <div className="lit-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void exportDoc()}>导出 DOCX</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void exportPdfFile()}>导出 PDF</button>
      </div>
      <details className="lit-log">
        <summary>格式能力与限制（导出前请阅读）</summary>
        <div className="muted">
          DOCX：支持标题层级、正文段落、表格、参考文献、审阅记录、中文（宋体/黑体，由本机 Word 渲染）、A4 页面设置。不支持：目录自动生成（请在 Word 中手动插入）、图片嵌入（附件仅以文件名列出）、公式与脚注。
          PDF：支持 A4、中文字体（系统字体，不嵌入）、标题/正文/表格、页脚页码、长文本分页。不支持：目录超链接、图片嵌入（附件仅以文件名列出）。
        </div>
      </details>

      <div className="lit-search-row">
        <input className="input" aria-label="快照名称" placeholder="快照名称（如：提交导师审阅前）" value={snapName} onChange={(e) => setSnapName(e.target.value)} />
        <button className="btn" onClick={() => void createSnapshot()}>创建快照</button>
      </div>

      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      {snapshots.length > 0 && (
        <div className="lit-list">
          {snapshots.map((s) => (
            <div key={s.id} className="lit-item">
              <div className="lit-item-main">
                <div className="lit-title">{s.name}</div>
                <div className="muted">创建于 {new Date(s.createdAt).toLocaleString("zh-CN")}</div>
              </div>
              <div className="lit-item-actions">
                <button className="btn btn-sm" onClick={() => void restoreSnapshot(s.id)}>恢复为副本</button>
                <button className="btn btn-sm btn-danger" onClick={async () => { await api()?.snapshotDelete(s.id); void refresh(); }}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

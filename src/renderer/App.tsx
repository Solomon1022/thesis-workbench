import { useCallback, useEffect, useState } from "react";
import type { Project, ProjectDetail, ProjectInput, StageStatus } from "../shared/types";
import { METHOD_TEMPLATES } from "../shared/templates";
import { ProjectHome } from "./components/ProjectHome";
import { ProjectWizard } from "./components/ProjectWizard";
import { SettingsView } from "./components/SettingsView";
import { StageNav } from "./components/StageNav";
import { StageWorkspace } from "./components/StageWorkspace";
import { AiJobsPanel } from "./components/AiJobsPanel";
import { GeneralSettingsView } from "./components/GeneralSettingsView";
import { ToastHost, toast } from "./components/Toast";

const api = () => window.thesisWorkbench;

function applyFontScale(v: string): void {
  const n = Number(v);
  const factor = Number.isFinite(n) && n > 0 ? n / 100 : 1;
  api()?.setUiZoom(factor);
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"models" | "roles" | "search" | "general">("models");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 启动时应用已保存的文字大小设置
  useEffect(() => {
    const a = api();
    if (!a) return;
    void a.settingsGetApp().then((s) => applyFontScale(s.fontSize)).catch(() => { /* 忽略 */ });
  }, []);

  const refreshProjects = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setProjects(await a.listProjects()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  const openProject = useCallback(async (id: string) => {
    const a = api();
    if (!a) return;
    setDetail(await a.getProject(id));
    setCurrentStage(null);
    setSettingsOpen(false);
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    const a = api();
    if (!a) return;
    setDetail(await a.getProject(id));
  }, []);

  const handleCreate = useCallback(async (input: ProjectInput) => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    try {
      const d = await a.createProject(input);
      setWizardOpen(false);
      await refreshProjects();
      setDetail(d);
      toast("项目已创建", "Project created · " + d.project.name);
      const start = d.stages.find((s) => s.status === "in_progress");
      setCurrentStage(start ? start.stageKey : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshProjects]);

  const handleStatus = useCallback(async (stageKey: string, status: StageStatus, skipReason: string) => {
    const a = api();
    if (!a || !detail) return;
    await a.setStageStatus(detail.project.id, stageKey, status, skipReason);
    await refreshDetail(detail.project.id);
  }, [detail, refreshDetail]);

  const handleContent = useCallback(async (stageKey: string, fieldKey: string, value: string): Promise<boolean> => {
    const a = api();
    if (!a || !detail) return false;
    try {
      await a.setStageContent(detail.project.id, stageKey, fieldKey, value);
      setDetail((current) => {
        if (!current || current.project.id !== detail.project.id) return current;
        return {
          ...current,
          content: {
            ...current.content,
            [stageKey]: { ...(current.content[stageKey] ?? {}), [fieldKey]: value },
          },
        };
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [detail]);

  const handleDelete = useCallback(async (id: string) => {
    const a = api();
    if (!a) return;
    if (!window.confirm("确定删除该项目及其全部内容？此操作不可恢复。")) return;
    await a.deleteProject(id);
    setDetail(null);
    setCurrentStage(null);
    await refreshProjects();
  }, [refreshProjects]);

  const method = detail ? METHOD_TEMPLATES[detail.project.researchMethod] : undefined;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-title">论文工作台</div>
          <div className="brand-sub">本地研究辅助 · 暂用名</div>
        </div>
        <button className="btn btn-primary btn-block" onClick={() => setWizardOpen(true)}>＋ 新建项目</button>
        <div className="project-list">
          {projects.length === 0 ? (
            <div className="empty-hint">还没有项目。点击「新建项目」，选择学科与研究方法后进入阶段流程。</div>
          ) : projects.map((p) => (
            <div
              key={p.id}
              className={"project-item" + (detail?.project.id === p.id ? " active" : "")}
              onClick={() => void openProject(p.id)}
              role="button"
              tabIndex={0}
            >
              <div className="project-name">{p.name}</div>
              <div className="project-meta">
                {p.disciplines.length ? p.disciplines.join("、") : "未选学科"} · {METHOD_TEMPLATES[p.researchMethod]?.label ?? "未选方法"}
              </div>
            </div>
          ))}
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        {detail && <AiJobsPanel projectId={detail.project.id} />}
        <div className="sidebar-bottom">
          <button className="btn btn-block" onClick={() => { setSettingsOpen(true); setSettingsTab("models"); }}>服务与模型设置</button>
          <button className="btn btn-block" onClick={() => { setSettingsOpen(true); setSettingsTab("general"); }}>设置</button>
        </div>
      </aside>

      {settingsOpen ? (
        <>
          <aside className="stage-nav">
            <div className="nav-settings-title">{settingsTab === "general" ? "通用设置" : "服务与模型设置"}</div>
            {(["models", "roles", "search", "general"] as const).map((k) => (
              <button
                key={k}
                className={"nav-stage" + (settingsTab === k ? " active" : "")}
                onClick={() => setSettingsTab(k)}
              >
                <span className="nav-name">{k === "models" ? "模型服务" : k === "roles" ? "任务角色" : k === "search" ? "搜索服务" : "通用"}</span>
              </button>
            ))}
            <div className="nav-settings-foot">
              <button className="btn btn-block" onClick={() => setSettingsOpen(false)}>返回项目</button>
            </div>
          </aside>
          <main className="workspace workspace-full">
            {settingsTab === "general"
              ? <GeneralSettingsView onFontSize={(v) => applyFontScale(v)} />
              : <SettingsView tab={settingsTab} onTabChange={setSettingsTab} />}
          </main>
        </>
      ) : detail ? (
        <>
          <StageNav
            stages={detail.stages}
            current={currentStage}
            onSelect={setCurrentStage}
            onHome={() => setCurrentStage(null)}
          />
          <main className="workspace">
            {currentStage === null ? (
              <ProjectHome detail={detail} onOpenStage={setCurrentStage} onDelete={() => void handleDelete(detail.project.id)} />
            ) : (
              <StageWorkspace
                detail={detail}
                stageKey={currentStage}
                onStatus={(stageKey, status, reason) => void handleStatus(stageKey, status, reason)}
                onContent={handleContent}
                onProjectRestored={() => void refreshProjects()}
              />
            )}
          </main>
        </>
      ) : (
        <main className="workspace">
          <div className="welcome">
            <h1>论文研究，从这里开始</h1>
            <p>按论文阶段推进：先建项目、选学科与研究方法，再进入对应阶段。可以带已有题目、文献、数据或初稿进入。</p>
            <ul>
              <li>本地存储：项目资料保存在本机（SQLite 数据库），不上传服务器。</li>
              <li>尚未接入的能力会明确标注：模型调用（阶段 2）、文献核验（阶段 3）、统计分析（阶段 5）。</li>
              <li>研究辅助不替代专业审批、临床决策或实验设备控制。</li>
            </ul>
          </div>
        </main>
      )}

      {wizardOpen && (
        <ProjectWizard busy={busy} onCancel={() => setWizardOpen(false)} onCreate={(input) => void handleCreate(input)} />
      )}
      <ToastHost />
    </div>
  );
}

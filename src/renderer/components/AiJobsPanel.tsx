import { useCallback, useEffect, useState } from "react";

export interface AiJobInfo {
  id: string;
  projectId: string;
  stageKey: string;
  kind: string;
  label: string;
  status: string;
  progress: number;
  message: string;
  resultJson: string;
  createdAt: number;
  updatedAt: number;
}

const STAGE_NAMES: Record<string, string> = {
  "": "全局",
  establish: "建立项目与要求",
  topic: "前期检索与选题",
  design: "研究问题与设计",
  literature: "文献综述与证据整理",
  proposal: "开题报告",
  instruments: "工具/实验准备",
  data: "资料收集/实验执行",
  analysis: "整理与分析",
  midterm: "中期检查",
  writing: "初稿与完整稿",
  revision: "审阅与修改",
  defense: "定稿与答辩准备",
  archive: "答辩后修改与归档",
};

/** 左列 AI 任务状态框：任务在主进程后台继续，切界面不中断；进度条实时更新，完成/失败打标 */
export function AiJobsPanel({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<AiJobInfo[]>([]);

  const refresh = useCallback(async () => {
    const a = window.thesisWorkbench;
    if (!a || !projectId) return;
    try {
      setJobs(await a.aiJobsList(projectId));
    } catch { /* 忽略 */ }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    const a = window.thesisWorkbench;
    if (!a) return;
    a.onAiJobUpdated((job) => {
      if (job.projectId === projectId) {
        setJobs((prev) => {
          const others = prev.filter((j) => j.id !== job.id);
          return [job as AiJobInfo, ...others];
        });
      }
    });
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [projectId, refresh]);

  if (!projectId || jobs.length === 0) return null;
  const active = jobs.filter((j) => j.status === "running");
  const finished = jobs.filter((j) => j.status !== "running").slice(0, 8);

  return (
    <div className="ai-jobs-box">
      <div className="ai-jobs-title">AI 任务状态</div>
      {active.map((j) => (
        <div key={j.id} className="ai-job-row">
          <div className="ai-job-head">
            <span className="ai-job-name">{STAGE_NAMES[j.stageKey] ?? j.stageKey} · {j.label}</span>
            <span className="ai-job-pct">{j.progress}%</span>
          </div>
          <div className="ai-job-track"><div className="ai-job-bar" style={{ width: Math.min(100, Math.max(3, j.progress)) + "%" }} /></div>
          <div className="ai-job-msg muted">{j.message}</div>
        </div>
      ))}
      {finished.map((j) => (
        <div key={j.id} className="ai-job-row">
          <div className="ai-job-head">
            <span className="ai-job-name">{STAGE_NAMES[j.stageKey] ?? j.stageKey} · {j.label}</span>
            <span className={"ai-job-done " + (j.status === "done" ? "" : "ai-job-failed")}>{j.status === "done" ? "已完成" : "失败"}</span>
          </div>
          {j.status === "failed" && j.message && <div className="ai-job-msg muted">{j.message.slice(0, 80)}</div>}
        </div>
      ))}
    </div>
  );
}

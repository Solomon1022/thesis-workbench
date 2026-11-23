import type { ThesisDB } from "./db";

export interface AiJob {
  id: string;
  projectId: string;
  stageKey: string;
  kind: string;
  label: string;
  status: "running" | "done" | "failed";
  progress: number;
  message: string;
  resultJson: string;
  createdAt: number;
  updatedAt: number;
}

const TICK_MS = 2500;
const TICK_MAX = 90; // 模拟进度封顶（真实进度可覆盖；完成时置 100）

/**
 * AI 任务注册表：AI 工作跑在主进程，切界面不中断；
 * 每个任务记录 阶段/类型/状态/进度/结果，渲染层订阅更新与恢复上次结果。
 * 无真实进度回调的任务用模拟进度条前进（完成时置 100），有真实进度的由调用方上报。
 */
export class AiJobRegistry {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private emitFn: ((job: AiJob) => void) | null = null;

  constructor(private db: ThesisDB) {}

  setEmitter(fn: (job: AiJob) => void): void {
    this.emitFn = fn;
  }

  private toJob(row: ReturnType<ThesisDB["listAiJobs"]>[number]): AiJob {
    return { ...row, status: row.status as AiJob["status"] };
  }

  private emit(id: string): void {
    const job = this.db.listAiJobs("", 1000).find((j) => j.id === id);
    if (job && this.emitFn) this.emitFn(this.toJob(job));
  }

  start(projectId: string, stageKey: string, kind: string, label: string): AiJob {
    const id = crypto.randomUUID();
    this.db.insertAiJob({ id, projectId, stageKey, kind, label, status: "running", progress: 3, message: "任务已启动", resultJson: "" });
    const timer = setInterval(() => {
      const cur = this.db.listAiJobs(projectId).find((j) => j.id === id);
      if (!cur || cur.status !== "running") { clearInterval(timer); this.timers.delete(id); return; }
      const step = 2 + Math.floor(Math.random() * 5);
      const next = Math.min(TICK_MAX, cur.progress + step);
      this.db.updateAiJob(id, { progress: next, message: "AI 工作进行中…" });
      this.emit(id);
    }, TICK_MS);
    this.timers.set(id, timer);
    const job = this.toJob(this.db.listAiJobs(projectId).find((j) => j.id === id)!);
    this.emit(id);
    return job;
  }

  /** 真实进度上报（有进度回调的任务用；百分比由调用方换算） */
  report(id: string, progress: number, message: string): void {
    this.db.updateAiJob(id, { progress: Math.max(0, Math.min(99, Math.round(progress))), message: message.slice(0, 200) });
    this.emit(id);
  }

  finish(id: string, ok: boolean, message: string, resultJson: string): void {
    const timer = this.timers.get(id);
    if (timer) { clearInterval(timer); this.timers.delete(id); }
    this.db.updateAiJob(id, { status: ok ? "done" : "failed", progress: ok ? 100 : this.db.listAiJobs("", 1000).find((j) => j.id === id)?.progress ?? 0, message: message.slice(0, 200), resultJson: (resultJson ?? "").slice(0, 400_000) });
    this.emit(id);
  }

  list(projectId: string): AiJob[] {
    return this.db.listAiJobs(projectId).map((j) => this.toJob(j));
  }
}

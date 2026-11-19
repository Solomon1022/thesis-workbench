import type { StageRecord } from "../../shared/types";
import { STAGES } from "../../shared/stages";

export const STATUS_LABEL: Record<string, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  needs_review: "待确认",
  done: "已完成",
  skipped: "已跳过",
};

export function StageNav({ stages, current, onSelect, onHome }: {
  stages: StageRecord[];
  current: string | null;
  onSelect: (key: string) => void;
  onHome: () => void;
}) {
  const map = new Map(stages.map((s) => [s.stageKey, s]));
  return (
    <aside className="stage-nav">
      <button className={"nav-home" + (current === null ? " active" : "")} onClick={onHome}>项目首页</button>
      {STAGES.map((stage, index) => {
        const rec = map.get(stage.key);
        const status = rec?.status ?? "not_started";
        return (
          <button
            key={stage.key}
            className={"nav-stage" + (current === stage.key ? " active" : "")}
            onClick={() => onSelect(stage.key)}
            title={rec?.skipReason || STATUS_LABEL[status]}
          >
            <span className="nav-index">{index}</span>
            <span className="nav-name">{stage.name}</span>
            <span className={"dot dot-" + status} title={STATUS_LABEL[status]} />
          </button>
        );
      })}
    </aside>
  );
}

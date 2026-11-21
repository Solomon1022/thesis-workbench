import { useState } from "react";
import { MAJOR_PLATFORM_GROUPS } from "../../shared/literature";

export interface PlatformPrefs {
  platformKeys: string[];
  openAccessOnly: boolean;
  globalLibraries: boolean;
}

/** 论文库偏好选择（模态窗口：必须点确定或取消才能关闭）。
 *  偏好只是「偏向」，不是绝对：内置检索仍走真实 Crossref，偏好库用于生成跳转检索链接。 */
export function PlatformPreferenceModal({ initial, onConfirm, onCancel }: {
  initial: PlatformPrefs;
  onConfirm: (prefs: PlatformPrefs) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial.platformKeys);
  const [openOnly, setOpenOnly] = useState(initial.openAccessOnly);
  const [globalLibs, setGlobalLibs] = useState(initial.globalLibraries);

  const toggle = (key: string) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  return (
    <div className="modal-mask">
      <div className="modal" role="dialog" aria-modal="true" aria-label="论文库偏好选择">
        <h2>选择偏好的论文库</h2>
        <p className="muted">按平台导航清单分组选择你偏向的论文库（可多选）。注意：这是「偏向」，不是绝对——应用内置检索始终走真实 Crossref，偏好的库会生成对应的官网跳转检索链接供你继续查阅。</p>
        {MAJOR_PLATFORM_GROUPS.map((g) => (
          <div key={g.title} className="platform-group">
            <div className="muted platform-title">{g.title}</div>
            <div className="lit-suggest">
              {g.items.map((p) => (
                <button key={p.key} className={"chip" + (selected.includes(p.key) ? " chip-on" : "")} onClick={() => toggle(p.key)} title={p.note ?? p.tag}>
                  {p.name}<span className="chip-tag">{p.tag}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="pref-options">
          <label className="check-row">
            <input type="radio" name="access" checked={openOnly} onChange={() => setOpenOnly(true)} />
            绝对的开放资料（只偏向免费/OA 平台）
          </label>
          <label className="check-row">
            <input type="radio" name="access" checked={!openOnly} onChange={() => setOpenOnly(false)} />
            可以接受订阅资料（开放 + 订阅平台都偏向）
          </label>
          <label className="check-row">
            <input type="checkbox" checked={globalLibs} onChange={(e) => setGlobalLibs(e.target.checked)} />
            全球通用库（Web of Science / Scopus / ScienceDirect 等综合权威库）
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => onConfirm({ platformKeys: selected, openAccessOnly: openOnly, globalLibraries: globalLibs })}>确定</button>
          <button className="btn" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

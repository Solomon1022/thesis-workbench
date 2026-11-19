import type { ExistingMaterials } from "../../shared/types";

export function MATERIAL_SUMMARY({ materials }: { materials: ExistingMaterials }) {
  const items: Array<[string, string]> = [
    ["已有题目", materials.title],
    ["已有文献", materials.literature],
    ["已有数据", materials.data],
    ["已有初稿", materials.draft],
    ["备注", materials.notes],
  ];
  return (
    <ul className="material-list">
      {items.map(([label, text]) => (
        <li key={label}>
          <strong>{label}：</strong>
          {text.trim() ? <span>{text.trim().length > 120 ? text.trim().slice(0, 120) + "…" : text.trim()}</span> : <span className="muted">未填写</span>}
        </li>
      ))}
    </ul>
  );
}

import { useEffect, useState } from "react";

interface ToastItem { id: number; title: string; sub?: string; kind: "ok" | "info" }

let seq = 0;

/** 全局轻量提示：右下角浮动，自动消失；中英双语 */
export function toast(title: string, sub?: string, kind: "ok" | "info" = "ok"): void {
  window.dispatchEvent(new CustomEvent("twb-toast", { detail: { id: ++seq, title, sub, kind } }));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as ToastItem;
      setItems((prev) => [...prev.slice(-3), d]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== d.id)), 2800);
    };
    window.addEventListener("twb-toast", onToast);
    return () => window.removeEventListener("twb-toast", onToast);
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className={"toast toast-" + t.kind}>
          <div className="toast-title">{t.title}</div>
          {t.sub && <div className="toast-sub">{t.sub}</div>}
        </div>
      ))}
    </div>
  );
}

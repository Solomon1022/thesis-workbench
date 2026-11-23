const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

/** 轻量 Markdown → HTML（标题/列表/分隔线/加粗斜体；无脚本注入风险） */
export function mdit(src: string): string {
  const out: string[] = [];
  let list: string[] | null = null;
  const flushList = () => {
    if (list) { out.push("<ul>" + list.map((li) => "<li>" + li + "</li>").join("") + "</ul>"); list = null; }
  };
  for (const raw of String(src ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) { flushList(); out.push("<h1>" + inline(line.replace(/^#\s+/, "")) + "</h1>"); continue; }
    if (/^##\s+/.test(line)) { flushList(); out.push("<h2>" + inline(line.replace(/^##\s+/, "")) + "</h2>"); continue; }
    if (/^###\s+/.test(line)) { flushList(); out.push("<h3>" + inline(line.replace(/^###\s+/, "")) + "</h3>"); continue; }
    if (/^[-*]\s+/.test(line)) { if (!list) list = []; list.push(inline(line.replace(/^[-*]\s+/, ""))); continue; }
    if (/^\s*[-–—]{3,}\s*$/.test(line)) { flushList(); out.push("<hr/>"); continue; }
    flushList();
    if (line.trim()) out.push("<p>" + inline(line.trim()) + "</p>");
  }
  flushList();
  return out.join("\n");
}

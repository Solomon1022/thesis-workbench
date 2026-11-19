/** 容错 CSV 解析：引号包裹、转义引号、BOM、CRLF/LF。 */

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const t = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ""; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  const headerRow = rows.shift() ?? [];
  const headers = headerRow.map((h, idx) => (h.trim() === "" ? "列" + (idx + 1) : h.trim()));
  return { headers, rows };
}

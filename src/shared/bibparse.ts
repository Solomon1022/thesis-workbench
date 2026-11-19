/** RIS 与 BibTeX 的容错解析。只提取题录字段；不解析全文、不推断缺失信息。 */

export interface ParsedReference {
  type: string;
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
}

function cleanField(v: string): string {
  return v.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** 解析 RIS 文本（TY/ER 块；TI、AU、PY、JO/T2、DO、UR、AB 字段） */
export function parseRIS(text: string): ParsedReference[] {
  const out: ParsedReference[] = [];
  const parts = text.split(/\n\s*TY\s+-\s+/i);
  if (parts.length === 0) return out;
  // 第一段仍以 TY 行开头需剥离；其余段在 split 时已消费 TY 行
  const blocks = parts.map((p) => p.replace(/^TY\s+-\s+/, ""));
  for (const blockRaw of blocks) {
    const block = blockRaw.split(/\n\s*ER\s+-\s*/i)[0] ?? blockRaw;
    const ref: ParsedReference = { type: "", title: "", authors: "", year: "", venue: "", doi: "", url: "", abstract: "" };
    const authors: string[] = [];
    const lines = block.split(/\r?\n/).map((line) => line.trim());
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Z0-9]{2})\s*-\s?(.*)$/);
      if (!m) continue;
      const tag = m[1].toUpperCase();
      const value = m[2].trim();
      if (tag === "TI") ref.title = ref.title ? ref.title + " " + value : value;
      else if (tag === "AU") authors.push(value);
      else if (tag === "PY") ref.year = (ref.year || value).slice(0, 4);
      else if (tag === "JO" || tag === "T2") ref.venue = ref.venue || value;
      else if (tag === "DO") ref.doi = ref.doi || value;
      else if (tag === "UR") ref.url = ref.url || value;
      else if (tag === "AB") ref.abstract = ref.abstract ? ref.abstract + " " + value : value;
      else if (tag === "TY") ref.type = value;
    }
    ref.authors = authors.join("; ");
    if (ref.title.trim() || ref.doi.trim()) out.push(ref);
  }
  return out;
}

/** 解析 BibTeX 文本（@article/@inproceedings/@misc 块） */
export function parseBibTeX(text: string): ParsedReference[] {
  const out: ParsedReference[] = [];
  const entryRe = /@\s*(\w+)\s*\{[^,]*,\s*([\s\S]*?)\n\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(text)) !== null) {
    const type = match[1];
    const body = match[2];
    const field = (name: string): string => {
      const m = body.match(new RegExp(name + "\\s*=\\s*[{\"]([\\s\\S]*?)[}\"\]\\s*[,}]", "i"));
      return m ? cleanField(m[1]) : "";
    };
    const ref: ParsedReference = {
      type,
      title: field("title"),
      authors: field("author").replace(/\s+and\s+/gi, "; "),
      year: field("year").slice(0, 4),
      venue: field("journal") || field("booktitle") || field("publisher"),
      doi: field("doi"),
      url: field("url"),
      abstract: field("abstract"),
    };
    if (ref.title.trim() || ref.doi.trim()) out.push(ref);
  }
  return out;
}

/** 标题归一化（去标点、小写），用于去重比较 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** DOI 归一化（去掉前缀 https://doi.org/ 与多余空白） */
export function normalizeDoi(doi: string): string {
  return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
}

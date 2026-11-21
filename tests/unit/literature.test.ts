import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeDoi, normalizeTitle, parseBibTeX, parseRIS } from "../../src/shared/bibparse";
import { ThesisDB } from "../../src/main/db";

const RIS_FIXTURE = [
  "TY  - JOUR",
  "TI  - Attention is all you need",
  "AU  - Vaswani, Ashish",
  "AU  - Shazeer, Noam",
  "PY  - 2017",
  "JO  - Advances in Neural Information Processing Systems",
  "DO  - 10.5555/3295222.3295349",
  "UR  - https://proceedings.neurips.cc",
  "AB  - The dominant sequence transduction models...",
  "ER  - ",
  "TY  - JOUR",
  "TI  - Deep Residual Learning for Image Recognition",
  "AU  - He, Kaiming",
  "PY  - 2016",
  "JO  - CVPR",
  "ER  - ",
].join("\r\n");

const BIB_FIXTURE = [
  "@article{vaswani2017attention,",
  "  title={Attention is all you need},",
  "  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},",
  "  year={2017},",
  "  journal={Advances in Neural Information Processing Systems},",
  "  doi={10.5555/3295222.3295349},",
  "}",
].join("\n");

describe("RIS / BibTeX 解析", () => {
  it("parseRIS 解析多条记录与全部字段", () => {
    const refs = parseRIS(RIS_FIXTURE);
    expect(refs.length).toBe(2);
    const first = refs[0];
    expect(first.title).toBe("Attention is all you need");
    expect(first.authors).toBe("Vaswani, Ashish; Shazeer, Noam");
    expect(first.year).toBe("2017");
    expect(first.venue).toBe("Advances in Neural Information Processing Systems");
    expect(first.doi).toBe("10.5555/3295222.3295349");
    expect(first.abstract.length).toBeGreaterThan(0);
    expect(refs[1].title).toBe("Deep Residual Learning for Image Recognition");
  });

  it("parseBibTeX 解析条目与作者分隔", () => {
    const refs = parseBibTeX(BIB_FIXTURE);
    expect(refs.length).toBe(1);
    const r = refs[0];
    expect(r.title).toBe("Attention is all you need");
    expect(r.authors).toContain("Vaswani, Ashish");
    expect(r.year).toBe("2017");
    expect(r.doi).toBe("10.5555/3295222.3295349");
  });

  it("parseBibTeX 解析不到内容时返回空数组", () => {
    expect(parseBibTeX("不是 BibTeX 的内容")).toEqual([]);
    expect(parseRIS("不是 RIS 的内容")).toEqual([]);
  });
});

describe("DOI 与标题归一化", () => {
  it("normalizeDoi 去掉前缀与大小写", () => {
    expect(normalizeDoi("https://doi.org/10.1038/Nature14539")).toBe("10.1038/nature14539");
    expect(normalizeDoi("doi: 10.1038/Nature14539 ")).toBe("10.1038/nature14539");
    expect(normalizeDoi("")).toBe("");
  });

  it("normalizeTitle 去标点与大小写", () => {
    expect(normalizeTitle("Attention Is All You Need!")).toBe("attention is all you need");
  });
});

describe("文献库持久化（SQLite）", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tw-lit-"));
    dbPath = path.join(dir, "test.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("插入、按 DOI 查重、证据卡片与检索记录", () => {
    const db = new ThesisDB(dbPath);
    const item = db.insertLiterature({
      projectId: "p1",
      title: "Attention is all you need",
      authors: "Vaswani et al.",
      year: "2017",
      venue: "NeurIPS",
      doi: "10.5555/3295222.3295349",
      url: "https://example.org",
      abstract: "摘要",
      source: "crossref",
      verifiedStatus: "verified",
      verifiedNote: "来自 crossref 真实数据源",
      fulltextStatus: "abstract_only",
      pdfName: "",
      preprint: false,
    });
    expect(item.id.length).toBeGreaterThan(0);
    expect(db.listLiterature("p1").length).toBe(1);

    // 相同 DOI 再插入应被唯一索引拒绝（抛错）
    expect(() => db.insertLiterature({
      projectId: "p1",
      title: "重复",
      authors: "",
      year: "",
      venue: "",
      doi: "10.5555/3295222.3295349",
      url: "",
      abstract: "",
      source: "manual",
      verifiedStatus: "unverified",
      verifiedNote: "",
      fulltextStatus: "none",
      pdfName: "",
      preprint: false,
    })).toThrow();

    // 证据卡片
    const card = db.insertEvidence("p1", item.id, "该模型引入自注意力", "第 2 页");
    expect(db.listEvidence(item.id).length).toBe(1);
    expect(db.listEvidence(item.id)[0].location).toBe("第 2 页");
    db.deleteEvidence(card.id);
    expect(db.listEvidence(item.id).length).toBe(0);

    // 检索记录
    db.appendSearchLog("p1", "crossref", "attention", 1, "ok", "");
    db.appendSearchLog("p1", "crossref", "nothing", 0, "no_results", "未返回结果");
    const log = db.listSearchLog("p1");
    expect(log.length).toBe(2);
    expect(log[0].query).toBe("nothing");

    // 删除文献时级联删除证据卡片
    const card2 = db.insertEvidence("p1", item.id, "claim", "");
    db.deleteLiterature(item.id);
    expect(db.listLiterature("p1").length).toBe(0);
    expect(db.listEvidence(item.id).length).toBe(0);
    db.close();
  });

  it("删除项目级联删除文献", () => {
    const db = new ThesisDB(dbPath);
    const project = db.createProject({ name: "测试", disciplines: ["化学与材料"], researchMethod: "chemistry-experiment", educationLevel: "本科", deadline: "", materials: { title: "", literature: "", data: "", draft: "", notes: "" } });
    db.insertLiterature({ projectId: project.project.id, title: "t", authors: "", year: "", venue: "", doi: "", url: "", abstract: "", source: "manual", verifiedStatus: "unverified", verifiedNote: "", fulltextStatus: "none", pdfName: "", preprint: false });
    db.deleteProject(project.project.id);
    expect(db.listLiterature(project.project.id).length).toBe(0);
    db.close();
  });

  it("语言与国内外归属分开保存并往返一致", () => {
    const db = new ThesisDB(dbPath);
    const item = db.insertLiterature({
      projectId: "p1",
      title: "AI虚拟主播互动质量对消费者购买意愿的影响",
      authors: "王明",
      year: "2024",
      venue: "经济与管理",
      doi: "10.1000/oa2",
      url: "",
      abstract: "",
      source: "openalex",
      verifiedStatus: "verified",
      verifiedNote: "",
      fulltextStatus: "none",
      pdfName: "",
      preprint: false,
      language: "zh",
      region: "unknown",
    });
    const loaded = db.listLiterature("p1")[0];
    expect(loaded.language).toBe("zh");
    expect(loaded.region).toBe("unknown");
    db.updateLiterature(item.id, { region: "domestic" });
    const updated = db.listLiterature("p1")[0];
    expect(updated.region).toBe("domestic");
    expect(updated.language).toBe("zh");
    db.close();
  });
});

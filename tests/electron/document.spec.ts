import { expect, test, _electron as electron } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";

/**
 * 阶段 6.4 验证：DOCX/PDF 导出使用真实项目内容，文件确实生成、格式可校验。
 * docxTo/pdfTo 为主进程同一代码路径（跳过系统保存对话框）。
 */

test("文档导出：真实内容 → DOCX/PDF 文件存在且格式正确", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const docxPath = path.join(userDataDir, "论文.docx");
  const pdfPath = path.join(userDataDir, "论文.pdf");
  const env = { ...process.env, NODE_ENV: "test", TWB_TEST_USER_DATA: userDataDir, ELECTRON_DEV_URL: "http://localhost:5173" } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    // 建项目 + 真实内容（标题/摘要/关键词/设计/草稿）
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill("导出测试-" + Date.now());
    await page.getByText("电子商务", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("questionnaire");
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: /初稿与完整稿/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByLabel("论文标题").fill("电商直播互动性对消费者购买意愿的影响研究");
    await page.getByLabel("摘要").fill("本文基于问卷数据研究电商直播互动性对消费者购买意愿的影响。");
    await page.getByLabel("关键词").fill("直播电商；购买意愿");
    await page.getByLabel("草稿与正文").fill("第一段：直播电商发展迅速，互动性成为影响购买决策的重要因素。\n\n第二段：本文提出研究问题与假设。");
    await expect(page.getByText(/已自动保存/).first()).toBeVisible();
    await page.getByRole("button", { name: /研究问题与设计/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByLabel("研究问题").fill("直播互动性如何影响消费者购买意愿？");

    const projectId = await page.evaluate(async () => (await window.thesisWorkbench.listProjects())[0].id);

    // DOCX
    const docxSize = await page.evaluate(async ([pid, p]) => window.thesisWorkbench.exportDocxTo(pid, p), [projectId, docxPath] as [string, string]);
    expect(docxSize).toBeGreaterThan(1000);
    expect(existsSync(docxPath)).toBe(true);
    const zip = await JSZip.loadAsync(readFileSync(docxPath));
    const docXml = await zip.file("word/document.xml")?.async("string") ?? "";
    expect(docXml).toContain("电商直播互动性对消费者购买意愿的影响研究");
    expect(docXml).toContain("本文基于问卷数据研究");
    expect(docXml).toContain("直播互动性如何影响消费者购买意愿？");
    console.log("DOCX-OK size=" + docxSize + " document.xml len=" + docXml.length);

    // PDF
    const pdfSize = await page.evaluate(async ([pid, p]) => window.thesisWorkbench.exportPdfTo(pid, p), [projectId, pdfPath] as [string, string]);
    expect(pdfSize).toBeGreaterThan(1000);
    expect(existsSync(pdfPath)).toBe(true);
    const head = readFileSync(pdfPath).subarray(0, 5).toString("latin1");
    expect(head).toBe("%PDF-");
    const pageCount = (readFileSync(pdfPath).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(1);
    console.log("PDF-OK size=" + pdfSize + " pages~=" + pageCount);
  } finally {
    await app.close();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});

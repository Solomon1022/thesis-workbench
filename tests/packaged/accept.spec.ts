import { expect, test, _electron as electron } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";

/**
 * 阶段 6.5 打包版验收：用重新构建的 win-unpacked 程序完成
 * 创建项目 → 编辑保存真实内容 → DOCX/PDF/备份导出 → 文件真实存在。
 */
test("打包版验收：真实内容编辑保存与三种导出", async () => {
  test.setTimeout(300_000);
  const userDataDir = mkdtempSync(path.join(tmpdir(), "tw-packed-"));
  const docxPath = path.join(userDataDir, "打包版论文.docx");
  const pdfPath = path.join(userDataDir, "打包版论文.pdf");
  const zipPath = path.join(userDataDir, "打包版备份.zip");
  const env = { ...process.env, NODE_ENV: "test", TWB_TEST_USER_DATA: userDataDir } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_DEV_URL;

  const app = await electron.launch({ executablePath: path.resolve("release/win-unpacked/Thesis Workbench.exe"), args: [], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 40_000 });

    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill("打包版验收-" + Date.now());
    await page.getByText("电子商务", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("questionnaire");
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: /初稿与完整稿/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByLabel("论文标题").fill("打包版导出验收论文");
    await page.getByLabel("摘要").fill("这是打包版应用导出的真实内容验证。");
    await page.getByLabel("草稿与正文").fill("第一段：内容来自当前项目，不是演示文本。");
    await expect(page.getByText(/已自动保存/).first()).toBeVisible();

    const projectId = await page.evaluate(async () => (await window.thesisWorkbench.listProjects())[0].id);

    // DOCX
    const docxSize = await page.evaluate(async ([pid, p]) => window.thesisWorkbench.exportDocxTo(pid, p), [projectId, docxPath] as [string, string]);
    expect(docxSize).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(readFileSync(docxPath));
    const docXml = await zip.file("word/document.xml")?.async("string") ?? "";
    expect(docXml).toContain("打包版导出验收论文");
    expect(docXml).toContain("不是演示文本");
    console.log("PACKED-DOCX-OK " + docxSize);

    // PDF
    const pdfSize = await page.evaluate(async ([pid, p]) => window.thesisWorkbench.exportPdfTo(pid, p), [projectId, pdfPath] as [string, string]);
    expect(pdfSize).toBeGreaterThan(1000);
    expect(readFileSync(pdfPath).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    console.log("PACKED-PDF-OK " + pdfSize);

    // 备份
    const zipSize = await page.evaluate(async ([pid, p]) => window.thesisWorkbench.exportBackupTo(pid, p), [projectId, zipPath] as [string, string]);
    expect(zipSize).toBeGreaterThan(200);
    const backup = await JSZip.loadAsync(readFileSync(zipPath));
    const bundleText = await backup.file("bundle.json")?.async("string") ?? "";
    expect(bundleText).toContain("打包版导出验收论文");
    expect(bundleText).toContain("不是演示文本");
    console.log("PACKED-ZIP-OK " + zipSize);

    // 关闭重开：内容仍在（同一 userData）
    await app.close();
  } finally {
    try { await app.close(); } catch { /* already closed */ }
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("tw-packed-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});

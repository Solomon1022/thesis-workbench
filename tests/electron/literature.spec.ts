import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 阶段 3 验证（测试夹具）：检索 → 选择候选 → DOI 核验 → 保存来源 → 证据卡片 → 错误状态 → 重启持久化。
 * 检索服务用本地模拟服务（TWB_CROSSREF_BASE / TWB_ARXIV_BASE），不依赖真实网络。
 */

function startCrossrefMock(): { server: Server; base: string; setMode: (m: "ok" | "err") => void } {
  let mode: "ok" | "err" = "ok";
  const works = [
    { title: ["Attention is all you need"], author: [{ given: "Ashish", family: "Vaswani" }, { given: "Noam", family: "Shazeer" }], issued: { "date-parts": [[2017]] }, "container-title": ["NeurIPS"], DOI: "10.5555/3295222.3295349", URL: "https://example.org/attention", abstract: "", type: "proceedings-article" },
    { title: ["Deep Residual Learning for Image Recognition"], author: [{ given: "Kaiming", family: "He" }], issued: { "date-parts": [[2016]] }, "container-title": ["CVPR"], DOI: "10.5555/deep-residual", URL: "https://example.org/residual", abstract: "", type: "proceedings-article" },
  ];
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (mode === "err") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "mock server error" }));
      return;
    }
    if (url.startsWith("/works?query")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { items: works } }));
      return;
    }
    if (url.startsWith("/works/")) {
      const encoded = url.slice("/works/".length);
      const doi = decodeURIComponent(encoded);
      const hit = works.find((w) => w.DOI === doi);
      if (!hit) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: hit }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return {
    server,
    get base() {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      return "http://127.0.0.1:" + port;
    },
    setMode(m: "ok" | "err") { mode = m; },
  };
}

function startArxivMock(): { server: Server; base: string } {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Diffusion Models Beat GANs on Image Synthesis</title><summary>We show that diffusion models can achieve better sample quality than GANs.</summary><published>2024-01-01T00:00:00Z</published><author><name>Prafulla Dhariwal</name></author><arxiv:doi>10.48550/arXiv.2401.00001</arxiv:doi></entry></feed>';
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/atom+xml" });
    res.end(xml);
  });
  return {
    server,
    get base() {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      return "http://127.0.0.1:" + port;
    },
  };
}

test("文献链路：检索→核验→保存→证据卡片→重启恢复", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const crossref = startCrossrefMock();
  const arxiv = startArxivMock();
  await new Promise<void>((resolve) => crossref.server.listen(0, "127.0.0.1", () => resolve()));
  await new Promise<void>((resolve) => arxiv.server.listen(0, "127.0.0.1", () => resolve()));
  const env = {
    ...process.env,
    NODE_ENV: "test",
    TWB_TEST_USER_DATA: userDataDir,
    TWB_CROSSREF_BASE: crossref.base,
    TWB_ARXIV_BASE: arxiv.base,
    ELECTRON_DEV_URL: "http://localhost:5173",
  } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    // 建项目 → 进入文献整理
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByRole("button", { name: "化学与材料", exact: true }).click();
    await page.getByLabel("项目名称 *").fill("文献测试-" + Date.now());
    await page.getByRole("button", { name: "化学与材料实验", exact: true }).click();
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: /文献综述与证据整理/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await expect(page.getByText("检索与核验（真实学术数据源）")).toBeVisible();

    // 0) 一键自动找文献（基于选题内容，输出真实地址，不保存）
    await page.getByRole("button", { name: /前期检索与选题/ }).click();
    await page.getByLabel("研究方向与关键词").fill("deep learning attention");
    await page.getByRole("button", { name: /文献综述与证据整理/ }).click();
    await page.getByRole("button", { name: "自动找文献（含地址）" }).click();
    await expect(page.getByText(/自动检索完成/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".lit-candidate").filter({ hasText: "Attention is all you need" })).toContainText("https://example.org/attention");
    await expect(page.getByText("Crossref（一键自动检索）")).toBeVisible();

    // 1) Crossref 检索 → 候选 → 保存
    await page.getByLabel("检索式").fill("attention transformer");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await expect(page.locator(".lit-outcome")).toContainText("2 条");
    await page.locator(".lit-candidate").filter({ hasText: "Attention is all you need" }).getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(/已保存：Attention/)).toBeVisible();
    await expect(page.locator(".lit-item").filter({ hasText: "Attention is all you need" }).getByText("已核验", { exact: true })).toBeVisible();

    // 2) DOI 核验 → 保存 → 重复保存被去重
    await page.getByLabel("DOI 核验").fill("10.5555/deep-residual");
    await page.getByRole("button", { name: "按 DOI 核验" }).click();
    await page.locator(".lit-candidate").filter({ hasText: "Deep Residual Learning" }).getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(/已保存：Deep Residual/)).toBeVisible();
    await page.getByRole("button", { name: "按 DOI 核验" }).click();
    await page.locator(".lit-candidate").filter({ hasText: "Deep Residual Learning" }).getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(/已存在相同 DOI 的文献记录/)).toBeVisible();

    // 3) arXiv 检索 → 预印本标记
    await page.getByLabel("检索来源").selectOption("arxiv");
    await page.getByLabel("检索式").fill("diffusion models");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await page.locator(".lit-candidate").filter({ hasText: "Diffusion Models Beat GANs" }).getByRole("button", { name: "保存" }).click();
    await expect(page.locator(".lit-item").filter({ hasText: "Diffusion Models Beat GANs" }).getByText("预印本", { exact: true })).toBeVisible();

    // 4) 手动录入（待核验）→ 人工核验（已核验）
    await page.getByLabel("参考文献引用").fill("张三, 李四. 手动录入的文献研究[J]. 测试期刊, 2020, 1(1): 1-10.");
    await page.getByRole("button", { name: "保存记录" }).click();
    const manualItem = page.locator(".lit-item").filter({ hasText: "手动录入的文献研究" });
    await expect(manualItem.getByText("待核验", { exact: true })).toBeVisible();
    await manualItem.getByRole("button", { name: "人工核验" }).click();
    await expect(manualItem.getByText("已核验", { exact: true })).toBeVisible();

    // 5) RIS 导入 → 待核验
    await page.getByLabel("导入文本").fill("TY  - JOUR\nTI  - Imported Paper Title\nPY  - 2020\nER  - ");
    await page.getByRole("button", { name: "解析预览" }).click();
    await page.locator(".lit-candidate").filter({ hasText: "Imported Paper Title" }).getByRole("button", { name: "保存" }).click();
    await expect(page.locator(".lit-item").filter({ hasText: "Imported Paper Title" }).getByText("待核验", { exact: true })).toBeVisible();

    // 6) 证据卡片
    await page.locator(".lit-item").filter({ hasText: "Attention is all you need" }).getByRole("button", { name: "证据卡片" }).click();
    await page.getByLabel("证据观点").fill("该研究提出多头自注意力机制");
    await page.getByLabel("原文定位").fill("第 2 页，模型部分");
    await page.getByRole("button", { name: "添加证据卡片" }).click();
    await expect(page.getByText("该研究提出多头自注意力机制")).toBeVisible();
    await page.getByRole("button", { name: "关闭" }).click();

    // 7) 错误状态：服务 500 → 明确失败提示 + 检索记录
    crossref.setMode("err");
    await page.getByLabel("检索来源").selectOption("crossref");
    await page.getByLabel("检索式").fill("anything");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await expect(page.getByText(/检索失败：Crossref 服务返回错误/).first()).toBeVisible();
    await page.locator("details.lit-log").filter({ hasText: "检索记录" }).locator("summary").click();
    await expect(page.locator("details.lit-log").filter({ hasText: "检索记录" })).toContainText("失败");
  } finally {
    await app.close();
  }

  // 8) 重启：文献与证据卡片持久化
  const app2 = await electron.launch({ args: ["."], env });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText(/文献测试-/)).toBeVisible({ timeout: 30_000 });
    await page2.getByText(/文献测试-/).click();
    await page2.getByRole("button", { name: /文献综述与证据整理/ }).click();
    await expect(page2.locator(".lit-item").filter({ hasText: "Attention is all you need" })).toBeVisible({ timeout: 15_000 });
    await expect(page2.locator(".lit-item").filter({ hasText: "Imported Paper Title" })).toBeVisible();
    await page2.locator(".lit-item").filter({ hasText: "Attention is all you need" }).getByRole("button", { name: "证据卡片" }).click();
    await expect(page2.getByText("该研究提出多头自注意力机制")).toBeVisible();
  } finally {
    await app2.close();
    await new Promise<void>((resolve) => crossref.server.close(() => resolve()));
    await new Promise<void>((resolve) => arxiv.server.close(() => resolve()));
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});

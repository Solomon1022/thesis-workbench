import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 阶段 2 验证：模型服务配置、密钥加密存储、三层连接测试、取消、任务角色分配与重启持久化。
 * 使用本地模拟 OpenAI 兼容服务，不依赖真实 API Key。
 */

type MockMode = "ok" | "auth_fail" | "slow";

function startMockServer(): { server: Server; baseUrl: string; setMode: (m: MockMode) => void; close: () => Promise<void> } {
  let mode: MockMode = "ok";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const url = req.url ?? "";
      if (mode === "auth_fail") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "invalid key" } }));
        return;
      }
      if (url.startsWith("/v1/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "test-model" }, { id: "other-model" }] }));
        return;
      }
      if (url.startsWith("/v1/chat/completions")) {
        if (mode === "slow") {
          setTimeout(() => {
            if (res.destroyed || res.writableEnded) return;
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "2" } }] }));
          }, 15000);
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "2" } }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return {
    server,
    get baseUrl() {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      return "http://127.0.0.1:" + port + "/v1";
    },
    setMode(m: MockMode) { mode = m; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("模型配置、三层连接测试、取消与角色分配可持久化", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const mock = startMockServer();
  await new Promise<void>((resolve) => mock.server.listen(0, "127.0.0.1", () => resolve()));
  const env = { ...process.env, NODE_ENV: "test", TWB_TEST_USER_DATA: userDataDir, ELECTRON_DEV_URL: "http://localhost:5173" } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    // 进入设置，配置自定义中转
    await page.getByRole("button", { name: "服务与模型设置" }).click();
    await expect(page.getByRole("heading", { name: "服务与模型设置" })).toBeVisible();
    await page.getByRole("button", { name: "自定义 / OpenAI 兼容中转" }).click();
    await page.getByLabel("Base URL *").fill(mock.baseUrl);
    await page.getByLabel("模型名 *").fill("test-model");
    await page.getByLabel("API Key").fill("sk-test-123");
    await page.getByRole("button", { name: "保存配置" }).click();
    await expect(page.getByText(/已保存（含密钥）/)).toBeVisible();

    // 三层全部通过
    await page.getByRole("button", { name: "连接测试" }).click();
    await expect(page.getByText("① 鉴权")).toBeVisible();
    await expect(page.getByText("✓ 通过").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("③ 实际能力")).toBeVisible();
    await expect(page.getByText("✓ 通过")).toHaveCount(3);
    await expect(page.getByText(/实际生成正常/)).toBeVisible();

    // 鉴权失败（模拟 401）
    mock.setMode("auth_fail");
    await page.getByRole("button", { name: "连接测试" }).click();
    await expect(page.getByText(/鉴权失败/)).toBeVisible({ timeout: 20_000 });

    // 取消（模拟慢响应）
    mock.setMode("slow");
    await page.getByRole("button", { name: "连接测试" }).click();
    await page.getByRole("button", { name: "取消测试" }).click();
    await expect(page.getByText("已取消").first()).toBeVisible({ timeout: 20_000 });
    mock.setMode("ok");

    // 任务角色分配
    await page.getByRole("button", { name: "任务角色" }).click();
    await page.getByLabel("研究设计服务商").selectOption("custom");
    await expect(page.getByLabel("研究设计模型名")).toHaveValue("test-model");
    await page.getByRole("button", { name: "保存研究设计" }).click();
    await expect(page.getByText("角色配置已保存")).toBeVisible();
  } finally {
    await app.close();
  }

  // 重启验证：配置、密钥状态与角色分配仍在
  const app2 = await electron.launch({ args: ["."], env });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });
    await page2.getByRole("button", { name: "服务与模型设置" }).click();
    await page2.getByRole("button", { name: "自定义 / OpenAI 兼容中转" }).click();
    await expect(page2.getByLabel("Base URL *")).toHaveValue(mock.baseUrl);
    await expect(page2.getByLabel("模型名 *")).toHaveValue("test-model");
    await expect(page2.getByText("已配置", { exact: true }).first()).toBeVisible();
    await page2.getByRole("button", { name: "任务角色" }).click();
    await expect(page2.getByLabel("研究设计服务商")).toHaveValue("custom");
    await expect(page2.getByLabel("研究设计模型名")).toHaveValue("test-model");
  } finally {
    await app2.close();
    await mock.close();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});

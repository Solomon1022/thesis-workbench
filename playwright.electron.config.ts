import { defineConfig } from "@playwright/test";

// 外层环境可能注入 ELECTRON_RUN_AS_NODE=1，会让 electron 退化为 node，必须清除
delete process.env.ELECTRON_RUN_AS_NODE;
process.env.ELECTRON_DEV_URL = "http://localhost:5173";

export default defineConfig({
  testDir: "./tests/electron",
  timeout: 90_000,
  workers: 1,
  use: { viewport: { width: 1280, height: 820 }, locale: "zh-CN" },
  webServer: {
    command: "npx vite --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

import { defineConfig } from "tsup";

// electron 必须交给运行时 require。主进程没有第三方运行时依赖，
// node:* 内置模块（node:sqlite 等）与相对导入由 esbuild 自动处理，无需 noExternal。
export default defineConfig({
  entry: { main: "src/main/main.ts", preload: "src/preload/preload.ts" },
  outDir: "dist-electron",
  format: ["cjs"],
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  external: ["electron"],
  esbuildOptions(options) { options.mainFields = ["module", "main"]; },
});

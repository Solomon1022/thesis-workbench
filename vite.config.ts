import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 渲染层为本地 SPA：相对路径 base 保证打包后 file:// 也能加载资源
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});

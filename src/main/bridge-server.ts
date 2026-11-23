import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ThesisDB } from "./db";
import type { LiteratureService } from "./literature-service";

export interface BridgeInfo {
  port: number;
  token: string;
}

/**
 * 本地桥服务（浏览器扩展 → 论文工作台）：
 * 仅绑定 127.0.0.1，校验 Host 与 token（防 DNS rebinding），
 * 提供 /ping 与 /import（解析 + 真实核验 + 入库）。
 * 扩展所需的端口与 token 写入 userData/bridge.json（供原生消息宿主读取）。
 */
export function startBridgeServer(opts: {
  db: ThesisDB;
  literature: LiteratureService;
  userDataDir: string;
  onImported: (projectId: string, summary: { verified: number; unverified: number; skipped: number; failed: number }) => void;
}): BridgeInfo {
  const { db, literature, userDataDir, onImported } = opts;
  const token = db.getAppSetting("bridge_token") || (() => { const t = randomUUID(); db.setAppSetting("bridge_token", t); return t; })();

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 2 * 1024 * 1024) { reject(new Error("请求体过大")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const send = (res: ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-twb-token",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    res.end(JSON.stringify(data));
  };

  const isLocal = (req: IncomingMessage) => {
    const host = String(req.headers.host ?? "").split(":")[0];
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  };

  const server = createServer((req, res) => {
    if (!isLocal(req)) { send(res, 403, { ok: false, message: "仅允许本机访问" }); return; }
    if (req.method === "OPTIONS") { send(res, 204, {}); return; }
    if (String(req.headers["x-twb-token"] ?? "") !== token) { send(res, 401, { ok: false, message: "token 校验失败" }); return; }
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/ping") {
      send(res, 200, { ok: true, name: "thesis-workbench", version: "1" });
      return;
    }
    if (req.method === "POST" && url === "/import") {
      void readBody(req).then(async (body) => {
        try {
          const parsed = JSON.parse(body) as { text?: string; projectId?: string };
          if (typeof parsed.text !== "string" || !parsed.text.trim() || typeof parsed.projectId !== "string") {
            send(res, 400, { ok: false, message: "缺少 text 或 projectId" });
            return;
          }
          const summary = await literature.importAiText(parsed.projectId, parsed.text);
          onImported(parsed.projectId, summary);
          send(res, 200, { ok: summary.ok, message: summary.message, summary });
        } catch (e) {
          send(res, 500, { ok: false, message: e instanceof Error ? e.message : String(e) });
        }
      }).catch((e) => send(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    send(res, 404, { ok: false, message: "未知接口" });
  });

  let port = 17321;
  let started = false;
  while (!started && port <= 17326) {
    try {
      server.listen(port, "127.0.0.1");
      started = true;
    } catch {
      port++;
    }
  }
  if (!started) throw new Error("本地桥服务启动失败（端口占用）");

  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(path.join(userDataDir, "bridge.json"), JSON.stringify({ port, token }), "utf8");
  } catch { /* 忽略写入失败（仅扩展端读取用） */ }

  return { port, token };
}

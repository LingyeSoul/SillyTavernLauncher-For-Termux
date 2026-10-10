/** WEBUI API 测试 — 静态资源 / EULA 门控 / 状态聚合 / 配置写操作。 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createWebuiHandler, resetAgreementCache } from "../src/webui/server.ts";
import { get, makeDataDir, cleanupDataDirs, useTempBaseDir, withServer } from "./helpers.ts";

const dirs: string[] = [];

beforeEach(() => {
  dirs.push(useTempBaseDir());
  resetAgreementCache();
});

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  cleanupDataDirs();
});

async function post(port: number, pathName: string, body: unknown, token?: string): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}${pathName}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

describe("WEBUI API", () => {
  it("静态首页可访问", async () => {
    const handler = createWebuiHandler({ host: "127.0.0.1" });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      const response = await get(port, "/");
      expect(response.status).toBe(200);
      expect(response.text).toContain("SillyTavern Launcher");
    } finally {
      await close();
    }
  });

  it("静态资源拒绝路径穿越", async () => {
    const handler = createWebuiHandler({ host: "127.0.0.1" });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      expect((await get(port, "/static/../../package.json")).status).toBe(404);
    } finally {
      await close();
    }
  });

  it("EULA 未同意时：只读可用，写操作被 403 拦截，accept 后放行", async () => {
    const handler = createWebuiHandler({ host: "127.0.0.1" });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      expect((await get(port, "/api/ping")).status).toBe(200);

      const blocked = await post(port, "/api/config/autostart", { enabled: true });
      expect(blocked.status).toBe(403);

      const agreement = await get(port, "/api/agreement");
      expect(agreement.status).toBe(200);
      expect(JSON.parse(agreement.text).required).toBe(true);

      const badAccept = await post(port, "/api/agreement/accept", { accepted: false });
      expect(badAccept.status).toBe(400);

      const accept = await post(port, "/api/agreement/accept", { accepted: true });
      expect(accept.status).toBe(200);

      const allowed = await post(port, "/api/config/autostart", { enabled: true });
      expect(allowed.status).toBe(200);

      const status = await get(port, "/api/status");
      expect(status.status).toBe(200);
      expect(JSON.parse(status.text).agreement_required).toBe(false);
      expect(JSON.parse(status.text).installed).toBe(false);
    } finally {
      await close();
    }
  });

  it("非回环监听时强制 Token 认证", async () => {
    const handler = createWebuiHandler({ host: "0.0.0.0" });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      expect((await get(port, "/api/ping")).status).toBe(401);
      const { getConfigStore } = await import("../src/services/configStore.ts");
      const token = getConfigStore().get<string>("webui.token", "");
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect((await get(port, `/api/ping?token=${token}`)).status).toBe(200);
      expect((await get(port, "/api/ping", { Authorization: `Bearer ${token}` })).status).toBe(200);
    } finally {
      await close();
    }
  });

  it("镜像设置校验非法输入", async () => {
    const handler = createWebuiHandler({ host: "127.0.0.1" });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      await post(port, "/api/agreement/accept", { accepted: true });
      const bad = await post(port, "/api/config/mirror", { mirror: "!!bad!!" });
      expect(bad.status).toBe(400);
    } finally {
      await close();
    }
  });
});

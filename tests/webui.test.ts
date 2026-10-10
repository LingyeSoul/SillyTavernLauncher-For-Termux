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

      const blocked = await post(port, "/api/config/startup", { behavior: "menu" });
      expect(blocked.status).toBe(403);

      const agreement = await get(port, "/api/agreement");
      expect(agreement.status).toBe(200);
      expect(JSON.parse(agreement.text).required).toBe(true);

      const badAccept = await post(port, "/api/agreement/accept", { accepted: false });
      expect(badAccept.status).toBe(400);

      const accept = await post(port, "/api/agreement/accept", { accepted: true });
      expect(accept.status).toBe(200);

      const allowed = await post(port, "/api/config/startup", { behavior: "menu" });
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

  it("关于页检查更新：绕过缓存强制检查，返回结构化结果", async () => {
    const handler = createWebuiHandler({ host: "127.0.0.1" });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      const blocked = await post(port, "/api/launcher/check-update", {});
      expect(blocked.status).toBe(403); // EULA 门控同样覆盖

      await post(port, "/api/agreement/accept", { accepted: true });
      const res = await post(port, "/api/launcher/check-update", {});
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.text) as { has_update?: boolean; has_error?: boolean };
      expect(typeof payload.has_update).toBe("boolean");
      expect(typeof payload.has_error).toBe("boolean");
    } finally {
      await close();
    }
  });

  it("智能镜像：注册表读取 / 智能模式开关 / 手动选择 / 测速任务受理", async () => {
    // 隔离全局 gitconfig（applyGitMirrorConfig 会写 --global 配置）
    const gitConfig = path.join(makeDataDir(), "gitconfig");
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    const handler = createWebuiHandler({ host: "127.0.0.1" });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      await post(port, "/api/agreement/accept", { accepted: true });

      const list = await get(port, "/api/mirrors");
      expect(list.status).toBe(200);
      const payload = JSON.parse(list.text);
      expect(payload.current).toBe("github");
      expect(payload.enabled).toBe(false);
      expect(payload.mirrors.length).toBeGreaterThan(10);
      expect(payload.mirrors[0]).toMatchObject({ host: "github.dpik.top", tier: "fast" });

      const smart = await post(port, "/api/config/mirror", { enabled: true });
      expect(smart.status).toBe(200);
      expect(JSON.parse(smart.text)).toMatchObject({ enabled: true, auto: true });

      const manual = await post(port, "/api/config/mirror", { mirror: "gh.llkk.cc" });
      expect(manual.status).toBe(200);
      expect(JSON.parse(manual.text)).toMatchObject({ mirror: "gh.llkk.cc", enabled: true, auto: false });

      const legacy = await post(port, "/api/config/mirror", { mirror: "ghproxy" });
      expect(legacy.status).toBe(200);
      expect(JSON.parse(legacy.text).mirror).toBe("gh-proxy.org");

      // 回归：官方源哨兵 'github' 是前端「官方源」按钮下发的合法值，曾被误判无效
      const official = await post(port, "/api/config/mirror", { mirror: "github" });
      expect(official.status).toBe(200);
      expect(JSON.parse(official.text)).toMatchObject({ mirror: "github", enabled: false });

      const empty = await post(port, "/api/config/mirror", {});
      expect(empty.status).toBe(400);

      const speedtest = await post(port, "/api/mirrors/speedtest", {});
      expect(speedtest.status).toBe(202);

      const autoSelect = await post(port, "/api/mirrors/auto-select", {});
      expect(autoSelect.status).toBe(202);
    } finally {
      delete process.env.GIT_CONFIG_GLOBAL;
      await close();
    }
  });
});

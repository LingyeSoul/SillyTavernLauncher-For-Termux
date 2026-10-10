/** 同步安全测试 — ← tests/test_sync_security.py 全量迁移（12 项语义对齐）。 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createSyncHandler, SyncServer } from "../src/services/sync/server.ts";
import { SyncClient, parseShareUrl } from "../src/services/sync/client.ts";
import {
  SyncSecurityError,
  SyncUsageError,
  redactShareUrl,
  safeRelativePath,
} from "../src/services/sync/common.ts";
import { parseZipCentralDirectory } from "../src/services/sync/zip.ts";
import { getSyncManager, resetSyncManager } from "../src/services/sync/manager.ts";
import { authHeader, cleanupDataDirs, craftZip, get, makeDataDir, TOKEN, trySymlink, useTempBaseDir, withServer } from "./helpers.ts";

const baseDirs: string[] = [];

beforeEach(() => {
  baseDirs.push(useTempBaseDir());
});

afterAll(() => {
  for (const dir of baseDirs) fs.rmSync(dir, { recursive: true, force: true });
  cleanupDataDirs();
});

describe("同步服务器认证与路径隐藏", () => {
  it("除 /health 外全部要求 Bearer Token，响应不泄露数据目录路径", async () => {
    const dataDir = makeDataDir();
    fs.writeFileSync(path.join(dataDir, "settings.json"), "{}");

    const handler = createSyncHandler({ dataDir, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      const health = await get(port, "/health");
      expect(health.status).toBe(200);
      expect(JSON.parse(health.text).auth_required).toBe(true);
      expect(health.text).not.toContain(dataDir);

      const unauthenticated = await get(port, "/info");
      expect(unauthenticated.status).toBe(401);

      const wrong = await get(port, "/info", authHeader("wrong"));
      expect(wrong.status).toBe(401);

      const info = await get(port, "/info", authHeader());
      expect(info.status).toBe(200);
      expect(info.text).not.toContain(dataDir);
      expect(JSON.parse(info.text).server_info.file_count).toBe(1);
    } finally {
      await close();
    }
  });

  it("/file 拒绝穿越(403)、目录(404)与缺参(400)", async () => {
    const dataDir = makeDataDir();
    fs.mkdirSync(path.join(dataDir, "folder"));
    const handler = createSyncHandler({ dataDir, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      expect((await get(port, "/file?path=../../outside", authHeader())).status).toBe(403);
      expect((await get(port, "/file?path=folder", authHeader())).status).toBe(404);
      expect((await get(port, "/file", authHeader())).status).toBe(400);
    } finally {
      await close();
    }
  });
});

describe("分享地址解析", () => {
  it("token 只存在于 fragment，base_url 不含凭证", () => {
    const { baseUrl, token } = parseShareUrl("http://192.168.1.10:9999#token=abc123");
    expect(baseUrl).toBe("http://192.168.1.10:9999");
    expect(token).toBe("abc123");
    expect(baseUrl).not.toContain("token");
    expect(redactShareUrl("http://192.168.1.10:9999#token=abc123")).toBe(
      "http://192.168.1.10:9999#token=<hidden>",
    );
  });

  it.each([
    "http://host:9999",
    "ftp://host:9999#token=x",
    "http://user:password@host:9999#token=x",
    "http://host:9999?token=x#token=y",
    "http://host:9999#token=x&extra=y",
    "http://host:9999#token=x&token=y",
  ])("拒绝不安全/不完整地址: %s", (url) => {
    expect(() => parseShareUrl(url)).toThrow(SyncUsageError);
  });
});

describe("安全路径映射", () => {
  it("写入路径中的符号链接被拒绝", () => {
    const base = makeDataDir();
    const actual = path.join(base, "actual");
    fs.mkdirSync(actual);
    if (!trySymlink(actual, path.join(base, "linked"), "dir")) return;
    expect(() => safeRelativePath(base, "linked/file.txt")).toThrow(SyncSecurityError);
  });
});

describe("同步客户端", () => {
  it("auto 模式下 ZIP 安全失败不会绕过到增量同步", async () => {
    const dataDir = makeDataDir();
    class GuardedClient extends SyncClient {
      override async syncFullZip(): Promise<never> {
        throw new SyncSecurityError("unsafe ZIP");
      }
      override async syncIncremental(): Promise<never> {
        throw new Error("不应被调用");
      }
    }
    const client = new GuardedClient("http://127.0.0.1:9999#token=test", dataDir);
    let healthCalled = false;
    (client as unknown as { health: () => Promise<unknown> }).health = async () => {
      healthCalled = true;
    };
    await expect(client.sync("auto")).rejects.toThrow(/unsafe ZIP/);
    expect(healthCalled).toBe(true);
  });

  it("真实 HTTP 往返：ZIP 全量 + 增量同步", async () => {
    const source = makeDataDir();
    fs.writeFileSync(path.join(source, "settings.json"), "one");
    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    const destination = makeDataDir();
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      const zipResult = await client.sync("zip", false);
      expect(fs.readFileSync(path.join(destination, "settings.json"), "utf-8")).toBe("one");

      fs.writeFileSync(path.join(source, "settings.json"), "two");
      fs.writeFileSync(path.join(source, "new.txt"), "new");
      const incremental = await client.sync("incremental", false);

      expect(zipResult.method).toBe("zip");
      expect(incremental.downloaded_files).toBe(2);
      expect(fs.readFileSync(path.join(destination, "settings.json"), "utf-8")).toBe("two");
      expect(fs.readFileSync(path.join(destination, "new.txt"), "utf-8")).toBe("new");
    } finally {
      await close();
    }
  });

  it("服务器 ZIP 不包含符号链接目标文件", async () => {
    const holder = makeDataDir();
    const source = path.join(holder, "src");
    fs.mkdirSync(source);
    const outside = path.join(holder, "outside-secret.txt");
    fs.writeFileSync(outside, "secret");
    if (!trySymlink(outside, path.join(source, "linked.txt"), "file")) return;

    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      const response = await get(port, "/zip", authHeader());
      const archivePath = path.join(makeDataDir(), "download.zip");
      fs.writeFileSync(archivePath, response.buffer);
      const entries = await parseZipCentralDirectory(archivePath, response.buffer.length);
      expect(entries.map((e) => e.name)).not.toContain("linked.txt");
    } finally {
      await close();
    }
  });

  it("恶意 ZIP 被拒绝且不触碰目标目录", async () => {
    const malicious = craftZip([{ name: "../outside.txt", data: Buffer.from("secret") }]);
    const { port, close } = await withServer((req, res) => {
      if (req.url === "/zip") {
        res.writeHead(200, { "Content-Type": "application/zip" });
        res.end(malicious);
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });

    const parent = makeDataDir();
    const destination = path.join(parent, "destination");
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "keep.txt"), "keep");
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      await expect(client.syncFullZip(false)).rejects.toThrow(/ZIP/);
      expect(fs.readFileSync(path.join(destination, "keep.txt"), "utf-8")).toBe("keep");
      expect(fs.existsSync(path.join(parent, "outside.txt"))).toBe(false);
    } finally {
      await close();
    }
  });
});

describe("同步服务器生命周期", () => {
  it("后台启动 / 健康 / 信息 / 停止", async () => {
    const source = makeDataDir();
    fs.writeFileSync(path.join(source, "settings.json"), "{}");
    const handlerPort = await import("node:net").then((net) =>
      new Promise<number>((resolve) => {
        const probe = net.createServer();
        probe.listen(0, "127.0.0.1", () => {
          const addr = probe.address() as { port: number };
          probe.close(() => resolve(addr.port));
        });
      }),
    );
    const server = new SyncServer(source, handlerPort, "127.0.0.1", () => TOKEN);
    try {
      expect(await server.start()).toBe(true);
      const health = await get(handlerPort, "/health");
      const info = await get(handlerPort, "/info", authHeader());
      expect(health.status).toBe(200);
      expect(info.status).toBe(200);
      const parsedShare = parseShareUrl(server.shareUrl("127.0.0.1"));
      expect(parsedShare.token).toBe(TOKEN);
    } finally {
      await server.stop();
    }
    expect(server.running).toBe(false);
  });

  it("SyncManager 启动经认证的服务器并可被客户端使用", async () => {
    const baseDir = makeDataDir();
    const dataDir = path.join(baseDir, "SillyTavern", "data", "default-user");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "settings.json"), "{}");

    const { setBaseDir } = await import("../src/services/paths.ts");
    setBaseDir(baseDir);
    const manager = getSyncManager();
    resetSyncManager();

    const port = await import("node:net").then((net) =>
      new Promise<number>((resolve) => {
        const probe = net.createServer();
        probe.listen(0, "127.0.0.1", () => {
          const addr = probe.address() as { port: number };
          probe.close(() => resolve(addr.port));
        });
      }),
    );

    const result = await manager.start(port, "127.0.0.1");
    expect(result.ok).toBe(true);
    try {
      const status = await manager.status();
      expect(status.running).toBe(true);
      const destination = path.join(baseDir, "destination");
      const client = new SyncClient(await manager.shareUrl("127.0.0.1"), destination);
      const info = await client.info();
      expect((info.server_info as { file_count: number }).file_count).toBe(1);
    } finally {
      await manager.stop();
    }

    const { getConfigStore } = await import("../src/services/configStore.ts");
    expect(getConfigStore().get<boolean>("sync.enabled")).toBe(false);
  });
});

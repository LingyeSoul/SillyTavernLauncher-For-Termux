/** 同步安全测试 — ← tests/test_sync_security.py 全量迁移（12 项语义对齐）。 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as path from "node:path";
import { createSyncHandler, SyncServer } from "../src/services/sync/server.ts";
import { SyncClient, parseShareUrl } from "../src/services/sync/client.ts";
import {
  MAX_SYNC_ZIP_FILES,
  MAX_SYNC_ZIP_SIZE,
  SyncSecurityError,
  SyncUsageError,
  redactShareUrl,
  safeRelativePath,
} from "../src/services/sync/common.ts";
import { parseZipCentralDirectory, validateZipEntries, type ZipEntry } from "../src/services/sync/zip.ts";
import { getSyncManager, resetSyncManager } from "../src/services/sync/manager.ts";
import { stDataDir } from "../src/services/paths.ts";
import { authHeader, cleanupDataDirs, craftZip, get, makeDataDir, TOKEN, trySymlink, useTempBaseDir, withServer } from "./helpers.ts";

const baseDirs: string[] = [];

type ManifestEntryInput = {
  path: string;
  size: number;
  mtime: number;
  sha256?: string;
};

/** 静态清单服务器：可返回任意原始 path 串，用于锁定客户端规范化行为。 */
function staticManifestServer(options: {
  manifest: ManifestEntryInput[];
  files: Record<string, Buffer>;
  onFileRequest?: (relativePath: string) => void;
}): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://manifest.local");
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", auth_required: true }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (url.pathname === "/info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          server_info: { file_count: options.manifest.length, total_size: 0 },
        }),
      );
      return;
    }
    if (url.pathname === "/manifest") {
      const manifest = options.manifest.map((item) => ({
        path: item.path,
        size: item.size,
        mtime: item.mtime,
        modified: new Date(item.mtime * 1000).toISOString(),
        is_dir: false,
        ...(item.sha256 === undefined ? {} : { sha256: item.sha256 }),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, manifest, total_files: manifest.length }));
      return;
    }
    if (url.pathname === "/file") {
      const relativePath = url.searchParams.get("path") ?? "";
      options.onFileRequest?.(relativePath);
      const data = options.files[relativePath];
      if (!data) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": data.length });
      res.end(data);
      return;
    }
    res.writeHead(404);
    res.end();
  };
}

function syntheticZipEntry(name: string, overrides: Partial<ZipEntry> = {}): ZipEntry {
  return {
    name,
    crc32: 0,
    compressedSize: 0,
    uncompressedSize: 0,
    method: 0,
    flagBits: 0,
    isDir: false,
    unixMode: 0,
    localHeaderOffset: 0,
    ...overrides,
  };
}

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

  it.each([
    "../outside.txt",
    "a/../../outside.txt",
    "/etc/passwd",
    "a\\b.txt",
    "C:/evil.txt",
    "",
  ])("拒绝穿越/绝对/反斜杠/驱动器号路径: %s", (value) => {
    expect(() => safeRelativePath(makeDataDir(), value)).toThrow(SyncSecurityError);
  });
});

describe("ZIP 炸弹限制", () => {
  it("拒绝超过文件数量上限的 ZIP", () => {
    const entries = Array.from({ length: MAX_SYNC_ZIP_FILES + 1 }, (_, i) =>
      syntheticZipEntry(`f${i}.txt`),
    );
    expect(() => validateZipEntries(entries)).toThrow(/文件数量超过限制/);
  });

  it("拒绝解压总量超过上限的 ZIP", () => {
    expect(() =>
      validateZipEntries([syntheticZipEntry("big.bin", { uncompressedSize: MAX_SYNC_ZIP_SIZE + 1 })]),
    ).toThrow(/解压后大小超过限制/);
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

describe("增量同步数据保护", () => {
  it("远端空清单默认拒绝：本地文件原样保留且不产生备份", async () => {
    const source = makeDataDir();
    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    const parent = makeDataDir();
    const destination = path.join(parent, "default-user");
    fs.mkdirSync(path.join(destination, "chats"), { recursive: true });
    fs.writeFileSync(path.join(destination, "settings.json"), "local-settings");
    fs.writeFileSync(path.join(destination, "chats", "a.jsonl"), "local-chat");
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      await expect(client.sync("incremental", true)).rejects.toThrow(/远端文件清单为空/);

      expect(fs.readFileSync(path.join(destination, "settings.json"), "utf-8")).toBe("local-settings");
      expect(fs.readFileSync(path.join(destination, "chats", "a.jsonl"), "utf-8")).toBe("local-chat");
      expect(fs.existsSync(path.join(parent, ".stl-backups"))).toBe(false);

      // 显式 allowEmptyRemote 才允许清空，且删除前仍先备份
      const allowed = await client.sync("incremental", true, true);
      expect(allowed.deleted_files).toBe(2);
      expect(fs.existsSync(path.join(destination, "settings.json"))).toBe(false);
      const backups = fs.readdirSync(path.join(parent, ".stl-backups"));
      expect(backups).toHaveLength(1);
      const backup = path.join(parent, ".stl-backups", backups[0]);
      expect(fs.readFileSync(path.join(backup, "settings.json"), "utf-8")).toBe("local-settings");
      expect(fs.readFileSync(path.join(backup, "chats", "a.jsonl"), "utf-8")).toBe("local-chat");
    } finally {
      await close();
    }
  });

  it("SyncManager.syncFrom 默认不传 allowEmptyRemote（空清单仍拒绝）", async () => {
    const dataDir = stDataDir();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "settings.json"), "keep");
    const source = makeDataDir();
    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      resetSyncManager();
      const result = await getSyncManager().syncFrom(
        `http://127.0.0.1:${port}#token=${TOKEN}`,
        "incremental",
        false,
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("远端文件清单为空");
      expect(fs.readFileSync(path.join(dataDir, "settings.json"), "utf-8")).toBe("keep");
    } finally {
      await close();
    }
  });

  it("manifest 路径规范化后重复：a//b.txt 与 a/b.txt 被拒绝", async () => {
    const { port, close } = await withServer(
      staticManifestServer({
        manifest: [
          { path: "a//b.txt", size: 2, mtime: 1_700_000_000 },
          { path: "a/b.txt", size: 2, mtime: 1_700_000_000 },
        ],
        files: { "a/b.txt": Buffer.from("ok") },
      }),
    );
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, makeDataDir());
      await expect(client.sync("incremental", false)).rejects.toThrow(/文件清单包含重复路径/);
    } finally {
      await close();
    }
  });

  it("manifest 原始 a//b.txt 归一后按 a/b.txt 请求并落盘", async () => {
    const requested: string[] = [];
    const { port, close } = await withServer(
      staticManifestServer({
        manifest: [{ path: "a//b.txt", size: 2, mtime: 1_700_000_000 }],
        files: { "a/b.txt": Buffer.from("ok") },
        onFileRequest: (relativePath) => requested.push(relativePath),
      }),
    );
    const destination = makeDataDir();
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      const result = await client.sync("incremental", false);
      expect(result.downloaded_files).toBe(1);
      expect(requested).toEqual(["a/b.txt"]);
      expect(fs.readFileSync(path.join(destination, "a", "b.txt"), "utf-8")).toBe("ok");
    } finally {
      await close();
    }
  });

  it("manifest 归一后文件与目录冲突被拒绝", async () => {
    const { port, close } = await withServer(
      staticManifestServer({
        manifest: [
          { path: "a", size: 1, mtime: 1_700_000_000 },
          { path: "a//b.txt", size: 2, mtime: 1_700_000_000 },
        ],
        files: {},
      }),
    );
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, makeDataDir());
      await expect(client.sync("incremental", false)).rejects.toThrow(/文件与目录路径冲突/);
    } finally {
      await close();
    }
  });

  it.each([
    {
      name: "声明大小不符",
      size: 4,
      body: Buffer.from("ab"),
      sha256: createHash("sha256").update("abcd").digest("hex"),
    },
    {
      name: "sha256 不符",
      size: 4,
      body: Buffer.from("evil"),
      sha256: "0".repeat(64),
    },
  ])("下载完整性校验失败（$name）不落盘", async ({ size, body, sha256 }) => {
    const parent = makeDataDir();
    const destination = path.join(parent, "default-user");
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "settings.json"), "local");
    const { port, close } = await withServer(
      staticManifestServer({
        manifest: [{ path: "settings.json", size, mtime: 1_700_000_000, sha256 }],
        files: { "settings.json": body },
      }),
    );
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      await expect(client.sync("incremental", false)).rejects.toThrow(/下载文件完整性校验失败/);
      expect(fs.readFileSync(path.join(destination, "settings.json"), "utf-8")).toBe("local");
    } finally {
      await close();
    }
  });

  it("有下载/删除时先创建增量备份", async () => {
    const source = makeDataDir();
    fs.writeFileSync(path.join(source, "keep.txt"), "new");
    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    const parent = makeDataDir();
    const destination = path.join(parent, "default-user");
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "keep.txt"), "old");
    fs.writeFileSync(path.join(destination, "delete.txt"), "gone");
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      const result = await client.sync("incremental", true);
      expect(result.downloaded_files).toBe(1);
      expect(result.deleted_files).toBe(1);
      if (result.backup === null) throw new Error("应创建增量备份");
      expect(fs.readFileSync(path.join(result.backup, "keep.txt"), "utf-8")).toBe("old");
      expect(fs.readFileSync(path.join(result.backup, "delete.txt"), "utf-8")).toBe("gone");
      expect(fs.readFileSync(path.join(destination, "keep.txt"), "utf-8")).toBe("new");
      expect(fs.existsSync(path.join(destination, "delete.txt"))).toBe(false);
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

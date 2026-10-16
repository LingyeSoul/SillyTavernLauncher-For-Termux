/**
 * 互操作回归测试 — 锁定双端同步协议契约（Windows 桌面端 ↔ Termux 端）。
 * 种子数据刻意覆盖三个历史断点：子目录、CJK 文件名、隐藏文件/.tmp 过滤。
 * 自产自销（本端 server ↔ 本端 client）+ 旧版 Windows 端清单形状的模拟服务器双轨验证。
 */
import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createSyncHandler } from "../src/services/sync/server.ts";
import { SyncClient } from "../src/services/sync/client.ts";
import { parseZipCentralDirectory } from "../src/services/sync/zip.ts";
import { authHeader, cleanupDataDirs, get, makeDataDir, TOKEN, withServer } from "./helpers.ts";

afterAll(() => {
  cleanupDataDirs();
});

describe("ZIP 全量同步：子目录 + CJK 文件名 + 二进制内容", () => {
  it("auto 模式（ZIP 优先）完整落盘，含深层子目录与非 ASCII 路径", async () => {
    const source = makeDataDir();
    fs.writeFileSync(path.join(source, "settings.json"), "{}");
    fs.mkdirSync(path.join(source, "chats", "子目录", "deep"), { recursive: true });
    fs.writeFileSync(path.join(source, "chats", "对话1.jsonl"), '{"msg":"你好"}\n');
    fs.writeFileSync(path.join(source, "chats", "子目录", "deep", "文件 2.txt"), "深层文件");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 0xff, 0xfe]);
    fs.mkdirSync(path.join(source, "files", "avatars"), { recursive: true });
    fs.writeFileSync(path.join(source, "files", "avatars", "头像 x.png"), png);

    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    const destination = makeDataDir();
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      const result = await client.sync("auto", false);
      expect(result.method).toBe("zip");

      expect(fs.readFileSync(path.join(destination, "settings.json"), "utf-8")).toBe("{}");
      expect(fs.readFileSync(path.join(destination, "chats", "对话1.jsonl"), "utf-8")).toBe('{"msg":"你好"}\n');
      expect(fs.readFileSync(path.join(destination, "chats", "子目录", "deep", "文件 2.txt"), "utf-8")).toBe("深层文件");
      expect(Buffer.compare(fs.readFileSync(path.join(destination, "files", "avatars", "头像 x.png")), png)).toBe(0);
    } finally {
      await close();
    }
  });
});

describe("增量同步：CJK 文件名下载", () => {
  it("/file 对非 ASCII 文件名返回 200，Content-Disposition 按 RFC 5987 编码", async () => {
    const source = makeDataDir();
    fs.mkdirSync(path.join(source, "chats"), { recursive: true });
    fs.writeFileSync(path.join(source, "chats", "对话1.jsonl"), "你好世界\n");
    fs.writeFileSync(path.join(source, "settings.json"), "{}");

    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    try {
      const cjk = await get(port, "/file?path=" + encodeURIComponent("chats/对话1.jsonl"), authHeader());
      expect(cjk.status).toBe(200);
      expect(cjk.text).toBe("你好世界\n");
      const disposition = String(cjk.headers["content-disposition"]);
      expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("对话1.jsonl")}`);
      expect(disposition).toMatch(/filename="[^"]*"/);

      const ascii = await get(port, "/file?path=settings.json", authHeader());
      expect(ascii.status).toBe(200);
      expect(String(ascii.headers["content-disposition"])).toContain('filename="settings.json"');
    } finally {
      await close();
    }
  });

  it("客户端增量同步完整下载 CJK 路径并逐文件校验", async () => {
    const source = makeDataDir();
    fs.mkdirSync(path.join(source, "chats"), { recursive: true });
    fs.writeFileSync(path.join(source, "chats", "对话1.jsonl"), "你好世界\n");

    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    const destination = makeDataDir();
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      const result = await client.sync("incremental", false);
      expect(result.downloaded_files).toBe(1);
      expect(fs.readFileSync(path.join(destination, "chats", "对话1.jsonl"), "utf-8")).toBe("你好世界\n");
    } finally {
      await close();
    }
  });
});

describe("过滤规则：与 Windows 端对齐（隐藏文件/目录 + .tmp）", () => {
  it("manifest 与 ZIP 均排除隐藏项与 .tmp，增量同步不误删本地隐藏文件", async () => {
    const source = makeDataDir();
    fs.writeFileSync(path.join(source, "keep.txt"), "new-content");
    fs.writeFileSync(path.join(source, ".hidden.json"), "server-secret");
    fs.writeFileSync(path.join(source, "temp.tmp"), "temp");
    fs.mkdirSync(path.join(source, ".hiddendir"), { recursive: true });
    fs.writeFileSync(path.join(source, ".hiddendir", "inner.txt"), "inner");
    fs.mkdirSync(path.join(source, "sub"), { recursive: true });
    fs.writeFileSync(path.join(source, "sub", "normal.txt"), "normal");
    fs.writeFileSync(path.join(source, "sub", ".hidden-too"), "x");

    const handler = createSyncHandler({ dataDir: source, tokenProvider: () => TOKEN });
    const { port, close } = await withServer((req, res) => void handler(req, res));
    const destination = makeDataDir();
    fs.writeFileSync(path.join(destination, ".hidden.json"), "local-secret");
    fs.writeFileSync(path.join(destination, "keep.txt"), "old");
    try {
      const manifest = await get(port, "/manifest", authHeader());
      const paths = (JSON.parse(manifest.text).manifest as { path: string }[]).map((m) => m.path).sort();
      expect(paths).toEqual(["keep.txt", "sub/normal.txt"]);

      const zip = await get(port, "/zip", authHeader());
      const archivePath = path.join(makeDataDir(), "download.zip");
      fs.writeFileSync(archivePath, zip.buffer);
      const names = (await parseZipCentralDirectory(archivePath, zip.buffer.length)).map((e) => e.name).sort();
      expect(names).toEqual(["keep.txt", "sub/normal.txt"]);

      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      await client.sync("incremental", false);
      expect(fs.readFileSync(path.join(destination, "keep.txt"), "utf-8")).toBe("new-content");
      expect(fs.readFileSync(path.join(destination, "sub", "normal.txt"), "utf-8")).toBe("normal");
      expect(fs.readFileSync(path.join(destination, ".hidden.json"), "utf-8")).toBe("local-secret");
      expect(fs.existsSync(path.join(destination, "temp.tmp"))).toBe(false);
    } finally {
      await close();
    }
  });
});

describe("兼容旧版 Windows 桌面端清单（无 sha256 字段）", () => {
  function windowsShapedServer(options: {
    manifest: { path: string; size: number; mtime: number }[];
    files: Record<string, Buffer>;
    sha256?: string;
  }): (req: IncomingMessage, res: ServerResponse) => void {
    return (req, res) => {
      const url = new URL(req.url ?? "/", "http://win.local");
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
      if (url.pathname === "/manifest") {
        const manifest = options.manifest.map((m) =>
          options.sha256 === undefined
            ? { ...m, modified: new Date(m.mtime * 1000).toISOString(), is_dir: false }
            : { ...m, modified: new Date(m.mtime * 1000).toISOString(), is_dir: false, sha256: options.sha256 },
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, manifest, total_files: manifest.length }));
        return;
      }
      if (url.pathname === "/file") {
        const data = options.files[url.searchParams.get("path") ?? ""];
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

  it("无 sha256 的清单可增量同步，且第二轮比较稳定（不重复下载）", async () => {
    const files: Record<string, Buffer> = {
      "settings.json": Buffer.from("{}"),
      "chats/对话1.jsonl": Buffer.from("你好\n"),
    };
    const manifest = Object.entries(files).map(([p, data], i) => ({
      path: p,
      size: data.length,
      mtime: 1_700_000_000 + i,
    }));
    const { port, close } = await withServer(windowsShapedServer({ manifest, files }));
    const destination = makeDataDir();
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, destination);
      const first = await client.sync("incremental", false);
      expect(first.downloaded_files).toBe(2);
      expect(fs.readFileSync(path.join(destination, "chats", "对话1.jsonl"), "utf-8")).toBe("你好\n");

      const second = await client.sync("incremental", false);
      expect(second.downloaded_files).toBe(0);
      expect(second.deleted_files).toBe(0);
    } finally {
      await close();
    }
  });

  it("sha256 存在但格式非法时仍然拒绝（安全语义不降级）", async () => {
    const files: Record<string, Buffer> = { "settings.json": Buffer.from("{}") };
    const manifest = [{ path: "settings.json", size: 2, mtime: 1_700_000_000 }];
    const { port, close } = await withServer(windowsShapedServer({ manifest, files, sha256: "not-hex" }));
    try {
      const client = new SyncClient(`http://127.0.0.1:${port}#token=${TOKEN}`, makeDataDir());
      await expect(client.sync("incremental", false)).rejects.toThrow("文件清单元数据无效");
    } finally {
      await close();
    }
  });
});

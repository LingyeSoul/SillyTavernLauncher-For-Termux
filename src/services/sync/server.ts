/**
 * 数据同步服务器 — node:http 手写路由（不引框架），供 CLI / WEBUI / 独立进程使用。
 * ← src/sync_server.py，安全语义逐条对齐：
 *   - 除 /health 外全部要求 Bearer Token（crypto.timingSafeEqual 恒时比较）
 *   - 响应头 Cache-Control: no-store + X-Content-Type-Options: nosniff
 *   - 路径穿越 / 符号链接 → 403；文件不存在 → 404
 *   - /zip 流式输出（常量内存），迭代时跳过一切符号链接
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { relative, resolve, sep } from "node:path";
import { once } from "node:events";
import {
  ALL_INTERFACES,
  SyncSecurityError,
  SyncUsageError,
  buildShareUrl,
  safeRelativePath,
} from "./common.ts";
import { buildZip } from "./zip.ts";

export interface ManifestItem {
  path: string;
  size: number;
  mtime: number;
  modified: string;
  is_dir: boolean;
  /** 本端清单始终提供；对端清单（如旧版 Windows 桌面端）可能缺失，客户端按 null 降级比较。 */
  sha256: string | null;
}

export type TokenProvider = () => string;
export type ServerInfoProvider = () => Record<string, unknown>;

/**
 * 遍历数据目录内可同步的普通文件，不跟随任何符号链接。
 * 与 Windows 桌面端过滤规则逐条对齐：隐藏目录不递归，隐藏文件与 .tmp 临时文件不参与同步，
 * 保证两端 manifest/ZIP 内容一致（避免增量同步反复重下或误删对端独有的文件）。
 */
export async function* iterDataFiles(baseDir: string): AsyncGenerator<{ absPath: string; relPath: string }> {
  const base = fs.realpathSync(baseDir);
  if (!fs.statSync(base).isDirectory()) return;

  async function* walk(dir: string): AsyncGenerator<{ absPath: string; relPath: string }> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        yield* walk(abs);
      } else if (entry.isFile()) {
        if (entry.name.startsWith(".") || entry.name.endsWith(".tmp")) continue;
        const target = fs.realpathSync(abs);
        if (target.startsWith(base + sep)) {
          yield { absPath: target, relPath: relative(base, target).split(sep).join("/") };
        }
      }
    }
  }

  yield* walk(base);
}

async function sha256File(path: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(path, { highWaterMark: 1 << 20 });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** 生成带 SHA-256 的稳定文件清单。 */
export async function buildManifest(baseDir: string): Promise<ManifestItem[]> {
  const manifest: ManifestItem[] = [];
  for await (const { absPath, relPath } of iterDataFiles(baseDir)) {
    const stat = await fsp.stat(absPath);
    manifest.push({
      path: relPath,
      size: stat.size,
      mtime: stat.mtimeMs / 1000,
      modified: new Date(stat.mtimeMs).toISOString(),
      is_dir: false,
      sha256: await sha256File(absPath),
    });
  }
  return manifest.sort((a, b) => (a.path < b.path ? -1 : 1));
}

function tokensEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function errorStatus(error: unknown): number {
  if (error instanceof SyncSecurityError) return 403;
  if (error instanceof SyncUsageError) return 404;
  return 500;
}

/**
 * 构造下载响应的 Content-Disposition（RFC 6266/5987）：
 * HTTP 头只允许 ASCII，中文等非 ASCII 文件名直接拼接会令 Node 抛 TypeError 变成 500，
 * 必须走 filename* 百分号编码，并为老客户端保留 ASCII 回退名。
 */
export function contentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** 解析一个可下载文件，拒绝目录穿越、目录本身和符号链接。 */
function safeDataFile(baseDir: string, relativePath: string): string {
  const target = safeRelativePath(baseDir, relativePath);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new SyncUsageError("文件不存在");
  }
  return target;
}

export interface SyncHandlerOptions {
  dataDir: string;
  tokenProvider: TokenProvider;
  serverInfoProvider?: ServerInfoProvider;
  onError?: (error: unknown, context: string) => void;
}

/** 创建同步 HTTP 处理器（挂到任意 http.Server 上）。 */
export function createSyncHandler(options: SyncHandlerOptions) {
  const dataDir = fs.realpathSync(options.dataDir);

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://sync.local");
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path !== "/health") {
        const authorization = req.headers.authorization ?? "";
        const separatorIndex = authorization.indexOf(" ");
        const scheme = separatorIndex > 0 ? authorization.slice(0, separatorIndex) : "";
        const provided = separatorIndex > 0 ? authorization.slice(separatorIndex + 1) : "";

        let expected: string;
        try {
          expected = options.tokenProvider();
        } catch (error) {
          options.onError?.(error, "token-provider");
          sendJson(res, 503, { success: false, error: "认证状态不可用" });
          return;
        }
        if (typeof expected !== "string" || !expected) {
          sendJson(res, 503, { success: false, error: "认证状态不可用" });
          return;
        }
        if (scheme.toLowerCase() !== "bearer" || !provided || !tokensEqual(provided, expected)) {
          sendJson(res, 401, { success: false, error: "需要有效的同步认证令牌" });
          return;
        }
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(res, 405, { success: false, error: "方法不允许" });
        return;
      }

      if (path === "/health") {
        sendJson(res, 200, { status: "healthy", timestamp: new Date().toISOString(), auth_required: true });
        return;
      }

      if (path === "/manifest") {
        const manifest = await buildManifest(dataDir);
        sendJson(res, 200, {
          success: true,
          manifest,
          total_files: manifest.length,
          generated_at: new Date().toISOString(),
        });
        return;
      }

      if (path === "/zip") {
        const files: { path: string; name: string }[] = [];
        for await (const { absPath, relPath } of iterDataFiles(dataDir)) {
          files.push({ path: absPath, name: relPath });
        }
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": 'attachment; filename="sillytavern-data.zip"',
        });
        let aborted = false;
        res.on("close", () => {
          aborted = true;
        });
        for await (const chunk of buildZip(files)) {
          if (aborted) return;
          if (!res.write(chunk)) {
            await once(res, "drain").catch(() => {
              aborted = true;
            });
            if (aborted) return;
          }
        }
        res.end();
        return;
      }

      if (path === "/file") {
        const relativePath = url.searchParams.get("path") ?? "";
        if (!relativePath) {
          sendJson(res, 400, { success: false, error: "缺少 path 参数" });
          return;
        }
        const target = safeDataFile(dataDir, relativePath);
        const stat = await fsp.stat(target);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Length": stat.size,
          "Content-Disposition": contentDisposition(relativePath.split("/").pop() ?? "sync-file"),
        });
        const stream = fs.createReadStream(target);
        stream.pipe(res);
        return;
      }

      if (path === "/info") {
        const manifest = await buildManifest(dataDir);
        const serverInfo: Record<string, unknown> = {
          total_size: manifest.reduce((sum, item) => sum + item.size, 0),
          file_count: manifest.length,
          auth_required: true,
        };
        const publicInfo = options.serverInfoProvider?.();
        if (publicInfo && typeof publicInfo === "object") {
          for (const key of ["host", "port", "running"] as const) {
            if (key in publicInfo) serverInfo[key] = publicInfo[key];
          }
        }
        sendJson(res, 200, { success: true, server_info: serverInfo });
        return;
      }

      sendJson(res, 404, { success: false, error: "未知接口" });
    } catch (error) {
      const status = errorStatus(error);
      if (status === 500) options.onError?.(error, `sync-handler ${req.url}`);
      if (!res.headersSent) {
        sendJson(res, status, { success: false, error: error instanceof Error ? error.message : String(error) });
      } else {
        res.destroy();
      }
    }
  };
}

/** 传统 CLI 使用的同步服务器（可阻塞或后台运行）。 */
export class SyncServer {
  readonly port: number;
  readonly host: string;
  readonly dataPath: string;
  running = false;
  private fallbackToken = crypto.randomUUID().replace(/-/g, "");
  private tokenProvider: TokenProvider;
  private server: import("node:http").Server | null = null;

  constructor(
    dataPath: string,
    port = 9999,
    host: string = ALL_INTERFACES,
    tokenProvider?: TokenProvider,
  ) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new SyncUsageError("同步端口必须在 1-65535 范围内");
    }
    this.port = port;
    this.host = host;
    this.dataPath = resolve(dataPath);
    if (!fs.existsSync(this.dataPath) || !fs.statSync(this.dataPath).isDirectory()) {
      throw new SyncUsageError(`数据目录不存在: ${this.dataPath}`);
    }
    this.tokenProvider = tokenProvider ?? (() => this.fallbackToken);
    const handler = createSyncHandler({
      dataDir: this.dataPath,
      tokenProvider: this.tokenProvider,
      serverInfoProvider: () => ({ host: this.host, port: this.port, running: this.running }),
    });
    this.server = createServer((req, res) => {
      void handler(req, res);
    });
  }

  shareUrl(publicHost?: string): string {
    return buildShareUrl(publicHost ?? this.host, this.port, this.tokenProvider());
  }

  /** 监听端口；失败抛 SyncUsageError。 */
  async listen(): Promise<void> {
    if (!this.server) throw new SyncUsageError("服务器已关闭");
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (err: Error) => reject(new SyncUsageError(`无法监听同步端口: ${err.message}`));
      this.server!.once("error", onError);
      this.server!.listen(this.port, this.host, () => {
        this.server!.off("error", onError);
        resolvePromise();
      });
    });
    this.running = true;
  }

  async start(): Promise<boolean> {
    if (this.running) return true;
    await this.listen();
    return true;
  }

  async stop(): Promise<boolean> {
    const server = this.server;
    this.server = null;
    this.running = false;
    if (server) {
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
        setTimeout(resolvePromise, 5000);
      });
    }
    return true;
  }
}

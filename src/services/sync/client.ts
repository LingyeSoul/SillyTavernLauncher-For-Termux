/**
 * 认证、事务式数据同步客户端 — 原生 fetch 实现。
 * ← src/sync_client.py，安全语义逐条对齐：
 *   - 分享地址 token 只允许出现在 fragment，绝不进入请求 URL
 *   - ZIP 炸弹限制（文件数 / 解压总量 / 下载字节数）
 *   - 加密条目、符号链接、路径冲突全拒绝；解压前不触碰目标目录
 *   - 增量同步逐文件 sha256 校验 + 声明大小上限；备份 + 事务式替换 + 回滚
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  MAX_SYNC_ZIP_SIZE,
  SyncNetworkError,
  SyncSecurityError,
  SyncUsageError,
  findDataPath,
  safeRelativePath,
} from "./common.ts";
import { extractZipEntry, parseZipCentralDirectory, validateZipEntries } from "./zip.ts";
import { buildManifest, type ManifestItem } from "./server.ts";

export interface SyncResult {
  method: "zip" | "incremental";
  bytes_downloaded?: number;
  downloaded_files?: number;
  deleted_files?: number;
  backup: string | null;
}

/** 拆分分享 URL；token 只存在于 fragment，base_url 不带任何凭证。 */
export function parseShareUrl(shareUrl: unknown): { baseUrl: string; token: string } {
  if (typeof shareUrl !== "string") throw new SyncUsageError("同步服务器地址无效");
  let parsed: URL;
  try {
    parsed = new URL(shareUrl.trim());
  } catch {
    throw new SyncUsageError("同步服务器地址无效");
  }
  const port = parsed.port ? Number(parsed.port) : null;
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))
  ) {
    throw new SyncUsageError("同步服务器必须是有效的 HTTP(S) 分享地址");
  }

  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const tokens = fragment.getAll("token");
  const keys = [...fragment.keys()];
  if (keys.length !== 1 || keys[0] !== "token" || tokens.length !== 1 || !tokens[0]) {
    throw new SyncUsageError("同步分享地址缺少有效的 token fragment");
  }
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  return { baseUrl, token: tokens[0] };
}

async function tmpdir(prefix: string, parent: string): Promise<string> {
  await fsp.mkdir(parent, { recursive: true });
  const dir = resolve(parent, `${prefix}-${crypto.randomUUID().slice(0, 8)}`);
  await fsp.mkdir(dir);
  return dir;
}

export class SyncClient {
  readonly baseUrl: string;
  readonly dataPath: string;
  private token: string;
  private timeoutMs: number;

  constructor(serverUrl: string, dataPath?: string, timeout = 30) {
    const parsed = parseShareUrl(serverUrl);
    this.baseUrl = parsed.baseUrl;
    this.token = parsed.token;
    this.dataPath = resolve(
      dataPath ?? findDataPath(["./backup/default-user"], true),
    );
    this.timeoutMs = timeout * 1000;
  }

  private async request(endpoint: string, params?: Record<string, string>): Promise<Response> {
    const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\/+/, "")}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new SyncNetworkError(`同步请求失败 (${endpoint}): HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      if (error instanceof SyncNetworkError) throw error;
      throw new SyncNetworkError(`同步请求失败 (${endpoint}): ${String(error)}`);
    }
  }

  async health(): Promise<{ status: string } & Record<string, unknown>> {
    let payload: Record<string, unknown>;
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payload = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SyncNetworkError) throw error;
      throw new SyncNetworkError(`同步服务器健康检查失败: ${String(error)}`);
    }
    if (payload.status !== "healthy") throw new SyncNetworkError("同步服务器状态异常");
    return payload as { status: string } & Record<string, unknown>;
  }

  async info(): Promise<Record<string, unknown>> {
    const response = await this.request("info");
    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new SyncNetworkError("同步服务器返回了无效 JSON");
    }
    if (typeof payload !== "object" || payload === null || payload.success !== true) {
      throw new SyncNetworkError("同步服务器返回了无效信息");
    }
    return payload;
  }

  /** 远端清单：逐条校验路径安全、重复、sha256 格式、大小/mtime 类型。 */
  private async remoteManifest(): Promise<ManifestItem[]> {
    const response = await this.request("manifest");
    let manifest: unknown;
    try {
      manifest = ((await response.json()) as Record<string, unknown>).manifest;
    } catch {
      throw new SyncNetworkError("同步服务器返回了无效文件清单");
    }
    if (!Array.isArray(manifest)) throw new SyncNetworkError("同步服务器返回了无效文件清单");

    const normalized: ManifestItem[] = [];
    const seen = new Set<string>();
    const hex = /^[0-9a-fA-F]{64}$/;
    for (const raw of manifest) {
      if (typeof raw !== "object" || raw === null) throw new SyncNetworkError("文件清单条目格式无效");
      const item = raw as Record<string, unknown>;
      const relativePath = item.path;
      safeRelativePath(this.dataPath, relativePath);
      const pathStr = String(relativePath);
      if (seen.has(pathStr)) throw new SyncSecurityError("文件清单包含重复路径");
      seen.add(pathStr);

      const size = item.size;
      const digest = item.sha256;
      if (
        typeof size !== "number" ||
        !Number.isInteger(size) ||
        size < 0 ||
        typeof digest !== "string" ||
        !hex.test(digest)
      ) {
        throw new SyncNetworkError("文件清单元数据无效");
      }
      const mtime = item.mtime;
      if (mtime !== undefined && mtime !== null && (typeof mtime !== "number" || !Number.isFinite(mtime))) {
        throw new SyncNetworkError("文件清单时间戳无效");
      }
      normalized.push({
        path: pathStr,
        size,
        mtime: (mtime as number) ?? 0,
        modified: String(item.modified ?? ""),
        is_dir: false,
        sha256: digest.toLowerCase(),
      });
    }
    for (const path of seen) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) {
        if (seen.has(parts.slice(0, i).join("/"))) {
          throw new SyncSecurityError("文件清单包含文件与目录路径冲突");
        }
      }
    }
    return normalized;
  }

  async getRemoteManifest(): Promise<ManifestItem[] | null> {
    try {
      return await this.remoteManifest();
    } catch (error) {
      process.stdout.write(`获取远程文件清单失败: ${String(error)}\n`);
      return null;
    }
  }

  async getLocalManifest(): Promise<ManifestItem[]> {
    return fs.existsSync(this.dataPath) ? buildManifest(this.dataPath) : [];
  }

  private async backup(): Promise<string | null> {
    if (!fs.existsSync(this.dataPath)) return null;
    const backupRoot = resolve(this.dataPath, "..", ".stl-backups");
    await fsp.mkdir(backupRoot, { recursive: true });
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const base = `${basename(this.dataPath)}.${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
    let backup = resolve(backupRoot, base);
    let suffix = 0;
    while (fs.existsSync(backup)) {
      suffix += 1;
      backup = resolve(backupRoot, `${base}.${suffix}`);
    }
    await fsp.cp(this.dataPath, backup, { recursive: true, verbatimSymlinks: true });
    return backup;
  }

  /** 事务式替换：旧目录 → rollback，新数据 → 目标位；失败恢复。 */
  private async replaceData(source: string, backup: string | null): Promise<void> {
    await fsp.mkdir(dirname(this.dataPath), { recursive: true });
    const rollback = resolve(dirname(this.dataPath), `.${basename(this.dataPath)}.rollback-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
    const hadExisting = fs.existsSync(this.dataPath);
    try {
      if (hadExisting) await fsp.rename(this.dataPath, rollback);
      await fsp.rename(source, this.dataPath);
      if (fs.existsSync(rollback)) await fsp.rm(rollback, { recursive: true, force: true });
    } catch (error) {
      if (fs.existsSync(this.dataPath)) {
        await fsp.rm(this.dataPath, { recursive: true, force: true });
      }
      if (fs.existsSync(rollback)) {
        await fsp.rename(rollback, this.dataPath);
      } else if (backup && fs.existsSync(backup)) {
        await fsp.cp(backup, this.dataPath, { recursive: true, verbatimSymlinks: true });
      }
      throw new SyncUsageError(`替换同步数据失败: ${String(error)}`);
    }
  }

  async syncFullZip(backup = true): Promise<SyncResult> {
    process.stdout.write("开始 ZIP 全量同步...\n");
    await fsp.mkdir(dirname(this.dataPath), { recursive: true });
    const savedBackup = backup ? await this.backup() : null;
    const temp = await tmpdir(".stl-sync-", dirname(this.dataPath));
    try {
      const response = await this.request("zip");
      const archivePath = resolve(temp, "download.zip");
      let downloaded = 0;
      const fd = await fsp.open(archivePath, "wx");
      try {
        if (!response.body) throw new SyncNetworkError("同步请求失败 (zip): 空响应体");
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          downloaded += value.byteLength;
          if (downloaded > MAX_SYNC_ZIP_SIZE) {
            throw new SyncSecurityError("下载的 ZIP 超过大小限制");
          }
          await fd.write(Buffer.from(value));
        }
      } finally {
        await fd.close();
      }

      const stat = await fsp.stat(archivePath);
      const entries = validateZipEntries(await parseZipCentralDirectory(archivePath, stat.size));

      const payload = resolve(temp, "payload");
      await fsp.mkdir(payload, { recursive: true });
      const targets = new Map<string, string>();
      for (const [path, entry] of entries) {
        const target = safeRelativePath(payload, path);
        targets.set(path, target);
        await extractZipEntry(archivePath, entry, target);
      }
      await this.replaceData(payload, savedBackup);
      process.stdout.write("ZIP 全量同步完成\n");
      return { method: "zip", bytes_downloaded: downloaded, backup: savedBackup };
    } finally {
      await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  async syncIncremental(backup = true): Promise<SyncResult> {
    process.stdout.write("开始增量同步...\n");
    const remote = await this.remoteManifest();
    const remoteByPath = new Map(remote.map((item) => [item.path, item]));
    const local = await this.getLocalManifest();
    const localByPath = new Map(local.map((item) => [item.path, item]));

    const downloads = remote.filter(
      (item) => !localByPath.has(item.path) || item.sha256 !== localByPath.get(item.path)!.sha256,
    );
    const deletes = [...localByPath.keys()].filter((path) => !remoteByPath.has(path));
    const savedBackup = backup && (downloads.length > 0 || deletes.length > 0) ? await this.backup() : null;
    await fsp.mkdir(this.dataPath, { recursive: true });

    const temp = await tmpdir(".stl-download-", dirname(this.dataPath));
    try {
      for (const item of downloads) {
        const outputPath = safeRelativePath(temp, item.path);
        await fsp.mkdir(dirname(outputPath), { recursive: true });
        const response = await this.request("file", { path: item.path });
        if (!response.body) throw new SyncNetworkError("同步请求失败 (file): 空响应体");
        const hash = crypto.createHash("sha256");
        let downloadedSize = 0;
        const fd = await fsp.open(outputPath, "wx");
        try {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            downloadedSize += value.byteLength;
            if (downloadedSize > item.size) {
              throw new SyncSecurityError("下载文件超过清单声明大小");
            }
            const buf = Buffer.from(value);
            hash.update(buf);
            await fd.write(buf);
          }
        } finally {
          await fd.close();
        }
        if (downloadedSize !== item.size || hash.digest("hex") !== item.sha256) {
          throw new SyncSecurityError("下载文件完整性校验失败");
        }
      }

      try {
        for (const item of downloads) {
          const source = safeRelativePath(temp, item.path);
          const target = safeRelativePath(this.dataPath, item.path);
          await fsp.mkdir(dirname(target), { recursive: true });
          await fsp.rename(source, target);
          if (item.mtime > 0) {
            await fsp.utimes(target, item.mtime, item.mtime).catch(() => {});
          }
        }
        for (const relativePath of deletes) {
          const target = safeRelativePath(this.dataPath, relativePath);
          const st = await fsp.lstat(target);
          if (st.isSymbolicLink()) throw new SyncSecurityError("拒绝删除符号链接");
          await fsp.rm(target, { force: true });
        }
      } catch (error) {
        if (savedBackup && fs.existsSync(savedBackup)) {
          if (fs.existsSync(this.dataPath)) {
            await fsp.rm(this.dataPath, { recursive: true, force: true });
          }
          await fsp.cp(savedBackup, this.dataPath, { recursive: true, verbatimSymlinks: true });
        }
        throw new SyncUsageError(`增量同步失败: ${String(error)}`);
      }
    } finally {
      await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    }

    process.stdout.write(`增量同步完成：下载 ${downloads.length} 个文件，删除 ${deletes.length} 个文件\n`);
    return {
      method: "incremental",
      downloaded_files: downloads.length,
      deleted_files: deletes.length,
      backup: savedBackup,
    };
  }

  async sync(method: "auto" | "zip" | "incremental" = "auto", backup = true): Promise<SyncResult> {
    await this.health();
    if (method === "zip") return this.syncFullZip(backup);
    if (method === "incremental") return this.syncIncremental(backup);
    if (method !== "auto") throw new SyncUsageError("同步方式必须是 auto、zip 或 incremental");
    try {
      return await this.syncFullZip(backup);
    } catch (error) {
      if (error instanceof SyncNetworkError) {
        process.stdout.write("ZIP 下载发生网络错误，改用增量同步...\n");
        return this.syncIncremental(backup);
      }
      throw error;
    }
  }

  async checkServerHealth(): Promise<boolean> {
    try {
      await this.health();
      process.stdout.write("服务器状态: 健康\n");
      return true;
    } catch (error) {
      process.stdout.write(`服务器健康检查失败: ${String(error)}\n`);
      return false;
    }
  }

  async getServerInfo(): Promise<Record<string, unknown> | null> {
    try {
      return await this.info();
    } catch (error) {
      process.stdout.write(`获取服务器信息失败: ${String(error)}\n`);
      return null;
    }
  }
}

/**
 * 同步公共层 — 异常类型、分享 URL、PID 记录、安全路径映射。
 * ← src/utils/sync_common.py，安全语义逐条对齐：
 *   - token 只存 URL fragment（不发给服务器）
 *   - 路径穿越 / 符号链接 / 驱动器号 全拒绝
 *   - PID 记录验证（executable + command 双因子，/proc 可用时读 cmdline）
 */
import * as fs from "node:fs";
import { mkdirSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_SYNC_ZIP_FILES = 20_000;
export const MAX_SYNC_ZIP_SIZE = 2 * 1024 * 1024 * 1024; // 2 GiB
// 经过令牌认证的局域网同步需要监听全部网络接口。
export const ALL_INTERFACES = "0.0.0.0";

export class SyncError extends Error {}
export class SyncUsageError extends SyncError {}
export class SyncNetworkError extends SyncError {}
export class SyncSecurityError extends SyncError {}

export function buildShareUrl(host: string, port: number, token: string): string {
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${displayHost}:${port}#token=${encodeURIComponent(token)}`;
}

export function redactShareUrl(shareUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(shareUrl);
  } catch {
    return "<无效同步地址>";
  }
  const query = parsed.search ? "?<hidden>" : "";
  const fragment = parsed.hash ? `#token=<hidden>` : "";
  const pathName = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.protocol}//${parsed.host}${pathName}${query}${fragment}`;
}

export function formatSize(sizeBytes: number): string {
  if (sizeBytes === 0) return "0B";
  const names = ["B", "KB", "MB", "GB"];
  let size = sizeBytes;
  let i = 0;
  while (size >= 1024 && i < names.length - 1) {
    size /= 1024.0;
    i += 1;
  }
  return `${size.toFixed(1)}${names[i]}`;
}

/** 同步服务器的命令标记：本文件的绝对路径（PID 记录用，对应 Python 的 __file__）。 */
export function syncCommandMarker(): string {
  return fileURLToPath(import.meta.url);
}

export function syncExecutableMarker(): string {
  return process.execPath;
}

export interface PidRecord {
  pid: number;
  executable: string;
  command: string;
  started: number;
}

export function writePidRecord(path: string, pid: number, executable: string, commandMarker: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = path + ".tmp";
  const record: PidRecord = {
    pid,
    executable: resolve(executable),
    command: resolve(commandMarker),
    started: Date.now() / 1000,
  };
  try {
    const fd = fs.openSync(tempPath, "w");
    try {
      fs.writeSync(fd, JSON.stringify(record));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.chmodSync(tempPath, 0o600);
    } catch {
      /* Windows */
    }
    fs.renameSync(tempPath, path);
    try {
      fs.chmodSync(path, 0o600);
    } catch {
      /* Windows */
    }
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      /* ignore */
    }
    throw error;
  }
}

function verifiedPidRecord(path: string, expectedExecutable: string, expectedCommand: string): number | null {
  let record: PidRecord;
  try {
    record = JSON.parse(fs.readFileSync(path, "utf-8")) as PidRecord;
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SyncSecurityError("同步服务器进程记录无效");
  }
  const pid = Number(record.pid);
  if (
    !Number.isInteger(pid) ||
    pid <= 1 ||
    basename(String(record.executable)) !== basename(expectedExecutable) ||
    resolve(String(record.command)) !== resolve(expectedCommand)
  ) {
    throw new SyncSecurityError("同步服务器进程记录与当前启动器不匹配");
  }

  const cmdlinePath = `/proc/${pid}/cmdline`;
  if (fs.existsSync(cmdlinePath)) {
    let parts: string[];
    let processCwd: string;
    try {
      parts = fs
        .readFileSync(cmdlinePath)
        .toString("utf-8")
        .split("\0")
        .filter((p) => p);
      processCwd = fs.realpathSync(`/proc/${pid}/cwd`);
    } catch {
      throw new SyncSecurityError("无法验证同步服务器进程");
    }
    const executableMatches = parts.some((part) => basename(part) === basename(record.executable));
    let commandMatches = false;
    for (const part of parts) {
      if (!/\.(ts|js|mjs|cjs)$/.test(part)) continue;
      let candidate = part;
      if (!isAbsolute(candidate)) candidate = resolve(processCwd, candidate);
      try {
        if (fs.realpathSync(candidate) === fs.realpathSync(record.command)) {
          commandMatches = true;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!executableMatches || !commandMatches) {
      throw new SyncSecurityError("记录的 PID 属于其他进程");
    }
  }
  return pid;
}

export function recordedProcessIsRunning(path: string, expectedExecutable: string, expectedCommand: string): boolean {
  const pid = verifiedPidRecord(path, expectedExecutable, expectedCommand);
  if (pid === null) return false;
  if (fs.existsSync("/proc")) {
    if (fs.existsSync(`/proc/${pid}`)) return true;
    try {
      fs.rmSync(path, { force: true });
    } catch {
      /* ignore */
    }
    return false;
  }
  return false;
}

export function stopRecordedProcess(path: string, expectedExecutable: string, expectedCommand: string): boolean {
  const pid = verifiedPidRecord(path, expectedExecutable, expectedCommand);
  if (pid === null) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      try {
        fs.rmSync(path, { force: true });
      } catch {
        /* ignore */
      }
      return false;
    }
    throw new SyncUsageError(`停止同步服务器失败: ${String(error)}`);
  }
  try {
    fs.rmSync(path, { force: true });
  } catch {
    /* ignore */
  }
  return true;
}

/** realpath；路径不存在时退回规范化绝对路径（对齐 Python Path.resolve 语义）。 */
function realPathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * 将 POSIX 相对路径安全映射到基础目录内，拒绝穿越、绝对路径、驱动器号与符号链接。
 * 返回绝对真实路径；不安全时抛 SyncSecurityError。
 */
export function safeRelativePath(basePath: string, relativePath: unknown): string {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0") || relativePath.includes("\\")) {
    throw new SyncSecurityError("无效的同步文件路径");
  }
  const parts = relativePath.split("/").filter((p) => p !== "");
  if (
    relativePath.startsWith("/") ||
    parts.includes("..") ||
    parts.length === 0 ||
    /^[A-Za-z]:$/.test(parts[0])
  ) {
    throw new SyncSecurityError("同步文件路径越过数据目录");
  }

  const base = realPathOrSelf(basePath);
  let candidate = base;
  for (const part of parts) {
    candidate = resolve(candidate, part);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(candidate);
    } catch {
      continue; // 不存在的路径段不可能是符号链接（对齐 Python is_symlink() 语义）
    }
    if (st.isSymbolicLink()) throw new SyncSecurityError("同步文件路径包含符号链接");
  }
  const target = realPathOrSelf(candidate);
  if (!target.startsWith(base + sep)) {
    throw new SyncSecurityError("同步文件路径越过数据目录");
  }
  return target;
}

/** find_data_path：自动探测 SillyTavern 数据目录。 */
export function findDataPath(extraPaths: string[] = [], matchParent = false, cwd = process.cwd()): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
  const possible = [
    resolve(cwd, "SillyTavern", "data", "default-user"),
    resolve(cwd, "data", "default-user"),
    resolve(home, "SillyTavern", "data", "default-user"),
    resolve(cwd, "SillyTavern", "data", "default-user"),
    ...extraPaths.map((p) => resolve(cwd, p)),
  ];
  for (const path of possible) {
    if (matchParent) {
      if (fs.existsSync(path) || fs.existsSync(dirname(path))) return path;
    } else if (fs.existsSync(path)) {
      return path;
    }
  }
  return resolve(cwd, "SillyTavern", "data", "default-user");
}

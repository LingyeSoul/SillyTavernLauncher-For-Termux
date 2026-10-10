/**
 * 路径解析 — 所有目录锚定到"安装根"（package.json 所在目录）。
 * ← src/config.py 的 config_path 解析 + main_cli.py 的 os.getcwd() 约定。
 * 测试通过 setBaseDir 注入临时目录（env STL_BASE_DIR 优先）。
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let baseDir: string | null = null;

export function setBaseDir(dir: string): void {
  baseDir = resolve(dir);
}

export function getBaseDir(): string {
  if (baseDir) return baseDir;
  const fromEnv = process.env.STL_BASE_DIR;
  if (fromEnv) {
    baseDir = resolve(fromEnv);
    return baseDir;
  }
  // 默认：package.json 所在目录（从进程 cwd 逐级向上找，找不到就用 cwd）
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(dir, "package.json"))) {
      baseDir = dir;
      return baseDir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  baseDir = process.cwd();
  return baseDir;
}

export function stDir(): string {
  return resolve(getBaseDir(), "SillyTavern");
}

export function stDataDir(): string {
  return resolve(stDir(), "data", "default-user");
}

export function launcherConfigPath(): string {
  return resolve(getBaseDir(), "config.json");
}

export function agreementCachePath(): string {
  return resolve(getBaseDir(), "agreement_cache.json");
}

export function agreementFilePath(): string {
  return resolve(getBaseDir(), "agreement.txt");
}

export function syncPidRecordPath(): string {
  return resolve(getBaseDir(), ".sync-server.json");
}

export function logsDir(): string {
  return resolve(getBaseDir(), "logs");
}

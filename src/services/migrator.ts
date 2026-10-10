/**
 * SillyTavern 安装迁移器 — 扫描 / 验证 / 四种模式迁移。
 * ← src/st_migrator.py（交互部分拆到 CLI/WEBUI）。
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { stDir } from "./paths.ts";
import { run } from "./runtime.ts";

export interface STInstallation {
  path: string;
  version: string;
  size: number;
  hasGit: boolean;
  gitBranch: string;
  gitCommit: string;
  hasData: boolean;
  dataSize: number;
  hasConfig: boolean;
  isValid: boolean;
  installType: string;
  lastModified: number;
}

export type MigrateMode = "move" | "copy_data" | "copy_config" | "copy_all";

function invalidInstallation(path: string): STInstallation {
  return {
    path, version: "unknown", size: 0, hasGit: false, gitBranch: "", gitCommit: "",
    hasData: false, dataSize: 0, hasConfig: false, isValid: false, installType: "", lastModified: 0,
  };
}

function directorySize(path: string, exclude: string[] = ["node_modules", ".git"]): number {
  let total = 0;
  const walk = (dir: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (exclude.includes(entry.name)) continue;
          walk(join(dir, entry.name));
        } else {
          try {
            total += fs.statSync(join(dir, entry.name)).size;
          } catch {
            /* 跳过无法访问的文件 */
          }
        }
      }
    } catch {
      /* 无权限目录跳过 */
    }
  };
  walk(path);
  return total;
}

async function gitInfo(path: string): Promise<{ branch: string; commit: string }> {
  const branchResult = await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: path, timeoutMs: 5000 });
  const commitResult = await run(["git", "rev-parse", "HEAD"], { cwd: path, timeoutMs: 5000 });
  return {
    branch: branchResult.ok ? branchResult.stdout.trim() : "",
    commit: commitResult.ok ? commitResult.stdout.trim().slice(0, 8) : "",
  };
}

export function validateInstallation(path: string): STInstallation {
  const abs = resolve(path);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return invalidInstallation(abs);

  const packageJson = join(abs, "package.json");
  if (!fs.existsSync(packageJson)) return invalidInstallation(abs);

  let version = "unknown";
  try {
    const data = JSON.parse(fs.readFileSync(packageJson, "utf-8")) as { name?: string; version?: string };
    if (data.name !== "SillyTavern") return invalidInstallation(abs);
    version = data.version ?? "unknown";
  } catch {
    return invalidInstallation(abs);
  }

  const hasGit = fs.existsSync(join(abs, ".git"));
  const hasData = fs.existsSync(join(abs, "data"));
  const hasConfig = fs.existsSync(join(abs, "config.yaml"));
  return {
    path: abs,
    version,
    size: directorySize(abs),
    hasGit,
    gitBranch: "",
    gitCommit: "",
    hasData,
    dataSize: hasData ? directorySize(join(abs, "data")) : 0,
    hasConfig,
    isValid: true,
    installType: hasGit ? "git" : "manual",
    lastModified: fs.statSync(abs).mtimeMs / 1000,
  };
}

const EXCLUDED_DIRS = ["node_modules", ".git", "__pycache__", "venv", ".venv", "tmp", "temp", "storage"];

function defaultSearchPaths(currentPath: string): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? currentPath;
  const termuxStorage = join(home, "storage", "shared");
  return [
    currentPath,
    home,
    join(home, "SillyTavern"),
    termuxStorage,
    join(termuxStorage, "SillyTavern"),
  ];
}

/** 扫描默认路径（最多 2 层深）查找其他 SillyTavern 安装。 */
export async function scanForInstallations(currentPath?: string): Promise<STInstallation[]> {
  const cwd = currentPath ?? process.cwd();
  const target = stDir();
  const installations: STInstallation[] = [];
  const seen = new Set<string>();

  for (const basePath of defaultSearchPaths(cwd)) {
    if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) continue;

    const candidates: string[] = [basePath];
    // 2 层深
    try {
      for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
        if (!entry.isDirectory() || EXCLUDED_DIRS.includes(entry.name)) continue;
        const child = join(basePath, entry.name);
        if (child === target || child.startsWith(target + sep)) continue;
        candidates.push(child);
        try {
          for (const sub of fs.readdirSync(child, { withFileTypes: true })) {
            if (!sub.isDirectory() || EXCLUDED_DIRS.includes(sub.name)) continue;
            candidates.push(join(child, sub.name));
          }
        } catch {
          /* 无权限 */
        }
      }
    } catch {
      /* 无权限 */
    }

    for (const candidate of candidates) {
      if (seen.has(candidate) || candidate === target || candidate.startsWith(target + sep)) continue;
      const install = validateInstallation(candidate);
      if (install.isValid) {
        installations.push(install);
        seen.add(candidate);
      }
    }
  }

  // 补充 Git 信息
  for (const install of installations) {
    if (install.hasGit) {
      const info = await gitInfo(install.path);
      install.gitBranch = info.branch;
      install.gitCommit = info.commit;
    }
  }
  return installations;
}

export async function backupExistingInstallation(path: string): Promise<string> {
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const backupPath = `${path}.backup.${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
  await fsp.cp(path, backupPath, { recursive: true, verbatimSymlinks: true });
  return backupPath;
}

export interface MigrateOptions {
  sourcePath: string;
  mode: MigrateMode;
  backup?: boolean;
  onLine?: (line: string) => void;
}

/** 执行迁移；目标固定为 ./SillyTavern。 */
export async function migrateInstallation(options: MigrateOptions): Promise<{ ok: boolean; message: string }> {
  const say = (line: string) => {
    process.stdout.write(line + "\n");
    options.onLine?.(line);
  };
  const target = stDir();
  const source = validateInstallation(options.sourcePath);
  if (!source.isValid) return { ok: false, message: `无效的 SillyTavern 安装: ${options.sourcePath}` };
  if (source.path === target) return { ok: false, message: "源路径和目标路径相同" };

  try {
    if (options.backup && fs.existsSync(target)) {
      say("目标位置已存在，正在备份...");
      const backupPath = await backupExistingInstallation(target);
      say(`备份已创建: ${backupPath}`);
    }

    const clearTarget = async () => {
      if (fs.existsSync(target)) await fsp.rm(target, { recursive: true, force: true });
    };

    if (options.mode === "move") {
      await clearTarget();
      await fsp.rename(source.path, target);
      say("文件已移动");
    } else if (options.mode === "copy_all") {
      await clearTarget();
      say("正在复制文件...");
      await fsp.cp(source.path, target, { recursive: true, verbatimSymlinks: true });
      say("文件已复制");
    } else if (options.mode === "copy_data") {
      const sourceData = join(source.path, "data");
      if (!fs.existsSync(sourceData)) return { ok: false, message: "源安装没有 data 目录" };
      const targetData = join(target, "data");
      if (fs.existsSync(targetData)) await fsp.rm(targetData, { recursive: true, force: true });
      await fsp.mkdir(dirname(targetData), { recursive: true });
      await fsp.cp(sourceData, targetData, { recursive: true, verbatimSymlinks: true });
      say("数据已复制");
    } else if (options.mode === "copy_config") {
      await fsp.mkdir(target, { recursive: true });
      const files = ["config.yaml", "whitelist.txt"];
      let copied = 0;
      for (const name of files) {
        const src = join(source.path, name);
        if (fs.existsSync(src)) {
          await fsp.copyFile(src, join(target, name));
          copied += 1;
        }
      }
      if (!copied) return { ok: false, message: "未找到配置文件" };
      say("配置文件已复制");
    }

    const verified = validateInstallation(target);
    if (options.mode === "copy_data" || options.mode === "copy_config" || verified.isValid) {
      return { ok: true, message: `迁移完成，目标位置: ${target}` };
    }
    return { ok: false, message: "迁移验证失败" };
  } catch (error) {
    return { ok: false, message: `迁移过程中出错: ${String(error)}` };
  }
}

/**
 * SillyTavern 版本管理 — tag 列表 / 当前版本 / 切换。
 * ← src/st_version_manager.py + main_cli.py 版本切换流程（交互拆出）。
 */
import * as fs from "node:fs";
import { join } from "node:path";
import { stDir } from "./paths.ts";
import {
  checkGitStatus,
  checkoutStVersion,
  compareVersions,
  fetchRemoteTags,
  getCurrentBranch,
  getCurrentCommit,
  getStTags,
  type VersionTagInfo,
} from "./gitOps.ts";
import { npmInstall } from "./stLifecycle.ts";

export interface VersionListResult {
  success: boolean;
  versions: Record<string, VersionTagInfo>;
  latest: string;
  error: string | null;
}

export async function fetchStVersions(dir = stDir()): Promise<VersionListResult> {
  try {
    const tags = await getStTags(dir);
    return {
      success: tags.ok,
      versions: tags.versions,
      latest: tags.latest,
      error: tags.ok ? null : tags.message,
    };
  } catch (error) {
    return { success: false, versions: {}, latest: "", error: `获取版本列表失败: ${String(error)}` };
  }
}

export async function updateRemoteTags(dir = stDir()): Promise<{ success: boolean; message: string }> {
  const result = await fetchRemoteTags(dir);
  return { success: result.ok, message: result.message };
}

export async function getCurrentVersion(dir = stDir()): Promise<{ success: boolean; version: string; error: string | null }> {
  try {
    const packageJson = join(dir, "package.json");
    if (!fs.existsSync(packageJson)) {
      return { success: false, version: "unknown", error: "SillyTavern未安装或package.json不存在" };
    }
    const data = JSON.parse(fs.readFileSync(packageJson, "utf-8")) as { version?: string };
    return { success: true, version: data.version ?? "unknown", error: null };
  } catch (error) {
    return { success: false, version: "unknown", error: `读取失败: ${String(error)}` };
  }
}

/** 当前版本完整信息（版本号 + commit + 分支 + 工作区状态）。 */
export async function getVersionInfo(dir = stDir()) {
  const current = await getCurrentVersion(dir);
  const commitInfo = await getCurrentCommit(dir);
  const branch = commitInfo.ok ? await getCurrentBranch(dir) : "";
  const gitStatus = commitInfo.ok ? await checkGitStatus(dir) : { clean: false, message: "未安装" };
  return {
    version: current.success ? current.version : null,
    versionError: current.success ? null : current.error,
    commit: commitInfo.ok ? commitInfo.commit : null,
    branch,
    gitClean: gitStatus.clean,
    gitStatusMessage: gitStatus.message,
  };
}

export interface VersionListItem {
  version: string;
  commit: string;
  date: string;
  isLatest: boolean;
}

/** 结构化版本列表（WEBUI 用），按语义版本倒序。 */
export async function listVersions(limit = 30, dir = stDir()): Promise<VersionListResult & { items: VersionListItem[] }> {
  const result = await fetchStVersions(dir);
  const items: VersionListItem[] = Object.entries(result.versions)
    .sort((a, b) => compareVersions(b[0], a[0]))
    .slice(0, limit)
    .map(([version, info]) => ({
      version,
      commit: info.commit,
      date: info.date,
      isLatest: version === result.latest,
    }));
  return { ...result, items };
}

/** 切换版本（commit 或版本号）；installDeps 时随后重装依赖。 */
export async function switchVersion(
  target: { commit?: string; version?: string },
  options: { installDeps?: boolean; force?: boolean; onLine?: (line: string) => void } = {},
): Promise<{ ok: boolean; message: string }> {
  const dir = stDir();
  if (!fs.existsSync(dir)) return { ok: false, message: "SillyTavern 未安装" };

  let commitHash = target.commit ?? "";
  if (!commitHash && target.version) {
    const versions = await fetchStVersions(dir);
    if (!versions.success) return { ok: false, message: `获取版本列表失败: ${versions.error}` };
    const info = versions.versions[target.version];
    if (!info) return { ok: false, message: `未找到版本 v${target.version}` };
    commitHash = info.commit;
    options.onLine?.(`找到commit: ${commitHash.slice(0, 7)}`);
  }
  if (!commitHash) return { ok: false, message: "请提供 commit 或 version" };

  const status = await checkGitStatus(dir);
  if (!status.clean && !options.force) {
    return { ok: false, message: `Git 工作区不干净（${status.message}），如确认请传 force` };
  }

  const result = await checkoutStVersion(commitHash, dir);
  if (!result.ok) return result;
  options.onLine?.(result.message);

  if (options.installDeps) {
    options.onLine?.("正在重新安装依赖...");
    await npmInstall(dir, options.onLine);
  }
  return { ok: true, message: `已切换到 ${commitHash.slice(0, 7)}${options.installDeps ? " 并重装依赖" : ""}` };
}

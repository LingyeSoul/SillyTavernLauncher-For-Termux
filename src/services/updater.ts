/**
 * 启动器自更新检查 — raw version 文件版本比对。
 * ← src/update_checker.py。远端解析同时兼容旧版 version.py 与新版 version.ts。
 */
import { activeMirrorHost, applyMirrorPrefix, normalizeMirrorValue } from "./mirrors.ts";
import { compareVersions } from "./gitOps.ts";
import { LAUNCHER_VERSION } from "../version.ts";

export interface UpdateCheckResult {
  has_error: boolean;
  error_message: string | null;
  current_version: string;
  latest_version: string | null;
  has_update: boolean;
  is_dev_version: boolean;
}

export function isDevVersion(version: string): boolean {
  const lower = version.toLowerCase();
  return ["dev", "alpha", "beta", "rc", "test"].some((k) => lower.includes(k));
}

/** 远端 version 文件地址（经当前镜像前缀改写；显式传入的 mirror 兼容旧配置键值） */
function latestVersionUrl(mirror?: string): string {
  const host = mirror !== undefined ? normalizeMirrorValue(mirror) : activeMirrorHost();
  return applyMirrorPrefix(
    "https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/src/version.ts",
    host,
  );
}

async function fetchLatestVersion(mirror?: string): Promise<string | null> {
  if (process.env.STL_NO_NETWORK === "1") return null;
  const url = latestVersionUrl(mirror);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "SillyTavernLauncher/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) return null;
    const content = await response.text();
    for (const line of content.split("\n")) {
      // 新版: export const LAUNCHER_VERSION = "x.y.z" / 旧版: version='x.y.z'
      const tsMatch = line.match(/LAUNCHER_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (tsMatch) return tsMatch[1];
      const pyMatch = line.match(/^version\s*=\s*['"]([^'"]+)['"]/);
      if (pyMatch) return pyMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(
  mirror?: string,
  allowDev = false,
  currentVersion = LAUNCHER_VERSION,
): Promise<UpdateCheckResult> {
  const latest = await fetchLatestVersion(mirror);
  if (!latest) {
    return {
      has_error: true,
      error_message: "无法获取最新版本信息",
      current_version: currentVersion,
      latest_version: null,
      has_update: false,
      is_dev_version: false,
    };
  }
  const dev = isDevVersion(latest);
  let hasUpdate: boolean;
  if (!allowDev && dev) {
    hasUpdate = false;
  } else {
    hasUpdate = compareVersions(currentVersion, latest) < 0;
  }
  return {
    has_error: false,
    error_message: null,
    current_version: currentVersion,
    latest_version: latest,
    has_update: hasUpdate,
    is_dev_version: dev,
  };
}

/**
 * Git 子进程封装 — 版本切换 / 分支强切 / 工作区检查 / tag 管理。
 * ← src/git_utils.py，命令序列逐条对齐。
 */
import * as fs from "node:fs";
import { run } from "./runtime.ts";

export interface GitOutcome {
  ok: boolean;
  message: string;
}

async function git(args: string[], cwd: string) {
  return run(["git", ...args], { cwd, timeoutMs: 120_000 });
}

async function gitLines(args: string[], cwd: string): Promise<string[]> {
  const result = await git(args, cwd);
  if (!result.ok) return [];
  return result.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** 切换 ST 到指定 commit（保持在 release 分支，避免 detached HEAD）。 */
export async function checkoutStVersion(commitHash: string, stDirPath: string): Promise<GitOutcome> {
  if (!fs.existsSync(stDirPath)) return { ok: false, message: "SillyTavern目录不存在" };
  if (!fs.existsSync(stDirPath + "/.git")) return { ok: false, message: "SillyTavern目录不是Git仓库" };

  try {
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], stDirPath);
    const currentBranch = branch.ok ? branch.stdout.trim() : "";

    if (currentBranch !== "release") {
      let checkout = await git(["checkout", "release"], stDirPath);
      if (!checkout.ok) {
        checkout = await git(["checkout", "-b", "release", "origin/release"], stDirPath);
        if (!checkout.ok) {
          return { ok: false, message: `无法切换到release分支: ${checkout.stderr.trim() || "未知错误"}` };
        }
      }
    }

    const status = await git(["status", "--porcelain"], stDirPath);
    if (status.stdout.trim()) {
      const nonLockChanges = status.stdout
        .split("\n")
        .filter((line) => line.trim() && !line.includes("package-lock.json"));
      if (nonLockChanges.length) {
        const stash = await git(["stash", "push", "-m", `版本切换前保存${commitHash.slice(0, 7)}`], stDirPath);
        if (!stash.ok) return { ok: false, message: `保存本地更改失败: ${stash.stderr.trim() || "未知错误"}` };
      } else {
        await git(["checkout", "--", "package-lock.json"], stDirPath);
      }
    }

    const reset = await git(["reset", "--hard", commitHash], stDirPath);
    if (!reset.ok) return { ok: false, message: `切换失败: ${reset.stderr.trim() || "未知错误"}` };

    const verify = await git(["rev-parse", "--abbrev-ref", "HEAD"], stDirPath);
    if (verify.ok && verify.stdout.trim() !== "release") {
      return { ok: false, message: `切换后未在release分支上，当前在: ${verify.stdout.trim()}` };
    }
    return { ok: true, message: `成功切换到版本 ${commitHash.slice(0, 7)}（在release分支上）` };
  } catch (error) {
    return { ok: false, message: `切换过程中发生错误: ${String(error)}` };
  }
}

/** 强制切换到远程分支（fetch → 清理工作区 → checkout -B）。 */
export async function checkoutBranchForce(branch: string, stDirPath: string, remote = "origin"): Promise<GitOutcome> {
  if (!fs.existsSync(stDirPath)) return { ok: false, message: "SillyTavern目录不存在" };
  if (!fs.existsSync(stDirPath + "/.git")) return { ok: false, message: "SillyTavern目录不是Git仓库" };

  try {
    const fetch = await git(["fetch", remote], stDirPath);
    if (!fetch.ok) return { ok: false, message: `fetch远程失败: ${fetch.stderr.trim()}` };

    const status = await git(["status", "--porcelain"], stDirPath);
    if (status.stdout.trim()) {
      const nonLockChanges = status.stdout
        .split("\n")
        .filter((line) => line.trim() && !line.includes("package-lock.json"));
      if (!nonLockChanges.length) {
        await git(["checkout", "--", "package-lock.json"], stDirPath);
      } else {
        const stash = await git(["stash", "push", "-m", "自动暂存: 切换分支前保存"], stDirPath);
        if (!stash.ok) {
          if (status.stdout.includes("package-lock.json")) {
            await git(["checkout", "--", "package-lock.json"], stDirPath);
          } else {
            return { ok: false, message: `暂存本地更改失败: ${stash.stderr.trim()}` };
          }
        }
      }
    }

    let checkout = await git(["checkout", "-B", branch, `${remote}/${branch}`], stDirPath);
    if (!checkout.ok) {
      const lower = checkout.stderr.toLowerCase();
      if (lower.includes("not found") || lower.includes("did not match")) {
        checkout = await git(["checkout", "-B", branch], stDirPath);
      }
    }
    if (!checkout.ok) return { ok: false, message: `切换到 ${branch} 分支失败: ${checkout.stderr.trim()}` };
    return { ok: true, message: `成功切换到 ${branch} 分支` };
  } catch (error) {
    return { ok: false, message: `切换过程中发生错误: ${String(error)}` };
  }
}

/** 工作区是否干净（package-lock.json 的镜像源差异自动恢复）。 */
export async function checkGitStatus(stDirPath: string): Promise<{ clean: boolean; message: string }> {
  try {
    const status = await git(["status", "--porcelain"], stDirPath);
    if (!status.ok) return { clean: false, message: `检查Git状态时出错: ${status.stderr.trim()}` };
    if (!status.stdout.trim()) return { clean: true, message: "工作区干净" };

    const nonLockChanges = status.stdout
      .split("\n")
      .filter((line) => line.trim() && !line.includes("package-lock.json"));
    if (!nonLockChanges.length) {
      await git(["checkout", "--", "package-lock.json"], stDirPath);
      return { clean: true, message: "工作区干净（已自动恢复package-lock.json）" };
    }
    return { clean: false, message: `检测到${nonLockChanges.length}个文件有未提交的更改` };
  } catch (error) {
    return { clean: false, message: `检查Git状态时出错: ${String(error)}` };
  }
}

export async function getCurrentCommit(stDirPath: string): Promise<{ ok: boolean; commit: string | null; message: string }> {
  try {
    const result = await git(["rev-parse", "HEAD"], stDirPath);
    if (result.ok) return { ok: true, commit: result.stdout.trim(), message: "成功获取当前commit" };
    return { ok: false, commit: null, message: `获取commit失败: ${result.stderr.trim()}` };
  } catch (error) {
    return { ok: false, commit: null, message: `获取commit时出错: ${String(error)}` };
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return result.ok ? result.stdout.trim() : "";
}

export interface VersionTagInfo {
  commit: string;
  date: string;
  tag_name: string;
}

const VERSION_TAG = /^[vV]?(\d+)\.(\d+)\.(\d+)(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;

function versionGte113(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, major, minor, patch] = match.map(Number) as unknown as [string, number, number, number];
  if (major > 1) return true;
  if (major === 1) {
    if (minor > 13) return true;
    if (minor === 13) return patch >= 0;
  }
  return false;
}

export function compareVersions(a: string, b: string): number {
  const nums = (v: string) =>
    v.replace(/^[vV]/, "").split(".").map((p) => Number(p.match(/^\d+/)?.[0] ?? 0));
  const [an, bn] = [nums(a), nums(b)];
  for (let i = 0; i < Math.max(an.length, bn.length); i++) {
    const x = an[i] ?? 0;
    const y = bn[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 获取本地 tag 列表（语义化版本 ≥1.13.0），含 commit/date。 */
export async function getStTags(stDirPath: string): Promise<{ ok: boolean; versions: Record<string, VersionTagInfo>; latest: string; message: string }> {
  if (!fs.existsSync(stDirPath) || !fs.existsSync(stDirPath + "/.git")) {
    return { ok: false, versions: {}, latest: "", message: "SillyTavern目录不存在或不是Git仓库" };
  }
  try {
    const tags = await gitLines(["tag", "-l"], stDirPath);
    const versions: Record<string, VersionTagInfo> = {};
    const valid: [string, string][] = [];
    for (const tag of tags) {
      const normalized = tag.replace(/^[vV]/, "");
      if (VERSION_TAG.test(normalized) && versionGte113(normalized)) {
        valid.push([tag, normalized]);
      }
    }
    for (const [tagName, versionStr] of valid) {
      const show = await git(["show", tagName, "--format=%H|%aI", "-s"], stDirPath);
      if (!show.ok) continue;
      const output = show.stdout.trim().replace(/^['"]|['"]$/g, "");
      const [commit, date] = output.split("|");
      if (commit && date) {
        versions[versionStr] = { commit, date, tag_name: tagName };
      }
    }
    const keys = Object.keys(versions).sort((a, b) => compareVersions(b, a));
    return { ok: true, versions, latest: keys[0] ?? "", message: `成功获取 ${Object.keys(versions).length} 个版本` };
  } catch (error) {
    return { ok: false, versions: {}, latest: "", message: `获取tag列表时出错: ${String(error)}` };
  }
}

export async function fetchRemoteTags(stDirPath: string): Promise<GitOutcome> {
  if (!fs.existsSync(stDirPath) || !fs.existsSync(stDirPath + "/.git")) {
    return { ok: false, message: "SillyTavern目录不存在或不是Git仓库" };
  }
  const result = await git(["fetch", "origin", "--tags"], stDirPath);
  return result.ok
    ? { ok: true, message: "成功从远程获取tags" }
    : { ok: false, message: `获取远程tags失败: ${result.stderr.trim()}` };
}

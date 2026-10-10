/**
 * SillyTavern 生命周期编排 — 安装/启动/停止/更新/修复。
 * ← main_cli.py 中散落的 subprocess 编排（install_sillytavern/start_sillytavern/
 *    update_sillytavern/fix_node_modules），拆出交互（confirm 由调用方传入）。
 * ST 进程注册表：WEBUI 托管子进程，日志进 LogBus（CLI 场景同步回显）。
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { delimiter, join } from "node:path";
import { spawnLive, run, runWithEcho, type LiveProcess } from "./runtime.ts";
import { stDir } from "./paths.ts";
import { getLogBus } from "./logBus.ts";
import { logError } from "./errorLog.ts";
import { checkoutBranchForce } from "./gitOps.ts";
import { getConfigStore } from "./configStore.ts";

// ---------- 环境检测 ----------

export function isCommandAvailable(cmd: string): boolean {
  const pathExt = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of pathExt) {
      try {
        if (fs.existsSync(join(dir, cmd + ext.toLowerCase())) || fs.existsSync(join(dir, cmd + ext))) {
          return true;
        }
      } catch {
        /* 权限异常视为不存在 */
      }
    }
  }
  return false;
}

export interface EnvCheckResult {
  ok: boolean;
  missing: string[];
}

export function checkSystemEnv(): EnvCheckResult {
  const missing: string[] = [];
  for (const cmd of ["git", "node", "npm"]) {
    if (!isCommandAvailable(cmd)) missing.push(cmd);
  }
  return { ok: missing.length === 0, missing };
}

export function isStInstalled(): boolean {
  return fs.existsSync(join(stDir(), "server.js")) && fs.existsSync(join(stDir(), "package.json"));
}

// ---------- ST 进程管理 ----------

export interface StRunState {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  exitCode: number | null;
}

class StProcessManager {
  private proc: LiveProcess | null = null;
  private startedAt: string | null = null;
  private lastExitCode: number | null = null;

  isRunning(): boolean {
    return this.proc !== null;
  }

  state(): StRunState {
    return {
      running: this.proc !== null,
      pid: this.proc?.pid ?? null,
      startedAt: this.startedAt,
      exitCode: this.lastExitCode,
    };
  }

  /** 托管启动（WEBUI / 后台模式）：子进程 stdout/stderr 进 LogBus。 */
  async start(onExit?: (code: number | null) => void): Promise<{ ok: boolean; message: string }> {
    if (this.proc) return { ok: true, message: "SillyTavern 已在运行" };
    if (!isStInstalled()) return { ok: false, message: "SillyTavern 未安装" };
    const bus = getLogBus();
    const proc = spawnLive(["node", "--max-old-space-size=4096", "server.js"], {
      cwd: stDir(),
      onLine: (line) => bus.push("st", line),
      onClose: (code) => {
        this.proc = null;
        this.lastExitCode = code;
        bus.push("st", `[进程退出 code=${code ?? "null"}]`);
        onExit?.(code);
      },
    });
    this.proc = proc;
    this.startedAt = new Date().toISOString();
    bus.push("st", `[已启动 pid=${proc.pid}]`);
    const code = await Promise.race([proc.exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 3000))]);
    if (code === "timeout") return { ok: true, message: `SillyTavern 已启动 (pid ${proc.pid})` };
    return { ok: false, message: `SillyTavern 启动后立即退出 (code ${code})` };
  }

  async stop(): Promise<{ ok: boolean; message: string }> {
    const proc = this.proc;
    if (!proc) return { ok: false, message: "SillyTavern 未在运行" };
    proc.kill("SIGTERM");
    const code = await Promise.race([proc.exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 10_000))]);
    if (code === "timeout") {
      proc.kill("SIGKILL");
      await proc.exited.catch(() => {});
      this.proc = null;
      return { ok: true, message: "SillyTavern 已强制停止" };
    }
    this.proc = null;
    return { ok: true, message: "SillyTavern 已停止" };
  }
}

let processManager: StProcessManager | null = null;

export function getStProcessManager(): StProcessManager {
  if (!processManager) processManager = new StProcessManager();
  return processManager;
}

export function resetStProcessManager(): void {
  processManager = null;
}

// ---------- npm ----------

function usingMirror(): boolean {
  return getConfigStore().get<string>("github.mirror", "github") !== "github";
}

export async function npmInstall(
  cwd: string,
  onLine?: (line: string) => void,
): Promise<boolean> {
  const args = ["npm", "install", "--no-audit", "--no-fund"];
  if (usingMirror()) {
    args.push("--registry=https://registry.npmmirror.com");
    onLine?.("使用国内NPM镜像源安装依赖...");
  } else {
    onLine?.("使用默认NPM源安装依赖...");
  }
  return runWithEcho(args, { cwd, timeoutMs: 30 * 60_000, onLine });
}

// ---------- 安装 ----------

export interface InstallOptions {
  confirm18: boolean; // 合规确认：已满18岁或取得监护人同意
  reinstall?: boolean;
  mirror?: string; // 可选：安装时顺带切换镜像
  onLine?: (line: string) => void;
}

export async function installSillytavern(options: InstallOptions): Promise<{ ok: boolean; message: string }> {
  const say = (line: string) => {
    process.stdout.write(line + "\n");
    getLogBus().push("task", line);
    options.onLine?.(line);
  };

  if (!options.confirm18) {
    return { ok: false, message: "未确认合规声明，取消安装" };
  }
  const env = checkSystemEnv();
  if (!env.ok) {
    return { ok: false, message: `环境检查失败，缺少: ${env.missing.join(", ")}` };
  }

  const target = stDir();
  if (fs.existsSync(target)) {
    if (!options.reinstall) {
      return { ok: false, message: "SillyTavern 目录已存在（如需重装请设置 reinstall）" };
    }
    say("删除现有目录...");
    await fsp.rm(target, { recursive: true, force: true });
  }

  const mirror = options.mirror ?? getConfigStore().get<string>("github.mirror", "github");
  say(`正在克隆 SillyTavern 仓库 (使用 ${mirror} 镜像)...`);
  const record = (action: string, status: string) => {
    const store = getConfigStore();
    const downloads = store.get<unknown[]>("downloads", []);
    downloads.push({ action, status, timestamp: new Date().toISOString() });
    store.set("downloads", downloads);
    store.save();
  };
  record("install", "started");

  // gitconfig 的 url.*.insteadof 会自动把 GitHub URL 重写为镜像地址
  const clone = await run(["git", "clone", "https://github.com/SillyTavern/SillyTavern.git", "SillyTavern"], {
    cwd: undefined,
    timeoutMs: 30 * 60_000,
  });
  for (const line of clone.stdout.split("\n")) if (line.trim()) say(line.trim());
  if (!clone.ok) {
    say("克隆失败");
    return { ok: false, message: `克隆失败: ${clone.stderr.trim().slice(0, 200)}` };
  }

  say("克隆完成，安装 Node.js 依赖...");
  const installOk = await npmInstall(target, options.onLine);
  if (!installOk) {
    return { ok: false, message: "依赖安装失败" };
  }
  record("install_complete", "completed");
  say("SillyTavern 安装完成!");
  return { ok: true, message: "SillyTavern 安装完成" };
}

// ---------- 启动（前台 exec 风格，CLI 用） ----------

/** 前台启动：子进程继承 stdio，退出码透传（os.execvp 的近似等价）。 */
export async function startForeground(): Promise<number> {
  const dir = stDir();
  if (!isStInstalled()) {
    process.stdout.write("SillyTavern 未找到，请先运行 install\n");
    return 1;
  }
  const store = getConfigStore();
  if (!store.get<boolean>("has_started_st", false)) {
    store.set("has_started_st", true);
    store.save();
    const history = store.get<unknown[]>("agreement_history", []);
    history.push({ action: "first_start_confirmed", timestamp: new Date().toISOString() });
    store.set("agreement_history", history);
    store.save();
  }
  const { spawn } = await import("node:child_process");
  const child = spawn("node", ["--max-old-space-size=4096", "server.js"], {
    cwd: dir,
    stdio: "inherit",
    env: process.env,
  });
  process.stdout.write(`SillyTavern 已启动 (${dir})\n`);
  const code = await new Promise<number | null>((resolve) => {
    child.on("exit", (c) => resolve(c));
    child.on("error", (err) => {
      process.stdout.write(`启动 SillyTavern 时出错: ${String(err)}\n`);
      resolve(1);
    });
  });
  return code ?? 0;
}

// ---------- 更新 ----------

export async function updateSillytavern(onLine?: (line: string) => void): Promise<{ ok: boolean; message: string }> {
  const say = (line: string) => {
    process.stdout.write(line + "\n");
    getLogBus().push("task", line);
    onLine?.(line);
  };
  const dir = stDir();
  if (!fs.existsSync(dir)) {
    return { ok: false, message: "SillyTavern 未安装，请先运行 install" };
  }

  // 迁移：远程仍指向 Gitee 时切回 GitHub
  if (fs.existsSync(join(dir, ".git"))) {
    const remote = await run(["git", "remote", "get-url", "origin"], { cwd: dir });
    if (remote.ok && remote.stdout.includes("gitee.com")) {
      say("检测到远程仓库仍指向 Gitee，正在迁移到 GitHub 官方仓库...");
      const migrate = await run(["git", "remote", "set-url", "origin", "https://github.com/SillyTavern/SillyTavern.git"], { cwd: dir });
      say(migrate.ok ? "已成功将远程仓库切换到 GitHub" : `切换远程仓库失败: ${migrate.stderr.trim()}`);
    }
  }

  try {
    // 清理未完成的合并/rebase
    const gitDir = join(dir, ".git");
    if (
      fs.existsSync(join(gitDir, "MERGE_HEAD")) ||
      fs.existsSync(join(gitDir, "rebase-apply")) ||
      fs.existsSync(join(gitDir, "rebase-merge"))
    ) {
      say("检测到未完成的合并/rebase状态，正在清理...");
      await run(["git", "merge", "--abort"], { cwd: dir });
      await run(["git", "rebase", "--abort"], { cwd: dir });
      await run(["git", "reset", "--hard", "HEAD"], { cwd: dir });
      say("已清理未完成的操作状态");
    }

    const force = await checkoutBranchForce("release", dir);
    if (!force.ok) {
      return { ok: false, message: `切换到 release 分支失败: ${force.message}` };
    }
    say("成功切换到 release 分支");
    say("正在拉取最新代码...");

    let pullOk = await runWithEcho(["git", "pull", "--rebase", "--autostash"], { cwd: dir, timeoutMs: 10 * 60_000, onLine: say });
    if (!pullOk) {
      say("Git更新失败，尝试自动解决冲突...");
      const status = await run(["git", "status", "--porcelain"], { cwd: dir });
      if (status.stdout.includes("package-lock.json")) {
        await run(["git", "checkout", "--", "package-lock.json"], { cwd: dir });
        say("已重置 package-lock.json，重新尝试更新...");
        pullOk = await runWithEcho(["git", "pull", "--rebase", "--autostash"], { cwd: dir, timeoutMs: 10 * 60_000, onLine: say });
      }
      if (!pullOk) {
        say("自动解决冲突失败，使用强制更新...");
        await run(["git", "rebase", "--abort"], { cwd: dir });
        await run(["git", "reset", "--hard", "origin/release"], { cwd: dir });
        say("已强制同步到最新版本");
      }
    }

    say("正在更新 Node.js 依赖...");
    const installOk = await npmInstall(dir, onLine);
    if (!installOk) return { ok: false, message: "依赖更新失败" };
    say("SillyTavern 更新完成!");
    return { ok: true, message: "SillyTavern 更新完成" };
  } catch (error) {
    logError("stLifecycle.updateSillytavern", error);
    return { ok: false, message: `更新过程中出现未知错误: ${String(error)}` };
  }
}

// ---------- 一键修复 ----------

export async function fixNodeModules(onLine?: (line: string) => void): Promise<{ ok: boolean; message: string }> {
  const say = (line: string) => {
    process.stdout.write(line + "\n");
    getLogBus().push("task", line);
    onLine?.(line);
  };
  const dir = stDir();
  if (!fs.existsSync(dir)) {
    return { ok: false, message: "SillyTavern 未安装，请先运行安装" };
  }
  const nodeModules = join(dir, "node_modules");
  if (fs.existsSync(nodeModules)) {
    say("正在删除 node_modules...");
    try {
      await fsp.rm(nodeModules, { recursive: true, force: true });
      say("✓ node_modules 已删除");
    } catch (error) {
      return { ok: false, message: `删除 node_modules 失败: ${String(error)}` };
    }
  } else {
    say("node_modules 目录不存在，无需清理");
  }
  say("正在清理 npm 缓存...");
  const clean = await runWithEcho(["npm", "cache", "clean", "--force"], { cwd: dir, timeoutMs: 5 * 60_000, onLine: say });
  if (!clean) return { ok: false, message: "npm 缓存清理失败" };
  say("正在重新安装依赖...");
  const installOk = await npmInstall(dir, onLine);
  if (!installOk) return { ok: false, message: "依赖安装失败" };
  say("一键修复完成!");
  return { ok: true, message: "一键修复完成" };
}

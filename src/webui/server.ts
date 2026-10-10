/**
 * WEBUI 服务器 — node:http 单文件路由：静态资源 + REST API + SSE 日志流。
 * ← webui 分支 webui_server.py 的重写（Flask+SocketIO → node:http+SSE，零依赖）。
 *
 * 安全边界：
 *   - 默认只绑 127.0.0.1（手机本机浏览器访问）
 *   - 配置为非回环地址时强制启用 Bearer/Query Token（webui.token，缺失自动生成）
 *   - EULA 未同意前，除只读接口与 /api/agreement/accept 外全部 403
 *   - 长任务互斥：install/update/syncFrom 运行中返回 409
 */
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCHER_VERSION } from "../version.ts";
import { getConfigStore, generateToken } from "../services/configStore.ts";
import { getLogBus } from "../services/logBus.ts";
import { logError } from "../services/errorLog.ts";
import { checkAgreementState } from "../services/agreement.ts";
import { getLocalIp } from "../services/network.ts";
import { MIRROR_LIST, validateMirrorInput, applyGitMirrorConfig } from "../services/mirrors.ts";
import {
  checkSystemEnv,
  fixNodeModules,
  getStProcessManager,
  installSillytavern,
  isStInstalled,
  updateSillytavern,
} from "../services/stLifecycle.ts";
import { StConfig } from "../services/stConfig.ts";
import { checkForUpdates } from "../services/updater.ts";
import { getVersionInfo, listVersions, switchVersion, updateRemoteTags } from "../services/versionManager.ts";
import { getSyncManager } from "../services/sync/manager.ts";
import { scanForInstallations, migrateInstallation, type MigrateMode } from "../services/migrator.ts";

const PUBLIC_DIR = resolve(fileURLToPath(import.meta.url), "..", "public");

type TaskKind = "install" | "stUpdate" | "launcherUpdate" | "syncFrom" | "repair";
const tasks = new Set<TaskKind>();

export function busyTasks(): TaskKind[] {
  return [...tasks];
}

interface JsonBody {
  [key: string]: unknown;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

async function readJson(req: IncomingMessage, limit = 1024 * 1024): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("请求体过大");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as JsonBody;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(res: ServerResponse, pathname: string): boolean {
  const relative = normalize(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  const target = resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR + sep)) return false;
  try {
    const content = fs.readFileSync(target);
    res.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/** EULA 状态（60 秒内存缓存，避免每次轮询都打远端）。 */
let agreementCache: { at: number; required: boolean; date: string; content: string; source: string } | null = null;

async function agreementState() {
  if (agreementCache && Date.now() - agreementCache.at < 60_000) return agreementCache;
  const store = getConfigStore();
  const state = await checkAgreementState(
    store.get<boolean>("agreement_accepted", false),
    store.get<string>("agreement_version", ""),
  );
  agreementCache = state
    ? { at: Date.now(), required: true, date: state.date, content: state.content, source: state.source }
    : { at: Date.now(), required: false, date: "", content: "", source: "" };
  return agreementCache;
}

export function resetAgreementCache(): void {
  agreementCache = null;
}

/** 更新检查结果（5 分钟缓存，避免轮询打远端）。 */
let updateCheckCache: { at: number; result: unknown } | null = null;

async function cachedUpdateCheck(): Promise<unknown> {
  if (updateCheckCache && Date.now() - updateCheckCache.at < 300_000) return updateCheckCache.result;
  const store = getConfigStore();
  const result = await checkForUpdates(store.get<string>("github.mirror", "github")).catch(() => null);
  updateCheckCache = { at: Date.now(), result };
  return result;
}

async function fullStatus() {
  const store = getConfigStore();
  const st = getStProcessManager();
  const agreement = await agreementState();
  const env = checkSystemEnv();
  const versionInfo = isStInstalled() ? await getVersionInfo() : null;
  const stConfig = isStInstalled() ? new StConfig().state : null;
  return {
    launcher_version: LAUNCHER_VERSION,
    installed: isStInstalled(),
    running: st.state(),
    st: versionInfo,
    st_config: stConfig,
    env,
    local_ip: await getLocalIp(),
    autostart: store.get<boolean>("autostart", false),
    mirror: store.get<string>("github.mirror", "github"),
    busy: busyTasks(),
    agreement_required: agreement.required,
    update: await cachedUpdateCheck(),
  };
}

export interface WebuiOptions {
  host?: string;
  port?: number;
}

export function createWebuiHandler(options: WebuiOptions = {}) {
  const store = getConfigStore();
  const host = options.host ?? store.get<string>("webui.host", "127.0.0.1");
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  let token = "";
  if (!isLoopback) {
    token = store.get<string>("webui.token", "");
    if (!token) {
      token = generateToken();
      store.set("webui.token", token);
      store.save();
    }
  }

  function authorized(req: IncomingMessage, url: URL): boolean {
    if (!token) return true;
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Bearer ") && header.slice(7) === token) return true;
    return url.searchParams.get("token") === token;
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://webui.local");
    const pathname = url.pathname;

    try {
      if (!authorized(req, url)) {
        send(res, 401, { success: false, error: "需要 WEBUI 访问令牌" });
        return;
      }

      // ---- SSE 日志流 ----
      if (pathname === "/api/events" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`event: hello\ndata: ${JSON.stringify({ version: LAUNCHER_VERSION })}\n\n`);
        const bus = getLogBus();
        const unsubscribe = bus.subscribe((line) => {
          res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
        });
        const lastSeq = Number(url.searchParams.get("since") ?? 0);
        for (const line of bus.since(lastSeq)) {
          res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
        }
        const statusTimer = setInterval(() => {
          res.write(`event: busy\ndata: ${JSON.stringify({ busy: busyTasks() })}\n\n`);
          res.write(": ping\n\n");
        }, 10_000);
        req.on("close", () => {
          clearInterval(statusTimer);
          unsubscribe();
        });
        return;
      }

      // ---- 静态资源 ----
      if (req.method === "GET" || req.method === "HEAD") {
        if (pathname === "/" || pathname.startsWith("/static/") || pathname === "/index.html" || pathname === "/app.js" || pathname === "/style.css") {
          if (serveStatic(res, pathname === "/" ? "/index.html" : pathname)) return;
        }
      }

      if (!pathname.startsWith("/api/")) {
        send(res, 404, { success: false, error: "未找到" });
        return;
      }

      const agreement = await agreementState();

      // ---- 只读接口（EULA 门控前可用） ----
      if (req.method === "GET" && pathname === "/api/ping") {
        send(res, 200, { success: true, pong: true });
        return;
      }
      if (req.method === "GET" && pathname === "/api/agreement") {
        send(res, 200, {
          success: true,
          required: agreement.required,
          date: agreement.date,
          content: agreement.content,
          source: agreement.source,
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/agreement/accept") {
        const body = await readJson(req);
        if (body.accepted !== true) {
          send(res, 400, { success: false, error: "需要 accepted=true" });
          return;
        }
        const saved = agreement.required ? agreement.date : store.get<string>("agreement_version", "");
        store.set("agreement_accepted", true);
        store.set("agreement_version", saved);
        const history = store.get<unknown[]>("agreement_history", []);
        history.push({ action: "agreement_accepted", timestamp: new Date().toISOString(), version: saved, source: agreement.source });
        store.set("agreement_history", history);
        store.save();
        resetAgreementCache();
        send(res, 200, { success: true });
        return;
      }

      if (agreement.required) {
        send(res, 403, { success: false, error: "请先阅读并同意用户协议" });
        return;
      }

      // ---- 只读数据 ----
      if (req.method === "GET" && pathname === "/api/status") {
        send(res, 200, { success: true, ...(await fullStatus()) });
        return;
      }
      if (req.method === "GET" && pathname === "/api/logs") {
        const since = Number(url.searchParams.get("since") ?? 0);
        send(res, 200, { success: true, lines: getLogBus().since(since) });
        return;
      }
      if (req.method === "GET" && pathname === "/api/config") {
        const snapshot = store.snapshot();
        delete (snapshot.sync as unknown as Record<string, unknown>).token;
        send(res, 200, { success: true, config: snapshot });
        return;
      }
      if (req.method === "GET" && pathname === "/api/mirrors") {
        send(res, 200, { success: true, mirrors: MIRROR_LIST, current: store.get<string>("github.mirror", "github") });
        return;
      }
      if (req.method === "GET" && pathname === "/api/versions") {
        const [current, versions] = await Promise.all([getVersionInfo(), listVersions(30)]);
        send(res, 200, { success: true, current, versions: versions.versions, latest: versions.latest, items: versions.items });
        return;
      }
      if (req.method === "GET" && pathname === "/api/migrate/scan") {
        send(res, 200, { success: true, installations: await scanForInstallations() });
        return;
      }
      if (req.method === "GET" && pathname === "/api/sync/status") {
        const manager = getSyncManager();
        const saved = manager.savedServers();
        send(res, 200, { success: true, status: await manager.status(), saved_servers: saved.redacted });
        return;
      }

      if (req.method !== "POST") {
        send(res, 404, { success: false, error: "未知接口" });
        return;
      }

      // ---- 写操作 ----
      const body = await readJson(req);
      const withTask = async (kind: TaskKind, work: () => Promise<{ ok: boolean; message: string }>) => {
        if (tasks.has(kind)) {
          send(res, 409, { success: false, error: "任务正在进行中" });
          return;
        }
        tasks.add(kind);
        send(res, 202, { success: true, started: true, task: kind });
        try {
          const result = await work();
          getLogBus().push("task", `${kind}: ${result.ok ? "✓" : "✗"} ${result.message}`);
        } catch (error) {
          logError(`webui:${kind}`, error);
          getLogBus().push("task", `${kind}: ✗ ${String(error)}`);
        } finally {
          tasks.delete(kind);
        }
      };

      switch (pathname) {
        case "/api/st/install": {
          if (body.confirm18 !== true) {
            send(res, 400, { success: false, error: "需要 confirm18=true（合规确认）" });
            return;
          }
          await withTask("install", () =>
            installSillytavern({
              confirm18: true,
              reinstall: body.reinstall === true,
              mirror: typeof body.mirror === "string" ? body.mirror : undefined,
            }),
          );
          return;
        }
        case "/api/st/start": {
          if (getStProcessManager().isRunning()) {
            send(res, 200, { success: true, message: "SillyTavern 已在运行" });
            return;
          }
          if (!isStInstalled()) {
            send(res, 400, { success: false, error: "SillyTavern 未安装" });
            return;
          }
          const store2 = getConfigStore();
          if (!store2.get<boolean>("has_started_st", false)) {
            store2.set("has_started_st", true);
            const history = store2.get<unknown[]>("agreement_history", []);
            history.push({ action: "first_start_confirmed", timestamp: new Date().toISOString() });
            store2.set("agreement_history", history);
            store2.save();
          }
          const result = await getStProcessManager().start();
          send(res, result.ok ? 200 : 500, { success: result.ok, message: result.message });
          return;
        }
        case "/api/st/stop": {
          const result = await getStProcessManager().stop();
          send(res, result.ok ? 200 : 400, { success: result.ok, message: result.message });
          return;
        }
        case "/api/st/restart": {
          const manager = getStProcessManager();
          await manager.stop();
          const result = await manager.start();
          send(res, result.ok ? 200 : 500, { success: result.ok, message: result.message });
          return;
        }
        case "/api/st/update": {
          await withTask("stUpdate", () => updateSillytavern());
          return;
        }
        case "/api/st/repair": {
          await withTask("repair", () => fixNodeModules());
          return;
        }
        case "/api/config/autostart": {
          store.set("autostart", body.enabled === true);
          store.save();
          send(res, 200, { success: true, autostart: body.enabled === true });
          return;
        }
        case "/api/config/mirror": {
          const mirror = typeof body.mirror === "string" ? body.mirror : "";
          const validated = validateMirrorInput(mirror);
          if (!validated.ok) {
            send(res, 400, { success: false, error: validated.message });
            return;
          }
          store.set("github.mirror", validated.key);
          store.save();
          await applyGitMirrorConfig(validated.key);
          send(res, 200, { success: true, mirror: validated.key });
          return;
        }
        case "/api/st-config": {
          const config = new StConfig();
          const action = String(body.action ?? "");
          if (action === "port" && typeof body.port === "number") {
            if (!(body.port >= 1 && body.port <= 65535)) {
              send(res, 400, { success: false, error: "端口号必须在 1-65535 范围内" });
              return;
            }
            config.state.port = body.port;
          } else if (action === "listen") {
            config.state.listen = body.enabled === true;
          } else if (action === "whitelist") {
            if (Array.isArray(body.ips)) config.state.whitelistIps = body.ips.map(String);
            if (body.mode !== undefined) config.state.whitelistMode = Boolean(body.mode);
            if (body.forwarded !== undefined) config.state.enableForwardedWhitelist = Boolean(body.forwarded);
          } else if (action === "host_whitelist") {
            if (Array.isArray(body.hosts)) config.state.hostWhitelistHosts = body.hosts.map(String);
            if (body.enabled !== undefined) config.state.hostWhitelistEnabled = Boolean(body.enabled);
            if (body.scan !== undefined) config.state.hostWhitelistScan = Boolean(body.scan);
          } else if (action === "unified") {
            config.state.unifiedWhitelist = body.enabled === true;
            if (body.enabled === true) config.syncWhitelists("ip");
          } else if (action === "auto_subnet") {
            await config.createWhitelist();
          } else {
            send(res, 400, { success: false, error: "未知 action" });
            return;
          }
          if (config.state.unifiedWhitelist && (action === "whitelist" || action === "auto_subnet")) {
            config.syncWhitelists("ip");
          }
          const ok = config.save();
          send(res, ok ? 200 : 500, { success: ok, state: config.state });
          return;
        }
        case "/api/versions/fetch-tags": {
          const result = await updateRemoteTags();
          send(res, result.success ? 200 : 500, { success: result.success, message: result.message });
          return;
        }
        case "/api/versions/switch": {
          const commit = typeof body.commit === "string" ? body.commit : undefined;
          const version = typeof body.version === "string" ? body.version : undefined;
          if (!commit && !version) {
            send(res, 400, { success: false, error: "需要 commit 或 version" });
            return;
          }
          const result = await switchVersion(
            { commit, version },
            { installDeps: body.installDeps === true, force: body.force === true },
          );
          send(res, result.ok ? 200 : 400, { success: result.ok, message: result.message });
          return;
        }
        case "/api/sync/server/start": {
          const manager = getSyncManager();
          const port = typeof body.port === "number" ? body.port : undefined;
          const host = typeof body.host === "string" ? body.host : "0.0.0.0";
          const result = await manager.start(port, host);
          send(res, result.ok ? 200 : 400, { success: result.ok, message: result.message, share_url: result.shareUrl });
          return;
        }
        case "/api/sync/server/stop": {
          const result = await getSyncManager().stop();
          send(res, 200, { success: true, message: result.message });
          return;
        }
        case "/api/sync/rotate-token": {
          const result = await getSyncManager().rotateToken();
          send(res, 200, { success: true, share_url: result.shareUrl });
          return;
        }
        case "/api/sync/from": {
          const serverUrl = typeof body.serverUrl === "string" ? body.serverUrl : "";
          if (!serverUrl) {
            send(res, 400, { success: false, error: "需要 serverUrl" });
            return;
          }
          const method = body.method === "zip" || body.method === "incremental" ? body.method : "auto";
          await withTask("syncFrom", () => getSyncManager().syncFrom(serverUrl, method, body.backup !== false));
          return;
        }
        case "/api/sync/test": {
          const serverUrl = typeof body.serverUrl === "string" ? body.serverUrl : "";
          const result = await getSyncManager().testConnection(serverUrl);
          send(res, result.ok ? 200 : 400, { success: result.ok, message: result.message });
          return;
        }
        case "/api/sync/servers": {
          const manager = getSyncManager();
          if (body.action === "add" && typeof body.serverUrl === "string") {
            manager.addSavedServer(body.serverUrl);
          } else if (body.action === "remove" && typeof body.index === "number") {
            manager.removeSavedServerAt(body.index);
          } else if (body.action === "clear") {
            manager.clearSavedServers();
          } else {
            send(res, 400, { success: false, error: "未知 action" });
            return;
          }
          send(res, 200, { success: true, saved_servers: manager.savedServers().redacted });
          return;
        }
        case "/api/migrate": {
          const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath : "";
          const mode = (["move", "copy_data", "copy_config", "copy_all"] as const).includes(body.mode as MigrateMode)
            ? (body.mode as MigrateMode)
            : null;
          if (!sourcePath || !mode) {
            send(res, 400, { success: false, error: "需要 sourcePath 与 mode" });
            return;
          }
          const result = await migrateInstallation({ sourcePath, mode, backup: body.backup !== false });
          send(res, result.ok ? 200 : 400, { success: result.ok, message: result.message });
          return;
        }
        case "/api/launcher/update": {
          await withTask("launcherUpdate", async () => {
            const { runWithEcho } = await import("../services/runtime.ts");
            const ok = await runWithEcho(["git", "pull"], { cwd: process.cwd() });
            if (!ok) return { ok: false, message: "git pull 失败" };
            const install = await runWithEcho(["npm", "install", "--no-audit", "--no-fund"], { cwd: process.cwd() });
            return install ? { ok: true, message: "启动器更新完成" } : { ok: false, message: "npm install 失败" };
          });
          return;
        }
        case "/api/launcher/restart": {
          send(res, 202, { success: true, started: true });
          setTimeout(() => {
            const args = process.argv.slice(1);
            spawn(process.execPath, args, { detached: true, stdio: "ignore", cwd: process.cwd() }).unref();
            process.exit(0);
          }, 300);
          return;
        }
        default:
          send(res, 404, { success: false, error: "未知接口" });
          return;
      }
    } catch (error) {
      logError("webui", error, req.url);
      send(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}

export async function startWebui(options: WebuiOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const store = getConfigStore();
  const host = options.host ?? store.get<string>("webui.host", "127.0.0.1");
  const port = options.port ?? store.get<number>("webui.port", 8300);
  const handler = createWebuiHandler({ host, port });

  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveListen());
  });

  const ip = host === "0.0.0.0" ? await getLocalIp() : host;
  const webuiToken = store.get<string>("webui.token", "");
  const url = `http://${ip}:${port}${webuiToken ? `/?token=${webuiToken}` : ""}`;
  return {
    url,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        setTimeout(resolveClose, 5000);
      }),
  };
}

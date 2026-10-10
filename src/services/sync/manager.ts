/**
 * 同步管理器 — 服务器生命周期 / 状态一致性 / 令牌轮换 / 客户端同步 / 已存服务器列表。
 * ← main_cli.py 的 start_sync_server / get_sync_server_status / stop_sync_server /
 *    rotate_sync_token / sync_from_server + _manage_saved_servers 的非交互部分。
 * DEVIATION: 原版 sync_termux.py 独立入口并入本模块（同一功能的重复实现，已删除）。
 */
import * as fs from "node:fs";
import { stDataDir, syncPidRecordPath } from "../paths.ts";
import { getConfigStore } from "../configStore.ts";
import { getLogBus } from "../logBus.ts";
import { getLocalIp } from "../network.ts";
import { SyncServer } from "./server.ts";
import { SyncClient } from "./client.ts";
import {
  ALL_INTERFACES,
  buildShareUrl,
  formatSize,
  redactShareUrl,
  recordedProcessIsRunning,
  stopRecordedProcess,
  syncCommandMarker,
  syncExecutableMarker,
  writePidRecord,
} from "./common.ts";

export interface SyncStatus {
  running: boolean;
  configEnabled: boolean;
  consistent: boolean;
  port: number;
  host: string;
  external: boolean;
  shareUrl?: string;
  localShareUrl?: string;
}

export class SyncManager {
  private server: SyncServer | null = null;

  private pidFile(): string {
    return syncPidRecordPath();
  }

  async status(): Promise<SyncStatus> {
    const store = getConfigStore();
    const localRunning = this.server !== null && this.server.running;
    let external = false;
    if (!localRunning) {
      try {
        external = recordedProcessIsRunning(this.pidFile(), syncExecutableMarker(), syncCommandMarker());
      } catch {
        external = false;
      }
    }
    const running = localRunning || external;
    const configEnabled = store.get<boolean>("sync.enabled", false);
    const port = store.get<number>("sync.port", 9999);
    const host = store.get<string>("sync.host", ALL_INTERFACES);

    const status: SyncStatus = {
      running,
      configEnabled,
      consistent: running === configEnabled,
      port,
      host,
      external,
    };
    if (running) {
      status.shareUrl = await this.shareUrl();
      status.localShareUrl = buildShareUrl("127.0.0.1", port, store.currentSyncToken());
    }
    return status;
  }

  async shareUrl(host?: string, port?: number): Promise<string> {
    const store = getConfigStore();
    const publicHost = host ?? (await getLocalIp());
    const selectedPort = port ?? store.get<number>("sync.port", 9999);
    return buildShareUrl(publicHost, selectedPort, store.currentSyncToken());
  }

  /** 进程内启动（WEBUI / CLI 后台模式）；绑定成功后才写配置。 */
  async start(port?: number, host = ALL_INTERFACES): Promise<{ ok: boolean; message: string; shareUrl?: string }> {
    const store = getConfigStore();
    const say = (line: string) => {
      process.stdout.write(line + "\n");
      getLogBus().push("sync", line);
    };
    try {
      if (this.server && this.server.running) {
        return { ok: true, message: "数据同步服务已在当前进程中运行" };
      }
      try {
        if (recordedProcessIsRunning(this.pidFile(), syncExecutableMarker(), syncCommandMarker())) {
          return { ok: true, message: "数据同步服务已在另一个进程中运行" };
        }
      } catch {
        /* 记录无效时继续启动 */
      }

      const dataPath = stDataDir();
      if (!fs.existsSync(dataPath)) {
        return { ok: false, message: `SillyTavern 数据目录不存在: ${dataPath}` };
      }

      const selectedPort = port ?? store.get<number>("sync.port", 9999);
      this.server = new SyncServer(dataPath, selectedPort, host, () => store.currentSyncToken());
      await this.server.start();

      store.set("sync.enabled", true);
      store.set("sync.port", selectedPort);
      store.set("sync.host", host);
      store.save();

      const shareUrl = await this.shareUrl(undefined, selectedPort);
      say(`数据同步服务已启动 (${host}:${selectedPort})`);
      say(`分享地址: ${shareUrl}`);
      return { ok: true, message: "数据同步服务已启动", shareUrl };
    } catch (error) {
      if (this.server) await this.server.stop();
      this.server = null;
      store.set("sync.enabled", false);
      store.save();
      return { ok: false, message: `启动同步服务器失败: ${String(error)}` };
    }
  }

  /** 阻塞式独立进程模式（`st sync start`）：写 PID 记录，SIGTERM 干净退出。 */
  async startBlocking(port?: number, host = ALL_INTERFACES): Promise<void> {
    const store = getConfigStore();
    const result = await this.start(port, host);
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = 1;
      return;
    }
    const pidFile = this.pidFile();
    writePidRecord(pidFile, process.pid, syncExecutableMarker(), syncCommandMarker());
    process.stdout.write("按 Ctrl+C 停止服务...\n");
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      process.stdout.write("\n正在停止同步服务器...\n");
      try {
        fs.rmSync(pidFile, { force: true });
      } catch {
        /* ignore */
      }
      await this.server?.stop();
      store.set("sync.enabled", false);
      store.save();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    await new Promise(() => {});
  }

  async stop(): Promise<{ ok: boolean; message: string }> {
    const store = getConfigStore();
    let stopped = false;
    if (this.server && this.server.running) {
      await this.server.stop();
      this.server = null;
      stopped = true;
    } else {
      try {
        stopped = stopRecordedProcess(this.pidFile(), syncExecutableMarker(), syncCommandMarker());
      } catch (error) {
        return { ok: false, message: `停止同步服务器失败: ${String(error)}` };
      }
    }
    store.set("sync.enabled", false);
    store.save();
    return stopped
      ? { ok: true, message: "数据同步服务已停止" }
      : { ok: true, message: "数据同步服务未运行" };
  }

  async rotateToken(): Promise<{ shareUrl: string }> {
    const store = getConfigStore();
    store.rotateSyncToken();
    return { shareUrl: await this.shareUrl() };
  }

  /** 状态不一致时把配置同步到实际运行状态。 */
  async syncConfigWithActualState(): Promise<boolean> {
    const status = await this.status();
    if (!status.consistent) {
      const store = getConfigStore();
      store.set("sync.enabled", status.running);
      store.save();
      return true;
    }
    return false;
  }

  /** 从远端同步到本地数据目录。 */
  async syncFrom(
    serverUrl: string,
    method: "auto" | "zip" | "incremental" = "auto",
    backup = true,
  ): Promise<{ ok: boolean; message: string }> {
    const say = (line: string) => {
      process.stdout.write(line + "\n");
      getLogBus().push("sync", line);
    };
    try {
      if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
        serverUrl = `http://${serverUrl}`;
      }
      const client = new SyncClient(serverUrl, stDataDir());
      await client.health();
      const info = await client.getServerInfo();
      if (info) {
        const serverInfo = info.server_info as { file_count?: number; total_size?: number };
        say(`服务器信息: 文件数量 ${serverInfo.file_count ?? 0}，总大小 ${formatSize(serverInfo.total_size ?? 0)}`);
      }
      const result = await client.sync(method, backup);
      return { ok: true, message: `数据同步完成 (${result.method})` };
    } catch (error) {
      return { ok: false, message: `数据同步失败: ${String(error)}` };
    }
  }

  /** 测试已保存的分享地址连通性。 */
  async testConnection(serverUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      const client = new SyncClient(serverUrl);
      await client.health();
      await client.info();
      return { ok: true, message: "连接成功" };
    } catch (error) {
      return { ok: false, message: `连接检查失败: ${String(error)}` };
    }
  }

  savedServers(): { urls: string[]; redacted: string[] } {
    const store = getConfigStore();
    const urls = store.get<string[]>("sync.saved_servers", []);
    return { urls: [...urls], redacted: urls.map(redactShareUrl) };
  }

  addSavedServer(serverUrl: string): void {
    const store = getConfigStore();
    const urls = store.get<string[]>("sync.saved_servers", []);
    if (!urls.includes(serverUrl)) {
      urls.push(serverUrl);
      store.set("sync.saved_servers", urls);
      store.save();
    }
  }

  removeSavedServer(serverUrl: string): boolean {
    const store = getConfigStore();
    const urls = store.get<string[]>("sync.saved_servers", []);
    const index = urls.indexOf(serverUrl);
    if (index < 0) return false;
    urls.splice(index, 1);
    store.set("sync.saved_servers", urls);
    store.save();
    return true;
  }

  removeSavedServerAt(index: number): boolean {
    const store = getConfigStore();
    const urls = store.get<string[]>("sync.saved_servers", []);
    if (index < 0 || index >= urls.length) return false;
    urls.splice(index, 1);
    store.set("sync.saved_servers", urls);
    store.save();
    return true;
  }

  clearSavedServers(): void {
    const store = getConfigStore();
    store.set("sync.saved_servers", []);
    store.save();
  }
}

let manager: SyncManager | null = null;

export function getSyncManager(): SyncManager {
  if (!manager) manager = new SyncManager();
  return manager;
}

export function resetSyncManager(): void {
  manager = null;
}

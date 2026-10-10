/**
 * 启动器配置存储 — config.json 原子写入 + 0600 + 递归默认值合并 + 点路径读写。
 * ← src/config.py ConfigManager，行为逐条对齐：
 *   - 原子写：tmp → fsync → chmod 600 → rename
 *   - 默认值合并保留用户设置
 *   - sync.token 自动生成（token_urlsafe(24) ≈ base64url 32 字符）
 */
import * as fs from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { launcherConfigPath } from "./paths.ts";
import { ALL_INTERFACES } from "./sync/common.ts";

export interface LauncherConfig {
  first_run: boolean;
  github: { mirror: string; custom_mirror_url: string };
  autostart: boolean;
  sync: {
    enabled: boolean;
    port: number;
    host: string;
    token: string;
    saved_servers: string[];
  };
  webui: { enabled: boolean; port: number; host: string };
  migration: {
    last_migration_time: string | null;
    last_source_path: string | null;
    backup_enabled: boolean;
    preferred_mode: string;
  };
  agreement_accepted: boolean;
  agreement_version: string;
  downloads: unknown[];
  has_started_st: boolean;
  agreement_history: unknown[];
  [key: string]: unknown;
}

export function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function defaultConfig(): LauncherConfig {
  return {
    first_run: true,
    github: { mirror: "github", custom_mirror_url: "" },
    autostart: false,
    sync: { enabled: false, port: 9999, host: ALL_INTERFACES, token: "", saved_servers: [] },
    webui: { enabled: false, port: 8300, host: "127.0.0.1" },
    migration: {
      last_migration_time: null,
      last_source_path: null,
      backup_enabled: true,
      preferred_mode: "move",
    },
    agreement_accepted: false,
    agreement_version: "",
    downloads: [],
    has_started_st: false,
    agreement_history: [],
  };
}

/** 递归补齐缺失默认值，保留用户已有设置；返回是否有变化。 */
function mergeDefaults(current: Record<string, unknown>, defaults: Record<string, unknown>): boolean {
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in current) || current[key] === undefined) {
      current[key] = structuredClone(value);
      changed = true;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (current[key] !== null && typeof current[key] === "object" && !Array.isArray(current[key])) {
        changed = mergeDefaults(current[key] as Record<string, unknown>, value as Record<string, unknown>) || changed;
      }
    }
  }
  return changed;
}

export class ConfigStore {
  private configPath: string;
  private config: LauncherConfig;
  private defaults: LauncherConfig;

  constructor(configPath?: string) {
    this.configPath = configPath ?? launcherConfigPath();
    this.defaults = defaultConfig();
    this.config = this.load();
    if (mergeDefaults(this.config as unknown as Record<string, unknown>, this.defaults as unknown as Record<string, unknown>)) {
      this.save();
    }
    if (!this.get<string>("sync.token")) {
      this.set("sync.token", generateToken());
      this.save();
    }
  }

  private load(): LauncherConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.saveData(this.defaults);
        return structuredClone(this.defaults);
      }
      return JSON.parse(fs.readFileSync(this.configPath, "utf-8")) as LauncherConfig;
    } catch (error) {
      process.stderr.write(`警告: 读取配置文件失败，使用默认配置: ${String(error)}\n`);
      return structuredClone(this.defaults);
    }
  }

  private saveData(data: LauncherConfig): void {
    const tempPath = `${this.configPath}.tmp`;
    try {
      mkdirSync(dirname(this.configPath), { recursive: true });
      const fd = fs.openSync(tempPath, "w");
      try {
        fs.writeSync(fd, JSON.stringify(data, null, 4) + "\n");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        fs.chmodSync(tempPath, 0o600);
      } catch {
        /* Windows 无 POSIX 权限 */
      }
      fs.renameSync(tempPath, this.configPath);
      try {
        fs.chmodSync(this.configPath, 0o600);
      } catch {
        /* 同上 */
      }
    } catch (error) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        /* 清理失败不影响主流程 */
      }
      throw new Error(`保存配置文件失败: ${String(error)}`);
    }
  }

  save(): void {
    this.saveData(this.config);
  }

  get<T>(key: string, defaultValue?: T): T {
    let value: unknown = this.config;
    for (const part of key.split(".")) {
      if (value === null || typeof value !== "object") return defaultValue as T;
      value = (value as Record<string, unknown>)[part];
    }
    return (value === undefined ? defaultValue : value) as T;
  }

  set(key: string, value: unknown): void {
    const parts = key.split(".");
    let cursor = this.config as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) {
      if (cursor[part] === null || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }

  reload(): void {
    this.config = this.load();
    mergeDefaults(this.config as unknown as Record<string, unknown>, this.defaults as unknown as Record<string, unknown>);
  }

  /** 当前同步令牌；每次读取重载配置，运行中的服务器可即时响应轮换。 */
  currentSyncToken(): string {
    this.reload();
    let token = this.get<string>("sync.token", "");
    if (typeof token !== "string" || !token) token = this.rotateSyncToken();
    return token;
  }

  rotateSyncToken(): string {
    const token = generateToken();
    this.set("sync.token", token);
    this.save();
    return token;
  }

  snapshot(): Readonly<LauncherConfig> {
    return structuredClone(this.config);
  }
}

let store: ConfigStore | null = null;

export function getConfigStore(): ConfigStore {
  if (!store) store = new ConfigStore();
  return store;
}

/** 测试用：重置全局单例。 */
export function resetConfigStore(): void {
  store = null;
}

/**
 * SillyTavern config.yaml 管理 — 注释保留读写、白名单管理、网段自愈。
 * ← src/stconfig.py。注释保留：yaml 包 Document 模式（参考项目同款方案）。
 */
import * as fs from "node:fs";
import { dirname } from "node:path";
import { parseDocument, type Document, type YAMLMap } from "yaml";
import { stDir } from "./paths.ts";
import { getLocalIp } from "./network.ts";

export interface StConfigState {
  listen: boolean;
  port: number;
  hostWhitelistEnabled: boolean;
  hostWhitelistScan: boolean;
  hostWhitelistHosts: string[];
  whitelistMode: boolean;
  enableForwardedWhitelist: boolean;
  whitelistIps: string[];
  unifiedWhitelist: boolean;
}

const DEFAULT_STATE: StConfigState = {
  listen: false,
  port: 8000,
  hostWhitelistEnabled: false,
  hostWhitelistScan: true,
  hostWhitelistHosts: ["localhost", "127.0.0.1", "[::1]"],
  whitelistMode: true,
  enableForwardedWhitelist: true,
  whitelistIps: ["::1", "127.0.0.1"],
  unifiedWhitelist: false,
};

export class StConfig {
  readonly configPath: string;
  readonly whitelistTxtPath: string;
  state: StConfigState;
  private doc: Document | null = null;

  constructor(baseStDir = stDir()) {
    this.configPath = `${baseStDir}/config.yaml`;
    this.whitelistTxtPath = `${baseStDir}/whitelist.txt`;
    this.state = { ...DEFAULT_STATE, whitelistIps: [...DEFAULT_STATE.whitelistIps], hostWhitelistHosts: [...DEFAULT_STATE.hostWhitelistHosts] };
    this.load();
  }

  load(): void {
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      this.doc = parseDocument(content);
      const get = (key: string, fallback: unknown) => {
        const value = this.doc!.get(key);
        return value === undefined || value === null ? fallback : value;
      };
      const host = (this.doc.get("hostWhitelist") as YAMLMap | undefined) ?? undefined;
      this.state.listen = Boolean(get("listen", false));
      this.state.port = Number(get("port", 8000)) || 8000;
      this.state.hostWhitelistEnabled = Boolean(host?.get?.("enabled") ?? false);
      this.state.hostWhitelistScan = Boolean(host?.get?.("scan") ?? true);
      this.state.hostWhitelistHosts = Array.isArray(host?.get?.("hosts")) ? [...(host!.get("hosts") as string[])] : [...DEFAULT_STATE.hostWhitelistHosts];
      this.state.whitelistMode = Boolean(get("whitelistMode", true));
      this.state.enableForwardedWhitelist = Boolean(get("enableForwardedWhitelist", true));
      const whitelist = get("whitelist", DEFAULT_STATE.whitelistIps);
      this.state.whitelistIps = Array.isArray(whitelist) ? [...(whitelist as string[])] : [...DEFAULT_STATE.whitelistIps];
      this.state.unifiedWhitelist = Boolean(get("unifiedWhitelist", false));
      this.migrateWhitelistFromTxt();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        process.stdout.write(`加载配置文件时出错: ${String(error)}\n`);
      }
    }
  }

  save(): boolean {
    try {
      if (!this.doc) this.doc = parseDocument("");
      this.doc.set("listen", this.state.listen);
      this.doc.set("port", this.state.port);
      let host = this.doc.get("hostWhitelist");
      if (!host || typeof host !== "object") {
        this.doc.set("hostWhitelist", {});
        host = this.doc.get("hostWhitelist");
      }
      (host as YAMLMap).set("enabled", this.state.hostWhitelistEnabled);
      (host as YAMLMap).set("scan", this.state.hostWhitelistScan);
      (host as YAMLMap).set("hosts", this.state.hostWhitelistHosts);
      this.doc.set("whitelistMode", this.state.whitelistMode);
      this.doc.set("enableForwardedWhitelist", this.state.enableForwardedWhitelist);
      this.doc.set("whitelist", this.state.whitelistIps);
      this.doc.set("unifiedWhitelist", this.state.unifiedWhitelist);
      fs.mkdirSync(dirname(this.configPath), { recursive: true });
      fs.writeFileSync(this.configPath, String(this.doc), "utf-8");
      return true;
    } catch (error) {
      process.stdout.write(`保存配置文件时出错: ${String(error)}\n`);
      return false;
    }
  }

  /** 将 IPv6 地址展开为 8 组；失败返回 null。 */
  private expandIpv6(ip: string): string[] | null {
    const clean = ip.split("%")[0];
    if (clean.includes(".")) return null; // 内嵌 IPv4 的形式极少见，放弃展开
    if (!clean.includes("::")) {
      const groups = clean.split(":");
      return groups.length === 8 && groups.every((g) => g.length > 0) ? groups : null;
    }
    const [head, tail] = clean.split("::");
    const headGroups = head ? head.split(":").filter(Boolean) : [];
    const tailGroups = tail ? tail.split(":").filter(Boolean) : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 1) return null; // "::" 至少占一组
    return [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  }

  /** 从 IP 提取网段通配符（IPv4 → x.y.z.*；IPv6 取前 4 组 + ::*）。 */
  subnetFromIp(ip: string): string | null {
    try {
      if (ip.includes(":")) {
        const groups = this.expandIpv6(ip);
        if (!groups) return ip;
        return `${groups.slice(0, 4).join(":")}::*`;
      }
      const parts = ip.split(".");
      if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
      return null;
    } catch {
      return null;
    }
  }

  /** 旧版 whitelist.txt → config.yaml 迁移。 */
  private migrateWhitelistFromTxt(): boolean {
    if (!fs.existsSync(this.whitelistTxtPath)) return false;
    try {
      const content = fs.readFileSync(this.whitelistTxtPath, "utf-8");
      const migrated: string[] = [];
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !migrated.includes(trimmed)) migrated.push(trimmed);
      }
      const current = new Set(this.state.whitelistIps);
      const newIps = migrated.filter((ip) => !current.has(ip));
      if (newIps.length) {
        this.state.whitelistIps = [...migrated, ...this.state.whitelistIps.filter((ip) => !migrated.includes(ip))];
        if (this.save()) {
          process.stdout.write(`已从 whitelist.txt 迁移 ${newIps.length} 个 IP 到 config.yaml\n`);
          try {
            fs.rmSync(this.whitelistTxtPath);
          } catch {
            /* 保留原文件 */
          }
        }
      }
      return true;
    } catch (error) {
      process.stdout.write(`迁移 whitelist.txt 失败: ${String(error)}\n`);
      return false;
    }
  }

  /** 自动检测当前网段并加入白名单。 */
  async createWhitelist(): Promise<boolean> {
    try {
      const localIp = await getLocalIp();
      if (!localIp || localIp === "127.0.0.1") {
        process.stdout.write("无法获取本地IP，白名单未更新\n");
        return true;
      }
      const subnet = this.subnetFromIp(localIp);
      if (subnet && !this.state.whitelistIps.includes(subnet)) {
        this.state.whitelistIps.unshift(subnet);
        if (!this.state.whitelistIps.includes("127.0.0.1")) this.state.whitelistIps.push("127.0.0.1");
        if (!this.state.whitelistIps.includes("::1")) this.state.whitelistIps.push("::1");
        this.save();
        process.stdout.write(`白名单已更新，添加网段: ${subnet} (本地IP: ${localIp})\n`);
      }
      return true;
    } catch (error) {
      process.stdout.write(`白名单更新失败: ${String(error)}\n`);
      return false;
    }
  }

  /** 统一白名单同步：ip → host 或 host → ip。 */
  syncWhitelists(source: "ip" | "host"): void {
    const isValidIpOrPattern = (entry: string): boolean => {
      if (!entry || entry === "localhost") return false;
      const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(\.\*)?$/;
      const ipv6 = /^[0-9a-fA-F:]+::?[0-9a-fA-F:]*$|^\[[0-9a-fA-F:]+\]$|^[0-9a-fA-F:]+::\*$/;
      const cidr4 = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
      const cidr6 = /^[0-9a-fA-F:]+\/\d{1,3}$/;
      const wildcard = /^(\d{1,3}\.){0,3}\*$|^(\d{1,3}\.){0,2}\*\.\*$/;
      return ipv4.test(entry) || ipv6.test(entry) || cidr4.test(entry) || cidr6.test(entry) || wildcard.test(entry);
    };

    if (source === "ip") {
      const hosts: string[] = [];
      if (this.state.hostWhitelistHosts.includes("localhost")) hosts.push("localhost");
      for (const ip of this.state.whitelistIps) {
        hosts.push(ip.includes(":") && !ip.startsWith("[") ? `[${ip}]` : ip);
      }
      this.state.hostWhitelistHosts = hosts;
    } else {
      const ips: string[] = [];
      for (const host of this.state.hostWhitelistHosts) {
        if (host === "localhost") continue;
        if (host.startsWith("[") && host.endsWith("]")) {
          const inner = host.slice(1, -1);
          if (isValidIpOrPattern(inner)) ips.push(inner);
        } else if (isValidIpOrPattern(host)) {
          ips.push(host);
        }
      }
      this.state.whitelistIps = ips;
    }
    this.save();
    process.stdout.write(`白名单已同步: ${source} -> ${source === "ip" ? "host" : "ip"}\n`);
  }
}

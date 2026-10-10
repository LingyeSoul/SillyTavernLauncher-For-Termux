/**
 * 本机 IP 探测 — ifconfig / ip addr 解析 + 网卡分类优先级 + UDP socket 回退 + 缓存。
 * ← src/network.py NetworkManager（Termux/Linux 环境优先）。
 * DEVIATION: 原版还在 sync_termux.py 里误用 Windows 的 ipconfig —— 本版统一为
 * ifconfig/ip addr/socket 三级探测，跨平台可用（Windows 上 ifconfig 不存在则跳过）。
 */
import * as dgram from "node:dgram";
import { run } from "./runtime.ts";

interface AdapterCandidate {
  ip: string;
  name: string;
  priority: number;
}

const VM_KEYWORDS = ["vmware", "virtualbox", "virtual", "vbox", "vethernet", "docker", "br-", "virbr", "vnc", "tap"];
const VPN_KEYWORDS = ["vpn", "tun", "ppp", "pptp", "l2tp", "openvpn", "wireguard", "nordvpn", "expressvpn"];
const PHYSICAL_KEYWORDS = ["eth", "wlan", "wifi", "wl", "enp", "wlp", "realtek", "intel", "broadcom", "qualcomm", "atheros", "802.11"];

function classifyAdapter(name: string): number {
  const lower = name.toLowerCase();
  if (VM_KEYWORDS.some((k) => lower.includes(k))) return 30;
  if (VPN_KEYWORDS.some((k) => lower.includes(k))) return 20;
  if (PHYSICAL_KEYWORDS.some((k) => lower.includes(k))) return 10;
  if (lower === "lo") return 99;
  return 25;
}

function isValidIp(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const num = Number(part);
    if (num < 0 || num > 255) return false;
  }
  return !ip.startsWith("127.") && !ip.startsWith("169.254.");
}

function ipPriority(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return 999;
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  if (first === 192 && second === 168) return 1;
  if (first === 10) return 2;
  if (first === 172 && second >= 16 && second <= 31) return 3;
  return isValidIp(ip) ? 4 : 999;
}

function parseIfconfig(output: string): string | null {
  const adapters: AdapterCandidate[] = [];
  let current: string | null = null;
  let priority = 25;
  for (const line of output.split("\n")) {
    if (!/^\s/.test(line)) {
      const match = line.match(/^(\S+)/);
      if (match && line.trim()) {
        current = match[1].replace(/:$/, "");
        priority = classifyAdapter(current);
      }
      continue;
    }
    const inet = line.match(/inet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (inet && current && isValidIp(inet[1])) {
      adapters.push({ ip: inet[1], name: current, priority });
    }
  }
  if (!adapters.length) return null;
  adapters.sort((a, b) => a.priority - b.priority || ipPriority(a.ip) - ipPriority(b.ip));
  return adapters[0].ip;
}

function parseIpAddr(output: string): string | null {
  const adapters: AdapterCandidate[] = [];
  let current: string | null = null;
  let priority = 25;
  for (const line of output.split("\n")) {
    const header = line.match(/^\d+:\s+(\S+):/);
    if (header) {
      current = header[1];
      priority = classifyAdapter(current);
      continue;
    }
    const inet = line.match(/inet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/\d+/);
    if (inet && current && isValidIp(inet[1])) {
      adapters.push({ ip: inet[1], name: current, priority });
    }
  }
  if (!adapters.length) return null;
  adapters.sort((a, b) => a.priority - b.priority || ipPriority(a.ip) - ipPriority(b.ip));
  return adapters[0].ip;
}

function fallbackLocalIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const done = (ip: string | null) => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(ip);
    };
    socket.once("error", () => done(null));
    try {
      socket.connect(80, "8.8.8.8", () => {
        const addr = socket.address();
        done(typeof addr === "object" && addr !== null && "address" in addr && isValidIp(addr.address) ? addr.address : null);
      });
      const timer = setTimeout(() => done(null), 3000);
      timer.unref?.();
    } catch {
      done(null);
    }
  });
}

export class NetworkManager {
  private cached: string | null = null;
  private checkedAt = 0;
  private cacheMs: number;

  constructor(cacheSeconds = 300) {
    this.cacheMs = cacheSeconds * 1000;
  }

  async getLocalIp(): Promise<string | null> {
    const now = Date.now();
    if (this.cached && now - this.checkedAt < this.cacheMs) return this.cached;

    let best: string | null = null;
    const ifconfig = await run(["ifconfig"], { timeoutMs: 5000 });
    if (ifconfig.ok) best = parseIfconfig(ifconfig.stdout);
    if (!best) {
      const ipAddr = await run(["ip", "addr"], { timeoutMs: 5000 });
      if (ipAddr.ok) best = parseIpAddr(ipAddr.stdout);
    }
    if (!best) best = await fallbackLocalIp();
    if (!best) best = "127.0.0.1";

    this.cached = best;
    this.checkedAt = now;
    return best;
  }
}

let manager: NetworkManager | null = null;

export function getNetworkManager(): NetworkManager {
  if (!manager) manager = new NetworkManager();
  return manager;
}

export async function getLocalIp(): Promise<string> {
  return (await getNetworkManager().getLocalIp()) ?? "127.0.0.1";
}

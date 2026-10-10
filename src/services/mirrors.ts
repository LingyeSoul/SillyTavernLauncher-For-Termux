/**
 * GitHub 镜像源注册表与选优服务 — 迁移自桌面版 SillyTavernLauncher 的"2026-09-21 镜像增强"。
 * ← src/utils/mirror_builder.py + url_converter.py + main_cli.set_github_mirror，
 *   并对齐桌面版 services/mirrors.ts 的智能选优体系。
 *
 * 单一事实源（本模块之前，镜像逻辑散落三处：updater 模板前缀 / gitconfig insteadOf /
 * 手写三站名单——新增镜像站要改多处，漏一处即静默不加速）：
 * - 注册表：内置镜像站名单（host 为唯一标识 + 用户实测报告的延迟参考值）；
 * - applyMirrorPrefix：唯一的 URL 前缀实现（'github'/未知值语义保留为"不加速"）；
 * - 测速：ping（ICMP，零服务端负载）为主探针，TCP 443 握手兜底（ICMP 被屏蔽的
 *   CDN 不误杀）；真实 HTTP 请求仅用于故障取证（单站单次）；
 * - 选优：未选定镜像时自动测速选最快；已选定保持稳定——自动切换只发生在镜像
 *   失效时：git 网络出错先对当前镜像取证，确不可达才切到下一个可达镜像
 *   （未验证的归因是甩锅；不为边际速度收益无故换源）。
 *
 * 状态落在 config.json 的 github.*（enabled/mirror/auto/speedtest）；
 * 与桌面版的差异（Termux 环境裁剪）：无 Windows 证书库回退（fetch 直连）、
 * 无 isomorphic-git（git 走系统 git + gitconfig insteadOf 全局重写）。
 * STL_NO_NETWORK=1 时所有探针直接返回不可达（测试零网络）。
 */
import { connect as netConnect } from "node:net";
import { run } from "./runtime.ts";
import { getConfigStore } from "./configStore.ts";
import { logError } from "./errorLog.ts";

/** 官方源哨兵：沿用旧配置语义（'github' = 不使用加速镜像） */
export const OFFICIAL_MIRROR = "github";

export type MirrorTier = "fast" | "medium" | "legacy";

export interface MirrorSource {
  /** 唯一标识（同时也是前缀主机名，如 gh.dpik.top） */
  host: string;
  /** 用户实测报告延迟（ms，仅作首屏排序参考，实测结果优先） */
  reportedMs?: number;
  tier: MirrorTier;
}

/**
 * 内置镜像站名单（2026-09-21 用户实测报告；host 唯一，顺序即推荐顺序）。
 * fast：报告延迟 < 600ms；medium：600–1100ms；legacy：旧版启动器内置镜像
 * （gh-proxy.org / gh.llkk.cc，老配置兼容，报告名单未覆盖故不给报告值）。
 */
export const MIRROR_SOURCES: readonly MirrorSource[] = [
  { host: "github.dpik.top", reportedMs: 497, tier: "fast" },
  { host: "gh.ddlc.top", reportedMs: 500, tier: "fast" },
  { host: "github-proxy.lixxing.top", reportedMs: 508, tier: "fast" },
  { host: "ghp.keleyaa.com", reportedMs: 509, tier: "fast" },
  { host: "github.boringhex.top", reportedMs: 513, tier: "fast" },
  { host: "gh.1k.ink", reportedMs: 514, tier: "fast" },
  { host: "git.669966.xyz", reportedMs: 519, tier: "fast" },
  { host: "jiashu.1win.eu.org", reportedMs: 521, tier: "fast" },
  { host: "ghfile.geekertao.top", reportedMs: 522, tier: "fast" },
  { host: "gp.871201.xyz", reportedMs: 523, tier: "fast" },
  { host: "ghproxy.xzhouqd.com", reportedMs: 530, tier: "fast" },
  { host: "github.1ms.xx.kg", reportedMs: 598, tier: "fast" },
  { host: "gh.chalin.tk", reportedMs: 613, tier: "medium" },
  { host: "ggg.clwap.dpdns.org", reportedMs: 617, tier: "medium" },
  { host: "github.zzrbk.xyz", reportedMs: 619, tier: "medium" },
  { host: "gh.shiina-rimo.cafe", reportedMs: 619, tier: "medium" },
  { host: "ghm.078465.xyz", reportedMs: 620, tier: "medium" },
  { host: "github.ihnic.com", reportedMs: 620, tier: "medium" },
  { host: "github.880824.xyz", reportedMs: 621, tier: "medium" },
  { host: "gh.jasonzeng.dev", reportedMs: 622, tier: "medium" },
  { host: "gh.xxooo.cf", reportedMs: 623, tier: "medium" },
  { host: "kenyu.ggff.net", reportedMs: 623, tier: "medium" },
  { host: "github.crdz.eu.org", reportedMs: 624, tier: "medium" },
  { host: "gh.996986.xyz", reportedMs: 625, tier: "medium" },
  { host: "tvv.tw", reportedMs: 626, tier: "medium" },
  { host: "proxy.baguoyuyan.com", reportedMs: 626, tier: "medium" },
  { host: "gh.monlor.com", reportedMs: 628, tier: "medium" },
  { host: "ghproxy.imciel.com", reportedMs: 628, tier: "medium" },
  { host: "git.951959483.xyz", reportedMs: 629, tier: "medium" },
  { host: "git.820828.xyz", reportedMs: 629, tier: "medium" },
  { host: "ghpxy.hwinzniej.top", reportedMs: 631, tier: "medium" },
  { host: "ghf.无名氏.top", reportedMs: 635, tier: "medium" },
  { host: "hub.ddayh.com", reportedMs: 636, tier: "medium" },
  { host: "gh.aaa.team", reportedMs: 643, tier: "medium" },
  { host: "getgit.love8yun.eu.org", reportedMs: 644, tier: "medium" },
  { host: "github.lsdfxdk.nyc.mn", reportedMs: 644, tier: "medium" },
  { host: "gh.198962.xyz", reportedMs: 645, tier: "medium" },
  { host: "github.788787.xyz", reportedMs: 645, tier: "medium" },
  { host: "git.yylx.win", reportedMs: 652, tier: "medium" },
  { host: "fastgit.cc", reportedMs: 653, tier: "medium" },
  { host: "gh.chjina.com", reportedMs: 654, tier: "medium" },
  { host: "ghproxy.cxkpro.top", reportedMs: 658, tier: "medium" },
  { host: "github.ednovas.xyz", reportedMs: 912, tier: "medium" },
  { host: "gh-proxy.com", reportedMs: 920, tier: "medium" },
  { host: "gh.noki.icu", reportedMs: 1064, tier: "medium" },
  { host: "gh.llkk.cc", reportedMs: 1064, tier: "medium" },
  { host: "gh.dpik.top", reportedMs: 1065, tier: "medium" },
  { host: "gh.con.sh", reportedMs: 1073, tier: "medium" },
  { host: "gh.b52m.cn", reportedMs: 1082, tier: "medium" },
  { host: "github.mlmle.cn", reportedMs: 1085, tier: "medium" },
  { host: "gitproxy.mrhjx.cn", reportedMs: 1086, tier: "medium" },
  { host: "down.npee.cn", reportedMs: 1090, tier: "medium" },
  { host: "free.cn.eu.org", reportedMs: 1103, tier: "medium" },
  // 旧版启动器内置镜像（老配置兼容；不在用户实测名单内，无报告值）
  { host: "gh-proxy.org", tier: "legacy" },
];

/** host → 注册表项（O(1) 判定） */
const MIRROR_HOST_INDEX = new Map<string, MirrorSource>(MIRROR_SOURCES.map((m) => [m.host, m]));

/**
 * 旧版短键别名（ghproxy/ghllkk 是旧 config.json 里的合法值，升级映射到注册表 host）。
 * github.com 及 www 形态语义上就是官方源，一并归一到哨兵——否则会被当成自定义
 * 镜像域名，生成 `https://github.com/https://github.com/` 自嵌套的 insteadOf 重写。
 */
const LEGACY_MIRROR_KEYS: Record<string, string> = {
  ghproxy: "gh-proxy.org",
  "gh-proxy": "gh-proxy.org",
  ghllkk: "gh.llkk.cc",
  "github.com": OFFICIAL_MIRROR,
  "www.github.com": OFFICIAL_MIRROR,
};

/**
 * 配置值归一：去空白 / 去协议前缀 / 旧短键映射 / 小写。
 * 不做合法性裁决（注册表外的自定义域名是合法手动选择）。
 */
export function normalizeMirrorValue(raw: string): string {
  const trimmed = raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  if (trimmed === "") return OFFICIAL_MIRROR;
  return LEGACY_MIRROR_KEYS[trimmed] ?? trimmed;
}

/** 是否为注册表内镜像源（智能选优/测速的候选范围；空串与 'github' 均否） */
export function isValidMirrorHost(host: string): boolean {
  return MIRROR_HOST_INDEX.has(host);
}

/** 形如主机名（含 IDN 字面量；不含协议/路径/端口/空白）——自定义镜像的门禁 */
function isHostnameLike(value: string): boolean {
  return /^[^\s/:?#[\]@]+$/u.test(value) && value.includes(".");
}

/** 注册表内或形状合法的自定义主机——可作为生效镜像（activeMirrorHost/前缀改写的门禁） */
function isUsableMirrorValue(host: string): boolean {
  return isValidMirrorHost(host) || isHostnameLike(host);
}

/** 镜像展示名（日志/提示文案） */
export function mirrorDisplayName(host: string): string {
  return host === "" || host === OFFICIAL_MIRROR ? "GitHub官方源" : `${host}镜像`;
}

/** 前缀根 URL：`https://<host>/`（IDN 主机名由 URL/fetch 层做 punycode） */
export function mirrorPrefixUrl(host: string): string {
  return `https://${host}/`;
}

/** 镜像改写适用范围：GitHub 家族域名（github.com 及其子域、*.githubusercontent.com） */
export function isGithubUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === "github.com" ||
    host.endsWith(".github.com") ||
    host === "githubusercontent.com" ||
    host.endsWith(".githubusercontent.com")
  );
}

/**
 * GitHub 官方 URL → 镜像前缀 URL（全应用唯一实现）。
 * mirror 为空 / 'github' / 既非注册表也非合法主机名 → 原样返回（fail-safe，
 * 手改配置的乱码不会把请求指到不存在的域名）；非 GitHub URL → 原样返回。
 */
export function applyMirrorPrefix(url: string, mirror: string): string {
  if (mirror === "" || mirror === OFFICIAL_MIRROR) return url;
  if (!isUsableMirrorValue(mirror)) return url;
  if (!isGithubUrl(url)) return url;
  return `${mirrorPrefixUrl(mirror)}${url}`;
}

// ---------------------------------------------------------------------------
// 状态（config.json github.*）
// ---------------------------------------------------------------------------

/** 测速结果快照（results 只含成功项；failed 为实测不可用主机，选优时跳过） */
export interface MirrorSpeedTest {
  results: Record<string, number>;
  failed: string[];
  /** 最近一次测速时间（ISO）；'' = 从未测速 */
  tested_at: string;
}

export interface MirrorState {
  /** 是否启用加速镜像（false = 官方源；host 保留作为下次开启的初始值） */
  enabled: boolean;
  /** 选中镜像 host；'' = 尚未选定（自动选优未完成）；'github' = 官方源语义 */
  host: string;
  /** true = 自动测速选优 + 故障自动切换；用户手动选定后置 false */
  auto: boolean;
  speedtest: MirrorSpeedTest;
}

/** configStore 读写面（测试可注入替身，避免触碰真实 config.json） */
export interface MirrorStoreLike {
  get: <T = unknown>(key: string, defaultValue?: T) => T;
  set: (key: string, value: unknown) => void;
  save: () => void;
}

export const EMPTY_SPEED_TEST: MirrorSpeedTest = { results: {}, failed: [], tested_at: "" };

/** 脏配置归一：results 只保留有限正数，failed 只保留字符串 */
export function normalizeSpeedTest(raw: unknown): MirrorSpeedTest {
  if (raw === null || typeof raw !== "object") return { ...EMPTY_SPEED_TEST };
  const source = raw as { results?: unknown; failed?: unknown; tested_at?: unknown };
  const results: Record<string, number> = {};
  if (source.results !== null && typeof source.results === "object") {
    for (const [host, value] of Object.entries(source.results as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) results[host] = value;
    }
  }
  const failed = Array.isArray(source.failed)
    ? source.failed.filter((item): item is string => typeof item === "string")
    : [];
  return {
    results,
    failed,
    tested_at: typeof source.tested_at === "string" ? source.tested_at : "",
  };
}

export function readMirrorState(store: MirrorStoreLike = getConfigStore()): MirrorState {
  const rawMirror = normalizeMirrorValue(String(store.get<string>("github.mirror", OFFICIAL_MIRROR) ?? OFFICIAL_MIRROR));
  // enabled 缺省时按旧配置语义推导：旧版选择了镜像（非 'github'）= 当时在加速
  const explicitEnabled = store.get<boolean | undefined>("github.enabled", undefined);
  return {
    enabled: typeof explicitEnabled === "boolean" ? explicitEnabled : rawMirror !== OFFICIAL_MIRROR,
    host: rawMirror,
    auto: store.get<boolean>("github.auto", true),
    speedtest: normalizeSpeedTest(store.get("github.speedtest")),
  };
}

/** 写回状态（失败只记日志；返回是否落盘成功） */
export function writeMirrorState(
  patch: Partial<MirrorState>,
  store: MirrorStoreLike = getConfigStore(),
): boolean {
  try {
    if (patch.enabled !== undefined) store.set("github.enabled", patch.enabled);
    if (patch.host !== undefined) store.set("github.mirror", patch.host);
    if (patch.auto !== undefined) store.set("github.auto", patch.auto);
    if (patch.speedtest !== undefined) store.set("github.speedtest", patch.speedtest);
    store.save();
    return true;
  } catch (error) {
    logError("mirrors.writeMirrorState", error);
    return false;
  }
}

/**
 * 当前生效的镜像 host（全应用唯一读取口）：
 * 未启用 / 未选定 / 主机名不合法 → 官方源（fail-safe，绝不把请求指到乱码域名）。
 */
export function activeMirrorHost(store: MirrorStoreLike = getConfigStore()): string {
  const state = readMirrorState(store);
  if (!state.enabled) return OFFICIAL_MIRROR;
  if (state.host === "" || state.host === OFFICIAL_MIRROR) return OFFICIAL_MIRROR;
  if (!isUsableMirrorValue(state.host)) return OFFICIAL_MIRROR;
  return state.host;
}

// ---------------------------------------------------------------------------
// 测速（ping 为主，真实请求仅用于故障取证）
// ---------------------------------------------------------------------------

/**
 * 探针目标：SillyTavern 仓库的 git 智能 HTTP 握手端点（`info/refs`）。
 * 与真实 clone/fetch/pull 的首个请求同路径同形状——仅用于**故障取证**
 * （failoverMirror 里对当前镜像发一次），批量测速一律走 ping（见下）。
 */
export const MIRROR_PROBE_TARGET =
  "https://github.com/SillyTavern/SillyTavern/info/refs?service=git-upload-pack";

export function mirrorProbeUrl(host: string): string {
  return `${mirrorPrefixUrl(host)}${MIRROR_PROBE_TARGET}`;
}

/** 单站测速超时（用户实测延迟集中在 0.5–1.1s，3s 足够容纳慢站） */
export const MIRROR_PROBE_TIMEOUT_MS = 3000;

/** 全量测速并发（54 站：并发 8 时最坏十几秒，通常数秒内出全部结果） */
export const MIRROR_TEST_CONCURRENCY = 8;

/** ping 发包数（两包取最小值，兼顾抖动与耗时） */
export const MIRROR_PING_PACKETS = 2;

/** ping 单包等待上限 */
export const MIRROR_PING_TIMEOUT_MS = 1000;

/** 批量测速用的探针：host → 延迟 ms；不可达（超时/DNS 失败/进程失败）→ null */
export type MirrorProbe = (host: string) => Promise<number | null>;

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 真实请求探针（故障取证）配置 */
export interface MirrorProbeOptions {
  /** fetch 实现（默认平台 fetch；测试注入） */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** 计时器（测试注入假时钟） */
  now?: () => number;
}

/**
 * 真实现（故障取证专用）：GitHub 家族 URL 经镜像前缀后 GET，只认 200。
 * 只在 git 网络操作已经失败后对当前镜像发一次——不用于批量测速（批量走 ping，
 * 避免为每个镜像站拉起真实代理请求浪费服务器资源）。
 */
export function createMirrorProbe(options: MirrorProbeOptions = {}): MirrorProbe {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? MIRROR_PROBE_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());
  return async (host: string): Promise<number | null> => {
    if (!isUsableMirrorValue(host)) return null;
    if (process.env.STL_NO_NETWORK === "1") return null;
    const startedAt = now();
    try {
      const response = await fetchImpl(mirrorProbeUrl(host), {
        method: "GET",
        headers: { "User-Agent": "SillyTavernLauncher/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const elapsed = now() - startedAt;
      if (response.status !== 200) return null;
      // 读取并丢弃响应体：确保计时覆盖到真实数据传输（部分代理先回头后拉源站）
      try {
        await response.arrayBuffer();
      } catch {
        // 体读取失败不改变已达成的 HTTP 200 结论（延迟仍有效）
      }
      return elapsed;
    } catch (error) {
      logError("mirrors.probe", error, host);
      return null;
    }
  };
}

/**
 * ping 输出 → 延迟 ms（取最小值，抗单包抖动；无匹配 = 不可达）。
 * 只匹配「数值 + ms」这一跨语言稳定的片段（zh "时间=23ms" / en "time=23ms" /
 * fr "temps=23 ms" 均命中），不依赖任何 UI 语言文案；`,` 小数分隔符归一为 `.`。
 */
export function parsePingLatency(output: string): number | null {
  const times: number[] = [];
  const re = /[=<>]\s*(\d+(?:[.,]\d+)?)\s*ms/gi;
  for (const match of output.matchAll(re)) {
    const value = Number((match[1] ?? "").replace(",", "."));
    if (Number.isFinite(value)) times.push(value);
  }
  if (times.length === 0) return null;
  return Math.min(...times);
}

/** 非 ASCII 主机名（IDN，如 ghf.无名氏.top）→ punycode：ping/DNS 层不接受原字面量 */
export function toAsciiHost(host: string): string {
  try {
    return new URL(`https://${host}/`).hostname;
  } catch {
    return host;
  }
}

/**
 * 默认 ping 执行：系统 ping 二包（Windows -n/-w，POSIX -c/-W；Termux 的
 * toybox ping 走 POSIX 分支）。run() 的超时硬杀兜底进程挂死的情况。
 */
async function defaultRunPing(host: string, packets: number, timeoutMs: number): Promise<string> {
  const target = toAsciiHost(host);
  const cmd =
    process.platform === "win32"
      ? ["ping", "-n", String(packets), "-w", String(timeoutMs), target]
      : ["ping", "-c", String(packets), "-W", String(Math.ceil(timeoutMs / 1000)), target];
  const result = await run(cmd, { timeoutMs: packets * (timeoutMs + 1500) + 2000 });
  // Windows 部分错误统计走 stderr；一起交给解析器
  return `${result.stdout}\n${result.stderr}`;
}

/** 默认 TCP 443 握手计时（ICMP 被屏蔽的站用它区分「主机活着」与「真不可达」） */
function defaultTcpProbe(host: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const socket = netConnect({ host: toAsciiHost(host), port: 443 });
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(Date.now() - startedAt));
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
  });
}

/** ping 探针配置 */
export interface MirrorPingOptions {
  /** 单包等待上限（默认 1000ms） */
  timeoutMs?: number;
  /** 发包数（默认 2） */
  packets?: number;
  /** 计时器（测试注入假时钟） */
  now?: () => number;
  /** ping 输出读取（默认 runtime.run 起系统 ping；测试注入假输出） */
  runPing?: (host: string, packets: number, timeoutMs: number) => Promise<string>;
  /** TCP 443 握手计时（默认 node:net；测试注入） */
  tcpProbe?: (host: string, timeoutMs: number) => Promise<number | null>;
}

/**
 * ping 探针（批量测速/选优的默认实现）：
 * ① ICMP（系统 ping，零服务端应用层负载，不消耗镜像站带宽）；
 * ② ICMP 无回复但 TCP 443 可握手 → 用 TCP 握手耗时（部分 CDN/防火墙屏蔽 ICMP，
 *    直接判死会把可用镜像误杀；TCP 通至少证明主机与端口活着）；
 * ③ 两者皆无 → 不可达。
 */
export function createMirrorPingProbe(options: MirrorPingOptions = {}): MirrorProbe {
  const timeoutMs = options.timeoutMs ?? MIRROR_PING_TIMEOUT_MS;
  const packets = options.packets ?? MIRROR_PING_PACKETS;
  const runPing = options.runPing ?? defaultRunPing;
  const tcpProbe = options.tcpProbe ?? defaultTcpProbe;
  return async (host: string): Promise<number | null> => {
    if (!isValidMirrorHost(host)) return null;
    if (process.env.STL_NO_NETWORK === "1") return null;
    try {
      const output = await runPing(host, packets, timeoutMs);
      const icmp = parsePingLatency(output);
      if (icmp !== null) return Math.round(icmp);
    } catch (error) {
      // ping 不可用（无该命令/被策略拦截）→ 落到 TCP 兜底，不因环境缺 ping 判死
      logError("mirrors.ping", error, host);
    }
    try {
      return await tcpProbe(host, timeoutMs + 1000);
    } catch (error) {
      logError("mirrors.tcpProbe", error, host);
      return null;
    }
  };
}

export interface SpeedTestOptions {
  probe: MirrorProbe;
  concurrency?: number;
  /** 每完成一站回调一次（UI 渐进展示；results/failed 为当前累计快照） */
  onResult?: (host: string, latencyMs: number | null) => void;
  now?: () => Date;
}

/** 全量测速（默认 ping 探针）：并发受限，成功项进 results、失败项进 failed；不改变选中项 */
export async function speedTestMirrors(
  hosts: readonly string[],
  options: SpeedTestOptions,
): Promise<MirrorSpeedTest> {
  const concurrency = Math.max(1, options.concurrency ?? MIRROR_TEST_CONCURRENCY);
  const results: Record<string, number> = {};
  const failed: string[] = [];
  const queue = hosts.filter((host) => isValidMirrorHost(host));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    // 显式游标取号：多 worker 共享队列（JS 单线程，取号与自增之间无 await）
    while (cursor < queue.length) {
      const host = queue[cursor];
      cursor += 1;
      let latency: number | null = null;
      try {
        latency = await options.probe(host);
      } catch (error) {
        logError("mirrors.speedTest", error, host);
        latency = null;
      }
      if (latency === null) failed.push(host);
      else results[host] = latency;
      options.onResult?.(host, latency);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return {
    results,
    failed,
    tested_at: (options.now?.() ?? new Date()).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 选优与故障切换
// ---------------------------------------------------------------------------

/** 自动选优/切换的候选批次大小（并行探测数；一批全灭才试下一批） */
export const MIRROR_CANDIDATE_BATCH = 6;

/** 自动选优最多试几批（6×3=18 站；全灭则判定无可用镜像，避免无谓打满 54 站） */
export const MIRROR_AUTO_BATCH_LIMIT = 3;

/** 从测速结果挑最快（跳过 exclude；并列时按注册表次序，保证结果稳定可测） */
export function pickFastestMirror(
  results: Record<string, number>,
  exclude: Iterable<string> = [],
): { host: string; latencyMs: number } | null {
  const excluded = new Set(exclude);
  let best: { host: string; latencyMs: number } | null = null;
  for (const source of MIRROR_SOURCES) {
    const latencyMs: number | undefined = results[source.host];
    if (latencyMs === undefined || excluded.has(source.host)) continue;
    if (best === null || latencyMs < best.latencyMs) best = { host: source.host, latencyMs };
  }
  return best;
}

/** 候选镜像（注册表顺序 = fast → medium → legacy；failed 跳过） */
export function orderedCandidates(speedtest: MirrorSpeedTest): MirrorSource[] {
  const failed = new Set(speedtest.failed);
  return MIRROR_SOURCES.filter((source) => !failed.has(source.host));
}

export interface MirrorSelectionOptions {
  /** 候选/批量探针（ping：零服务端应用层负载） */
  probe: MirrorProbe;
  /** 当前镜像的健康取证探针（默认同 probe；生产注入真实请求——ping 通不代表
   *  反代活着，取证必须打一次真实链路，仅单站单次，不构成批量负载） */
  verify?: MirrorProbe;
  store?: MirrorStoreLike;
  now?: () => Date;
  /** 候选批次大小（默认 6） */
  batchSize?: number;
  /** 最多试几批（默认 3） */
  batchLimit?: number;
}

export interface MirrorSelectionOutcome {
  /** 本次选定/维持的镜像 host（'' = 无可用镜像，调用方保持原状） */
  host: string;
  latencyMs: number | null;
  /** 选中项是否与切换前不同 */
  changed: boolean;
  /** 是否因无可用镜像而放弃（host 为空） */
  exhausted: boolean;
  message: string;
  speedtest: MirrorSpeedTest;
}

/** 逐批并行探测候选，返回首个（也是最快的一批内最快）可用镜像 */
async function probeCandidates(
  candidates: readonly MirrorSource[],
  options: MirrorSelectionOptions,
  accumulate: { results: Record<string, number>; failed: string[] },
): Promise<{ host: string; latencyMs: number } | null> {
  const batchSize = Math.max(1, options.batchSize ?? MIRROR_CANDIDATE_BATCH);
  const batchLimit = Math.max(1, options.batchLimit ?? MIRROR_AUTO_BATCH_LIMIT);
  for (let batch = 0; batch < batchLimit; batch += 1) {
    const slice = candidates.slice(batch * batchSize, (batch + 1) * batchSize);
    if (slice.length === 0) break;
    const probed = await Promise.all(
      slice.map(async (source) => {
        let latencyMs: number | null = null;
        try {
          latencyMs = await options.probe(source.host);
        } catch (error) {
          logError("mirrors.probeCandidates", error, source.host);
          latencyMs = null;
        }
        if (latencyMs === null) accumulate.failed.push(source.host);
        else accumulate.results[source.host] = latencyMs;
        return { host: source.host, latencyMs };
      }),
    );
    const fastest = pickFastestMirror(
      Object.fromEntries(
        probed
          .filter((item): item is { host: string; latencyMs: number } => item.latencyMs !== null)
          .map((item) => [item.host, item.latencyMs]),
      ),
    );
    if (fastest !== null) return fastest;
  }
  return null;
}

/**
 * 自动测速选优（"未手动选择时由启动器自动测速选一个"）：
 * 按注册表顺序逐批并行探测，取最快可用站写回配置。
 * 不可用时保持原状（exhausted=true），绝不把用户指到测不通的站。
 */
export async function autoSelectMirror(
  options: MirrorSelectionOptions,
): Promise<MirrorSelectionOutcome> {
  const store = options.store ?? getConfigStore();
  const state = readMirrorState(store);
  const now = options.now ?? (() => new Date());
  const accumulate = { results: { ...state.speedtest.results }, failed: [...state.speedtest.failed] };

  if (!state.enabled) {
    return {
      host: state.host,
      latencyMs: null,
      changed: false,
      exhausted: false,
      message: "当前使用官方源，无需自动选优",
      speedtest: state.speedtest,
    };
  }
  if (!state.auto) {
    return {
      host: state.host,
      latencyMs: null,
      changed: false,
      exhausted: false,
      message: "已手动指定镜像源，跳过自动选优",
      speedtest: state.speedtest,
    };
  }

  const candidates = orderedCandidates(state.speedtest);
  const fastest = await probeCandidates(candidates, options, accumulate);
  const speedtest: MirrorSpeedTest = {
    results: accumulate.results,
    failed: accumulate.failed,
    tested_at: now().toISOString(),
  };
  if (fastest === null) {
    // 候选全灭（多为整体断网）：清空 failed，不把镜像池锁死（与 failover 全灭路径同一原则）
    writeMirrorState({ speedtest: { results: accumulate.results, failed: [], tested_at: speedtest.tested_at } }, store);
    return {
      host: "",
      latencyMs: null,
      changed: false,
      exhausted: true,
      message: `自动测速未找到可用镜像（已试 ${accumulate.failed.length} 个），改用官方源`,
      speedtest,
    };
  }
  const changed = fastest.host !== state.host;
  writeMirrorState({ host: fastest.host, speedtest }, store);
  return {
    host: fastest.host,
    latencyMs: fastest.latencyMs,
    changed,
    exhausted: false,
    message: `自动测速选定镜像 ${fastest.host}（${fastest.latencyMs} ms）`,
    speedtest,
  };
}

/**
 * git 网络类失败的 stderr/消息特征（有文本可判的链路用它过滤，避免把
 * "目录已存在/路径非法"之类的本地失败也送进探针流程）。
 * 覆盖 git 自身的连接类报错、平台 fetch 的直连异常（ENOTFOUND/ECONNREFUSED/
 * ETIMEDOUT 等）与证书链失败。
 */
const NETWORK_FAILURE_RE =
  /could not resolve host|failed to connect|unable to access|connection (?:timed out|refused|reset)|operation timed out|timed out|network is unreachable|no route to host|early eof|rpc failed|the remote end hung up|ssl certificate problem|certificate verify|empty server response|httperror|fetch failed|socket hang up|econnrefused|econnreset|enotfound|etimedout|eproto|einval.*tls/i;

export function isNetworkFailureText(text: string): boolean {
  return NETWORK_FAILURE_RE.test(text);
}

export interface MirrorFailoverOutcome {
  switched: boolean;
  from: string;
  to: string;
  latencyMs: number | null;
  message: string;
  /** 是否遍历完候选仍无可用镜像（此时保持原镜像不动） */
  exhausted: boolean;
}

/**
 * 镜像故障切换：当前镜像导致 git 网络错误时调用。
 * 先取证再归因（红线：未验证的归因是甩锅）——探活当前镜像，仍可达说明本次失败
 * 与镜像无关（磁盘/路径/仓库自身问题），配置一律不动；
 * 确不可达才把当前镜像记入 failed、逐批探测候选并切到最快可用站。
 * 手动模式（auto=false）不自动切换，只回报原因。
 */
export async function failoverMirror(
  reason: string,
  options: MirrorSelectionOptions,
): Promise<MirrorFailoverOutcome> {
  const store = options.store ?? getConfigStore();
  const state = readMirrorState(store);
  const now = options.now ?? (() => new Date());
  const current = activeMirrorHost(store);

  if (!state.enabled || !state.auto || !isValidMirrorHost(state.host)) {
    return {
      switched: false,
      from: current,
      to: current,
      latencyMs: null,
      exhausted: false,
      message: `手动模式：${current} 失败后不自动切换（原因：${reason}）`,
    };
  }

  // 取证：当前镜像仍可达 → 本次失败不是镜像的锅，保持用户设置不动
  // （ping 只证明主机活着，代理链路是否通必须打一次真实请求——故用 verify）
  const verifyProbe = options.verify ?? options.probe;
  let currentLatency: number | null = null;
  try {
    currentLatency = await verifyProbe(state.host);
  } catch (error) {
    logError("mirrors.failoverVerify", error, state.host);
    currentLatency = null;
  }
  if (currentLatency !== null) {
    return {
      switched: false,
      from: state.host,
      to: state.host,
      latencyMs: currentLatency,
      exhausted: false,
      message: `镜像 ${state.host} 探活正常（${currentLatency} ms），本次失败与镜像无关，保持当前设置（${reason}）`,
    };
  }

  const failed = [...new Set([...state.speedtest.failed, state.host])];
  const results = { ...state.speedtest.results };
  delete results[state.host];
  const accumulate = { results, failed };
  const candidates = orderedCandidates({ results, failed, tested_at: state.speedtest.tested_at });
  const fastest = await probeCandidates(candidates, options, accumulate);
  const speedtest: MirrorSpeedTest = {
    results: accumulate.results,
    failed: accumulate.failed,
    tested_at: now().toISOString(),
  };

  if (fastest === null) {
    // 全灭：清空 failed（网络整体异常时不该把镜像池锁死），保持当前选定值
    writeMirrorState(
      { speedtest: { results: accumulate.results, failed: [], tested_at: speedtest.tested_at } },
      store,
    );
    return {
      switched: false,
      from: state.host,
      to: state.host,
      latencyMs: null,
      exhausted: true,
      message: `镜像 ${state.host} 不可用且无备用镜像可达，保持原设置（原因：${reason}）`,
    };
  }

  writeMirrorState({ host: fastest.host, speedtest }, store);
  return {
    switched: true,
    from: state.host,
    to: fastest.host,
    latencyMs: fastest.latencyMs,
    exhausted: false,
    message: `镜像 ${state.host} 不可用（${reason}），已自动切换至 ${fastest.host}（${fastest.latencyMs} ms）`,
  };
}

/**
 * 启动自愈：自动模式下若尚未选定镜像（host 为空/官方哨兵），跑一次自动选优。
 * 已选定（含自定义域名）→ 直接沿用，不因测速结果过期而换源——自动切换只发生在
 * 镜像失效时（failoverMirror 取证判死），不为边际速度收益牺牲稳定性。
 * 手动模式 / 官方源直接返回 null（无需动作）。
 */
export async function ensureMirrorSelection(
  options: MirrorSelectionOptions,
): Promise<MirrorSelectionOutcome | null> {
  const store = options.store ?? getConfigStore();
  const state = readMirrorState(store);
  if (!state.enabled || !state.auto) return null;
  if (state.host !== "" && state.host !== OFFICIAL_MIRROR) return null;
  return autoSelectMirror(options);
}

// ---------------------------------------------------------------------------
// 旧接口兼容面（gitconfig 应用 / 输入校验 / 一键自愈）
// ---------------------------------------------------------------------------

/**
 * 配置 Git 全局 insteadOf 重写（本仓库 git clone/pull/fetch 加速的唯一开关）；
 * 返回是否成功。
 */
export async function applyGitMirrorConfig(host: string, log?: (line: string) => void): Promise<boolean> {
  const say = log ?? ((line: string) => process.stdout.write(line + "\n"));
  const key = normalizeMirrorValue(host);
  await run(["git", "config", "--global", "--unset-all", "url.https://github.com/.insteadof"]);
  if (key === OFFICIAL_MIRROR) {
    say("已恢复 GitHub 官方源（移除 git 全局镜像重写）");
    return true;
  }
  const mirrorUrl = `https://${key}/https://github.com/`;
  const result = await run([
    "git", "config", "--global",
    `url.${mirrorUrl}.insteadof`, "https://github.com/",
  ]);
  if (!result.ok) {
    say(`配置Git全局镜像时出错: ${result.stderr.trim()}`);
    return false;
  }
  say(`Git全局镜像已配置: ${mirrorUrl} -> https://github.com/`);
  return true;
}

/** 把当前生效镜像写入 gitconfig（ensure/failover 之后由调用方触发） */
export async function applyActiveMirrorToGit(log?: (line: string) => void): Promise<boolean> {
  return applyGitMirrorConfig(activeMirrorHost(), log);
}

/**
 * 启动自愈 + 应用（安装/更新/取 tag 前的统一入口）：
 * 自动模式下未选定镜像时测速选优并同步 gitconfig；已选定不动——只在镜像失效时
 * 由故障切换换源。返回是否发生了选优动作。
 */
export async function ensureSmartMirrorAndApply(
  say?: (line: string) => void,
  options: Partial<MirrorSelectionOptions> = {},
): Promise<boolean> {
  const outcome = await ensureMirrorSelection({
    probe: createMirrorPingProbe(),
    ...options,
  });
  if (!outcome) return false;
  say?.(`镜像: ${outcome.message}`);
  if (outcome.host) {
    const ok = await applyActiveMirrorToGit();
    if (!ok) say?.("警告: 写入 git 全局镜像配置失败");
  }
  return true;
}

/**
 * git 网络失败后的故障切换 + 应用：reasonText 非网络特征时不动配置（本地错误
 * 不是镜像的锅）；取证确不可达才切换并同步 gitconfig。返回是否切换成功。
 */
export async function failoverOnNetworkError(
  reasonText: string,
  say?: (line: string) => void,
): Promise<boolean> {
  if (!isNetworkFailureText(reasonText)) return false;
  const outcome = await failoverMirror(reasonText.slice(0, 150), {
    probe: createMirrorPingProbe(),
    verify: createMirrorProbe(),
  });
  say?.(`镜像: ${outcome.message}`);
  if (outcome.switched) {
    const ok = await applyActiveMirrorToGit();
    if (!ok) say?.("警告: 写入 git 全局镜像配置失败");
    return true;
  }
  return false;
}

/** 校验并设置镜像（写配置 + gitconfig）；返回结果对象，展示交给调用方。 */
export function validateMirrorInput(mirror: string): { ok: true; key: string } | { ok: false; message: string } {
  const trimmed = mirror.trim();
  if (!trimmed) return { ok: false, message: "镜像源不能为空" };
  const key = normalizeMirrorValue(trimmed);
  // 官方源哨兵单独放行：isUsableMirrorValue 判的是「镜像前缀主机」（'github'
  // 不含点号、也不在注册表，必为 false）——但它是 CLI 用法与 WebUI 文档承诺的合法值
  if (key === OFFICIAL_MIRROR) return { ok: true, key };
  if (!isUsableMirrorValue(key)) {
    return { ok: false, message: `无效的镜像源: ${trimmed}（应为镜像域名或 github）` };
  }
  return { ok: true, key };
}

/**
 * 写入用户选择：'github' → 官方源（enabled=false，host 保留）；
 * 其他 host → 启用 + 手动模式（auto=false，自动切换让位于用户意志）。
 */
export function setMirrorChoice(host: string, store: MirrorStoreLike = getConfigStore()): string {
  const key = normalizeMirrorValue(host);
  if (key === OFFICIAL_MIRROR) writeMirrorState({ enabled: false, host: OFFICIAL_MIRROR }, store);
  else writeMirrorState({ enabled: true, host: key, auto: false }, store);
  return key;
}

/**
 * EULA 协议 — 在线抓取（HTML 正文抽取 + 中文日期解析）+ 本地缓存 + 本地文件回退。
 * ← src/features/agreement/fetcher.py。
 * HTML 抽取：定位 <div class="vp-doc _agreement">，块级标签转段落分隔。
 * 用正则状态机替代 Python HTMLParser（目标页面结构固定，够用且可测）。
 */
import * as fs from "node:fs";
import { agreementCachePath, agreementFilePath } from "./paths.ts";

export const AGREEMENT_URL = "https://sillytavern.lingyesoul.top/agreement";
export const LOCAL_EULA_VERSION = "2025年1月17日";

export interface AgreementData {
  date: string;
  content: string;
  fromCache: boolean;
}

/** 从文本解析中文日期"YYYY年M月D日"为 ISO 格式（优先带"版本日期"前缀）。 */
export function parseDateText(text: string): string {
  const withPrefix = text.match(/版本日期[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const match = withPrefix ?? text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

const BLOCK_TAGS = /^(p|br|h[1-6]|li|div)$/i;

/** 抽取 <div class="...vp-doc..._agreement..."> 内的文本，保留段落结构。 */
export function extractContent(html: string): string {
  const openDiv = html.match(/<div[^>]*class="[^"]*vp-doc[^"]*_agreement[^"]*"[^>]*>/i);
  if (!openDiv) return "";
  const start = openDiv.index! + openDiv[0].length;

  const parts: string[] = [];
  let lastWasBlock = false;
  const pushBlock = () => {
    if (!lastWasBlock) parts.push("\n\n");
    lastWasBlock = true;
  };

  let i = start;
  let depth = 1;
  while (i < html.length && depth > 0) {
    if (html.startsWith("</div", i)) {
      depth -= 1;
      if (depth <= 0) break;
      pushBlock();
      i = html.indexOf(">", i);
      if (i < 0) break;
      i += 1;
      continue;
    }
    if (html[i] === "<") {
      const close = html.indexOf(">", i);
      if (close < 0) break;
      const tag = html.slice(i + 1, close).trim();
      const name = tag.split(/[\s/>]/)[0] ?? "";
      if (name.toLowerCase() === "div" && !tag.startsWith("/")) {
        depth += 1;
      } else if (BLOCK_TAGS.test(name)) {
        if (name.toLowerCase() === "br") {
          parts.push("\n");
          lastWasBlock = false;
        } else {
          pushBlock();
        }
      }
      i = close + 1;
      continue;
    }
    const next = html.indexOf("<", i);
    const segment = html.slice(i, next < 0 ? html.length : next);
    const text = segment.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    if (text) {
      parts.push(text);
      lastWasBlock = false;
    }
    if (next < 0) break;
    i = next;
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

interface CacheData {
  date: string;
  content: string;
  fetched_at: string;
}

function loadCache(cachePath: string): CacheData | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const data = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as CacheData;
    if (!data || typeof data.date !== "string" || typeof data.content !== "string" || !data.fetched_at) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveCache(cachePath: string, date: string, content: string): void {
  try {
    const data: CacheData = { date, content, fetched_at: new Date().toISOString() };
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    /* 缓存失败不致命 */
  }
}

/** 读取本地 agreement.txt；不存在时返回空内容（对齐 Python 行为）。 */
export function readLocalAgreement(): string {
  try {
    return fs.readFileSync(agreementFilePath(), "utf-8");
  } catch {
    return "";
  }
}

/** 在线获取协议，失败回退缓存；两者都失败抛错。 */
export async function getAgreement(cachePath = agreementCachePath()): Promise<AgreementData> {
  if (process.env.STL_NO_NETWORK === "1") {
    const cached = loadCache(cachePath);
    if (cached) return { date: cached.date, content: cached.content, fromCache: true };
    throw new Error("无法获取协议内容且无本地缓存");
  }
  try {
    const response = await fetch(AGREEMENT_URL, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "SillyTavernLauncher/1.0" },
    });
    if (response.ok) {
      const html = await response.text();
      const date = parseDateText(html);
      const content = extractContent(html);
      if (date && content) {
        saveCache(cachePath, date, content);
        return { date, content, fromCache: false };
      }
    }
  } catch {
    /* 网络失败走缓存/本地回退 */
  }

  const cached = loadCache(cachePath);
  if (cached) return { date: cached.date, content: cached.content, fromCache: true };
  throw new Error("无法获取协议内容且无本地缓存");
}

/** EULA 门控：需要展示则返回协议内容，已同意且版本一致则返回 null。 */
export async function checkAgreementState(accepted: boolean, acceptedVersion: string): Promise<{
  required: boolean;
  date: string;
  content: string;
  source: "online" | "local";
} | null> {
  try {
    const agreement = await getAgreement();
    if (accepted && acceptedVersion === agreement.date) return null;
    return { required: true, date: agreement.date, content: agreement.content, source: "online" };
  } catch {
    process.stdout.write("提示: 无法在线获取协议，使用本地协议文件\n");
    if (accepted && acceptedVersion === LOCAL_EULA_VERSION) return null;
    return { required: true, date: LOCAL_EULA_VERSION, content: readLocalAgreement(), source: "local" };
  }
}

/**
 * 错误日志落盘 — logs/error.log，严禁静默吞噬。
 */
import * as fs from "node:fs";
import { mkdirSync } from "node:fs";
import { logsDir } from "./paths.ts";

export function logError(scope: string, error: unknown, detail?: string): void {
  const time = new Date().toISOString();
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  const line = `[${time}] [${scope}]${detail ? ` ${detail}` : ""}\n${message}\n---\n`;
  try {
    mkdirSync(logsDir(), { recursive: true });
    fs.appendFileSync(`${logsDir()}/error.log`, line, "utf-8");
  } catch {
    process.stderr.write(`[errorLog] 写入失败: ${line}`);
  }
}

/**
 * 系统浏览器打开 — 跨平台零依赖（Termux 优先）。
 * 纪律：spawn 走 runtime.run（全项目唯一出口）；命令候选按序降级，
 * 全部失败只回提示不抛错——开浏览器永远不能阻断 WEBUI 启动流程。
 */
import { run } from "./runtime.ts";

export interface OpenBrowserResult {
  ok: boolean;
  message: string;
}

/** 各平台按优先级排列的候选命令（%URL% 为占位符，注入时原样替换，不做 shell 拼接）。 */
export function openBrowserCommands(platform: NodeJS.Platform): string[][] {
  switch (platform) {
    case "win32":
      // start 后第一个空参数是窗口标题占位，防止带 & 的 URL 被截断
      return [["cmd", "/c", "start", "", "%URL%"]];
    case "darwin":
      return [["open", "%URL%"]];
    case "android":
      // Termux：termux-open-url 需 termux-tools 包，缺包时退回系统 am
      return [
        ["termux-open-url", "%URL%"],
        ["am", "start", "-a", "android.intent.action.VIEW", "-d", "%URL%"],
      ];
    default:
      return [["xdg-open", "%URL%"]];
  }
}

export async function openBrowser(
  url: string,
  opts: { platform?: NodeJS.Platform; runner?: (cmd: string[]) => Promise<{ ok: boolean }> } = {},
): Promise<OpenBrowserResult> {
  const platform = opts.platform ?? process.platform;
  const runner = opts.runner ?? ((cmd) => run(cmd, { timeoutMs: 10_000 }));
  for (const template of openBrowserCommands(platform)) {
    const result = await runner(template.map((part) => (part === "%URL%" ? url : part)));
    if (result.ok) return { ok: true, message: "已请求系统打开浏览器" };
  }
  return { ok: false, message: `未能自动打开浏览器，请手动访问 ${url}` };
}

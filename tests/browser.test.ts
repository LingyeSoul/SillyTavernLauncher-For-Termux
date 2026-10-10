/** 浏览器自动打开测试 — 平台命令映射（纯函数）+ 候选降级与 URL 注入（注入 runner，不真开浏览器）。 */
import { describe, expect, it } from "vitest";
import { openBrowser, openBrowserCommands } from "../src/services/browser.ts";

describe("openBrowserCommands", () => {
  it("win32 用 cmd start 且带标题占位", () => {
    expect(openBrowserCommands("win32")).toEqual([["cmd", "/c", "start", "", "%URL%"]]);
  });

  it("darwin 用 open", () => {
    expect(openBrowserCommands("darwin")).toEqual([["open", "%URL%"]]);
  });

  it("android 优先 termux-open-url，缺 termux-tools 时退回系统 am", () => {
    expect(openBrowserCommands("android")).toEqual([
      ["termux-open-url", "%URL%"],
      ["am", "start", "-a", "android.intent.action.VIEW", "-d", "%URL%"],
    ]);
  });

  it("其余平台（linux 等）用 xdg-open", () => {
    expect(openBrowserCommands("linux")).toEqual([["xdg-open", "%URL%"]]);
  });
});

describe("openBrowser", () => {
  it("URL 注入占位符，首个候选成功即返回", async () => {
    const seen: string[][] = [];
    const result = await openBrowser("http://127.0.0.1:8300", {
      platform: "darwin",
      runner: async (cmd) => {
        seen.push(cmd);
        return { ok: true };
      },
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([["open", "http://127.0.0.1:8300"]]);
  });

  it("首个候选失败时降级到下一个（termux-open-url 缺包 → am）", async () => {
    const seen: string[][] = [];
    const result = await openBrowser("http://127.0.0.1:8300", {
      platform: "android",
      runner: async (cmd) => {
        seen.push(cmd);
        return { ok: cmd[0] === "termux-open-url" ? false : true };
      },
    });
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(["am", "start", "-a", "android.intent.action.VIEW", "-d", "http://127.0.0.1:8300"]);
  });

  it("全部候选失败时返回手动访问提示（不抛错）", async () => {
    const result = await openBrowser("http://127.0.0.1:8300/?token=abc", {
      platform: "linux",
      runner: async () => ({ ok: false }),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("http://127.0.0.1:8300/?token=abc");
  });

  it("带 & 的 token URL 作为数组参数原样传递，不做 shell 拼接", async () => {
    const url = "http://192.168.1.10:8300/?token=a&b=c";
    let received: string[] = [];
    await openBrowser(url, {
      platform: "win32",
      runner: async (cmd) => {
        received = cmd;
        return { ok: true };
      },
    });
    expect(received).toEqual(["cmd", "/c", "start", "", url]);
  });
});

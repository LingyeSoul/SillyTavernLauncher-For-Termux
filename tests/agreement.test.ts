/** 协议解析测试 — 中文日期 + HTML 正文抽取。 */
import { describe, expect, it } from "vitest";
import { extractContent, parseDateText } from "../src/services/agreement.ts";

describe("parseDateText", () => {
  it("优先匹配带版本日期前缀的日期", () => {
    expect(parseDateText("版本日期：2026年4月23日")).toBe("2026-04-23");
    expect(parseDateText("版本日期: 2025年1月17日")).toBe("2025-01-17");
  });
  it("回退匹配裸中文日期", () => {
    expect(parseDateText("更新于 2026年12月1日 生效")).toBe("2026-12-01");
  });
  it("无日期返回空串", () => {
    expect(parseDateText("no date here")).toBe("");
  });
});

describe("extractContent", () => {
  const html = `
<html><body>
<div class="vp-doc _agreement">
  <h1>用户协议</h1>
  <p>第一条 内容。</p>
  <ul><li>条款 A</li><li>条款 B</li></ul>
</div>
<div class="vp-doc other"><p>不应被抓取</p></div>
</body></html>`;

  it("只抽取 _agreement 容器内文本并保留段落", () => {
    const content = extractContent(html);
    expect(content).toContain("用户协议");
    expect(content).toContain("第一条 内容。");
    expect(content).toContain("条款 A");
    expect(content).not.toContain("不应被抓取");
    expect(content).toMatch(/\n\n/);
  });

  it("目标容器不存在时返回空串", () => {
    expect(extractContent("<div class='other'>x</div>")).toBe("");
  });
});

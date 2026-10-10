/** 配置存储测试 — 默认值合并 / 点路径 / 原子写 / 令牌生成与轮换。 */
import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { ConfigStore } from "../src/services/configStore.ts";
import { useTempBaseDir } from "./helpers.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function newStore(): { store: ConfigStore; configPath: string } {
  const dir = useTempBaseDir();
  dirs.push(dir);
  const configPath = `${dir}/config.json`;
  return { store: new ConfigStore(configPath), configPath };
}

describe("ConfigStore", () => {
  it("首次创建生成默认配置并自动生成同步令牌", () => {
    const { store } = newStore();
    expect(store.get("github.mirror")).toBe("github");
    expect(store.get<boolean>("agreement_accepted")).toBe(false);
    const token = store.get<string>("sync.token", "");
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("点路径 get/set 与嵌套创建", () => {
    const { store } = newStore();
    store.set("sync.port", 1234);
    store.set("custom.deep.key", "value");
    store.save();
    expect(store.get("sync.port")).toBe(1234);
    expect(store.get("custom.deep.key")).toBe("value");
    expect(store.get("sync.missing", "fallback")).toBe("fallback");
  });

  it("旧配置缺失新键时递归补齐且不覆盖用户设置", () => {
    const dir = useTempBaseDir();
    dirs.push(dir);
    const configPath = `${dir}/config.json`;
    fs.writeFileSync(
      configPath,
      JSON.stringify({ github: { mirror: "ghproxy" }, autostart: true }),
      "utf-8",
    );
    const store = new ConfigStore(configPath);
    expect(store.get("github.mirror")).toBe("ghproxy"); // 用户设置保留
    expect(store.get<boolean>("autostart")).toBe(true);
    expect(store.get("sync.port")).toBe(9999); // 默认值补齐
    expect(store.get<string>("webui.port", "")).not.toBe(""); // 新增 webui 默认
  });

  it("令牌轮换：新令牌不同且持久化", () => {
    const { store, configPath } = newStore();
    const original = store.currentSyncToken();
    const rotated = store.rotateSyncToken();
    const reloaded = new ConfigStore(configPath);
    expect(original.length).toBeGreaterThanOrEqual(32);
    expect(rotated).not.toBe(original);
    expect(reloaded.currentSyncToken()).toBe(rotated);
    if (process.platform !== "win32") {
      expect(fs.statSync(configPath).mode & 0o077).toBe(0);
    }
  });

  it("损坏的配置回退默认值", () => {
    const dir = useTempBaseDir();
    dirs.push(dir);
    const configPath = `${dir}/config.json`;
    fs.writeFileSync(configPath, "{invalid json", "utf-8");
    const store = new ConfigStore(configPath);
    expect(store.get("github.mirror")).toBe("github");
  });
});

/**
 * CLI 入口 — `st [command]`。← main_cli.py main() + show_menu 的精简版。
 * 交互菜单保留全部 13 项能力 + WEBUI 快捷入口；rich 交互请用 `st webui`。
 */
import readline from "node:readline/promises";
import process from "node:process";
import { LAUNCHER_VERSION } from "./version.ts";
import { getBaseDir } from "./services/paths.ts";
import { getConfigStore } from "./services/configStore.ts";
import { checkSystemEnv, isStInstalled, startForeground, installSillytavern, updateSillytavern, fixNodeModules } from "./services/stLifecycle.ts";
import { checkAgreementState, LOCAL_EULA_VERSION } from "./services/agreement.ts";
import {
  MIRROR_SOURCES,
  activeMirrorHost,
  applyGitMirrorConfig,
  autoSelectMirror,
  createMirrorPingProbe,
  mirrorDisplayName,
  readMirrorState,
  setMirrorChoice,
  speedTestMirrors,
  validateMirrorInput,
  writeMirrorState,
} from "./services/mirrors.ts";
import { getSyncManager } from "./services/sync/manager.ts";
import { redactShareUrl } from "./services/sync/common.ts";
import { getVersionInfo, listVersions, switchVersion, updateRemoteTags } from "./services/versionManager.ts";
import { StConfig } from "./services/stConfig.ts";
import { checkForUpdates } from "./services/updater.ts";
import { scanForInstallations, migrateInstallation, type MigrateMode } from "./services/migrator.ts";
import { startWebui } from "./webui/server.ts";
import { openBrowser } from "./services/browser.ts";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function ask(prompt: string): Promise<string> {
  return (await rl.question(prompt)).trim();
}

async function confirm(prompt: string, defaultYes = false): Promise<boolean> {
  const answer = await ask(`${prompt} (${defaultYes ? "Y/n" : "y/N"}): `);
  if (!answer) return defaultYes;
  return answer[0].toUpperCase() === "Y";
}

// ---------- EULA ----------

async function eulaGate(): Promise<boolean> {
  const store = getConfigStore();
  const state = await checkAgreementState(
    store.get<boolean>("agreement_accepted", false),
    store.get<string>("agreement_version", ""),
  );
  if (!state) return true;

  process.stdout.write("\n" + "=".repeat(70) + "\n");
  process.stdout.write(" ".repeat(15) + "SillyTavernLauncher 用户协议\n");
  process.stdout.write("=".repeat(70) + "\n\n");
  if (state.content) process.stdout.write(state.content + "\n\n");
  process.stdout.write("请仔细阅读以上协议内容。\n\n");

  const answer = await ask("输入 Y 同意协议：");
  if (!answer || answer[0].toUpperCase() !== "Y") {
    process.stdout.write("\n您未同意协议。启动器将退出。\n");
    return false;
  }
  const savedVersion = state.date || LOCAL_EULA_VERSION;
  store.set("agreement_version", savedVersion);
  store.set("agreement_accepted", true);
  const history = store.get<unknown[]>("agreement_history", []);
  history.push({ action: "agreement_accepted", timestamp: new Date().toISOString(), version: savedVersion, source: state.source });
  store.set("agreement_history", history);
  store.save();
  process.stdout.write("\n✓ 感谢您同意协议。现在可以使用启动器了。\n\n");
  return true;
}

// ---------- 交互菜单 ----------

async function showMenu(): Promise<void> {
  const store = getConfigStore();
  for (;;) {
    const state = readMirrorState(store);
    const modeText = !state.enabled
      ? "官方源"
      : state.auto
        ? `智能自动（${mirrorDisplayName(activeMirrorHost(store))}）`
        : `手动指定（${mirrorDisplayName(state.host)}）`;
    process.stdout.write("\n" + "=".repeat(50) + `\nSillyTavernLauncher 菜单 v${LAUNCHER_VERSION}\n` + "=".repeat(50) + "\n");
    process.stdout.write(`安装状态: ${isStInstalled() ? "已安装" : "未安装"} | 镜像: ${modeText}\n\n`);
    process.stdout.write("1. 安装 SillyTavern\n");
    process.stdout.write("2. 启动 SillyTavern\n");
    process.stdout.write("3. 显示配置\n");
    process.stdout.write("4. st 命令行为 → 一键启动酒馆\n");
    process.stdout.write("5. st 命令行为 → 显示菜单\n");
    process.stdout.write("6. 更新 SillyTavern\n");
    process.stdout.write("7. 更新启动器\n");
    process.stdout.write("8. 设置 GitHub 镜像\n");
    process.stdout.write("9. 数据同步\n");
    process.stdout.write("10. 版本管理\n");
    process.stdout.write("11. SillyTavern 配置\n");
    process.stdout.write("12. 迁移其他 SillyTavern 安装\n");
    process.stdout.write("13. 一键修复 (清理依赖)\n");
    process.stdout.write("14. 启动 WebUI\n");
    process.stdout.write("0. 退出\n");
    process.stdout.write("=".repeat(50) + "\n");

    const choice = await ask("请选择操作 [0-14]: ");
    try {
      if (choice === "0") {
        process.stdout.write("感谢使用 SillyTavernLauncher!\n");
        return;
      }
      if (choice === "1") {
        if (isStInstalled() && !(await confirm("SillyTavern 目录已存在，重新安装？"))) continue;
        await confirmInstall(true);
      } else if (choice === "2") {
        await runStart();
      } else if (choice === "3") {
        process.stdout.write(JSON.stringify(store.snapshot(), null, 2) + "\n");
        const cfg = new StConfig();
        process.stdout.write(`ST 端口: ${cfg.state.port} | 监听: ${cfg.state.listen ? "所有地址" : "本机"}\n`);
      } else if (choice === "4") {
        store.set("startup", "st");
        store.save();
        process.stdout.write("已设置: 输入 st 将直接启动 SillyTavern\n");
      } else if (choice === "5") {
        store.set("startup", "menu");
        store.save();
        process.stdout.write("已设置: 输入 st 将显示菜单\n");
      } else if (choice === "6") {
        const result = await updateSillytavern();
        process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
      } else if (choice === "7") {
        await updateLauncher();
      } else if (choice === "8") {
        await mirrorMenu();
      } else if (choice === "9") {
        await syncMenu();
      } else if (choice === "10") {
        await versionMenu();
      } else if (choice === "11") {
        await stConfigMenu();
      } else if (choice === "12") {
        await migrateMenu();
      } else if (choice === "13") {
        const result = await fixNodeModules();
        process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
      } else if (choice === "14") {
        const { url, close } = await startWebui();
        process.stdout.write(`WEBUI 已启动: ${url}\n按 Ctrl+C 停止 WebUI 并返回...\n`);
        await new Promise(() => {});
        void close;
      } else {
        process.stdout.write("无效选择\n");
      }
    } catch (error) {
      process.stdout.write(`发生错误: ${String(error)}\n`);
    }
  }
}

async function confirmInstall(interactive: boolean): Promise<void> {
  if (interactive) {
    process.stdout.write("\n您即将下载第三方开源软件 SillyTavern。该软件可能支持 AI 角色扮演、\n情感互动等功能，使用这些功能需遵守相关管理规定。本启动器不建议未满\n18周岁用户独立使用。未满14周岁用户须在监护人明确知情并同意的前提下使用。\n");
    if (!(await confirm("我已确认本人已年满18周岁，或已取得监护人同意"))) {
      process.stdout.write("取消安装\n");
      return;
    }
  }
  const result = await installSillytavern({ confirm18: true });
  process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
}

async function runStart(): Promise<void> {
  if (!isStInstalled()) {
    if (await confirm("SillyTavern 未找到，是否立即安装？", true)) {
      await confirmInstall(true);
    }
    if (!isStInstalled()) {
      process.stdout.write("取消启动\n");
      return;
    }
  }
  rl.close();
  const code = await startForeground();
  process.exit(code);
}

async function updateLauncher(): Promise<void> {
  const result = await checkForUpdates();
  if (result.has_error) {
    process.stdout.write(`检查更新失败: ${result.error_message}\n`);
    return;
  }
  if (!result.has_update) {
    process.stdout.write(`✅ 当前已是最新版本: v${result.current_version}\n`);
    return;
  }
  const devMark = result.is_dev_version ? " [开发版]" : "";
  process.stdout.write(`发现新版本: v${result.current_version} -> v${result.latest_version}${devMark}\n`);
  if (!(await confirm("确认更新并重启启动器？"))) return;

  const { runWithEcho } = await import("./services/runtime.ts");
  const ok = await runWithEcho(["git", "pull"], { cwd: getBaseDir() });
  if (!ok) {
    process.stdout.write("更新代码失败\n");
    return;
  }
  await runWithEcho(["npm", "install", "--no-audit", "--no-fund"], { cwd: getBaseDir() });
  process.stdout.write("SillyTavernLauncher 更新完成! 请重新运行 st\n");
}

/** 镜像菜单 — 智能镜像体系（官方源 / 智能自动 / 测速 / 手动选择）。 */
async function mirrorMenu(): Promise<void> {
  const store = getConfigStore();
  const state = readMirrorState(store);
  const active = activeMirrorHost(store);
  const modeText = !state.enabled ? "官方源" : state.auto ? "智能自动（测速选优 + 故障切换）" : "手动指定";
  const testedAt = state.speedtest.tested_at
    ? `，上次测速 ${state.speedtest.tested_at.slice(0, 16).replace("T", " ")}`
    : "";
  process.stdout.write(`\nGitHub 镜像设置（当前: ${mirrorDisplayName(active)} | 模式: ${modeText}${testedAt}）:\n`);
  process.stdout.write("1. 使用官方源（关闭加速）\n");
  process.stdout.write("2. 开启智能镜像（自动测速选优 + 网络故障自动切换）\n");
  process.stdout.write("3. 立即测速选优\n");
  process.stdout.write("4. 全量测速（仅测速，不切换）\n");
  process.stdout.write("5. 从推荐列表手动选择\n");
  process.stdout.write("6. 输入自定义镜像域名\n");
  process.stdout.write("0. 返回上级菜单\n");
  const choice = await ask("请选择 [0-6]: ");
  try {
    if (choice === "0") return;
    if (choice === "1") {
      setMirrorChoice("github");
      await applyGitMirrorConfig("github");
      process.stdout.write("✓ 已切换为 GitHub 官方源\n");
    } else if (choice === "2") {
      writeMirrorState({ enabled: true, auto: true }, store);
      await applyGitMirrorConfig(activeMirrorHost(store));
      process.stdout.write("✓ 智能镜像已开启：未选定镜像时自动测速选优，仅在镜像失效时自动切换\n");
    } else if (choice === "3") {
      if (!readMirrorState(store).enabled) {
        process.stdout.write("当前为官方源，先选择 2 开启智能镜像\n");
        return;
      }
      writeMirrorState({ enabled: true, auto: true }, store);
      process.stdout.write("正在测速选优...\n");
      const outcome = await autoSelectMirror({ probe: createMirrorPingProbe() });
      process.stdout.write(`${outcome.exhausted ? "✗" : "✓"} ${outcome.message}\n`);
      if (outcome.host) await applyGitMirrorConfig(outcome.host);
    } else if (choice === "4") {
      process.stdout.write(`正在全量测速（${MIRROR_SOURCES.length} 个镜像站，ping 探测）...\n`);
      const speedtest = await speedTestMirrors(
        MIRROR_SOURCES.map((source) => source.host),
        {
          probe: createMirrorPingProbe(),
          onResult: (host, latency) =>
            process.stdout.write(`  ${host}: ${latency === null ? "不可达" : `${latency}ms`}\n`),
        },
      );
      writeMirrorState({ speedtest }, store);
      const ok = Object.keys(speedtest.results).length;
      process.stdout.write(`✓ 测速完成：${ok} 个可用 / ${speedtest.failed.length} 个不可达\n`);
    } else if (choice === "5") {
      // 推荐列表：实测延迟优先，其次注册表报告值，取前 12
      const state2 = readMirrorState(store);
      const ranked = [...MIRROR_SOURCES]
        .sort((a, b) => {
          const la = state2.speedtest.results[a.host];
          const lb = state2.speedtest.results[b.host];
          return (la ?? a.reportedMs ?? 9_999) - (lb ?? b.reportedMs ?? 9_999);
        })
        .slice(0, 12);
      ranked.forEach((source, i) => {
        const measured = state2.speedtest.results[source.host];
        const latencyText = measured !== undefined ? `${measured}ms` : source.reportedMs !== undefined ? `~${source.reportedMs}ms` : "";
        const mark = source.host === active ? " ← 当前" : "";
        process.stdout.write(`${i + 1}. ${source.host} ${latencyText}${mark}\n`);
      });
      const pick = await ask(`请选择 [1-${ranked.length}, 0取消]: `);
      const index = Number(pick) - 1;
      if (!(index >= 0 && index < ranked.length)) return;
      const host = ranked[index].host;
      setMirrorChoice(host, store);
      await applyGitMirrorConfig(host);
      process.stdout.write(`✓ GitHub 镜像已设置为: ${host}（手动模式）\n`);
    } else if (choice === "6") {
      const input = await ask("请输入镜像域名（如 gh.example.com）: ");
      const validated = validateMirrorInput(input);
      if (!validated.ok) {
        process.stdout.write(`✗ ${validated.message}\n`);
        return;
      }
      setMirrorChoice(validated.key, store);
      await applyGitMirrorConfig(validated.key);
      process.stdout.write(`✓ GitHub 镜像已设置为: ${validated.key}（手动模式）\n`);
    } else {
      process.stdout.write("无效选择\n");
    }
  } catch (error) {
    process.stdout.write(`发生错误: ${String(error)}\n`);
  }
}

async function syncMenu(): Promise<void> {
  const manager = getSyncManager();
  for (;;) {
    const status = await manager.status();
    const stateText = status.running ? "✓ 运行中" : "✗ 已停止";
    process.stdout.write("\n" + "=".repeat(50) + `\n数据同步菜单 (${stateText}${status.consistent ? "" : " ⚠ 状态不一致"})\n` + "=".repeat(50) + "\n");
    if (status.running) {
      process.stdout.write(`分享地址: ${status.shareUrl}\n`);
      process.stdout.write(`本机分享地址: ${status.localShareUrl}\n`);
    }
    process.stdout.write("\n1. 启动同步服务器\n2. 停止同步服务器\n3. 从服务器同步数据\n4. 轮换同步令牌\n5. 保存的服务器\n0. 返回主菜单\n");
    const choice = await ask("请选择 [0-5]: ");
    if (choice === "0") return;
    try {
      if (choice === "1") {
        const portInput = await ask(`端口 (当前: ${status.port}): `);
        const port = portInput ? Number(portInput) : undefined;
        if (port !== undefined && !(port >= 1 && port <= 65535)) {
          process.stdout.write("端口号必须在 1-65535 范围内\n");
          continue;
        }
        const result = await manager.start(port);
        process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
      } else if (choice === "2") {
        const result = await manager.stop();
        process.stdout.write(`${result.message}\n`);
      } else if (choice === "3") {
        const serverUrl = await ask("请输入分享地址 (例如: http://192.168.1.100:9999#token=...): ");
        if (!serverUrl) continue;
        process.stdout.write(`连接到服务器: ${redactShareUrl(serverUrl.startsWith("http") ? serverUrl : `http://${serverUrl}`)}\n`);
        const methodInput = await ask("同步方法 [1-自动 2-ZIP全量 3-增量]: ");
        const method = methodInput === "2" ? "zip" : methodInput === "3" ? "incremental" : "auto";
        const backup = await confirm("是否备份现有数据？", true);
        const result = await manager.syncFrom(serverUrl, method, backup);
        process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
      } else if (choice === "4") {
        if (await confirm("轮换后旧分享地址会立即失效，确认继续？")) {
          const result = await manager.rotateToken();
          process.stdout.write(`新分享地址: ${result.shareUrl}\n`);
        }
      } else if (choice === "5") {
        const saved = manager.savedServers();
        if (!saved.urls.length) {
          process.stdout.write("暂无已保存的服务器\n");
          continue;
        }
        saved.redacted.forEach((url, i) => process.stdout.write(`${i + 1}. ${url}\n`));
        const action = await ask("[1-连接并同步 2-测试 3-删除 0-返回]: ");
        const index = Number(action.split(" ")[0]) - 1;
        if (!(index >= 0 && index < saved.urls.length)) continue;
        const target = saved.urls[index];
        if (action.startsWith("1")) {
          const result = await manager.syncFrom(target);
          process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
        } else if (action.startsWith("2")) {
          const result = await manager.testConnection(target);
          process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
        } else if (action.startsWith("3")) {
          manager.removeSavedServer(target);
          process.stdout.write("已删除\n");
        }
      }
    } catch (error) {
      process.stdout.write(`发生错误: ${String(error)}\n`);
    }
  }
}

async function versionMenu(): Promise<void> {
  for (;;) {
    const current = await getVersionInfo();
    process.stdout.write("\n" + "=".repeat(50) + `\n版本管理 (当前: ${current.version ?? "未知"})\n` + "=".repeat(50) + "\n");
    process.stdout.write("1. 查看当前版本信息\n2. 列出可用版本\n3. 切换版本\n4. 更新版本标签\n0. 返回主菜单\n");
    const choice = await ask("请选择 [0-4]: ");
    if (choice === "0") return;
    if (choice === "1") {
      process.stdout.write(JSON.stringify(current, null, 2) + "\n");
    } else if (choice === "2") {
      const list = await listVersions(20);
      if (!list.success) {
        process.stdout.write(`获取版本列表失败: ${list.error}\n`);
        continue;
      }
      for (const item of list.items) {
        process.stdout.write(`v${item.version}${item.isLatest ? " [最新]" : ""} - ${item.commit.slice(0, 7)} (${item.date.slice(0, 10)})\n`);
      }
    } else if (choice === "3") {
      const version = await ask("请输入版本号 (例如 1.5.0，留空取消): ");
      if (!version) continue;
      if (!(await confirm("确认切换? 版本切换后需要重新安装依赖"))) continue;
      const result = await switchVersion({ version }, { installDeps: true, force: true });
      process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
    } else if (choice === "4") {
      const result = await updateRemoteTags();
      process.stdout.write(`${result.success ? "✓" : "✗"} ${result.message}\n`);
    }
  }
}

async function stConfigMenu(): Promise<void> {
  const config = new StConfig();
  for (;;) {
    process.stdout.write("\n" + "=".repeat(50) + "\nSillyTavern 配置管理\n" + "=".repeat(50) + "\n");
    process.stdout.write(`端口: ${config.state.port} | 局域网监听: ${config.state.listen ? "启用" : "禁用"}\n`);
    process.stdout.write(`IP 白名单: ${config.state.whitelistMode ? "启用" : "禁用"} (${config.state.whitelistIps.join(", ")})\n`);
    process.stdout.write("\n1. 修改端口\n2. 切换局域网监听\n3. 自动添加当前网段到白名单\n4. 编辑 IP 白名单\n5. 统一白名单同步开关\n0. 返回主菜单\n");
    const choice = await ask("请选择 [0-5]: ");
    if (choice === "0") return;
    if (choice === "1") {
      const port = Number(await ask(`新端口 (当前: ${config.state.port}): `));
      if (port >= 1 && port <= 65535) {
        config.state.port = port;
        config.save();
        process.stdout.write(`✓ 端口已设置为 ${port}（重启 ST 后生效）\n`);
      } else {
        process.stdout.write("✗ 端口号必须在 1-65535 范围内\n");
      }
    } else if (choice === "2") {
      config.state.listen = !config.state.listen;
      config.save();
      process.stdout.write(`✓ 局域网监听已${config.state.listen ? "启用" : "禁用"}（重启 ST 后生效）\n`);
      if (config.state.listen && (await confirm("自动检测网段并添加到 IP 白名单？", true))) {
        await config.createWhitelist();
      }
    } else if (choice === "3") {
      await config.createWhitelist();
      process.stdout.write(`当前白名单: ${config.state.whitelistIps.join(", ")}\n`);
    } else if (choice === "4") {
      process.stdout.write("输入新白名单（格式: 逗号分隔，支持 192.168.1.*, ::1, 10.0.0.1）\n");
      const raw = await ask("> ");
      const ips = raw.split(/[，,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (ips.length) {
        config.state.whitelistIps = ips;
        config.save();
        process.stdout.write(`✓ IP 白名单已更新，共 ${ips.length} 条\n`);
      }
    } else if (choice === "5") {
      config.state.unifiedWhitelist = !config.state.unifiedWhitelist;
      if (config.state.unifiedWhitelist) config.syncWhitelists("ip");
      config.save();
      process.stdout.write(`✓ 统一白名单同步已${config.state.unifiedWhitelist ? "启用" : "禁用"}\n`);
    }
  }
}

async function migrateMenu(): Promise<void> {
  process.stdout.write("正在扫描其他 SillyTavern 安装...\n");
  const installations = await scanForInstallations();
  if (!installations.length) {
    process.stdout.write("未找到其他 SillyTavern 安装\n");
    return;
  }
  installations.forEach((install, i) => {
    process.stdout.write(`\n[${i + 1}] ${install.path}\n    v${install.version} | ${(install.size / 1024 / 1024).toFixed(1)} MB | ${install.hasGit ? "Git 仓库" : "手动安装"}\n`);
  });
  const choice = await ask(`选择要迁移的安装 [1-${installations.length}, 0取消]: `);
  const index = Number(choice) - 1;
  if (!(index >= 0 && index < installations.length)) {
    process.stdout.write("取消迁移\n");
    return;
  }
  const source = installations[index];
  process.stdout.write("迁移模式: 1-移动整个安装(推荐) 2-只复制数据 3-只复制配置 4-复制全部\n");
  const modeInput = await ask("请选择 [1-4]: ");
  const modeMap: Record<string, MigrateMode> = { "1": "move", "2": "copy_data", "3": "copy_config", "4": "copy_all" };
  const mode = modeMap[modeInput];
  if (!mode) {
    process.stdout.write("无效选择\n");
    return;
  }
  if (mode === "move") process.stdout.write("⚠️ 移动操作将从源位置删除文件\n");
  if (!(await confirm(`确认从 ${source.path} 迁移？`))) {
    process.stdout.write("取消迁移\n");
    return;
  }
  const result = await migrateInstallation({ sourcePath: source.path, mode, backup: true });
  process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
}

// ---------- 命令分发 ----------

function usage(): void {
  process.stdout.write(`SillyTavernLauncher for Termux v${LAUNCHER_VERSION}

用法: st [命令]

命令:
  (无命令)        按 startup 行为执行（默认进入菜单）
  install         安装 SillyTavern
  start|launch    启动 SillyTavern（前台）
  menu            进入交互菜单
  webui           启动 WebUI 管理界面（[--port N] [--no-open]，默认自动打开浏览器）
  config          显示配置
  startup <menu|st|webui>
                  输入 st 无参数时的行为（menu=菜单, st=一键启动酒馆, webui=一键启动 WebUI）
  autostart <enable|disable>
                  兼容旧命令：enable=startup st, disable=startup menu
  update <st|stl> 更新 SillyTavern / 启动器
  set-mirror <github|auto|域名>
                  github=官方源, auto=智能测速选优+故障切换, 其他=手动指定镜像
  sync <start|stop|info|rotate-token|from|menu> [--port N] [--server-url URL]
  version <info|list|switch> [--commit H | --version-str V]
  st-config <port|listen> [--st-port N] [--enable-listen | --disable-listen]
  migrate <scan|from> [--source-path P] [--mode M]
`);
}

/** WebUI 前台运行（startup=webui 与 st webui 共用）。 */
async function runWebuiForeground(port?: number, open = true): Promise<number> {
  const { url } = await startWebui({ port });
  process.stdout.write(`WEBUI 已启动: ${url}\n`);
  if (open) {
    const opened = await openBrowser(url);
    process.stdout.write(`${opened.ok ? "✓" : "✗"} ${opened.message}\n`);
  }
  process.stdout.write("按 Ctrl+C 停止。\n");
  await new Promise(() => {});
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const store = getConfigStore();

  const findFlag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
  };
  const hasFlag = (name: string): boolean => args.includes(name);

  if (!(await eulaGate())) return 0;

  const env = checkSystemEnv();
  if (!env.ok) {
    process.stdout.write(`错误: 缺少依赖命令: ${env.missing.join(", ")}\n`);
    return 1;
  }

  const command = args[0] && !args[0].startsWith("--") ? args[0] : "";

  // 无命令：按 startup 行为执行（st=直启酒馆，webui=直启 WebUI，默认菜单）
  if (!command) {
    const startup = store.get<string>("startup", "menu");
    if (startup === "st") {
      return await startForeground();
    }
    if (startup === "webui") {
      return await runWebuiForeground(
        findFlag("--port") ? Number(findFlag("--port")) : undefined,
        !hasFlag("--no-open"),
      );
    }
    await showMenu();
    return 0;
  }

  switch (command) {
    case "install":
      await confirmInstall(true);
      return 0;
    case "start":
    case "launch":
      return await startForeground();
    case "menu":
      await showMenu();
      return 0;
    case "webui":
      return await runWebuiForeground(
        findFlag("--port") ? Number(findFlag("--port")) : undefined,
        !hasFlag("--no-open"),
      );
    case "config":
      process.stdout.write(JSON.stringify(store.snapshot(), null, 2) + "\n");
      return 0;
    case "startup": {
      const sub = args[args.indexOf(command) + 1];
      if (sub === "menu" || sub === "st" || sub === "webui") {
        store.set("startup", sub);
        store.save();
        const labels = { menu: "显示菜单", st: "一键启动酒馆", webui: "一键启动 WebUI" } as const;
        process.stdout.write(`已设置 st 命令行为: ${labels[sub]}\n`);
        return 0;
      }
      process.stdout.write("请指定 menu | st | webui\n");
      return 1;
    }
    case "autostart": {
      const sub = args[args.indexOf(command) + 1];
      if (sub === "enable" || sub === "disable") {
        store.set("startup", sub === "enable" ? "st" : "menu");
        store.save();
        process.stdout.write(sub === "enable" ? "已启用一键启动功能（startup=st）\n" : "已禁用一键启动功能（startup=menu）\n");
        return 0;
      }
      process.stdout.write("请指定 enable 或 disable\n");
      return 1;
    }
    case "update": {
      const sub = args[args.indexOf(command) + 1];
      if (sub === "st" || !sub) {
        const result = await updateSillytavern();
        process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
        return result.ok ? 0 : 1;
      }
      if (sub === "stl" || sub === "dev") {
        await updateLauncher();
        return 0;
      }
      process.stdout.write("支持: st | stl | dev\n");
      return 1;
    }
    case "set-mirror": {
      const mirror = findFlag("--mirror") ?? args[args.indexOf(command) + 1];
      if (!mirror || mirror.startsWith("--")) {
        process.stdout.write("用法: st set-mirror <github|auto|镜像域名>\n");
        return 1;
      }
      if (mirror.toLowerCase() === "auto") {
        // 智能模式：自动测速选优 + 网络故障自动切换
        writeMirrorState({ enabled: true, auto: true }, store);
        process.stdout.write("正在测速选优...\n");
        const outcome = await autoSelectMirror({ probe: createMirrorPingProbe() });
        process.stdout.write(`${outcome.exhausted ? "✗" : "✓"} ${outcome.message}\n`);
        if (outcome.host) await applyGitMirrorConfig(outcome.host);
        return outcome.exhausted ? 1 : 0;
      }
      const validated = validateMirrorInput(mirror);
      if (!validated.ok) {
        process.stdout.write(`✗ ${validated.message}\n`);
        return 1;
      }
      const key = setMirrorChoice(validated.key, store);
      await applyGitMirrorConfig(key);
      process.stdout.write(`✓ GitHub 镜像已设置为: ${key}${key === "github" ? "（官方源）" : "（手动模式）"}\n`);
      return 0;
    }
    case "sync": {
      const sub = args[args.indexOf(command) + 1] ?? "menu";
      const manager = getSyncManager();
      if (sub === "start") {
        const port = findFlag("--port") ? Number(findFlag("--port")) : undefined;
        await manager.startBlocking(port);
        return 0;
      }
      if (sub === "stop") {
        const result = await manager.stop();
        process.stdout.write(`${result.message}\n`);
        return 0;
      }
      if (sub === "info") {
        const status = await manager.status();
        process.stdout.write(`同步服务器: ${status.running ? "运行中" : "已停止"} (${status.host}:${status.port})\n`);
        if (status.running) process.stdout.write(`分享地址: ${status.shareUrl}\n`);
        return 0;
      }
      if (sub === "rotate-token") {
        const result = await manager.rotateToken();
        process.stdout.write(`同步令牌已轮换，新分享地址: ${result.shareUrl}\n`);
        return 0;
      }
      if (sub === "from") {
        const serverUrl = findFlag("--server-url");
        if (!serverUrl) {
          process.stdout.write("用法: st sync from --server-url 'http://192.168.1.100:9999#token=...'\n");
          return 1;
        }
        const method = (findFlag("--method") ?? "auto") as "auto" | "zip" | "incremental";
        const result = await manager.syncFrom(serverUrl, method, !hasFlag("--no-backup"));
        process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
        return result.ok ? 0 : 1;
      }
      await syncMenu();
      return 0;
    }
    case "version": {
      const sub = args[args.indexOf(command) + 1] ?? "info";
      if (sub === "info") {
        process.stdout.write(JSON.stringify(await getVersionInfo(), null, 2) + "\n");
        return 0;
      }
      if (sub === "list") {
        const list = await listVersions(20);
        if (!list.success) {
          process.stdout.write(`✗ ${list.error}\n`);
          return 1;
        }
        for (const item of list.items) {
          process.stdout.write(`v${item.version}${item.isLatest ? " [最新]" : ""} - ${item.commit.slice(0, 7)} (${item.date.slice(0, 10)})\n`);
        }
        return 0;
      }
      if (sub === "switch") {
        const commit = findFlag("--commit");
        const version = findFlag("--version-str");
        if (!commit && !version) {
          process.stdout.write("用法: st version switch --commit <hash> | --version-str <ver>\n");
          return 1;
        }
        const result = await switchVersion({ commit, version }, { installDeps: true, force: true });
        process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
        return result.ok ? 0 : 1;
      }
      return 0;
    }
    case "st-config": {
      const sub = args[args.indexOf(command) + 1] ?? "info";
      const config = new StConfig();
      if (sub === "port") {
        const port = Number(findFlag("--st-port"));
        if (!(port >= 1 && port <= 65535)) {
          process.stdout.write("用法: st st-config port --st-port 8000\n");
          return 1;
        }
        config.state.port = port;
        config.save();
        process.stdout.write(`✓ 端口已设置为 ${port}\n`);
        return 0;
      }
      if (sub === "listen") {
        config.state.listen = hasFlag("--enable-listen");
        config.save();
        process.stdout.write(`✓ 局域网监听已${config.state.listen ? "启用" : "禁用"}\n`);
        return 0;
      }
      process.stdout.write(`端口: ${config.state.port} | 局域网监听: ${config.state.listen ? "启用" : "禁用"}\n`);
      return 0;
    }
    case "migrate": {
      const sub = args[args.indexOf(command) + 1] ?? "scan";
      if (sub === "from") {
        const sourcePath = findFlag("--source-path");
        const mode = (findFlag("--mode") ?? "move") as MigrateMode;
        if (!sourcePath) {
          process.stdout.write("用法: st migrate from --source-path ~/SillyTavern [--mode move|copy_data|copy_config|copy_all]\n");
          return 1;
        }
        const result = await migrateInstallation({ sourcePath, mode, backup: true });
        process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.message}\n`);
        return result.ok ? 0 : 1;
      }
      await migrateMenu();
      return 0;
    }
    default:
      usage();
      return command === "help" || command === "-h" ? 0 : 1;
  }
}

main()
  .then((code) => {
    rl.close();
    process.exit(code);
  })
  .catch((error) => {
    process.stderr.write(`错误: ${String(error)}\n`);
    rl.close();
    process.exit(1);
  });

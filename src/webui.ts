/**
 * WEBUI 入口 — `node src/webui.ts` 或 `st webui`。
 * EULA 同意在页面上完成（/api/agreement 门控），此处仅检查环境并启动 HTTP 服务。
 */
import { startWebui } from "./webui/server.ts";
import { checkSystemEnv } from "./services/stLifecycle.ts";
import { LAUNCHER_VERSION } from "./version.ts";

async function main(): Promise<number> {
  process.stdout.write(`SillyTavernLauncher WebUI v${LAUNCHER_VERSION}\n`);
  const env = checkSystemEnv();
  if (!env.ok) {
    process.stdout.write(`警告: 缺少依赖命令: ${env.missing.join(", ")}（部分功能不可用）\n`);
  }
  try {
    const { url, close } = await startWebui();
    process.stdout.write(`WEBUI 已启动: ${url}\n`);
    process.stdout.write("在手机浏览器打开上面的地址，按 Ctrl+C 停止。\n");
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await close();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());
    await new Promise(() => {});
    return 0;
  } catch (error) {
    process.stderr.write(`WEBUI 启动失败: ${String(error)}\n`);
    return 1;
  }
}

process.exit(await main());

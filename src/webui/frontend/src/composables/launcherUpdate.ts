/** 启动器自更新 — 状态页更新横幅与更多页维护按钮共享的完整链路：
 *  确认 → POST /api/launcher/update（202 异步受理）→ 等 withTask 总结行落日志 →
 *  判定成败 → 成功时后端自动重启进程，前端延时整页刷新载入新版本。 */
import { computed, ref } from "vue";
import { post } from "./api";
import { confirmDialog } from "./confirm";
import { notify, store } from "./launcher";
import type { UpdateInfo } from "../types";

const TASK = "launcherUpdate";

export const updateInfo = computed<UpdateInfo | null>(() => store.status?.update ?? null);

/** 更新横幅文案：检测到新版本时 "vX → vY [开发版]"，否则 null。 */
export const updateBanner = computed(() => {
  const info = updateInfo.value;
  if (!info || info.has_error || !info.has_update || !info.latest_version) return null;
  return `v${info.current_version} → v${info.latest_version}${info.is_dev_version ? " [开发版]" : ""}`;
});

/** 有新版本时的目标版本号（无更新 / 检查失败为 null）。 */
export const updateTarget = computed(() => {
  const info = updateInfo.value;
  return info?.has_update && info.latest_version ? info.latest_version : null;
});

export const launcherUpdating = ref(false);

/** 日志里最近一条 launcherUpdate 总结行的 seq（withTask 结束时必写 "launcherUpdate: ✓/✗ …"）。 */
function lastTaskSeq(): number {
  for (let i = store.logs.length - 1; i >= 0; i--) {
    if (store.logs[i].text.startsWith(`${TASK}: `)) return store.logs[i].seq;
  }
  return 0;
}

/** 等待本轮更新任务的总结行（SSE 实时推送）；超时返回 false。 */
async function waitTaskDone(baselineSeq: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (lastTaskSeq() > baselineSeq) return true;
  }
  return false;
}

/** 更新启动器（含确认框）。后端在成功后自动重启 WEBUI，这里延时刷新页面载入新前端。 */
export async function runLauncherUpdate(): Promise<void> {
  if (launcherUpdating.value) return;
  const ok = await confirmDialog({
    title: "更新启动器",
    text: "将执行 git pull 并在完成后自动重启 WEBUI，确认继续？",
    confirmText: "更新并重启",
  });
  if (!ok) return;
  launcherUpdating.value = true;
  const baselineSeq = lastTaskSeq();
  try {
    await post("/api/launcher/update");
    notify("更新已开始，请在日志页查看进度", "info");
    const done = await waitTaskDone(baselineSeq, 10 * 60 * 1000);
    if (!done) {
      notify("更新仍在进行，请在日志页查看进度", "warning");
      return;
    }
    if (!taskSucceeded(baselineSeq)) {
      notify("启动器更新失败，详情见日志页", "error");
      return;
    }
    notify("更新完成，正在重启 WEBUI…", "success");
    setTimeout(() => location.reload(), 8000);
  } catch (error) {
    notify(`更新启动失败: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    launcherUpdating.value = false;
  }
}

/** 本轮任务的总结行是否为成功（✓）。 */
function taskSucceeded(baselineSeq: number): boolean {
  for (let i = store.logs.length - 1; i >= 0; i--) {
    const line = store.logs[i];
    if (line.seq <= baselineSeq || !line.text.startsWith(`${TASK}: `)) continue;
    return line.text.startsWith(`${TASK}: ✓`);
  }
  return false;
}

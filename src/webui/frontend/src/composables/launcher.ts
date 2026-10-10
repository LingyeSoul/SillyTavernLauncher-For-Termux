/** 全局 store（模块级单例）：状态轮询 / SSE 日志流 / EULA 门 / 通知队列 / 视图切换。 */
import { reactive } from "vue";
import { api, errorMessage, getToken, post } from "./api";
import type { AgreementInfo, LogLine, NotificationItem, NotifyKind, StatusPayload, ViewKey } from "../types";

/** 单例 snackbar 队列（D5：不堆叠，关闭动画 300ms 走完再弹下一条）。 */
let notifId = 0;
let pumping = false;
let skipResolve: (() => void) | null = null;

export const store = reactive({
  view: "home" as ViewKey,
  loaded: false,
  status: null as StatusPayload | null,
  agreement: null as AgreementInfo | null,
  logs: [] as LogLine[],
  busy: [] as string[],
  sseConnected: false,
  notifications: [] as NotificationItem[],
  activeNotification: null as NotificationItem | null,
});

export function notify(text: string, kind: NotifyKind = "info"): void {
  store.notifications.push({ id: ++notifId, text, kind });
  void pumpNotifications();
}

async function pumpNotifications(): Promise<void> {
  if (pumping) return;
  pumping = true;
  while (store.notifications.length) {
    const next = store.notifications.shift()!;
    store.activeNotification = next;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3200);
      skipResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    skipResolve = null;
    store.activeNotification = null;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  pumping = false;
}

export function dismissNotification(): void {
  skipResolve?.();
  skipResolve = null;
}

/** 状态轮询；/api/status 被 EULA 403 门控时探测协议状态并拉起协议门。 */
export async function refresh(): Promise<void> {
  try {
    const data = await api<StatusPayload>("/api/status");
    if (data.agreement_required) {
      store.agreement = await api<AgreementInfo>("/api/agreement");
      store.loaded = true;
      return;
    }
    store.agreement = null;
    store.status = data;
    store.loaded = true;
  } catch (error) {
    try {
      const info = await api<AgreementInfo>("/api/agreement");
      if (info.required) {
        store.agreement = info;
        store.loaded = true;
        return;
      }
    } catch {
      /* 协议接口也不可用时按普通错误处理 */
    }
    notify(`状态获取失败: ${errorMessage(error)}`, "error");
  }
}

export async function acceptAgreement(): Promise<void> {
  await post("/api/agreement/accept", { accepted: true });
  store.agreement = null;
  await refresh();
}

async function backfillLogs(): Promise<void> {
  const data = await api<{ lines: LogLine[] }>("/api/logs");
  store.logs = data.lines.slice(-2000);
}

function connectEvents(): void {
  const base = getToken() ? `/api/events?token=${encodeURIComponent(getToken())}` : "/api/events";
  const source = new EventSource(base);
  source.onopen = () => {
    store.sseConnected = true;
  };
  source.addEventListener("log", (event) => {
    store.logs.push(JSON.parse((event as MessageEvent).data) as LogLine);
    if (store.logs.length > 2000) store.logs.splice(0, store.logs.length - 2000);
  });
  source.addEventListener("busy", (event) => {
    const data = JSON.parse((event as MessageEvent).data) as { busy?: string[] };
    store.busy = data.busy ?? [];
  });
  source.onerror = () => {
    store.sseConnected = false;
    source.close();
    setTimeout(connectEvents, 3000);
  };
}

export function initLauncher(): void {
  void backfillLogs().catch(() => {});
  connectEvents();
  void refresh();
  setInterval(() => {
    if (!store.agreement) void refresh();
  }, 5000);
}

export function setView(view: ViewKey): void {
  store.view = view;
}

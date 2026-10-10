/**
 * 智能滚动 — 内容更新时的贴底跟随，与日志流同款纪律：
 * 更新前视口在底部 48px 内 → 更新后跟随到新底部；用户上翻阅读时绝不抢滚动位置。
 */
import { nextTick, watch, type WatchSource } from "vue";

const PIN_RANGE = 48;

export function scrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".stl-scroll");
}

function isPinnedBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < PIN_RANGE;
}

/** watch 默认 pre-flush：回调在 DOM 更新前执行，此时测量的是"更新前"的贴底状态。 */
export function followOnUpdate(source: WatchSource): void {
  watch(source, async () => {
    const el = scrollContainer();
    if (!el || !isPinnedBottom(el)) return;
    await nextTick();
    el.scrollTop = el.scrollHeight;
  });
}

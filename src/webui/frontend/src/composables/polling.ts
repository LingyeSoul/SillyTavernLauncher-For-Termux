/** 轮询 — setInterval 生命周期收敛进 composable，组件卸载自动清理。 */
import { onUnmounted } from "vue";

export function usePolling(fn: () => void, intervalMs: number, options: { immediate?: boolean } = {}): void {
  if (options.immediate !== false) fn();
  const timer = setInterval(fn, intervalMs);
  onUnmounted(() => clearInterval(timer));
}

/** 确认对话框服务 — 替代 window.confirm，由 App 外壳统一渲染。 */
import { reactive } from "vue";

export interface ConfirmRequest {
  title: string;
  text: string;
  confirmText?: string;
  danger?: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (value: boolean) => void;
}

export const confirmState = reactive({
  pending: null as PendingConfirm | null,
});

export function confirmDialog(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.pending = { ...request, resolve };
  });
}

export function settleConfirm(value: boolean): void {
  const pending = confirmState.pending;
  confirmState.pending = null;
  pending?.resolve(value);
}

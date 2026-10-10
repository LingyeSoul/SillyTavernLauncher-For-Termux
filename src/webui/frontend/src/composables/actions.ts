/** 动作执行器 — 收敛各视图重复的 try/catch + notify 样板。 */
import { errorMessage } from "./api";
import { notify } from "./launcher";
import type { NotifyKind } from "../types";

export interface RunActionOptions<T> {
  /** 成功提示文案；传函数时从结果拼出（如 result.message）。缺省不提示。 */
  success?: string | ((result: T) => string);
  /** 成功提示语义，默认 "success"；传函数时按结果定（如 result.success）。 */
  kind?: NotifyKind | ((result: T) => NotifyKind);
  /** 失败提示前缀，最终文案为 `<前缀>: <错误>`。 */
  failurePrefix?: string;
}

/** 执行动作：成功按配置通知并返回结果；失败统一 error 通知并返回 undefined。 */
export async function runAction<T>(task: () => Promise<T>, options: RunActionOptions<T> = {}): Promise<T | undefined> {
  try {
    const result = await task();
    if (options.success !== undefined) {
      const text = typeof options.success === "function" ? options.success(result) : options.success;
      const kind = typeof options.kind === "function" ? options.kind(result) : (options.kind ?? "success");
      notify(text, kind);
    }
    return result;
  } catch (error) {
    notify(options.failurePrefix ? `${options.failurePrefix}: ${errorMessage(error)}` : errorMessage(error), "error");
    return undefined;
  }
}

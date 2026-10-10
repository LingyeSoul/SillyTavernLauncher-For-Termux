/** REST 客户端 — 非回环监听时由 URL ?token= 携带令牌，存 localStorage。 */

let token = localStorage.getItem("stl_webui_token") ?? "";

const urlToken = new URLSearchParams(location.search).get("token");
if (urlToken) {
  token = urlToken;
  localStorage.setItem("stl_webui_token", urlToken);
  history.replaceState(null, "", "/");
}

export function getToken(): string {
  return token;
}

export class ApiError extends Error {}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* 空响应体 */
  }
  if (!response.ok && response.status !== 202) {
    throw new ApiError(String(payload.error ?? `HTTP ${response.status}`));
  }
  return payload as T;
}

export function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

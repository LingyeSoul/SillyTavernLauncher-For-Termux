/** 与 webui/server.ts 的 REST/SSE 契约对齐的前端类型。 */

export interface LogLine {
  seq: number;
  time: string;
  source: string;
  text: string;
}

export interface StRunning {
  running: boolean;
  pid?: number;
}

export interface StVersionInfo {
  version?: string;
  commit?: string;
  branch?: string;
}

export interface StConfigState {
  port: number;
  listen: boolean;
  whitelistIps: string[];
}

export interface EnvCheck {
  ok: boolean;
  missing: string[];
}

export interface UpdateInfo {
  has_update?: boolean;
  has_error?: boolean;
  current_version?: string;
  latest_version?: string;
  is_dev_version?: boolean;
}

export interface StatusPayload {
  launcher_version: string;
  installed: boolean;
  running: StRunning;
  st: StVersionInfo | null;
  st_config: StConfigState | null;
  env: EnvCheck;
  local_ip: string;
  startup: string;
  mirror: string;
  busy: string[];
  agreement_required: boolean;
  update: UpdateInfo | null;
}

export interface AgreementInfo {
  required: boolean;
  date: string;
  content: string;
  source: string;
}

export interface SyncStatusPayload {
  running: boolean;
  shareUrl?: string;
}

export interface SyncStatusResponse {
  status: SyncStatusPayload;
  saved_servers: string[];
}

export interface VersionItem {
  version: string;
  commit: string;
  date: string;
  isLatest?: boolean;
}

export interface VersionsResponse {
  current: StVersionInfo | null;
  items: VersionItem[];
}

export interface MirrorEntry {
  key: string;
  display: string;
}

export interface MirrorsResponse {
  mirrors: MirrorEntry[];
  current: string;
}

export interface MigrationInstallation {
  path: string;
  version?: string;
  size: number;
  hasGit?: boolean;
}

export type ViewKey = "home" | "logs" | "sync" | "config" | "more";

export type NotifyKind = "info" | "success" | "error" | "warning";

export interface NotificationItem {
  id: number;
  text: string;
  kind: NotifyKind;
}

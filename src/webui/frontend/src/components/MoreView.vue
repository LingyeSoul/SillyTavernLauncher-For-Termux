<script setup lang="ts">
/** 更多页 — 版本管理 / 迁移安装 / 维护工具。 */
import { computed, onMounted, ref } from "vue";
import {
  mdiTagOutline,
  mdiFolderMoveOutline,
  mdiRefresh,
  mdiSwapHorizontal,
  mdiWrenchOutline,
  mdiRestartAlert,
  mdiTagSearch,
} from "@mdi/js";
import { confirmDialog } from "../composables/confirm";
import { api, errorMessage, post } from "../composables/api";
import { notify } from "../composables/launcher";
import { followOnUpdate } from "../composables/smartScroll";
import type { MigrationInstallation, VersionsResponse } from "../types";
import EmptyState from "./EmptyState.vue";

const versions = ref<VersionsResponse | null>(null);
const versionsLoading = ref(false);

const migrateState = ref<"idle" | "scanning" | "done">("idle");
const installations = ref<MigrationInstallation[]>([]);

const currentVersion = computed(() =>
  versions.value?.current?.version ? `v${versions.value.current.version}` : "未知",
);

onMounted(() => void loadVersions());

/* 内容更新贴底跟随（版本列表 / 迁移扫描结果异步载入时若在页尾阅读则跟随） */
followOnUpdate(() => [versions.value?.items.length ?? 0, installations.value.length, migrateState.value]);

async function loadVersions(): Promise<void> {
  versionsLoading.value = true;
  try {
    versions.value = await api<VersionsResponse>("/api/versions");
  } catch (error) {
    notify(errorMessage(error), "error");
  } finally {
    versionsLoading.value = false;
  }
}

async function fetchTags(): Promise<void> {
  try {
    const result = await post<{ message?: string }>("/api/versions/fetch-tags");
    notify(result.message ?? "已更新", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  await loadVersions();
}

async function switchVersion(version: string): Promise<void> {
  const ok = await confirmDialog({
    title: `切换到 v${version}？`,
    text: "将自动重装依赖，过程可在日志页查看。",
    confirmText: "切换",
  });
  if (!ok) return;
  try {
    const result = await post<{ message?: string }>("/api/versions/switch", {
      version,
      installDeps: true,
      force: true,
    });
    notify(result.message ?? "已切换", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

async function scanMigrate(): Promise<void> {
  migrateState.value = "scanning";
  try {
    const data = await api<{ installations: MigrationInstallation[] }>("/api/migrate/scan");
    installations.value = data.installations ?? [];
    migrateState.value = "done";
  } catch (error) {
    notify(`扫描失败: ${errorMessage(error)}`, "error");
    migrateState.value = "done";
  }
}

async function migrate(sourcePath: string): Promise<void> {
  const ok = await confirmDialog({
    title: "迁移安装",
    text: `移动整个安装到本地？\n源: ${sourcePath}`,
    confirmText: "迁移",
  });
  if (!ok) return;
  try {
    const result = await post<{ message?: string; success: boolean }>("/api/migrate", {
      sourcePath,
      mode: "move",
    });
    notify(result.message ?? "迁移完成", result.success ? "success" : "error");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

async function repair(): Promise<void> {
  const ok = await confirmDialog({
    title: "一键修复依赖",
    text: "将删除 node_modules 并重装依赖。",
    confirmText: "开始修复",
  });
  if (!ok) return;
  try {
    await post("/api/st/repair");
    notify("修复已开始，请在日志页查看进度", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

async function restartWebui(): Promise<void> {
  const ok = await confirmDialog({
    title: "重启启动器",
    text: "重启启动器进程？页面将在几秒后恢复。",
    danger: true,
    confirmText: "重启",
  });
  if (!ok) return;
  try {
    await post("/api/launcher/restart");
    notify("重启中…页面将在几秒后恢复", "success");
    setTimeout(() => location.reload(), 4000);
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}
</script>

<template>
  <div class="more-view anim-fade-up">
    <div class="workspace-heading">
      <div>
        <h1>更多</h1>
        <p class="heading-sub">版本管理 · 迁移 · 维护</p>
      </div>
    </div>

    <v-card variant="tonal" class="mb-4">
      <v-card-title class="section-title">
        版本管理
        <span class="section-meta font-mono-field">当前: {{ currentVersion }}</span>
      </v-card-title>
      <v-card-text>
        <div class="row-head">
          <v-spacer />
          <v-btn variant="outlined" size="small" :prepend-icon="mdiTagSearch" @click="fetchTags">
            更新标签
          </v-btn>
        </div>
        <EmptyState
          v-if="!versionsLoading && !versions?.items?.length"
          :icon="mdiTagOutline"
          title="暂无版本标签"
          hint="点击「更新标签」从远端获取可用版本"
        />
        <template v-else>
          <div v-if="versionsLoading" class="skeleton-list">
            <div v-for="i in 3" :key="i" class="skeleton-block" :style="{ height: '44px' }" />
          </div>
          <div v-else class="item-list">
            <div v-for="item in versions?.items ?? []" :key="item.commit" class="item-row">
              <div class="item-main">
                <div class="item-title">
                  v{{ item.version }}
                  <v-chip v-if="item.isLatest" size="x-small" variant="outlined">最新</v-chip>
                </div>
                <div class="item-meta font-mono-field">
                  {{ item.commit.slice(0, 7) }} · {{ item.date.slice(0, 10) }}
                </div>
              </div>
              <v-btn
                variant="text"
                size="x-small"
                :prepend-icon="mdiSwapHorizontal"
                @click="switchVersion(item.version)"
              >
                切换
              </v-btn>
            </div>
          </div>
        </template>
      </v-card-text>
    </v-card>

    <v-card variant="tonal" class="mb-4">
      <v-card-title class="section-title">迁移安装</v-card-title>
      <v-card-text>
        <div class="row-head">
          <v-spacer />
          <v-btn variant="outlined" size="small" :prepend-icon="mdiRefresh" :loading="migrateState === 'scanning'" @click="scanMigrate">
            扫描其他 SillyTavern
          </v-btn>
        </div>
        <EmptyState
          v-if="migrateState === 'idle'"
          :icon="mdiFolderMoveOutline"
          title="未扫描"
          hint="扫描本机已有的其他 SillyTavern 安装并迁移到此处"
        />
        <div v-else-if="migrateState === 'scanning'" class="skeleton-list">
          <div v-for="i in 2" :key="i" class="skeleton-block" :style="{ height: '48px' }" />
        </div>
        <EmptyState
          v-else-if="!installations.length"
          :icon="mdiFolderMoveOutline"
          title="未找到其他安装"
          hint="扫描范围内没有可迁移的 SillyTavern"
        />
        <div v-else class="item-list">
          <div v-for="install in installations" :key="install.path" class="item-row">
            <div class="item-main">
              <div class="item-path font-mono-field">{{ install.path }}</div>
              <div class="item-meta font-mono-field">
                {{ install.version ? `v${install.version} · ` : "" }}{{ (install.size / 1024 / 1024).toFixed(1) }} MB
                · {{ install.hasGit ? "Git" : "手动" }}
              </div>
            </div>
            <v-btn variant="text" size="x-small" @click="migrate(install.path)">迁移</v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <v-card variant="tonal">
      <v-card-title class="section-title">维护</v-card-title>
      <v-card-text>
        <div class="card-actions">
          <v-btn variant="outlined" :prepend-icon="mdiWrenchOutline" @click="repair">一键修复依赖</v-btn>
          <v-btn variant="text" color="error" :prepend-icon="mdiRestartAlert" @click="restartWebui">
            重启启动器
          </v-btn>
        </div>
        <p class="footer-note">SillyTavernLauncher for Termux · Node.js/TypeScript</p>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.section-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  padding-bottom: 4px;
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.section-meta {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.row-head {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.item-list {
  display: grid;
  gap: 4px;
}

.item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-deep);
}

.item-main {
  min-width: 0;
}

.item-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-path {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.item-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.skeleton-list {
  display: grid;
  gap: 6px;
}

.card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.footer-note {
  margin: 16px 0 0;
  font-size: var(--fs-caption);
  color: var(--text-muted);
}
</style>

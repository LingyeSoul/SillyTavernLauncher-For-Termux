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
import { api, post } from "../composables/api";
import { runAction } from "../composables/actions";
import { followOnUpdate } from "../composables/smartScroll";
import type { MigrationInstallation, VersionsResponse } from "../types";
import EmptyState from "./EmptyState.vue";
import PageHeader from "./PageHeader.vue";
import SectionCard from "./SectionCard.vue";

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
  const data = await runAction(() => api<VersionsResponse>("/api/versions"));
  if (data) versions.value = data;
  versionsLoading.value = false;
}

async function fetchTags(): Promise<void> {
  await runAction(() => post<{ message?: string }>("/api/versions/fetch-tags"), {
    success: (r) => r.message ?? "已更新",
  });
  await loadVersions();
}

async function switchVersion(version: string): Promise<void> {
  const ok = await confirmDialog({
    title: `切换到 v${version}？`,
    text: "将自动重装依赖，过程可在日志页查看。",
    confirmText: "切换",
  });
  if (!ok) return;
  await runAction(() =>
    post<{ message?: string }>("/api/versions/switch", {
      version,
      installDeps: true,
      force: true,
    }),
  { success: (r) => r.message ?? "已切换" });
}

async function scanMigrate(): Promise<void> {
  migrateState.value = "scanning";
  const data = await runAction(() => api<{ installations: MigrationInstallation[] }>("/api/migrate/scan"), {
    failurePrefix: "扫描失败",
  });
  installations.value = data?.installations ?? [];
  migrateState.value = "done";
}

async function migrate(sourcePath: string): Promise<void> {
  const ok = await confirmDialog({
    title: "迁移安装",
    text: `移动整个安装到本地？\n源: ${sourcePath}`,
    confirmText: "迁移",
  });
  if (!ok) return;
  await runAction(() => post<{ message?: string; success: boolean }>("/api/migrate", {
    sourcePath,
    mode: "move",
  }), {
    success: (r) => r.message ?? "迁移完成",
    kind: (r) => (r.success ? "success" : "error"),
  });
}

async function repair(): Promise<void> {
  const ok = await confirmDialog({
    title: "一键修复依赖",
    text: "将删除 node_modules 并重装依赖。",
    confirmText: "开始修复",
  });
  if (!ok) return;
  await runAction(() => post("/api/st/repair"), { success: "修复已开始，请在日志页查看进度" });
}

async function restartWebui(): Promise<void> {
  const ok = await confirmDialog({
    title: "重启启动器",
    text: "重启启动器进程？页面将在几秒后恢复。",
    danger: true,
    confirmText: "重启",
  });
  if (!ok) return;
  const result = await runAction(() => post("/api/launcher/restart"), {
    success: "重启中…页面将在几秒后恢复",
  });
  if (result !== undefined) setTimeout(() => location.reload(), 4000);
}
</script>

<template>
  <div class="more-view anim-fade-up">
    <PageHeader title="更多" sub="版本管理 · 迁移 · 维护" />

    <SectionCard title="版本管理" class="mb-4">
      <template #meta>
        <span class="section-meta font-mono-field">当前: {{ currentVersion }}</span>
      </template>
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
    </SectionCard>

    <SectionCard title="迁移安装" class="mb-4">
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
    </SectionCard>

    <SectionCard title="维护">
      <div class="card-actions">
        <v-btn variant="outlined" :prepend-icon="mdiWrenchOutline" @click="repair">一键修复依赖</v-btn>
        <v-btn variant="text" color="error" :prepend-icon="mdiRestartAlert" @click="restartWebui">
          重启启动器
        </v-btn>
      </div>
      <p class="muted-hint mt-4">SillyTavernLauncher for Termux · Node.js/TypeScript</p>
    </SectionCard>
  </div>
</template>

<style scoped>
.row-head {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}
</style>

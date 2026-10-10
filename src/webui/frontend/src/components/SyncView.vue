<script setup lang="ts">
/** 同步页 — 分享服务器控制 + 从服务器拉取 + 已存服务器管理。 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { mdiContentCopy, mdiKeyOutline, mdiPlay, mdiStop, mdiServerRemove, mdiSync } from "@mdi/js";
import { confirmDialog } from "../composables/confirm";
import { api, errorMessage, post } from "../composables/api";
import { notify } from "../composables/launcher";
import { followOnUpdate } from "../composables/smartScroll";
import type { SyncStatusResponse } from "../types";
import EmptyState from "./EmptyState.vue";

const running = ref(false);
const shareUrl = ref("");
const savedServers = ref<string[]>([]);
const fromUrl = ref("");
const fromMethod = ref("auto");
const fromBackup = ref(true);

const methodItems = [
  { title: "自动", value: "auto" },
  { title: "ZIP 全量", value: "zip" },
  { title: "增量", value: "incremental" },
];

let timer: ReturnType<typeof setInterval> | undefined;

async function refreshSync(): Promise<void> {
  try {
    const data = await api<SyncStatusResponse>("/api/sync/status");
    running.value = data.status.running;
    shareUrl.value = data.status.running ? data.status.shareUrl ?? "" : "";
    savedServers.value = data.saved_servers ?? [];
  } catch (error) {
    notify(`同步状态获取失败: ${errorMessage(error)}`, "error");
  }
}

onMounted(() => {
  void refreshSync();
  timer = setInterval(() => void refreshSync(), 5000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

/* 内容更新贴底跟随（状态切换 / 分享地址出现 / 已存列表变化） */
followOnUpdate(() => [running.value, shareUrl.value, savedServers.value.length]);

async function startServer(): Promise<void> {
  try {
    const result = await post<{ message?: string; success: boolean }>("/api/sync/server/start", {});
    notify(result.message ?? "已启动", result.success ? "success" : "error");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  void refreshSync();
}

async function stopServer(): Promise<void> {
  try {
    const result = await post<{ message?: string }>("/api/sync/server/stop");
    notify(result.message ?? "已停止", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  void refreshSync();
}

async function copyUrl(): Promise<void> {
  if (!shareUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    notify("已复制", "success");
  } catch {
    notify("复制失败，请长按手动复制", "error");
  }
}

async function rotateToken(): Promise<void> {
  const ok = await confirmDialog({
    title: "轮换令牌",
    text: "轮换后旧分享地址立即失效，确认继续？",
    danger: true,
    confirmText: "轮换",
  });
  if (!ok) return;
  try {
    const result = await post<{ share_url: string }>("/api/sync/rotate-token");
    notify(`新地址: ${result.share_url}`, "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  void refreshSync();
}

async function syncFrom(): Promise<void> {
  const serverUrl = fromUrl.value.trim();
  if (!serverUrl) {
    notify("请输入分享地址", "error");
    return;
  }
  try {
    await post("/api/sync/from", {
      serverUrl,
      method: fromMethod.value,
      backup: fromBackup.value,
    });
    notify("同步已开始，请在日志页查看进度", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

async function removeSaved(index: number): Promise<void> {
  try {
    const data = await post<SyncStatusResponse>("/api/sync/servers", { action: "remove", index });
    savedServers.value = data.saved_servers ?? [];
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

const stateText = computed(() => (running.value ? "运行中" : "已停止"));
</script>

<template>
  <div class="sync-view anim-fade-up">
    <div class="workspace-heading">
      <div>
        <h1>数据同步</h1>
        <p class="heading-sub">在设备之间迁移 SillyTavern 数据</p>
      </div>
      <v-spacer />
      <v-chip :color="running ? 'success' : undefined" variant="tonal" size="small">
        {{ stateText }}
      </v-chip>
    </div>

    <v-card variant="tonal" class="mb-4">
      <v-card-title class="section-title">同步服务器</v-card-title>
      <v-card-text>
        <div class="share-url font-mono-field" :class="{ 'share-url--off': !running }">
          {{ running ? shareUrl : "（未运行）" }}
        </div>
        <div class="card-actions">
          <v-btn v-if="!running" color="primary" :prepend-icon="mdiPlay" @click="startServer">启动服务</v-btn>
          <v-btn v-else variant="tonal" :prepend-icon="mdiStop" @click="stopServer">停止服务</v-btn>
          <v-btn variant="outlined" :prepend-icon="mdiContentCopy" :disabled="!running" @click="copyUrl">
            复制地址
          </v-btn>
          <v-btn
            variant="text"
            color="error"
            :prepend-icon="mdiKeyOutline"
            size="small"
            @click="rotateToken"
          >
            轮换令牌
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card variant="tonal" class="mb-4">
      <v-card-title class="section-title">从服务器拉取</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="fromUrl"
          class="font-mono-field"
          placeholder="http://192.168.1.100:9999#token=..."
          autocomplete="off"
          spellcheck="false"
        />
        <div class="pull-row">
          <v-select v-model="fromMethod" :items="methodItems" label="同步方式" style="max-width: 180px" />
          <v-switch v-model="fromBackup" label="先备份" hide-details />
          <v-spacer />
          <v-btn variant="tonal" color="primary" :prepend-icon="mdiSync" @click="syncFrom">
            开始同步
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-card variant="tonal">
      <v-card-title class="section-title">已保存的服务器</v-card-title>
      <v-card-text>
        <EmptyState
          v-if="!savedServers.length"
          :icon="mdiServerRemove"
          title="暂无保存的服务器"
          hint="成功从服务器同步后，地址会自动保存在这里"
        />
        <div v-else class="saved-list">
          <div v-for="(redacted, index) in savedServers" :key="index" class="saved-item">
            <span class="font-mono-field saved-url">{{ redacted }}</span>
            <v-btn variant="text" size="x-small" color="error" @click="removeSaved(index)">删除</v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.section-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  padding-bottom: 4px;
}

.share-url {
  background: var(--bg-deep);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  overflow-wrap: anywhere;
  color: var(--text-primary);
}
.share-url--off {
  color: var(--text-muted);
}

.card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.pull-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.saved-list {
  display: grid;
  gap: 4px;
}

.saved-item {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-deep);
}

.saved-url {
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>

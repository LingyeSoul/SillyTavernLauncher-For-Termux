<script setup lang="ts">
/** 同步页 — 分享服务器控制 + 从服务器拉取 + 已存服务器管理。
 *  embedded=true 时作为「更多」页的同步 Tab 嵌入，隐藏页头由 Tab 提供标题语境。 */
import { computed, ref } from "vue";
defineProps<{ embedded?: boolean }>();
import { mdiContentCopy, mdiKeyOutline, mdiPlay, mdiStop, mdiServerRemove, mdiSync } from "@mdi/js";
import { confirmDialog } from "../composables/confirm";
import { api, post } from "../composables/api";
import { notify } from "../composables/launcher";
import { runAction } from "../composables/actions";
import { usePolling } from "../composables/polling";
import { followOnUpdate } from "../composables/smartScroll";
import type { SyncStatusResponse } from "../types";
import EmptyState from "./EmptyState.vue";
import PageHeader from "./PageHeader.vue";
import SectionCard from "./SectionCard.vue";

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

async function refreshSync(): Promise<void> {
  const data = await runAction(() => api<SyncStatusResponse>("/api/sync/status"), {
    failurePrefix: "同步状态获取失败",
  });
  if (!data) return;
  running.value = data.status.running;
  shareUrl.value = data.status.running ? data.status.shareUrl ?? "" : "";
  savedServers.value = data.saved_servers ?? [];
}

usePolling(() => void refreshSync(), 5000, { immediate: true });

/* 内容更新贴底跟随（状态切换 / 分享地址出现 / 已存列表变化） */
followOnUpdate(() => [running.value, shareUrl.value, savedServers.value.length]);

async function startServer(): Promise<void> {
  await runAction(() => post<{ message?: string; success: boolean }>("/api/sync/server/start", {}), {
    success: (r) => r.message ?? "已启动",
    kind: (r) => (r.success ? "success" : "error"),
  });
  void refreshSync();
}

async function stopServer(): Promise<void> {
  await runAction(() => post<{ message?: string }>("/api/sync/server/stop"), {
    success: (r) => r.message ?? "已停止",
  });
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
  await runAction(() => post<{ share_url: string }>("/api/sync/rotate-token"), {
    success: (r) => `新地址: ${r.share_url}`,
  });
  void refreshSync();
}

async function syncFrom(): Promise<void> {
  const serverUrl = fromUrl.value.trim();
  if (!serverUrl) {
    notify("请输入分享地址", "error");
    return;
  }
  await runAction(() =>
    post("/api/sync/from", {
      serverUrl,
      method: fromMethod.value,
      backup: fromBackup.value,
    }),
  { success: "同步已开始，请在日志页查看进度" });
}

async function removeSaved(index: number): Promise<void> {
  const data = await runAction(() => post<SyncStatusResponse>("/api/sync/servers", { action: "remove", index }));
  if (data) savedServers.value = data.saved_servers ?? [];
}

const stateText = computed(() => (running.value ? "运行中" : "已停止"));
</script>

<template>
  <div class="sync-view anim-fade-up">
    <PageHeader v-if="!embedded" title="数据同步" sub="在设备之间迁移 SillyTavern 数据">
      <template #actions>
        <v-chip :color="running ? 'success' : undefined" variant="tonal" size="small">
          {{ stateText }}
        </v-chip>
      </template>
    </PageHeader>

    <SectionCard title="同步服务器" class="mb-4">
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
    </SectionCard>

    <SectionCard title="从服务器拉取" class="mb-4">
      <v-text-field
        v-model="fromUrl"
        class="font-mono-field"
        placeholder="http://192.168.1.100:9999#token=..."
        autocomplete="off"
        spellcheck="false"
      />
      <div class="field-row">
        <v-select v-model="fromMethod" :items="methodItems" label="同步方式" style="max-width: 180px" />
        <v-switch v-model="fromBackup" label="先备份" hide-details />
        <v-spacer />
        <v-btn variant="tonal" color="primary" :prepend-icon="mdiSync" @click="syncFrom">
          开始同步
        </v-btn>
      </div>
    </SectionCard>

    <SectionCard title="已保存的服务器">
      <EmptyState
        v-if="!savedServers.length"
        :icon="mdiServerRemove"
        title="暂无保存的服务器"
        hint="成功从服务器同步后，地址会自动保存在这里"
      />
      <div v-else class="item-list">
        <div v-for="(redacted, index) in savedServers" :key="index" class="item-row">
          <span class="font-mono-field item-path">{{ redacted }}</span>
          <v-btn variant="text" size="x-small" color="error" @click="removeSaved(index)">删除</v-btn>
        </div>
      </div>
    </SectionCard>
  </div>
</template>

<style scoped>
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
</style>

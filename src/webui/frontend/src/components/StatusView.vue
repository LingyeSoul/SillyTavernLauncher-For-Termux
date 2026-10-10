<script setup lang="ts">
/** 状态页 — 运行状态（状态 + 访问地址，垂直堆叠）+ 操作面板（全部实例操作，唯一实色余烬按钮在内，Scarce Ember Rule）。 */
import { computed } from "vue";
import {
  mdiOpenInNew,
  mdiPlay,
  mdiStop,
  mdiRestart,
  mdiDownloadOutline,
  mdiUpdate,
  mdiArrowUpCircleOutline,
} from "@mdi/js";
import { confirmDialog } from "../composables/confirm";
import { post } from "../composables/api";
import { notify, refresh, store } from "../composables/launcher";
import { runAction } from "../composables/actions";
import { followOnUpdate } from "../composables/smartScroll";
import MetricTile from "./MetricTile.vue";
import PageHeader from "./PageHeader.vue";
import SectionCard from "./SectionCard.vue";

const status = computed(() => store.status);
const installed = computed(() => status.value?.installed ?? false);
const running = computed(() => status.value?.running?.running ?? false);
const busy = computed(() => (status.value?.busy ?? []).length > 0);

/** 访问地址列表：监听开启时局域网地址在前，本地地址恒定兜底。 */
const stUrls = computed(() => {
  const data = status.value;
  if (!data?.installed || !data.st_config) return [] as { kind: string; url: string }[];
  const { port, listen } = data.st_config;
  const urls = [
    { kind: "局域网", url: `http://${data.local_ip}:${port}` },
    { kind: "本地", url: `http://127.0.0.1:${port}` },
  ];
  return listen ? urls : urls.slice(1);
});

const subtitle = computed(() => {
  const st = status.value?.st;
  if (!installed.value) return "未安装 · 点击「安装」开始部署";
  const version = st?.version ? `v${st.version}` : "未知版本";
  const commit = st?.commit ? ` · ${st.branch || "?"} / ${st.commit.slice(0, 7)}` : "";
  return `${version}${commit}`;
});

const update = computed(() => {
  const info = status.value?.update;
  if (!info || info.has_error || !info.has_update) return null;
  return `v${info.current_version} → v${info.latest_version}${info.is_dev_version ? " [开发版]" : ""}`;
});

/* 内容更新贴底跟随（更新横幅出现 / 安装·运行状态切换改变页高时） */
followOnUpdate(() => [installed.value, running.value, update.value !== null, store.busy.length]);

function afterAction(delay = 800): void {
  setTimeout(() => void refresh(), delay);
}

async function start(): Promise<void> {
  const result = await runAction(() => post<{ message?: string }>("/api/st/start"), {
    success: (r) => r.message ?? "已启动",
  });
  if (result !== undefined) afterAction();
}

async function stop(): Promise<void> {
  const result = await runAction(() => post<{ message?: string }>("/api/st/stop"), {
    success: (r) => r.message ?? "已停止",
  });
  if (result !== undefined) afterAction(500);
}

async function restart(): Promise<void> {
  const result = await runAction(() => post<{ message?: string }>("/api/st/restart"), {
    success: (r) => r.message ?? "已重启",
  });
  if (result !== undefined) afterAction();
}

async function install(): Promise<void> {
  const ok = await confirmDialog({
    title: "安装 SillyTavern",
    text: "确认本人已年满18周岁，或已取得监护人同意后开始安装。",
    confirmText: "开始安装",
  });
  if (!ok) return;
  await runAction(() => post("/api/st/install", { confirm18: true }), {
    success: "安装已开始，请在日志页查看进度",
  });
}

async function updateSt(): Promise<void> {
  await runAction(() => post("/api/st/update"), { success: "更新已开始，请在日志页查看进度" });
}

async function updateLauncher(): Promise<void> {
  const ok = await confirmDialog({
    title: "更新启动器",
    text: "将执行 git pull 并重启 WEBUI，确认继续？",
    confirmText: "更新并重启",
  });
  if (!ok) return;
  await runAction(() => post("/api/launcher/update"), { success: "更新中…" });
}
</script>

<template>
  <div v-if="status" class="status-view anim-fade-up">
    <PageHeader title="SillyTavern" :sub="subtitle">
      <template #actions>
        <v-chip v-if="busy" color="primary" variant="tonal" size="small">
          <v-progress-circular indeterminate size="10" width="2" class="mr-2" />
          任务进行中
        </v-chip>
      </template>
    </PageHeader>

    <v-alert v-if="update" type="warning" class="mb-4" :prepend-icon="mdiArrowUpCircleOutline">
      <div class="d-flex align-center flex-wrap ga-2">
        <span>启动器更新可用：{{ update }}</span>
        <v-spacer />
        <v-btn size="small" variant="outlined" :prepend-icon="mdiUpdate" @click="updateLauncher">更新启动器</v-btn>
      </div>
    </v-alert>

    <SectionCard title="运行状态" class="mb-4">
      <div class="metric-grid metric-grid--stack">
        <MetricTile label="状态">
          <span v-if="!installed" class="text-warning">未安装</span>
          <span v-else-if="running" class="text-success">运行中 · pid {{ status.running.pid ?? "?" }}</span>
          <span v-else class="text-medium-emphasis">已停止</span>
        </MetricTile>
        <MetricTile label="访问地址" small>
          <div v-for="entry in stUrls" :key="entry.kind" class="addr-line">
            <span class="addr-kind">{{ entry.kind }}</span>
            <a class="st-link" :href="entry.url" target="_blank" rel="noopener">
              {{ entry.url }}
              <v-icon :icon="mdiOpenInNew" size="12" class="ml-1" />
            </a>
          </div>
          <span v-if="!stUrls.length">—</span>
        </MetricTile>
      </div>
    </SectionCard>

    <SectionCard title="操作面板">
      <div class="card-actions">
        <v-btn v-if="!installed" color="primary" :prepend-icon="mdiDownloadOutline" :disabled="busy" @click="install">
          安装
        </v-btn>
        <v-btn
          v-else-if="!running"
          color="primary"
          :prepend-icon="mdiPlay"
          :disabled="busy"
          @click="start"
        >
          启动
        </v-btn>
        <v-btn v-else variant="tonal" :prepend-icon="mdiStop" @click="stop">停止</v-btn>
        <v-btn v-if="installed && running" variant="tonal" :prepend-icon="mdiRestart" @click="restart">重启</v-btn>
        <v-btn
          v-if="installed"
          variant="outlined"
          :prepend-icon="mdiUpdate"
          :disabled="busy"
          @click="updateSt"
        >
          更新
        </v-btn>
      </div>
      <p v-if="status.env?.ok" class="muted-hint">环境依赖：✓ git · node · npm</p>
      <p v-else class="muted-hint">
        <span class="text-error">环境依赖：✗ 缺少 {{ (status.env?.missing ?? []).join(", ") }}</span>
      </p>
    </SectionCard>
  </div>
</template>

<style scoped>
.addr-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.addr-kind {
  flex: none;
  font-size: var(--fs-micro);
  color: var(--text-muted);
}
.st-link {
  color: var(--forge-ember);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.st-link:hover {
  text-decoration: underline;
}
</style>

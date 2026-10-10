<script setup lang="ts">
/** 状态页 — 运行控制台。页头右侧是唯一实色余烬按钮（Scarce Ember Rule）。 */
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
import { errorMessage, post } from "../composables/api";
import { notify, refresh, store } from "../composables/launcher";
import { followOnUpdate } from "../composables/smartScroll";
import MetricTile from "./MetricTile.vue";

const status = computed(() => store.status);
const installed = computed(() => status.value?.installed ?? false);
const running = computed(() => status.value?.running?.running ?? false);
const busy = computed(() => (status.value?.busy ?? []).length > 0);

const stUrl = computed(() => {
  const data = status.value;
  if (!data?.installed || !data.st_config) return "";
  const ip = data.st_config.listen ? data.local_ip : "127.0.0.1";
  return `http://${ip}:${data.st_config.port}`;
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
  try {
    const result = await post<{ message?: string }>("/api/st/start");
    notify(result.message ?? "已启动", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  afterAction();
}

async function stop(): Promise<void> {
  try {
    const result = await post<{ message?: string }>("/api/st/stop");
    notify(result.message ?? "已停止", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  afterAction(500);
}

async function restart(): Promise<void> {
  try {
    const result = await post<{ message?: string }>("/api/st/restart");
    notify(result.message ?? "已重启", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  afterAction();
}

async function install(): Promise<void> {
  const ok = await confirmDialog({
    title: "安装 SillyTavern",
    text: "确认本人已年满18周岁，或已取得监护人同意后开始安装。",
    confirmText: "开始安装",
  });
  if (!ok) return;
  try {
    await post("/api/st/install", { confirm18: true });
    notify("安装已开始，请在日志页查看进度", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

async function updateSt(): Promise<void> {
  try {
    await post("/api/st/update");
    notify("更新已开始，请在日志页查看进度", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

async function updateLauncher(): Promise<void> {
  const ok = await confirmDialog({
    title: "更新启动器",
    text: "将执行 git pull 并重启 WEBUI，确认继续？",
    confirmText: "更新并重启",
  });
  if (!ok) return;
  try {
    await post("/api/launcher/update");
    notify("更新中…", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

</script>

<template>
  <div v-if="status" class="status-view anim-fade-up">
    <div class="workspace-heading">
      <div>
        <h1>SillyTavern</h1>
        <p class="heading-sub">{{ subtitle }}</p>
      </div>
      <v-spacer />
      <div class="heading-actions">
        <v-chip v-if="busy" color="primary" variant="tonal" size="small">
          <v-progress-circular indeterminate size="10" width="2" class="mr-2" />
          任务进行中
        </v-chip>
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
      </div>
    </div>

    <v-alert v-if="update" type="warning" class="mb-4" :prepend-icon="mdiArrowUpCircleOutline">
      <div class="d-flex align-center flex-wrap ga-2">
        <span>启动器更新可用：{{ update }}</span>
        <v-spacer />
        <v-btn size="small" variant="outlined" :prepend-icon="mdiUpdate" @click="updateLauncher">更新启动器</v-btn>
      </div>
    </v-alert>

    <v-card variant="tonal" class="mb-4">
      <v-card-title class="section-title">运行状态</v-card-title>
      <v-card-text>
        <div class="metric-grid">
          <MetricTile label="状态">
            <span v-if="!installed" class="text-warning">未安装</span>
            <span v-else-if="running" class="text-success">运行中 · pid {{ status.running.pid ?? "?" }}</span>
            <span v-else class="text-medium-emphasis">已停止</span>
          </MetricTile>
          <MetricTile label="版本">
            {{ status.st?.version ? `v${status.st.version}` : "—" }}
          </MetricTile>
          <MetricTile label="分支 / Commit">
            {{ status.st?.commit ? `${status.st.branch || "?"} / ${status.st.commit.slice(0, 7)}` : "—" }}
          </MetricTile>
          <MetricTile label="访问地址" small>
            <a v-if="stUrl" class="st-link" :href="stUrl" target="_blank" rel="noopener">
              {{ stUrl }}
              <v-icon :icon="mdiOpenInNew" size="12" class="ml-1" />
            </a>
            <span v-else>—</span>
          </MetricTile>
        </div>
        <div class="card-actions">
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
      </v-card-text>
    </v-card>

    <v-card variant="tonal">
      <v-card-title class="section-title">本机环境</v-card-title>
      <v-card-text>
        <div class="metric-grid">
          <MetricTile label="局域网 IP">{{ status.local_ip }}</MetricTile>
          <MetricTile label="ST 端口">{{ status.st_config?.port ?? "—" }}</MetricTile>
          <MetricTile label="环境依赖">
            <span v-if="status.env?.ok" class="text-success">✓ git · node · npm</span>
            <span v-else class="text-error">✗ 缺少 {{ (status.env?.missing ?? []).join(", ") }}</span>
          </MetricTile>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.section-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  padding-bottom: 4px;
}

.card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
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

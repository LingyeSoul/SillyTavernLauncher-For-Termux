<script setup lang="ts">
/** 设置页 — 双 tab：酒馆设置（ST 参数 + 智能镜像）/ 启动器设置（st 命令行为）。字段聚焦时不被轮询刷新覆盖。 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import { mdiAutoFix, mdiCheck, mdiContentSave, mdiLanConnect, mdiPlaylistEdit, mdiSpeedometer } from "@mdi/js";
import { api, errorMessage, post } from "../composables/api";
import { notify, refresh, store } from "../composables/launcher";
import { runAction } from "../composables/actions";
import { followOnUpdate } from "../composables/smartScroll";
import type { MirrorsResponse } from "../types";
import PageHeader from "./PageHeader.vue";
import SectionCard from "./SectionCard.vue";

const tab = ref<"st" | "launcher">("st");

const cfgPort = ref("");
const cfgListen = ref(false);
const whitelistText = ref("");
const focused = reactive({ port: false, whitelist: false });
const mirrors = ref<MirrorsResponse | null>(null);

const behaviorItems = [
  { title: "显示菜单（默认）", value: "menu" },
  { title: "一键启动酒馆", value: "st" },
  { title: "一键启动 WebUI", value: "webui" },
];
const startup = ref("menu");

const whitelistCount = computed(() =>
  whitelistText.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length,
);

watch(
  () => store.status?.st_config,
  (config) => {
    if (!config) return;
    if (!focused.port) cfgPort.value = String(config.port);
    if (!focused.whitelist) whitelistText.value = (config.whitelistIps ?? []).join("\n");
    cfgListen.value = config.listen;
  },
  { immediate: true },
);

watch(
  () => store.status?.startup,
  (behavior) => {
    if (behavior) startup.value = behavior;
  },
  { immediate: true },
);

onMounted(async () => {
  void refresh();
  try {
    mirrors.value = await api<MirrorsResponse>("/api/mirrors");
  } catch {
    /* 镜像列表失败不阻断设置页 */
  }
});

/* 内容更新贴底跟随（镜像列表载入 / 切 tab 引起页高变化时若在页尾阅读则跟随） */
followOnUpdate(() => [mirrors.value?.mirrors.length ?? 0, mirrors.value?.current ?? "", cfgListen.value, tab.value]);

async function savePort(): Promise<void> {
  const port = Number(cfgPort.value);
  if (!(port >= 1 && port <= 65535)) {
    notify("端口号必须在 1-65535 范围内", "error");
    return;
  }
  await runAction(() => post("/api/st-config", { action: "port", port }), {
    success: "端口已保存，重启 ST 后生效",
  });
}

async function toggleListen(value: boolean | null): Promise<void> {
  const enabled = value === true;
  const ok = await runAction(() => post("/api/st-config", { action: "listen", enabled }), {
    success: `局域网监听已${enabled ? "启用" : "禁用"}，重启 ST 后生效`,
  });
  if (ok === undefined) cfgListen.value = !enabled;
}

async function autoSubnet(): Promise<void> {
  const ok = await runAction(() => post("/api/st-config", { action: "auto_subnet" }), {
    success: "已自动添加当前网段",
  });
  if (ok !== undefined) void refresh();
}

async function saveWhitelist(): Promise<void> {
  const ips = whitelistText.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ok = await runAction(() => post("/api/st-config", { action: "whitelist", ips }), {
    success: `白名单已保存（${ips.length} 条）`,
  });
  if (ok !== undefined) void refresh();
}

async function saveStartup(value: string | null): Promise<void> {
  const behavior = value ?? "menu";
  await runAction(() => post("/api/config/startup", { behavior }), {
    success: `st 命令行为已设为: ${behaviorItems.find((item) => item.value === behavior)?.title ?? behavior}`,
  });
}

// ---------- 智能镜像 ----------

/** 镜像任务（测速/选优）运行中：后端 busy 里有 mirror */
const mirrorTaskRunning = computed(() => store.status?.busy?.includes("mirror") ?? false);

/** 推荐列表：实测延迟优先，其次注册表报告值，取前 12 */
const rankedMirrors = computed(() => {
  const list = [...(mirrors.value?.mirrors ?? [])];
  list.sort((a, b) => (a.latency_ms ?? a.reported_ms ?? 9e9) - (b.latency_ms ?? b.reported_ms ?? 9e9));
  return list.slice(0, 12);
});

const mirrorModeText = computed(() => {
  const data = mirrors.value;
  if (!data) return "加载中…";
  if (!data.enabled) return "官方源（未加速）";
  return data.auto ? "智能自动" : "手动指定";
});

async function reloadMirrors(): Promise<void> {
  mirrors.value = await api<MirrorsResponse>("/api/mirrors");
}

/** 手动点选（含官方源）——自动切优让位于用户意志 */
async function selectMirror(host: string, label: string): Promise<void> {
  const ok = await runAction(() => post("/api/config/mirror", { mirror: host }), {
    success: `镜像已切换: ${label}`,
  });
  if (ok !== undefined) await reloadMirrors().catch((error) => notify(errorMessage(error), "error"));
}

async function enableSmartMirror(): Promise<void> {
  const ok = await runAction(() => post("/api/config/mirror", { enabled: true }), {
    success: "智能加速已开启：未选定镜像时自动选优，仅在镜像失效时自动切换",
  });
  if (ok !== undefined) await reloadMirrors().catch((error) => notify(errorMessage(error), "error"));
}

/** 后台任务（202）：提示 + 延迟刷新结果（进度实时进日志页） */
async function startMirrorTask(path: string, doing: string, doneHint: string): Promise<void> {
  const started = await runAction(() => post(path, {}), {
    success: `${doing}（进度见日志页，完成后列表自动刷新）`,
    kind: "info",
  });
  if (started === undefined) return;
  setTimeout(() => {
    void reloadMirrors().catch(() => {});
    notify(doneHint, "info");
  }, 8000);
}
</script>

<template>
  <div class="settings-view anim-fade-up">
    <PageHeader title="设置" sub="酒馆参数 · 启动器行为" />

    <v-tabs v-model="tab" density="compact" color="primary" class="settings-tabs">
      <v-tab value="st">酒馆设置</v-tab>
      <v-tab value="launcher">启动器设置</v-tab>
    </v-tabs>

    <v-window v-model="tab" class="settings-window">
      <!-- 酒馆设置 -->
      <v-window-item value="st">
        <SectionCard title="SillyTavern 配置" class="mt-4">
          <div class="field-row">
            <v-text-field
              v-model="cfgPort"
              type="number"
              label="端口"
              class="font-mono-field port-input"
              min="1"
              max="65535"
              hide-details
              @focus="focused.port = true"
              @blur="focused.port = false"
              @keyup.enter="savePort"
            />
            <v-btn variant="tonal" :prepend-icon="mdiContentSave" @click="savePort">保存</v-btn>
          </div>
          <v-switch
            :model-value="cfgListen"
            label="局域网监听（其他设备可访问）"
            hide-details
            class="mt-2"
            @update:model-value="toggleListen"
          />
          <div class="mt-2">
            <v-btn variant="outlined" size="small" :prepend-icon="mdiLanConnect" @click="autoSubnet">
              自动添加当前网段
            </v-btn>
          </div>
          <div class="whitelist-head">
            <span class="whitelist-label">IP 白名单</span>
            <v-chip size="x-small" variant="outlined">{{ whitelistCount }} 条</v-chip>
          </div>
          <v-textarea
            v-model="whitelistText"
            class="font-mono-field"
            rows="4"
            placeholder="每行一条，如 192.168.1.*"
            spellcheck="false"
            @focus="focused.whitelist = true"
            @blur="focused.whitelist = false"
          />
          <v-btn variant="tonal" size="small" :prepend-icon="mdiPlaylistEdit" @click="saveWhitelist">
            保存白名单
          </v-btn>
        </SectionCard>

        <SectionCard title="GitHub 镜像" class="mt-4">
          <div class="mirror-status">
            <span class="mirror-current">当前：{{ mirrors?.display ?? "…" }}</span>
            <v-chip
              size="x-small"
              :variant="mirrors?.enabled && mirrors?.auto ? 'tonal' : 'outlined'"
              :color="mirrors?.enabled && mirrors?.auto ? 'primary' : undefined"
            >
              {{ mirrorModeText }}
            </v-chip>
          </div>
          <p v-if="mirrors?.speedtest?.tested_at" class="muted-hint">
            上次测速 {{ mirrors.speedtest.tested_at.slice(0, 16).replace("T", " ") }} ·
            {{ mirrors.speedtest.ok }} 个可用 / {{ mirrors.speedtest.failed }} 个不可达
          </p>
          <div class="mirror-actions">
            <v-btn
              size="small"
              variant="outlined"
              :disabled="!mirrors || mirrors.current === mirrors.official || mirrorTaskRunning"
              @click="mirrors && selectMirror(mirrors.official, 'GitHub 官方源')"
            >
              官方源
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              :prepend-icon="mdiAutoFix"
              :disabled="!mirrors || (mirrors.enabled && mirrors.auto) || mirrorTaskRunning"
              @click="enableSmartMirror"
            >
              开启智能加速
            </v-btn>
            <v-btn
              size="small"
              variant="outlined"
              :prepend-icon="mdiSpeedometer"
              :disabled="!mirrors || !mirrors.enabled || mirrorTaskRunning"
              @click="startMirrorTask('/api/mirrors/auto-select', '测速选优已开始', '选优完成，列表已刷新')"
            >
              立即选优
            </v-btn>
            <v-btn
              size="small"
              variant="outlined"
              :prepend-icon="mdiSpeedometer"
              :disabled="!mirrors || mirrorTaskRunning"
              @click="startMirrorTask('/api/mirrors/speedtest', '全量测速已开始', '测速完成，列表已刷新')"
            >
              全量测速
            </v-btn>
          </div>
          <div class="mirror-list">
            <v-btn
              v-for="mirror in rankedMirrors"
              :key="mirror.host"
              :variant="mirror.host === mirrors?.current ? 'tonal' : 'outlined'"
              :color="mirror.host === mirrors?.current ? 'primary' : undefined"
              size="small"
              :prepend-icon="mirror.host === mirrors?.current ? mdiCheck : undefined"
              :disabled="mirror.host === mirrors?.current || mirrorTaskRunning"
              @click="selectMirror(mirror.host, mirror.host)"
            >
              {{ mirror.host }}
              <span class="mirror-latency" :class="{ failed: mirror.failed }">
                {{ mirror.latency_ms !== null ? `${mirror.latency_ms}ms` : mirror.reported_ms !== null ? `~${mirror.reported_ms}ms` : "" }}
              </span>
            </v-btn>
          </div>
          <p v-if="!mirrors" class="muted-hint">镜像列表加载中…</p>
          <p class="muted-hint">点选任意镜像 = 手动模式；智能模式下未选定自动选优，且仅在当前镜像失效时自动切换。</p>
        </SectionCard>
      </v-window-item>

      <!-- 启动器设置 -->
      <v-window-item value="launcher">
        <SectionCard title="st 命令行为" class="mt-4">
          <v-select
            :model-value="startup"
            :items="behaviorItems"
            label="输入 st 无参数时执行的动作"
            hint="更改立即生效，无需重启"
            persistent-hint
            @update:model-value="saveStartup"
          />
          <div class="behavior-hints">
            <div class="behavior-hint">
              <span class="hint-key font-mono-field">显示菜单</span>
              <span>进入交互菜单，可选择启动、安装、同步等全部功能</span>
            </div>
            <div class="behavior-hint">
              <span class="hint-key font-mono-field">一键启动酒馆</span>
              <span>直接启动 SillyTavern（未安装时会询问是否安装）</span>
            </div>
            <div class="behavior-hint">
              <span class="hint-key font-mono-field">一键启动 WebUI</span>
              <span>直接打开浏览器管理界面，本页所有功能皆可在其中操作</span>
            </div>
          </div>
        </SectionCard>
      </v-window-item>
    </v-window>
  </div>
</template>

<style scoped>
.settings-tabs {
  border-bottom: 1px solid var(--border-subtle);
}

.settings-tabs :deep(.v-tab) {
  text-transform: none;
  font-size: 13px;
  font-weight: 500;
  min-height: 38px;
}

.settings-window :deep(.v-window__container) {
  min-height: 320px;
}

.port-input {
  max-width: 180px;
}

.whitelist-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 8px;
}

.whitelist-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.mirror-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mirror-current {
  font-size: 13px;
  font-weight: 500;
}

.mirror-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 12px 0;
}

.mirror-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mirror-latency {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.7;
}

.mirror-latency.failed {
  text-decoration: line-through;
}

.behavior-hints {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.behavior-hint {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 10px;
  font-size: var(--fs-caption);
  color: var(--text-muted);
  align-items: baseline;
}

.hint-key {
  color: var(--text-secondary);
  font-size: 12px;
}
</style>

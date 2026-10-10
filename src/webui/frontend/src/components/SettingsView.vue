<script setup lang="ts">
/** 设置页 — 双 tab：酒馆设置（ST 参数 + 镜像）/ 启动器设置（st 命令行为）。字段聚焦时不被轮询刷新覆盖。 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import { mdiCheck, mdiContentSave, mdiLanConnect, mdiPlaylistEdit } from "@mdi/js";
import { api, errorMessage, post } from "../composables/api";
import { notify, refresh, store } from "../composables/launcher";
import { followOnUpdate } from "../composables/smartScroll";
import type { MirrorsResponse } from "../types";

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
followOnUpdate(() => [mirrors.value?.mirrors.length ?? 0, cfgListen.value, tab.value]);

async function savePort(): Promise<void> {
  const port = Number(cfgPort.value);
  if (!(port >= 1 && port <= 65535)) {
    notify("端口号必须在 1-65535 范围内", "error");
    return;
  }
  try {
    await post("/api/st-config", { action: "port", port });
    notify("端口已保存，重启 ST 后生效", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

async function toggleListen(value: boolean | null): Promise<void> {
  const enabled = value === true;
  try {
    await post("/api/st-config", { action: "listen", enabled });
    notify(`局域网监听已${enabled ? "启用" : "禁用"}，重启 ST 后生效`, "success");
  } catch (error) {
    notify(errorMessage(error), "error");
    cfgListen.value = !enabled;
  }
}

async function autoSubnet(): Promise<void> {
  try {
    await post("/api/st-config", { action: "auto_subnet" });
    notify("已自动添加当前网段", "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  void refresh();
}

async function saveWhitelist(): Promise<void> {
  const ips = whitelistText.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    await post("/api/st-config", { action: "whitelist", ips });
    notify(`白名单已保存（${ips.length} 条）`, "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
  void refresh();
}

async function saveStartup(value: string | null): Promise<void> {
  const behavior = value ?? "menu";
  try {
    await post("/api/config/startup", { behavior });
    const label = behaviorItems.find((item) => item.value === behavior)?.title ?? behavior;
    notify(`st 命令行为已设为: ${label}`, "success");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

async function selectMirror(key: string, display: string): Promise<void> {
  try {
    await post("/api/config/mirror", { mirror: key });
    notify(`镜像已切换: ${display}`, "success");
    mirrors.value = await api<MirrorsResponse>("/api/mirrors");
  } catch (error) {
    notify(errorMessage(error), "error");
  }
}
</script>

<template>
  <div class="settings-view anim-fade-up">
    <div class="workspace-heading">
      <div>
        <h1>设置</h1>
        <p class="heading-sub">酒馆参数 · 启动器行为</p>
      </div>
    </div>

    <v-tabs v-model="tab" density="compact" color="primary" class="settings-tabs">
      <v-tab value="st">酒馆设置</v-tab>
      <v-tab value="launcher">启动器设置</v-tab>
    </v-tabs>

    <v-window v-model="tab" class="settings-window">
      <!-- 酒馆设置 -->
      <v-window-item value="st">
        <v-card variant="tonal" class="mt-4">
          <v-card-title class="section-title">SillyTavern 配置</v-card-title>
          <v-card-text>
            <div class="port-row">
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
          </v-card-text>
        </v-card>

        <v-card variant="tonal" class="mt-4">
          <v-card-title class="section-title">GitHub 镜像</v-card-title>
          <v-card-text>
            <div class="mirror-list">
              <v-btn
                v-for="mirror in mirrors?.mirrors ?? []"
                :key="mirror.key"
                :variant="mirror.key === mirrors?.current ? 'tonal' : 'outlined'"
                :color="mirror.key === mirrors?.current ? 'primary' : undefined"
                size="small"
                :prepend-icon="mirror.key === mirrors?.current ? mdiCheck : undefined"
                :disabled="mirror.key === mirrors?.current"
                @click="selectMirror(mirror.key, mirror.display)"
              >
                {{ mirror.display }}
              </v-btn>
            </div>
            <p v-if="!mirrors" class="muted-hint">镜像列表加载中…</p>
          </v-card-text>
        </v-card>
      </v-window-item>

      <!-- 启动器设置 -->
      <v-window-item value="launcher">
        <v-card variant="tonal" class="mt-4">
          <v-card-title class="section-title">st 命令行为</v-card-title>
          <v-card-text>
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
          </v-card-text>
        </v-card>
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

.section-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  padding-bottom: 4px;
}

.port-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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

.mirror-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.muted-hint {
  margin: 8px 0 0;
  font-size: var(--fs-caption);
  color: var(--text-muted);
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

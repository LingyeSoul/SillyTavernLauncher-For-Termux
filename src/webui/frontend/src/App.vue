<script setup lang="ts">
/**
 * 应用外壳 — 桌面（≥960）permanent 抽屉 + 顶栏；移动端自定义底栏 + 顶栏瘦身。
 * 页面切换 240ms fadeSlideUp（CSS 等价实现，reduced-motion 归零）。
 * 视图切换时记忆/恢复滚动位置（首次进入复位顶部）。
 */
import { computed, nextTick, onMounted, ref, watch, type Component } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiCogOutline,
  mdiDotsHorizontal,
  mdiInformationOutline,
  mdiSync,
  mdiTextBoxOutline,
  mdiViewDashboardOutline,
} from "@mdi/js";
import { dismissNotification, initLauncher, setView, store } from "./composables/launcher";
import type { ViewKey } from "./types";
import AgreementDialog from "./components/AgreementDialog.vue";
import ConfirmHost from "./components/ConfirmHost.vue";
import StatusView from "./components/StatusView.vue";
import LogsView from "./components/LogsView.vue";
import SyncView from "./components/SyncView.vue";
import SettingsView from "./components/SettingsView.vue";
import MoreView from "./components/MoreView.vue";
import AboutView from "./components/AboutView.vue";
import logoUrl from "./assets/logo.png";

const { mdAndUp } = useDisplay();
const isDesktop = computed(() => mdAndUp.value);

const NAV: { group: string; items: { key: ViewKey; label: string; icon: string }[] }[] = [
  {
    group: "运行",
    items: [
      { key: "home", label: "状态", icon: mdiViewDashboardOutline },
      { key: "logs", label: "日志", icon: mdiTextBoxOutline },
      { key: "sync", label: "同步", icon: mdiSync },
    ],
  },
  {
    group: "管理",
    items: [
      { key: "config", label: "设置", icon: mdiCogOutline },
      { key: "more", label: "更多", icon: mdiDotsHorizontal },
    ],
  },
];

/** 移动底栏：更多收纳同步后置第 3 位，第 5 位关于（对齐桌面版导航 IA）。 */
const MOBILE_TABS: { key: ViewKey; label: string; icon: string }[] = [
  { key: "home", label: "状态", icon: mdiViewDashboardOutline },
  { key: "logs", label: "日志", icon: mdiTextBoxOutline },
  { key: "more", label: "更多", icon: mdiDotsHorizontal },
  { key: "config", label: "设置", icon: mdiCogOutline },
  { key: "about", label: "关于", icon: mdiInformationOutline },
];

const VIEWS: Record<ViewKey, Component> = {
  home: StatusView,
  logs: LogsView,
  sync: SyncView,
  config: SettingsView,
  more: MoreView,
  about: AboutView,
};

const currentView = computed(() => VIEWS[store.view]);
const launcherVersion = computed(() => store.status?.launcher_version ?? "");

const statusChip = computed(() => {
  if (!store.status) return null;
  if (!store.status.installed) return { text: "未安装", color: "warning" as const };
  if (store.status.running?.running) return { text: "运行中", color: "success" as const };
  return { text: "已停止", color: undefined };
});

/** 滚动记忆：离开视图存位置，回来恢复；首次进入显式复位顶部。
 *  第二阶段兜底——骨架屏换真内容后高度才落地，恢复值若被钳到 0 则 350ms 后补一次。 */
const scrollRef = ref<HTMLElement | null>(null);
const scrollMemory = new Map<ViewKey, number>();

function applyScrollTop(top: number): void {
  if (scrollRef.value) scrollRef.value.scrollTop = top;
}

watch(
  () => store.view,
  (view, previous) => {
    if (previous && scrollRef.value) scrollMemory.set(previous, scrollRef.value.scrollTop);
    const top = scrollMemory.get(view) ?? 0;
    void nextTick(() => {
      if (store.view === view) applyScrollTop(top);
    });
    setTimeout(() => {
      if (store.view === view && top > 0 && scrollRef.value?.scrollTop === 0) applyScrollTop(top);
    }, 350);
  },
);

onMounted(initLauncher);
</script>

<template>
  <v-app>
    <!-- 桌面导航抽屉 -->
    <v-navigation-drawer v-if="isDesktop" permanent :width="240" class="workspace-nav">
      <div class="workspace-brand">
        <img class="brand-logo" :src="logoUrl" alt="SillyTavernLauncher logo" />
        <div>
          <div class="brand-name">STL</div>
          <div class="brand-sub">SillyTavern Launcher</div>
        </div>
      </div>
      <nav class="workspace-nav-list">
        <template v-for="group in NAV" :key="group.group">
          <div class="nav-group-label">{{ group.group }}</div>
          <button
            v-for="item in group.items"
            :key="item.key"
            class="nav-item"
            :class="{ 'nav-item--active': store.view === item.key }"
            @click="setView(item.key)"
          >
            <v-icon :icon="item.icon" size="19" />
            <span>{{ item.label }}</span>
          </button>
        </template>
      </nav>
      <template #append>
        <div class="nav-footer">
          v{{ launcherVersion || "…" }} · 本地工作台
        </div>
      </template>
    </v-navigation-drawer>

    <!-- 顶栏 -->
    <v-app-bar flat :height="isDesktop ? 60 : 52" class="workspace-topbar">
      <div class="topbar-inner">
        <div class="topbar-brand">
          <img class="brand-logo brand-logo--sm" :src="logoUrl" alt="" />
          <span class="topbar-title">SillyTavernLauncher</span>
        </div>
        <v-spacer />
        <v-chip v-if="statusChip" :color="statusChip.color" variant="tonal" size="small" class="status-chip">
          <span class="status-dot" />
          {{ statusChip.text }}
        </v-chip>
        <span v-if="isDesktop && launcherVersion" class="engine-badge">v{{ launcherVersion }}</span>
      </div>
    </v-app-bar>

    <!-- 主区：内部滚动（滚动记忆挂点） -->
    <v-main>
      <div ref="scrollRef" class="stl-scroll" :class="{ 'stl-scroll--fill': store.view === 'logs' }">
        <template v-if="!store.loaded">
          <div class="workspace-heading">
            <div class="skeleton-block" style="width: 200px; height: 28px" />
            <div class="skeleton-block" style="width: 260px; height: 14px" />
          </div>
          <div class="skeleton-card">
            <div class="skeleton-block" style="width: 40%" />
            <div class="skeleton-block" style="width: 100%; height: 56px" />
            <div class="skeleton-block" style="width: 100%; height: 56px" />
          </div>
          <div class="skeleton-card">
            <div class="skeleton-block" style="width: 30%" />
            <div class="skeleton-block" style="width: 100%; height: 56px" />
          </div>
        </template>
        <Transition v-else name="page" mode="out-in">
          <component :is="currentView" :key="store.view" />
        </Transition>
      </div>
    </v-main>

    <!-- 移动底栏 -->
    <nav v-if="!isDesktop" class="stl-tabbar">
      <button
        v-for="item in MOBILE_TABS"
        :key="item.key"
        class="stl-tab"
        :class="{ 'stl-tab--active': store.view === item.key }"
        @click="setView(item.key)"
      >
        <v-icon :icon="item.icon" size="20" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- EULA 门 / 确认框 / 通知（单例队列） -->
    <AgreementDialog />
    <ConfirmHost />
    <v-snackbar
      :model-value="!!store.activeNotification"
      :color="store.activeNotification?.kind === 'error' ? 'error' : store.activeNotification?.kind === 'success' ? 'success' : store.activeNotification?.kind === 'warning' ? 'warning' : undefined"
      location="top end"
      timeout="-1"
      @update:model-value="dismissNotification"
    >
      {{ store.activeNotification?.text }}
    </v-snackbar>
  </v-app>
</template>

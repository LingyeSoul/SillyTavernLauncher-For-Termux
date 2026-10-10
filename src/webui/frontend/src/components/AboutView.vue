<script setup lang="ts">
/** 关于页 — 对齐桌面版：logo + 标题 + 版本芯片 + 作者 + 链接按钮 + 检查更新（唯一 primary）。 */
import { computed, ref } from "vue";
import {
  mdiCashMultiple,
  mdiInformationOutline,
  mdiOpenInNew,
  mdiRefresh,
} from "@mdi/js";
import { errorMessage, post } from "../composables/api";
import { notify, refresh, store } from "../composables/launcher";
import { runLauncherUpdate } from "../composables/launcherUpdate";
import PageHeader from "./PageHeader.vue";
import logoUrl from "../assets/logo.png";

const LINKS = [
  { label: "访问 GitHub 仓库", url: "https://github.com/LingyeSoul/SillyTavernLauncher-For-Termux" },
  { label: "访问启动器官网", url: "https://sillytavern.lingyesoul.top" },
  { label: "访问作者 B 站", url: "https://space.bilibili.com/298721157" },
  { label: "加入 QQ 频道", url: "https://pd.qq.com/s/9usg3jiu1" },
  { label: "打赏作者", url: "https://ifdian.net/order/create?user_id=8a03ea64ebc211ebad0e52540025c377", icon: mdiCashMultiple },
] as const;

const versionText = computed(() => `v${store.status?.launcher_version ?? "?"}`);
const checking = ref(false);

function openLink(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** 强制检查（绕过 status 轮询的 5 分钟缓存）；有更新则走 runLauncherUpdate（内含确认框）。 */
async function checkUpdate(): Promise<void> {
  if (checking.value) return;
  checking.value = true;
  try {
    const result = await post<{ has_error?: boolean; error_message?: string | null; has_update?: boolean; latest_version?: string | null }>(
      "/api/launcher/check-update",
    );
    if (result.has_error) {
      notify(result.error_message ?? "检查更新失败", "error");
      return;
    }
    if (!result.has_update || !result.latest_version) {
      notify("当前已是最新版本", "success");
      return;
    }
    await refresh();
    await runLauncherUpdate();
  } catch (error) {
    notify(`检查更新失败: ${errorMessage(error)}`, "error");
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="about-view anim-fade-up">
    <PageHeader title="关于" sub="关于本启动器" />

    <div class="about-body">
      <img class="about-logo" :src="logoUrl" alt="SillyTavernLauncher logo" />
      <h2 class="about-name">SillyTavernLauncher</h2>
      <v-chip class="font-mono-field">{{ versionText }}</v-chip>
      <p class="about-author">作者: 泠夜Soul</p>

      <div class="about-links">
        <v-btn
          v-for="link in LINKS"
          :key="link.url"
          class="about-link-btn"
          variant="outlined"
          :prepend-icon="'icon' in link ? link.icon : mdiOpenInNew"
          @click="openLink(link.url)"
        >
          {{ link.label }}
        </v-btn>
        <v-btn
          class="about-link-btn"
          color="primary"
          :prepend-icon="mdiRefresh"
          :loading="checking"
          @click="checkUpdate"
        >
          检查更新
        </v-btn>
      </div>

      <p class="about-footnote font-mono-field">
        <v-icon :icon="mdiInformationOutline" size="13" />
        for Termux · Node.js/TypeScript
      </p>
    </div>
  </div>
</template>

<style scoped>
.about-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 320px;
  margin: 32px auto 0;
  text-align: center;
}

.about-logo {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
}

.about-name {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.35;
  margin: 4px 0 0;
}

.about-author {
  margin: 2px 0 14px;
  font-size: var(--fs-caption);
  color: var(--text-muted);
}

.about-links {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.about-link-btn {
  width: 100%;
  max-width: 220px;
  margin: 0 auto;
}

.about-footnote {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: 20px 0 0;
  font-size: var(--fs-micro);
  color: var(--text-muted);
}
</style>

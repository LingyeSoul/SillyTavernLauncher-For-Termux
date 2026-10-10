<script setup lang="ts">
/** 日志页 — 整页终端：贴底跟随 + 行级语义色 + SSE 连接指示。 */
import { ref } from "vue";
import { store } from "../composables/launcher";
import LogStream from "./LogStream.vue";

const autoScroll = ref(true);
</script>

<template>
  <div class="logs-view">
    <div class="workspace-heading">
      <div>
        <h1>实时日志</h1>
        <p class="heading-sub">{{ store.logs.length }} 行 · SSE 流</p>
      </div>
      <v-spacer />
      <div class="heading-actions">
        <v-chip v-if="store.busy.length" color="primary" variant="tonal" size="small">
          {{ store.busy.join(" · ") }}
        </v-chip>
        <v-tooltip :text="store.sseConnected ? 'SSE 已连接' : 'SSE 断开，重连中…'" location="bottom">
          <template #activator="{ props }">
            <span v-bind="props" class="sse-dot" :class="{ 'sse-dot--on': store.sseConnected }" />
          </template>
        </v-tooltip>
        <v-switch
          v-model="autoScroll"
          label="自动滚动"
          hide-details
          density="compact"
          class="log-switch"
        />
      </div>
    </div>
    <LogStream :lines="store.logs" :auto-scroll="autoScroll" />
  </div>
</template>

<style scoped>
.logs-view {
  display: flex;
  flex-direction: column;
  /* 高视口填满整页、矮视口随内容长高并禁止 flex 压缩，触发页面级滚动保证底部可达 */
  flex: 0 0 auto;
  min-height: 100%;
}

.logs-view .workspace-heading {
  margin-bottom: 16px;
}

.heading-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.log-switch :deep(.v-selection-control) {
  min-height: 30px;
}
</style>

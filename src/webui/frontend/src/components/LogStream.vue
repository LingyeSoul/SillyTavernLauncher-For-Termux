<script setup lang="ts">
/**
 * 日志流终端 — mono 12px / bg-deep / 行级 200ms 入场 / 贴底才自动滚（48px 阈值）。
 * 自动滚动开关只切换"贴底跟随"，用户上翻阅读时绝不抢滚动位置。
 */
import { nextTick, ref, watch } from "vue";
import { mdiTextBoxOutline } from "@mdi/js";
import type { LogLine } from "../types";

const props = defineProps<{
  lines: LogLine[];
  autoScroll: boolean;
}>();

const wrap = ref<HTMLElement | null>(null);
/** pinned = 用户视口贴在底部；仅在 pinned 时跟随滚动。 */
const pinned = ref(true);

function onScroll(): void {
  const el = wrap.value;
  if (!el) return;
  pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

watch(
  () => props.lines.length,
  async () => {
    if (!props.autoScroll || !pinned.value) return;
    await nextTick();
    const el = wrap.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

function lineClass(line: LogLine): string {
  if (line.text.includes("✗") || /\berror\b|\bERRO\b|失败/i.test(line.text)) return "log-error";
  if (line.text.includes("⚠") || /\bwarn\b|警告/i.test(line.text)) return "log-warn";
  if (line.text.includes("✓")) return "log-ok";
  if (line.source === "st" || line.source === "webui") return "log-info";
  return "";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour12: false });
}
</script>

<template>
  <div ref="wrap" class="log-console" @scroll="onScroll">
    <div v-if="!lines.length" class="stl-empty" style="padding: 32px 12px">
      <div class="empty-mark">
        <v-icon :icon="mdiTextBoxOutline" size="28" />
      </div>
      <div class="empty-title">暂无日志</div>
      <div class="empty-hint">操作启动器后，输出会实时出现在这里</div>
    </div>
    <div v-for="line in lines" :key="line.seq" class="log-line" :class="lineClass(line)">
      <span class="log-time">{{ formatTime(line.time) }}</span>
      <span class="log-tag">[{{ line.source }}]</span>{{ line.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
/** 指标瓦片 — Forge 签名原子：12px 标签 + JetBrains Mono 500 读数。长文本（地址/路径）用 small 变体。 */
withDefaults(
  defineProps<{
    label: string;
    hint?: string;
    small?: boolean;
  }>(),
  { small: false },
);
</script>

<template>
  <div class="metric-tile">
    <div class="metric-label">{{ label }}</div>
    <div class="metric-value" :class="{ 'metric-value--sm': small }">
      <slot />
    </div>
    <div v-if="hint" class="metric-hint">{{ hint }}</div>
  </div>
</template>

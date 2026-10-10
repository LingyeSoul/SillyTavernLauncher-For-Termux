<script setup lang="ts">
/** 空状态标牌：72px 描边方块 + 18px 次级标题 + 至多一个引导动作（D2）。icon 传 @mdi/js 路径字符串。 */
defineProps<{
  icon: string;
  title: string;
  hint?: string;
}>();
</script>

<template>
  <div class="stl-empty">
    <div class="empty-mark">
      <v-icon :icon="icon" size="28" />
    </div>
    <div class="empty-title">{{ title }}</div>
    <div v-if="hint" class="empty-hint">{{ hint }}</div>
    <div v-if="$slots.default" class="empty-action">
      <slot />
    </div>
  </div>
</template>

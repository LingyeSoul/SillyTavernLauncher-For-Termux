<script setup lang="ts">
/** 页头 — 标题 + mono 副标题 + 右侧操作区，各视图共用的页面骨架。 */
defineProps<{ title: string; sub?: string }>();
</script>

<template>
  <div class="workspace-heading">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="sub" class="heading-sub">{{ sub }}</p>
    </div>
    <v-spacer />
    <div v-if="$slots.actions" class="heading-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

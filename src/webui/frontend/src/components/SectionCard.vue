<script setup lang="ts">
/** 节卡片 — tonal 卡 + Forge 节标题的签名组合，替代各视图重复的卡片模板。 */
defineProps<{ title: string }>();
</script>

<template>
  <v-card variant="tonal">
    <v-card-title class="section-title">
      {{ title }}
      <slot name="meta" />
    </v-card-title>
    <v-card-text>
      <slot />
    </v-card-text>
  </v-card>
</template>

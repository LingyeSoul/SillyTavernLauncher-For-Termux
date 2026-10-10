<script setup lang="ts">
import { confirmState, settleConfirm } from "../composables/confirm";
</script>

<template>
  <v-dialog :model-value="!!confirmState.pending" persistent width="min(440px, calc(100vw - 32px))">
    <v-card v-if="confirmState.pending">
      <v-card-title>{{ confirmState.pending.title }}</v-card-title>
      <v-card-text class="confirm-text">{{ confirmState.pending.text }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="settleConfirm(false)">取消</v-btn>
        <v-btn
          :color="confirmState.pending.danger ? 'error' : 'primary'"
          :variant="confirmState.pending.danger ? 'text' : 'flat'"
          @click="settleConfirm(true)"
        >
          {{ confirmState.pending.confirmText ?? "确认" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.confirm-text {
  white-space: pre-line;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}
</style>

<script setup lang="ts">
/** EULA 协议门 — persistent 对话框，勾选成年确认后才可同意。 */
import { ref, watch } from "vue";
import { acceptAgreement, notify, store } from "../composables/launcher";
import { errorMessage } from "../composables/api";

const adult = ref(false);
const submitting = ref(false);

watch(
  () => store.agreement,
  () => {
    adult.value = false;
    submitting.value = false;
  },
);

async function accept(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await acceptAgreement();
  } catch (error) {
    notify(errorMessage(error), "error");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="!!store.agreement" persistent width="min(640px, calc(100vw - 32px))">
    <v-card v-if="store.agreement">
      <v-card-title>用户协议</v-card-title>
      <v-card-text>
        <pre class="agreement-pre font-mono-field">{{ store.agreement.content || "（无法加载协议内容）" }}</pre>
        <p class="agreement-meta">
          版本日期: {{ store.agreement.date || "未知" }} · 来源: {{ store.agreement.source || "—" }}
        </p>
        <v-checkbox
          v-model="adult"
          hide-details
          label="我已确认本人已年满18周岁，或作为未满18周岁用户已取得监护人同意"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" :disabled="!adult || submitting" @click="accept">同意并继续</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.agreement-pre {
  background: var(--bg-deep);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 12px;
  max-height: 42vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  font-size: var(--fs-caption);
  line-height: 1.6;
}

.agreement-meta {
  font-size: var(--fs-caption);
  color: var(--text-muted);
  margin: 8px 0 12px;
}
</style>

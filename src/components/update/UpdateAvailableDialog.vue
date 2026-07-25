<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import MarkdownRenderer from "@/components/shared/MarkdownRenderer.vue";

const props = defineProps<{
  open: boolean;
  version: string;
  notes: string | null;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const dialogRef = ref<HTMLElement | null>(null);
const primaryButtonRef = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;

function close() {
  emit("close");
}

function confirm() {
  emit("confirm");
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  close();
}

function handleDialogKeydown(event: KeyboardEvent) {
  if (event.key !== "Tab") return;

  const focusable = [
    ...(dialogRef.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []),
  ];
  if (focusable.length === 0) return;

  const current = focusable.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? (current - 1 + focusable.length) % focusable.length
    : (current + 1) % focusable.length;
  event.preventDefault();
  focusable[next].focus();
}

watch(
  () => props.open,
  async (open, wasOpen) => {
    if (open) {
      window.addEventListener("keydown", handleWindowKeydown);
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      primaryButtonRef.value?.focus();
    } else if (wasOpen) {
      window.removeEventListener("keydown", handleWindowKeydown);
      await nextTick();
      previousFocus?.focus();
      previousFocus = null;
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
  previousFocus?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="update-dialog-backdrop" @mousedown.self="close">
      <section
        ref="dialogRef"
        class="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        aria-describedby="update-dialog-summary"
        data-testid="update-available-dialog"
        @keydown="handleDialogKeydown"
      >
        <header class="update-dialog-header">
          <div class="update-dialog-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </div>
          <div class="update-dialog-heading">
            <span class="update-dialog-eyebrow">应用更新</span>
            <h2 id="update-dialog-title">发现新版本 v{{ version }}</h2>
            <p id="update-dialog-summary">新版本已准备好，你可以先了解变化，再决定何时更新。</p>
          </div>
          <button
            type="button"
            class="update-dialog-close"
            aria-label="稍后处理更新"
            @click="close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div class="update-dialog-content">
          <div class="update-dialog-notes-heading">本次更新</div>
          <MarkdownRenderer
            v-if="notes"
            class="update-dialog-notes"
            :content="notes"
            :breaks="false"
          />
          <p v-else class="update-dialog-empty">此版本暂无详细更新说明。</p>
        </div>

        <footer class="update-dialog-actions">
          <button type="button" class="update-dialog-secondary" @click="close">稍后处理</button>
          <button
            ref="primaryButtonRef"
            type="button"
            class="update-dialog-primary"
            @click="confirm"
          >
            查看并更新
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./UpdateAvailableDialog.css"></style>

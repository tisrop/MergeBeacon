<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { useI18n } from "@/i18n";

const props = defineProps<{
  open: boolean;
  title: string;
  repository: string;
  target: string;
  impact: string;
  warning: string;
  confirmLabel: string;
  loadingLabel?: string;
  loading: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
const { t } = useI18n();

const dialogRef = ref<HTMLElement | null>(null);
const cancelButtonRef = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;

function cancel(): void {
  if (!props.loading) emit("cancel");
}

function confirm(): void {
  if (!props.loading) emit("confirm");
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || props.loading) return;
  event.preventDefault();
  cancel();
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab") return;

  const focusable = [
    ...(dialogRef.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []),
  ];
  if (focusable.length === 0) return;

  const current = focusable.indexOf(document.activeElement as HTMLElement);
  const next =
    current === -1
      ? event.shiftKey
        ? focusable.length - 1
        : 0
      : event.shiftKey
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
      cancelButtonRef.value?.focus();
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
    <div v-if="open" class="close-confirm-dialog-backdrop" @mousedown.self="cancel">
      <section
        ref="dialogRef"
        class="close-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-confirm-dialog-title"
        aria-describedby="close-confirm-dialog-impact close-confirm-dialog-warning"
        data-testid="close-confirm-dialog"
        @keydown="handleDialogKeydown"
      >
        <header class="close-confirm-dialog-header">
          <span class="close-confirm-dialog-icon" aria-hidden="true">!</span>
          <div>
            <span class="close-confirm-dialog-eyebrow">{{ t("common.securityConfirmation") }}</span>
            <h2 id="close-confirm-dialog-title">{{ title }}</h2>
          </div>
        </header>

        <div class="close-confirm-dialog-content">
          <p id="close-confirm-dialog-impact">{{ impact }}</p>
          <div class="close-confirm-dialog-target">
            <span class="close-confirm-dialog-repository">{{ repository }}</span>
            <strong>{{ target }}</strong>
          </div>
          <p id="close-confirm-dialog-warning" class="close-confirm-dialog-warning">
            {{ warning }}
          </p>
          <p v-if="error" class="close-confirm-dialog-error" role="alert">{{ error }}</p>
        </div>

        <footer class="close-confirm-dialog-actions">
          <button
            ref="cancelButtonRef"
            type="button"
            class="btn"
            :disabled="loading"
            data-testid="cancel-close"
            @click="cancel"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="button"
            class="btn btn-danger"
            :disabled="loading"
            data-testid="confirm-close"
            @click="confirm"
          >
            {{ loading ? (loadingLabel ?? t("dialog.closing")) : confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./CloseConfirmDialog.css"></style>

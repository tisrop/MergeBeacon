<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter, useRoute } from "vue-router";
import { RouterView } from "vue-router";
import { useUpdateStore } from "@/stores/useUpdateStore";
import CommandPalette from "@/components/command/CommandPalette.vue";
import NotificationManager from "@/components/notification/NotificationManager.vue";
import UpdateAvailableDialog from "@/components/update/UpdateAvailableDialog.vue";

const router = useRouter();
const route = useRoute();
const updates = useUpdateStore();
const { updateResult, updatePromptVersion } = storeToRefs(updates);
const SETTINGS_PAGE_START_ID = "settings-page-start";
const APP_UPDATE_SECTION_ID = "app-update";
const APP_UPDATE_HASH = `#${APP_UPDATE_SECTION_ID}`;

const commandPaletteRef = ref<InstanceType<typeof CommandPalette> | null>(null);
const isCommandPaletteOpen = ref(false);
const isEditingControlFocused = ref(false);
let commandPaletteStateSequence = 0;

const hasMatchingUpdatePrompt = computed(() =>
  Boolean(
    updatePromptVersion.value &&
    updateResult.value?.available &&
    updateResult.value.version === updatePromptVersion.value,
  ),
);
const isUpdateDialogOpen = computed(
  () =>
    hasMatchingUpdatePrompt.value && !isCommandPaletteOpen.value && !isEditingControlFocused.value,
);

async function navigateToSettings(hash = "") {
  updates.dismissUpdatePrompt();
  if (route.path !== "/settings" || route.hash !== hash) {
    const target = hash ? { path: "/settings", hash } : { path: "/settings" };
    if (route.path === "/settings") {
      await router.replace(target);
    } else {
      await router.push(target);
    }
  }
  await nextTick();
}

async function openSettings() {
  await navigateToSettings();
  document.getElementById(SETTINGS_PAGE_START_ID)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

async function openUpdateSettings() {
  await navigateToSettings(APP_UPDATE_HASH);
  document.getElementById(APP_UPDATE_SECTION_ID)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function openCommandPalette() {
  commandPaletteRef.value?.open();
}

function handleCommandPaletteOpenChange(open: boolean) {
  const sequence = ++commandPaletteStateSequence;
  if (open) {
    isCommandPaletteOpen.value = true;
    return;
  }
  void nextTick(() => {
    if (sequence === commandPaletteStateSequence) {
      syncEditingControlFocus();
      isCommandPaletteOpen.value = false;
    }
  });
}

function isEditingControl(element: Element | null): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function syncEditingControlFocus() {
  isEditingControlFocused.value = isEditingControl(document.activeElement);
}

function handleDocumentFocusChange() {
  void nextTick(syncEditingControlFocus);
}

onMounted(() => {
  window.__goToSettings = openSettings;
  window.__openCommandPalette = openCommandPalette;
  document.addEventListener("focusin", handleDocumentFocusChange);
  document.addEventListener("focusout", handleDocumentFocusChange);
  syncEditingControlFocus();
  void updates.maybeCheckForUpdatesInBackground();
});

onUnmounted(() => {
  delete window.__goToSettings;
  delete window.__openCommandPalette;
  document.removeEventListener("focusin", handleDocumentFocusChange);
  document.removeEventListener("focusout", handleDocumentFocusChange);
});
</script>

<template>
  <RouterView v-slot="{ Component, route: matchedRoute }">
    <component
      :is="Component"
      :key="matchedRoute.name === 'pr-detail' ? matchedRoute.path : undefined"
    />
  </RouterView>
  <CommandPalette
    ref="commandPaletteRef"
    :disabled="isUpdateDialogOpen"
    @open-change="handleCommandPaletteOpenChange"
  />
  <NotificationManager />
  <UpdateAvailableDialog
    :open="isUpdateDialogOpen"
    :version="updatePromptVersion ?? ''"
    :notes="updateResult?.notes ?? null"
    @close="updates.dismissUpdatePrompt"
    @confirm="openUpdateSettings"
  />
</template>

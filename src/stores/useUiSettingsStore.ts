import { defineStore } from "pinia";
import { ref } from "vue";

const DIFF_SYNC_SCROLL_KEY = "mergebeacon:diff-sync-scroll";
const DIFF_SIDEBAR_EXPANDED_KEY = "mergebeacon:diff-sidebar-expanded";
const PR_DEPENDENCIES_VISIBLE_KEY = "mergebeacon:pr-dependencies-visible";
const MERGE_QUEUE_VISIBLE_KEY = "mergebeacon:merge-queue-visible";

function readBooleanSetting(key: string, defaultValue: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return defaultValue;
    return value !== "false";
  } catch {
    return defaultValue;
  }
}

function writeBooleanSetting(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Hardened webviews may disable storage; the setting remains valid for this session.
  }
}

export const useUiSettingsStore = defineStore("ui-settings", () => {
  const isDiffSyncScrollEnabled = ref(readBooleanSetting(DIFF_SYNC_SCROLL_KEY, true));
  const isDiffSidebarExpanded = ref(readBooleanSetting(DIFF_SIDEBAR_EXPANDED_KEY, false));
  const isPrDependenciesVisible = ref(readBooleanSetting(PR_DEPENDENCIES_VISIBLE_KEY, true));
  const isMergeQueueVisible = ref(readBooleanSetting(MERGE_QUEUE_VISIBLE_KEY, true));

  function setDiffSyncScrollEnabled(enabled: boolean): void {
    isDiffSyncScrollEnabled.value = enabled;
    writeBooleanSetting(DIFF_SYNC_SCROLL_KEY, enabled);
  }

  function setDiffSidebarExpanded(expanded: boolean): void {
    isDiffSidebarExpanded.value = expanded;
    writeBooleanSetting(DIFF_SIDEBAR_EXPANDED_KEY, expanded);
  }

  function setPrDependenciesVisible(visible: boolean): void {
    isPrDependenciesVisible.value = visible;
    writeBooleanSetting(PR_DEPENDENCIES_VISIBLE_KEY, visible);
  }

  function setMergeQueueVisible(visible: boolean): void {
    isMergeQueueVisible.value = visible;
    writeBooleanSetting(MERGE_QUEUE_VISIBLE_KEY, visible);
  }

  return {
    isDiffSyncScrollEnabled,
    isDiffSidebarExpanded,
    isPrDependenciesVisible,
    isMergeQueueVisible,
    setDiffSyncScrollEnabled,
    setDiffSidebarExpanded,
    setPrDependenciesVisible,
    setMergeQueueVisible,
  };
});

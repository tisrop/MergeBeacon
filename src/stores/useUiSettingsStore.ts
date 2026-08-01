import { defineStore } from "pinia";
import { ref } from "vue";
import { currentLocale, setAppLocale, type AppLocale } from "@/i18n";
import type { AiReviewLanguagePreference } from "@/types";

const DIFF_SYNC_SCROLL_KEY = "mergebeacon:diff-sync-scroll";
const DIFF_SIDEBAR_EXPANDED_KEY = "mergebeacon:diff-sidebar-expanded";
const PR_DEPENDENCIES_VISIBLE_KEY = "mergebeacon:pr-dependencies-visible";
const MERGE_QUEUE_VISIBLE_KEY = "mergebeacon:merge-queue-visible";
const AI_REVIEW_LANGUAGE_KEY = "mergebeacon:ai-review-language";

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

function readAiReviewLanguagePreference(): AiReviewLanguagePreference {
  try {
    const value = localStorage.getItem(AI_REVIEW_LANGUAGE_KEY);
    return value === "zh-CN" || value === "en-US" ? value : "auto";
  } catch {
    return "auto";
  }
}

export const useUiSettingsStore = defineStore("ui-settings", () => {
  const locale = ref<AppLocale>(currentLocale());
  const isDiffSyncScrollEnabled = ref(readBooleanSetting(DIFF_SYNC_SCROLL_KEY, true));
  const isDiffSidebarExpanded = ref(readBooleanSetting(DIFF_SIDEBAR_EXPANDED_KEY, false));
  const isPrDependenciesVisible = ref(readBooleanSetting(PR_DEPENDENCIES_VISIBLE_KEY, true));
  const isMergeQueueVisible = ref(readBooleanSetting(MERGE_QUEUE_VISIBLE_KEY, true));
  const aiReviewLanguagePreference = ref<AiReviewLanguagePreference>(
    readAiReviewLanguagePreference(),
  );

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

  function setLocale(value: AppLocale): void {
    locale.value = value;
    setAppLocale(value);
  }

  function setAiReviewLanguagePreference(value: AiReviewLanguagePreference): void {
    aiReviewLanguagePreference.value = value;
    try {
      if (value === "auto") localStorage.removeItem(AI_REVIEW_LANGUAGE_KEY);
      else localStorage.setItem(AI_REVIEW_LANGUAGE_KEY, value);
    } catch {
      // The selected language remains valid for this session.
    }
  }

  return {
    locale,
    isDiffSyncScrollEnabled,
    isDiffSidebarExpanded,
    isPrDependenciesVisible,
    isMergeQueueVisible,
    aiReviewLanguagePreference,
    setDiffSyncScrollEnabled,
    setDiffSidebarExpanded,
    setPrDependenciesVisible,
    setMergeQueueVisible,
    setLocale,
    setAiReviewLanguagePreference,
  };
});

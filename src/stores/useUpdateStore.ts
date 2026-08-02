import { defineStore } from "pinia";
import { onScopeDispose, ref } from "vue";
import {
  checkForUpdates,
  downloadAndInstallUpdate,
  openExternalUrl,
  listenToUpdateProgress,
  restartAfterUpdate,
} from "@/api";
import type { UpdateCheckResult } from "@/types";
import { getErrorMessage } from "@/utils/error";
import { translate } from "@/i18n";
import { readStorageString, writeStorageString } from "@/utils/storage";

const AUTO_UPDATE_CHECK_KEY = "mergebeacon:auto-update-check";
const LAST_UPDATE_CHECK_KEY = "mergebeacon:last-update-check";
const DISMISSED_UPDATE_VERSION_KEY = "mergebeacon:dismissed-update-version";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const useUpdateStore = defineStore("update", () => {
  const isAutoUpdateCheckEnabled = ref(readStorageString(AUTO_UPDATE_CHECK_KEY) !== "false");
  const isCheckingUpdate = ref(false);
  const updateResult = ref<UpdateCheckResult | null>(null);
  const updatePromptVersion = ref<string | null>(null);
  const updateError = ref("");
  const isInstallingUpdate = ref(false);
  const isRestartingUpdate = ref(false);
  const isUpdateInstalled = ref(false);
  const updateDownloaded = ref(0);
  const updateTotal = ref<number | null>(null);
  const updatePhase = ref<"downloading" | "installing" | null>(null);
  let unlistenUpdateProgress: (() => void) | null = null;
  let activeUpdateRequestId: string | null = null;
  let isDisposed = false;

  function clearUpdateProgressListener() {
    const unlisten = unlistenUpdateProgress;
    unlistenUpdateProgress = null;
    unlisten?.();
  }

  function isBackgroundCheckDue(now = Date.now()) {
    const lastCheck = Number(readStorageString(LAST_UPDATE_CHECK_KEY));
    return (
      !Number.isFinite(lastCheck) ||
      lastCheck <= 0 ||
      lastCheck > now ||
      now - lastCheck >= UPDATE_CHECK_INTERVAL_MS
    );
  }

  async function checkUpdate(isBackground = false) {
    if (
      isCheckingUpdate.value ||
      isInstallingUpdate.value ||
      isUpdateInstalled.value ||
      isRestartingUpdate.value
    ) {
      return;
    }
    if (!isBackground) {
      writeStorageString(LAST_UPDATE_CHECK_KEY, String(Date.now()));
      updateError.value = "";
      updateResult.value = null;
      updatePromptVersion.value = null;
    }

    isCheckingUpdate.value = true;
    try {
      const result = await checkForUpdates();
      updateResult.value = result;
      if (isBackground) {
        const dismissedVersion = readStorageString(DISMISSED_UPDATE_VERSION_KEY);
        updatePromptVersion.value =
          result.available && result.version !== dismissedVersion ? result.version : null;
      }
    } catch (error) {
      if (!isBackground) {
        updateError.value = getErrorMessage(error, translate("update.checkFailed"));
      }
    } finally {
      isCheckingUpdate.value = false;
    }
  }

  async function maybeCheckForUpdatesInBackground() {
    if (!isAutoUpdateCheckEnabled.value || !isBackgroundCheckDue()) return;
    writeStorageString(LAST_UPDATE_CHECK_KEY, String(Date.now()));
    await checkUpdate(true);
  }

  function dismissUpdatePrompt() {
    const dismissedVersion = updatePromptVersion.value;
    updatePromptVersion.value = null;
    if (dismissedVersion) {
      writeStorageString(DISMISSED_UPDATE_VERSION_KEY, dismissedVersion);
    }
  }

  async function setAutoUpdateCheckEnabled(enabled: boolean) {
    isAutoUpdateCheckEnabled.value = enabled;
    writeStorageString(AUTO_UPDATE_CHECK_KEY, String(enabled));
    if (enabled) {
      await maybeCheckForUpdatesInBackground();
    }
  }

  async function installUpdate() {
    const result = updateResult.value;
    const expectedVersion = result?.version;
    if (
      isInstallingUpdate.value ||
      isUpdateInstalled.value ||
      isRestartingUpdate.value ||
      !result?.available ||
      !expectedVersion
    ) {
      return;
    }

    updatePromptVersion.value = null;

    if (result.update_mode === "portable") {
      if (!result.portable_download_url) {
        updateError.value = translate("update.portableUrlMissing");
        return;
      }
      isInstallingUpdate.value = true;
      updateError.value = "";
      try {
        await openExternalUrl(result.portable_download_url);
      } catch (error) {
        updateError.value = getErrorMessage(error, translate("update.portableOpenFailed"));
      } finally {
        isInstallingUpdate.value = false;
      }
      return;
    }

    const requestId = crypto.randomUUID();
    activeUpdateRequestId = requestId;
    isInstallingUpdate.value = true;
    updateError.value = "";
    updateDownloaded.value = 0;
    updateTotal.value = null;
    updatePhase.value = "downloading";

    try {
      clearUpdateProgressListener();
      const unlisten = await listenToUpdateProgress((progress) => {
        if (progress.request_id !== activeUpdateRequestId) return;
        updatePhase.value = progress.phase;
        if (progress.phase === "downloading") {
          updateDownloaded.value = progress.downloaded;
          updateTotal.value = progress.total;
        }
      });
      if (isDisposed || activeUpdateRequestId !== requestId) {
        unlisten();
      } else {
        unlistenUpdateProgress = unlisten;
      }

      await downloadAndInstallUpdate(requestId, expectedVersion);
      isUpdateInstalled.value = true;
      updatePhase.value = null;
    } catch (error) {
      updateError.value = getErrorMessage(error, translate("update.installFailed"));
      updatePhase.value = null;
    } finally {
      if (activeUpdateRequestId === requestId) activeUpdateRequestId = null;
      isInstallingUpdate.value = false;
      clearUpdateProgressListener();
    }
  }

  async function restartUpdate() {
    if (isRestartingUpdate.value || !isUpdateInstalled.value) return;

    isRestartingUpdate.value = true;
    updateError.value = "";
    try {
      await restartAfterUpdate();
    } catch (error) {
      updateError.value = getErrorMessage(error, translate("update.restartFailed"));
    } finally {
      isRestartingUpdate.value = false;
    }
  }

  onScopeDispose(() => {
    isDisposed = true;
    activeUpdateRequestId = null;
    clearUpdateProgressListener();
  });

  return {
    isAutoUpdateCheckEnabled,
    isCheckingUpdate,
    updateResult,
    updatePromptVersion,
    updateError,
    isInstallingUpdate,
    isRestartingUpdate,
    isUpdateInstalled,
    updateDownloaded,
    updateTotal,
    updatePhase,
    checkUpdate,
    maybeCheckForUpdatesInBackground,
    dismissUpdatePrompt,
    setAutoUpdateCheckEnabled,
    installUpdate,
    restartUpdate,
  };
});

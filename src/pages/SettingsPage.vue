<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import {
  copyRecentErrorLogs as copyRecentErrorLogsToClipboard,
  copySupportInfo as copySupportInfoToClipboard,
  getAppVersion,
} from "@/api";
import { getErrorMessage } from "@/utils/error";
import { useAuthStore } from "@/stores/useAuthStore";
import { useUpdateStore } from "@/stores/useUpdateStore";
import { useUiSettingsStore } from "@/stores/useUiSettingsStore";
import { takeSettingsReturnLocation } from "@/services/settingsReturnNavigation";
import AppLayout from "@/components/layout/AppLayout.vue";
import AiSettings from "@/components/ai/AiSettings.vue";
import NotificationSettings from "@/components/notification/NotificationSettings.vue";
import MarkdownRenderer from "@/components/shared/MarkdownRenderer.vue";
import AppSelect from "@/components/shared/AppSelect.vue";
import type { Platform } from "@/types";
import { useI18n, type AppLocale } from "@/i18n";

const auth = useAuthStore();
const updates = useUpdateStore();
const uiSettings = useUiSettingsStore();
const router = useRouter();
const { t } = useI18n();
const {
  isAutoUpdateCheckEnabled,
  isCheckingUpdate,
  updateResult,
  updateError,
  isInstallingUpdate,
  isRestartingUpdate,
  isUpdateInstalled,
  updateDownloaded,
  updateTotal,
  updatePhase,
} = storeToRefs(updates);
const { locale, isDiffSyncScrollEnabled, isPrDependenciesVisible, isMergeQueueVisible } =
  storeToRefs(uiSettings);
const localeOptions = computed(() => [
  { value: "zh-CN", label: t("language.chinese") },
  { value: "en-US", label: t("language.english") },
]);
const selectedLocale = computed<AppLocale>({
  get: () => locale.value,
  set: (value) => uiSettings.setLocale(value),
});

const platformList: { value: Platform; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "gitee", label: "Gitee" },
];

const isCopyingSupportInfo = ref(false);
const supportInfoStatus = ref("");
const isSupportInfoError = ref(false);
const isCopyingErrorLogs = ref(false);
const errorLogStatus = ref("");
const isErrorLogError = ref(false);
const appVersion = ref("");
const versionError = ref("");
const isConfirmingInstall = ref(false);

function closeSettings() {
  const returnLocation = takeSettingsReturnLocation();
  void router.replace(
    returnLocation ??
      (auth.isLoggedIn
        ? { name: "pr-list" }
        : { path: "/login", query: { platform: auth.activePlatform } }),
  );
}

const updateProgressPercent = computed(() => {
  if (!updateTotal.value || updateTotal.value <= 0) return null;
  return Math.min(100, Math.round((updateDownloaded.value / updateTotal.value) * 100));
});

const isPortableUpdate = computed(() => updateResult.value?.update_mode === "portable");
const updateActionLabel = computed(() => {
  if (isInstallingUpdate.value) {
    return isPortableUpdate.value ? t("settings.openingBrowser") : t("settings.downloadInstalling");
  }
  return isPortableUpdate.value ? t("settings.downloadPortable") : t("settings.downloadUpdate");
});

onMounted(async () => {
  try {
    appVersion.value = await getAppVersion();
  } catch (error) {
    versionError.value = getErrorMessage(error, t("settings.versionUnavailable"));
  }
});

async function checkUpdate(isBackground = false) {
  isConfirmingInstall.value = false;
  await updates.checkUpdate(isBackground);
}

async function setAutoUpdateCheckEnabled(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  await updates.setAutoUpdateCheckEnabled(enabled);
}

function setDiffSyncScrollEnabled(event: Event) {
  uiSettings.setDiffSyncScrollEnabled((event.target as HTMLInputElement).checked);
}

function setPrDependenciesVisible(event: Event) {
  uiSettings.setPrDependenciesVisible((event.target as HTMLInputElement).checked);
}

function setMergeQueueVisible(event: Event) {
  uiSettings.setMergeQueueVisible((event.target as HTMLInputElement).checked);
}

async function installUpdate() {
  if (
    isInstallingUpdate.value ||
    isUpdateInstalled.value ||
    isRestartingUpdate.value ||
    !updateResult.value?.available
  ) {
    return;
  }
  if (!isPortableUpdate.value && !isConfirmingInstall.value) {
    isConfirmingInstall.value = true;
    return;
  }

  isConfirmingInstall.value = false;
  await updates.installUpdate();
}

function cancelInstallConfirmation() {
  isConfirmingInstall.value = false;
}

async function restartApp() {
  await updates.restartUpdate();
}

async function copySupportInfo() {
  if (isCopyingSupportInfo.value) return;

  isCopyingSupportInfo.value = true;
  supportInfoStatus.value = "";
  isSupportInfoError.value = false;
  try {
    await copySupportInfoToClipboard(auth.activePlatform);
    supportInfoStatus.value = t("settings.supportCopied");
  } catch (error) {
    isSupportInfoError.value = true;
    supportInfoStatus.value = t("common.copyFailed", {
      message: getErrorMessage(error, t("settings.supportUnavailable")),
    });
  } finally {
    isCopyingSupportInfo.value = false;
  }
}

async function copyRecentErrorLogs() {
  if (isCopyingErrorLogs.value) return;

  isCopyingErrorLogs.value = true;
  errorLogStatus.value = "";
  isErrorLogError.value = false;
  try {
    const count = await copyRecentErrorLogsToClipboard();
    errorLogStatus.value =
      count > 0 ? t("settings.errorLogCopied", { count }) : t("settings.errorLogEmpty");
  } catch (error) {
    isErrorLogError.value = true;
    errorLogStatus.value = t("common.copyFailed", {
      message: getErrorMessage(error, t("settings.errorLogsUnavailable")),
    });
  } finally {
    isCopyingErrorLogs.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <template #header>
      <div class="page-heading">
        <div>
          <h2>{{ t("settings.title") }}</h2>
          <p>{{ t("settings.description") }}</p>
        </div>
        <button
          class="btn-icon"
          type="button"
          :title="t('settings.close')"
          :aria-label="t('settings.close')"
          data-testid="close-settings"
          @click="closeSettings"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </template>

    <div id="settings-page-start" class="settings-page">
      <section class="card section">
        <div class="section-heading">
          <span class="section-icon" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </span>
          <div>
            <h3>{{ t("settings.interfaceTitle") }}</h3>
            <p>{{ t("settings.interfaceDescription") }}</p>
          </div>
        </div>
        <div class="setting-row">
          <span>
            <label class="setting-label" for="interface-language">
              {{ t("language.interface") }}
            </label>
            <span class="setting-hint">{{ t("language.interfaceHint") }}</span>
          </span>
          <AppSelect
            id="interface-language"
            v-model="selectedLocale"
            class="language-select"
            size="sm"
            :aria-label="t('language.interface')"
            :options="localeOptions"
          />
        </div>
        <div class="setting-row">
          <span>
            <span class="setting-label">{{ t("settings.diffSync") }}</span>
            <span class="setting-hint">{{ t("settings.diffSyncHint") }}</span>
          </span>
          <label class="toggle">
            <input
              type="checkbox"
              :aria-label="t('settings.diffSync')"
              :checked="isDiffSyncScrollEnabled"
              @change="setDiffSyncScrollEnabled"
            />
            <span class="toggle-slider" />
          </label>
        </div>
        <div class="setting-row">
          <span>
            <span class="setting-label">{{ t("settings.showDependencies") }}</span>
            <span class="setting-hint">{{ t("settings.showDependenciesHint") }}</span>
          </span>
          <label class="toggle">
            <input
              type="checkbox"
              :aria-label="t('settings.showDependencies')"
              :checked="isPrDependenciesVisible"
              @change="setPrDependenciesVisible"
            />
            <span class="toggle-slider" />
          </label>
        </div>
        <div class="setting-row">
          <span>
            <span class="setting-label">{{ t("settings.mergeQueue") }}</span>
            <span class="setting-hint">
              {{
                isPrDependenciesVisible
                  ? t("settings.mergeQueueHint")
                  : t("settings.mergeQueueDisabledHint")
              }}
            </span>
          </span>
          <label class="toggle">
            <input
              type="checkbox"
              :aria-label="t('settings.mergeQueue')"
              :checked="isPrDependenciesVisible && isMergeQueueVisible"
              :disabled="!isPrDependenciesVisible"
              @change="setMergeQueueVisible"
            />
            <span class="toggle-slider" />
          </label>
        </div>
        <div v-for="p in platformList" :key="p.value" class="setting-row">
          <span>
            <span class="setting-label">{{ p.label }}</span>
            <span class="setting-hint">{{ t("settings.platformVisible") }}</span>
          </span>
          <label class="toggle">
            <input
              type="checkbox"
              :aria-label="t('settings.showPlatform', { platform: p.label })"
              :checked="auth.platformVisibility[p.value]"
              :disabled="
                auth.platformVisibility[p.value] &&
                Object.values(auth.platformVisibility).filter(Boolean).length <= 1
              "
              @change="
                auth.setPlatformVisibility(p.value, ($event.target as HTMLInputElement).checked)
              "
            />
            <span class="toggle-slider" />
          </label>
        </div>
      </section>

      <section class="card section">
        <div class="section-heading">
          <span class="section-icon notification" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
              <path d="M10 21h4" />
            </svg>
          </span>
          <div>
            <h3>{{ t("settings.notificationTitle") }}</h3>
            <p>{{ t("settings.notificationDescription") }}</p>
          </div>
        </div>
        <NotificationSettings />
      </section>

      <section class="card section">
        <div class="section-heading">
          <span class="section-icon ai" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
              <circle cx="12" cy="12" r="5" />
              <path d="m15.5 8.5 2-2M6.5 17.5l2-2M8.5 8.5l-2-2M17.5 17.5l-2-2" />
            </svg>
          </span>
          <div>
            <h3>{{ t("settings.aiTitle") }}</h3>
            <p>{{ t("settings.aiDescription") }}</p>
          </div>
        </div>
        <AiSettings />
      </section>

      <section id="app-update" class="card section">
        <div class="section-heading update-heading">
          <span class="section-icon update" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </span>
          <div>
            <h3>{{ t("settings.updateTitle") }}</h3>
            <p>
              {{
                t("settings.currentVersion", {
                  version: appVersion ? `v${appVersion}` : t("settings.readingVersion"),
                })
              }}
            </p>
          </div>
          <button
            type="button"
            class="btn"
            data-testid="check-update"
            :disabled="
              isCheckingUpdate || isInstallingUpdate || isUpdateInstalled || isRestartingUpdate
            "
            @click="checkUpdate()"
          >
            {{ isCheckingUpdate ? t("settings.checkingUpdate") : t("settings.checkUpdate") }}
          </button>
        </div>
        <div class="auto-update-row">
          <span>
            <span class="setting-label">{{ t("settings.autoUpdate") }}</span>
            <span class="setting-hint">{{ t("settings.autoUpdateHint") }}</span>
          </span>
          <label class="toggle">
            <input
              type="checkbox"
              :aria-label="t('settings.autoUpdateAria')"
              :checked="isAutoUpdateCheckEnabled"
              @change="setAutoUpdateCheckEnabled"
            />
            <span class="toggle-slider" />
          </label>
        </div>
        <p v-if="versionError" class="support-status error" role="status">{{ versionError }}</p>
        <p v-if="updateError" class="support-status error" role="status" aria-live="polite">
          {{ updateError }}
        </p>
        <div v-if="updateResult?.available" class="update-result" role="status">
          <strong>{{
            t("settings.updateAvailable", { version: updateResult.version ?? "" })
          }}</strong>
          <p v-if="isPortableUpdate">
            {{ t("settings.portableInstructions") }}
          </p>
          <p v-else-if="!isUpdateInstalled">{{ t("settings.updateInstallerHint") }}</p>
          <p v-else>{{ t("settings.updateInstalled") }}</p>
          <MarkdownRenderer
            v-if="updateResult.notes"
            class="update-notes"
            :content="updateResult.notes"
            :breaks="false"
          />
          <div v-if="isInstallingUpdate" class="update-progress" aria-live="polite">
            <progress
              v-if="updateProgressPercent !== null"
              :value="updateProgressPercent"
              max="100"
            />
            <span v-if="updatePhase === 'installing'">{{ t("settings.installingUpdate") }}</span>
            <span v-else-if="updateProgressPercent !== null">
              {{ t("settings.downloading", { percent: updateProgressPercent ?? 0 }) }}
            </span>
            <span v-else>{{ t("settings.downloadingUpdate") }}</span>
          </div>
          <div class="update-actions">
            <template v-if="isUpdateInstalled">
              <button
                type="button"
                class="btn btn-primary"
                data-testid="install-update"
                :aria-busy="isRestartingUpdate"
                :disabled="isRestartingUpdate"
                @click="restartApp"
              >
                {{ isRestartingUpdate ? t("settings.restarting") : t("settings.restart") }}
              </button>
            </template>
            <template v-else-if="isConfirmingInstall">
              <span class="install-warning">{{ t("settings.workWarning") }}</span>
              <button
                type="button"
                class="btn btn-primary"
                data-testid="install-update"
                :disabled="isInstallingUpdate"
                @click="installUpdate"
              >
                {{ t("settings.confirmInstall") }}
              </button>
              <button
                type="button"
                class="btn"
                data-testid="cancel-install"
                @click="cancelInstallConfirmation"
              >
                {{ t("settings.cancelInstall") }}
              </button>
            </template>
            <button
              v-else
              type="button"
              class="btn btn-primary"
              data-testid="install-update"
              :disabled="isInstallingUpdate"
              @click="installUpdate"
            >
              {{ updateActionLabel }}
            </button>
          </div>
        </div>
        <p v-else-if="updateResult" class="support-status" role="status" aria-live="polite">
          {{ t("settings.latestVersion") }}
        </p>
        <p v-else class="privacy-note">{{ t("settings.officialUpdates") }}</p>
      </section>

      <section id="diagnostics" class="card section">
        <div class="section-heading support-heading">
          <span class="section-icon support" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" />
            </svg>
          </span>
          <div class="section-heading-copy">
            <h3>{{ t("settings.diagnosticsTitle") }}</h3>
            <p>{{ t("settings.diagnosticsDescription") }}</p>
          </div>
          <div class="support-actions">
            <button
              type="button"
              class="btn"
              data-testid="copy-support"
              :disabled="isCopyingSupportInfo"
              @click="copySupportInfo"
            >
              {{ isCopyingSupportInfo ? t("settings.copying") : t("settings.copySupport") }}
            </button>
            <button
              type="button"
              class="btn"
              data-testid="copy-error-logs"
              :disabled="isCopyingErrorLogs"
              @click="copyRecentErrorLogs"
            >
              {{ isCopyingErrorLogs ? t("settings.copying") : t("settings.copyErrorLogs") }}
            </button>
          </div>
        </div>
        <p class="privacy-note">
          {{ t("settings.diagnosticsPrivacy") }}
        </p>
        <p class="privacy-note">
          {{ t("settings.errorLogPrivacy") }}
        </p>
        <p
          v-if="supportInfoStatus"
          class="support-status"
          :class="{ error: isSupportInfoError }"
          role="status"
          aria-live="polite"
        >
          {{ supportInfoStatus }}
        </p>
        <p
          v-if="errorLogStatus"
          class="support-status"
          :class="{ error: isErrorLogError }"
          role="status"
          aria-live="polite"
        >
          {{ errorLogStatus }}
        </p>
      </section>
    </div>
  </AppLayout>
</template>

<style scoped src="./SettingsPage.css"></style>

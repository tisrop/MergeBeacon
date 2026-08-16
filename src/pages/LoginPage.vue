<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/useAuthStore";
import type { Platform } from "@/types";
import AppSelect from "@/components/shared/AppSelect.vue";
import BrandMark from "@/components/shared/BrandMark.vue";
import { authLogin } from "@/api";
import { getErrorMessage } from "@/utils/error";
import { open } from "@tauri-apps/plugin-shell";
import { useI18n } from "@/i18n";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

function parsePlatform(value: unknown): Platform | undefined {
  return value === "github" || value === "gitlab" || value === "gitee" ? value : undefined;
}

const platform = ref<Platform>(parsePlatform(route.query.platform) ?? "github");
const token = ref("");
const gitlabUrl = ref("");
const error = ref("");
const loading = ref(false);

watch(
  () => route.query.platform,
  (value) => {
    const requestedPlatform = parsePlatform(value);
    if (requestedPlatform) platform.value = requestedPlatform;
  },
);

const platforms: { value: Platform; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "gitee", label: "Gitee" },
];

const needsCustomUrl = computed(() => platform.value === "gitlab" || platform.value === "gitee");
const usesInsecureHttp = computed(() => getCustomUrl()?.startsWith("http://") ?? false);

function getCustomUrl(): string | undefined {
  if (!needsCustomUrl.value) return undefined;
  const url = gitlabUrl.value.trim();
  if (!url) return undefined;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `https://${url}`;
  }
  return url;
}

async function handleLogin() {
  if (!token.value.trim()) {
    error.value = t("login.tokenRequired");
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const result = await authLogin(platform.value, token.value.trim(), getCustomUrl());
    auth.platforms[platform.value] = { user: result.user, isLoggedIn: true };
    auth.activePlatform = platform.value;
    await router.replace("/pr");
  } catch (e) {
    error.value = getErrorMessage(e, t("login.error"));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-shell">
      <section class="login-intro" :aria-label="t('login.intro')">
        <div class="intro-mark" aria-hidden="true">
          <BrandMark />
        </div>
        <p class="intro-title">{{ t("login.introTitle") }}</p>
        <p>{{ t("login.introBody") }}</p>
        <ul>
          <li>{{ t("login.featurePlatforms") }}</li>
          <li>{{ t("login.featureReview") }}</li>
          <li>{{ t("login.featureSecurity") }}</li>
        </ul>
      </section>

      <main class="login-card">
        <div class="login-brand">
          <span class="login-brand-mark" aria-hidden="true">
            <BrandMark />
          </span>
          <h1>MergeBeacon</h1>
        </div>
        <p class="subtitle">{{ t("login.connect") }}</p>

        <div class="field">
          <label class="field-label">{{ t("login.platform") }}</label>
          <AppSelect v-model="platform" :options="platforms" />
        </div>

        <div v-if="needsCustomUrl" class="field">
          <label class="field-label" for="server-url">{{ t("login.serverUrl") }}</label>
          <input
            id="server-url"
            v-model="gitlabUrl"
            class="input"
            type="text"
            :placeholder="
              t('login.serverPlaceholder', {
                url: platform === 'gitlab' ? 'https://gitlab.com' : 'https://gitee.com',
              })
            "
          />
          <p class="field-hint">{{ t("login.serverHint") }}</p>
          <p v-if="usesInsecureHttp" class="http-warning">
            {{ t("login.httpWarning") }}
          </p>
        </div>

        <div class="field">
          <label class="field-label" for="access-token">{{ t("login.accessToken") }}</label>
          <input
            id="access-token"
            v-model="token"
            class="input"
            type="password"
            :placeholder="t('login.tokenPlaceholder')"
            @keyup.enter="handleLogin"
          />
          <p class="field-hint">{{ t("login.tokenHint") }}</p>
        </div>

        <div v-if="error" class="error-box-inline" role="alert">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {{ error }}
        </div>

        <button class="btn btn-primary login-btn" :disabled="loading" @click="handleLogin">
          <div v-if="loading" class="btn-spinner" />
          {{ loading ? t("login.loggingIn") : t("login.login") }}
        </button>

        <div class="help-links" :aria-label="t('login.tokenLinks')">
          <button
            type="button"
            class="token-link"
            @click="open('https://github.com/settings/tokens')"
          >
            GitHub Token
          </button>
          <button
            type="button"
            class="token-link"
            @click="open('https://gitlab.com/-/user_settings/personal_access_tokens')"
          >
            GitLab Token
          </button>
          <button
            type="button"
            class="token-link"
            @click="open('https://gitee.com/profile/personal_access_tokens')"
          >
            Gitee Token
          </button>
        </div>

        <p class="skip">
          <router-link to="/settings">{{ t("login.skip") }} →</router-link>
        </p>
      </main>
    </div>
  </div>
</template>

<style scoped src="./LoginPage.css"></style>

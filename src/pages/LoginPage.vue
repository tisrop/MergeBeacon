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

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

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
    error.value = "请输入 Token";
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
    error.value = getErrorMessage(e, "登录失败，请检查 Token 是否正确");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-shell">
      <section class="login-intro" aria-label="产品介绍">
        <div class="intro-mark" aria-hidden="true">
          <BrandMark />
        </div>
        <p class="intro-title">发现关键信号，放心完成每一次合并</p>
        <p>在一个工作台中管理多平台仓库、代码差异、评审意见与 AI 建议。</p>
        <ul>
          <li>GitHub、GitLab 与 Gitee 统一工作流</li>
          <li>聚焦上下文的代码评审体验</li>
          <li>Token 安全保存，敏感信息不出本机</li>
        </ul>
      </section>

      <main class="login-card">
        <div class="login-brand">
          <span class="login-brand-mark" aria-hidden="true">
            <BrandMark />
          </span>
          <h1>MergeBeacon</h1>
        </div>
        <p class="subtitle">连接代码托管平台，开始评审与 Issue 管理</p>

        <div class="form-group">
          <label>平台</label>
          <AppSelect v-model="platform" :options="platforms" />
        </div>

        <div v-if="needsCustomUrl" class="form-group">
          <label for="server-url">服务器地址（可选）</label>
          <input
            id="server-url"
            v-model="gitlabUrl"
            class="input"
            type="text"
            :placeholder="
              platform === 'gitlab'
                ? 'https://gitlab.com（留空使用官方）'
                : 'https://gitee.com（留空使用官方）'
            "
          />
          <p class="hint">私有化部署请填写完整地址，如 https://gitlab.example.com</p>
          <p v-if="usesInsecureHttp" class="http-warning">
            HTTP 连接不会加密 Token，请仅用于可信内网。
          </p>
        </div>

        <div class="form-group">
          <label for="access-token">Personal Access Token</label>
          <input
            id="access-token"
            v-model="token"
            class="input"
            type="password"
            placeholder="输入你的 Token..."
            @keyup.enter="handleLogin"
          />
          <p class="hint">Token 优先保存到系统凭证库；不可用时保存到本地加密文件。</p>
        </div>

        <div v-if="error" class="error-box" role="alert">
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
          {{ loading ? "登录中..." : "登录" }}
        </button>

        <div class="help-links" aria-label="Token 获取链接">
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
          <router-link to="/settings">跳过登录，先去设置 →</router-link>
        </p>
      </main>
    </div>
  </div>
</template>

<style scoped src="./LoginPage.css"></style>

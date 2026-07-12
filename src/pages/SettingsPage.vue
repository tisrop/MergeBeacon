<script setup lang="ts">
import { useAuthStore } from "@/stores/useAuthStore";
import AppLayout from "@/components/layout/AppLayout.vue";
import AiSettings from "@/components/ai/AiSettings.vue";
import type { Platform } from "@/types";

const auth = useAuthStore();

const platformList: { value: Platform; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "gitee", label: "Gitee" },
];
</script>

<template>
  <AppLayout>
    <template #header>
      <div class="settings-header">
        <h2>设置</h2>
        <p>管理代码平台显示方式与 AI 评审服务</p>
      </div>
    </template>

    <div class="settings-page">
      <section class="section">
        <div class="section-heading">
          <span class="section-icon" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </span>
          <div>
            <h3>界面设置</h3>
            <p>选择需要在侧边栏中显示的代码托管平台。</p>
          </div>
        </div>
        <div v-for="p in platformList" :key="p.value" class="setting-row">
          <span>
            <span class="setting-label">{{ p.label }}</span>
            <span class="setting-hint">在平台切换器中显示</span>
          </span>
          <label class="toggle">
            <input
              type="checkbox"
              :aria-label="`显示 ${p.label}`"
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

      <section class="section">
        <div class="section-heading">
          <span class="section-icon ai" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
              <circle cx="12" cy="12" r="5" />
              <path d="m15.5 8.5 2-2M6.5 17.5l2-2M8.5 8.5l-2-2M17.5 17.5l-2-2" />
            </svg>
          </span>
          <div>
            <h3>AI 评审设置</h3>
            <p>配置兼容 OpenAI 协议的模型服务与访问凭据。</p>
          </div>
        </div>
        <AiSettings />
      </section>
    </div>
  </AppLayout>
</template>

<style scoped>
.settings-page {
  max-width: 720px;
}

.section {
  margin-bottom: var(--space-6);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.settings-header h2 {
  font-size: 20px;
  letter-spacing: -0.02em;
}

.settings-header p {
  margin-top: 2px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.section-heading h3 {
  font-size: 15px;
  font-weight: 600;
}

.section-heading p,
.setting-hint {
  display: block;
  margin-top: 2px;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.section-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--color-primary);
  background: var(--color-primary-light);
}

.section-icon.ai {
  color: var(--color-success);
  background: var(--color-success-light);
}

.section-icon svg {
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 54px;
  padding: var(--space-2) 0;
}

.setting-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.toggle {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: pointer;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--color-border);
  border-radius: 24px;
  transition: background var(--transition-fast);
}

.toggle-slider::before {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: transform var(--transition-fast);
}

.toggle input:checked + .toggle-slider {
  background: var(--color-primary);
}

.toggle input:checked + .toggle-slider::before {
  transform: translateX(20px);
}

.toggle input:focus-visible + .toggle-slider {
  outline: 3px solid rgba(57, 120, 189, 0.28);
  outline-offset: 2px;
}

.toggle input:disabled + .toggle-slider {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle input:disabled ~ .toggle-slider {
  cursor: not-allowed;
}
</style>

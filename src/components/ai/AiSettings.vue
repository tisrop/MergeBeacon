<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { aiGetConfig, aiSaveConfig, aiSaveApiKey, aiTestConnection, aiListModels } from "@/api";
import { useI18n } from "@/i18n";
import type { AiConfig } from "@/types";
import { getErrorMessage } from "@/utils/error";

const { t } = useI18n();

const config = ref<AiConfig>({
  endpoint: "https://api.openai.com/v1",
  model: "gpt-5.6",
  api_key_configured: false,
  system_prompt: null,
  temperature: 0.3,
  max_tokens: 8192,
});

const newApiKey = ref("");
const testing = ref(false);
const saving = ref(false);
const testResult = ref<boolean | null>(null);
const saveMsg = ref("");

const models = ref<string[]>([]);
const fetchingModels = ref(false);
const showModelDropdown = ref(false);
const modelError = ref("");
const modelSearch = ref("");

const filteredModels = computed(() => {
  if (!modelSearch.value) return models.value;
  const q = modelSearch.value.toLowerCase();
  return models.value.filter((m) => m.toLowerCase().includes(q));
});

function onFocusModel() {
  if (models.value.length > 0) {
    modelSearch.value = "";
    showModelDropdown.value = true;
  }
}

function onInputModel() {
  showModelDropdown.value = true;
}

function selectModel(model: string) {
  config.value.model = model;
  modelSearch.value = "";
  showModelDropdown.value = false;
}

function onBlurDropdown() {
  setTimeout(() => {
    showModelDropdown.value = false;
  }, 200);
}

function onKeydownModel(e: KeyboardEvent) {
  if (!showModelDropdown.value || filteredModels.value.length === 0) return;
  if (e.key === "Escape") {
    showModelDropdown.value = false;
  }
  if (e.key === "Enter") {
    const first = filteredModels.value[0];
    if (first) selectModel(first);
    e.preventDefault();
  }
}

interface HighlightSegment {
  text: string;
  matched: boolean;
}

function highlight(text: string, query: string): HighlightSegment[] {
  if (!query) return [{ text, matched: false }];
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery);
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      segments.push({ text: text.slice(cursor, matchIndex), matched: false });
    }
    const matchEnd = matchIndex + query.length;
    segments.push({ text: text.slice(matchIndex, matchEnd), matched: true });
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false });
  return segments.length > 0 ? segments : [{ text, matched: false }];
}

const presets = computed(() => [
  { name: "OpenAI", endpoint: "https://api.openai.com/v1", model: "gpt-5.6" },
  { name: "DeepSeek", endpoint: "https://api.deepseek.com/v1", model: "deepseek-v4-flash" },
  {
    name: t("aiSettings.presetQwen"),
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  { name: "Moonshot", endpoint: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: t("aiSettings.presetOllama"), endpoint: "http://localhost:11434/v1", model: "llama3" },
]);

onMounted(async () => {
  try {
    config.value = await aiGetConfig();
  } catch {
    // use defaults
  }
});

function applyPreset(p: (typeof presets.value)[number]) {
  config.value.endpoint = p.endpoint;
  config.value.model = p.model;
  models.value = [];
}

async function handleFetchModels() {
  if (!config.value.endpoint) {
    modelError.value = t("aiSettings.apiEndpointRequired");
    return;
  }

  fetchingModels.value = true;
  modelError.value = "";
  models.value = [];

  try {
    if (newApiKey.value.trim()) {
      await aiSaveApiKey(newApiKey.value.trim());
      newApiKey.value = "";
      config.value.api_key_configured = true;
    }

    const result = await aiListModels(config.value.endpoint);
    models.value = result;
    if (result.length === 0) {
      modelError.value = t("aiSettings.loadModelsEmpty");
    }
    showModelDropdown.value = true;
  } catch (e) {
    modelError.value = getErrorMessage(e, t("aiSettings.loadModelsFailed"));
  } finally {
    fetchingModels.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  saveMsg.value = "";
  const hasNewKey = !!newApiKey.value;
  try {
    await aiSaveConfig(config.value);
    if (hasNewKey) {
      await aiSaveApiKey(newApiKey.value);
      newApiKey.value = "";
      config.value.api_key_configured = true;
    }
    saveMsg.value = t("aiSettings.saved");

    if (hasNewKey && config.value.endpoint) {
      await handleFetchModels();
    }
  } catch (e) {
    saveMsg.value = t("aiSettings.saveFailed", {
      message: getErrorMessage(e, t("common.unknownError")),
    });
  } finally {
    saving.value = false;
  }
}

async function handleTest() {
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await aiTestConnection();
  } catch {
    testResult.value = false;
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div class="ai-settings">
    <div class="presets">
      <label>{{ t("aiSettings.preset") }}</label>
      <div class="preset-btns">
        <button v-for="p in presets" :key="p.name" class="btn btn-sm" @click="applyPreset(p)">
          {{ p.name }}
        </button>
      </div>
    </div>

    <div class="field">
      <label>{{ t("aiSettings.apiEndpoint") }}</label>
      <input
        v-model="config.endpoint"
        class="input"
        type="text"
        placeholder="https://api.openai.com/v1"
      />
    </div>

    <div class="field">
      <label>{{ t("aiSettings.apiKey") }}</label>
      <input
        v-model="newApiKey"
        class="input"
        type="password"
        :placeholder="
          config.api_key_configured
            ? t('aiSettings.apiKeyReplace')
            : t('aiSettings.apiKeyPlaceholder')
        "
      />
      <p class="hint">{{ t("aiSettings.apiKeyEncrypted") }}</p>
    </div>

    <div class="field">
      <label>{{ t("aiSettings.model") }}</label>
      <div class="model-row">
        <div class="model-input-wrap">
          <input
            :value="showModelDropdown ? modelSearch : config.model"
            class="input"
            type="text"
            :placeholder="config.model || 'gpt-5.6'"
            @focus="onFocusModel"
            @input="
              modelSearch = ($event.target as HTMLInputElement).value;
              onInputModel();
            "
            @blur="onBlurDropdown"
            @keydown="onKeydownModel"
          />
          <div v-if="showModelDropdown && models.length > 0" class="model-dropdown">
            <div v-if="modelSearch" class="model-search-hint">
              {{
                t("aiSettings.modelSearchResults", {
                  query: modelSearch,
                  count: filteredModels.length,
                })
              }}
            </div>
            <div
              v-for="m in filteredModels"
              :key="m"
              class="model-item"
              :class="{ selected: m === config.model }"
              @mousedown.prevent="selectModel(m)"
            >
              <span v-if="modelSearch">
                <template v-for="(segment, index) in highlight(m, modelSearch)" :key="index">
                  <mark v-if="segment.matched">{{ segment.text }}</mark>
                  <template v-else>{{ segment.text }}</template>
                </template>
              </span>
              <span v-else>{{ m }}</span>
            </div>
            <div v-if="filteredModels.length === 0" class="model-empty">
              {{ t("aiSettings.modelNoMatch") }}
            </div>
          </div>
        </div>
        <button
          class="btn btn-sm fetch-models-button"
          :disabled="fetchingModels"
          @click="handleFetchModels"
        >
          {{ fetchingModels ? t("aiSettings.fetchingModels") : t("aiSettings.fetchModels") }}
        </button>
      </div>
      <p v-if="modelError" class="model-error">{{ modelError }}</p>
      <p v-else-if="models.length > 0" class="model-count">
        {{ t("aiSettings.modelCount", { count: models.length }) }}
      </p>
      <p v-else class="hint">{{ t("aiSettings.loadModelsHint") }}</p>
    </div>

    <div class="field">
      <label>{{ t("aiSettings.temperature", { value: config.temperature ?? 0.3 }) }}</label>
      <input
        v-model.number="config.temperature"
        type="range"
        min="0"
        max="2"
        step="0.1"
        class="range-input"
      />
    </div>

    <div class="field">
      <label>{{ t("aiSettings.maxTokens") }}</label>
      <input v-model.number="config.max_tokens" class="input" type="number" min="256" max="32768" />
      <p class="hint">{{ t("aiSettings.maxTokensHint") }}</p>
    </div>

    <div class="actions">
      <button class="btn" :disabled="testing" @click="handleTest">
        {{ testing ? t("aiSettings.testing") : t("aiSettings.testConnection") }}
      </button>
      <button class="btn btn-primary" :disabled="saving" @click="handleSave">
        {{ saving ? t("aiSettings.saving") : t("aiSettings.saveSettings") }}
      </button>
    </div>

    <div
      v-if="testResult !== null"
      class="test-result"
      :class="{ success: testResult, fail: !testResult }"
    >
      {{ testResult ? t("aiSettings.connectionSuccess") : t("aiSettings.connectionFailed") }}
    </div>

    <div v-if="saveMsg" class="save-msg">{{ saveMsg }}</div>
  </div>
</template>

<style scoped src="./AiSettings.css"></style>

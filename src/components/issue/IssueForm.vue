<script setup lang="ts">
import { computed } from "vue";
import AppMultiSelect from "@/components/shared/AppMultiSelect.vue";
import AppSelect from "@/components/shared/AppSelect.vue";
import type { IssueTemplate, PrLabel } from "@/types";
import { useI18n } from "@/i18n";

const props = defineProps<{
  title: string;
  body: string;
  labels: string[];
  availableLabels: PrLabel[];
  labelsLoading: boolean;
  labelsError: string;
  templates: IssueTemplate[];
  selectedTemplatePath: string;
  templatesLoading: boolean;
  templatesError: string;
  error: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  "update:title": [value: string];
  "update:body": [value: string];
  "update:labels": [value: string[]];
  "update:selectedTemplatePath": [value: string];
  "reload-labels": [];
  "reload-templates": [];
  "apply-template": [];
  submit: [];
}>();
const { t } = useI18n();

const labelOptions = computed(() =>
  props.availableLabels.map((label) => ({
    value: label.name,
    label: label.name,
    color: label.color,
    description: label.description,
  })),
);
const templateOptions = computed(() => {
  if (props.templatesLoading && props.templates.length === 0) return [];
  return [
    { value: "", label: t("issue.templateNone") },
    ...props.templates.map((template) => ({
      value: template.source_path,
      label: template.name,
    })),
  ];
});
const selectedTemplate = computed(() =>
  props.templates.find((template) => template.source_path === props.selectedTemplatePath),
);
</script>

<template>
  <form class="card issue-form" @submit.prevent="emit('submit')">
    <div class="issue-form-heading">
      <div class="issue-form-icon" aria-hidden="true">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div>
        <h3>{{ t("issue.formTitle") }}</h3>
        <p>{{ t("issue.formDescription") }}</p>
      </div>
    </div>

    <div class="issue-form-fields">
      <div class="field template-field">
        <div class="field-label-row field-label-spread">
          <span class="field-caption">{{ t("issue.templateDescription") }}</span>
          <button
            v-if="templatesError"
            class="field-retry"
            type="button"
            @click="emit('reload-templates')"
          >
            {{ t("common.reload") }}
          </button>
        </div>
        <div class="template-controls">
          <AppSelect
            id="issue-template"
            :model-value="selectedTemplatePath"
            :options="templateOptions"
            :placeholder="
              templatesLoading ? t('issue.templateLoadingPlaceholder') : t('issue.templateNone')
            "
            :aria-label="t('issue.templateSelect')"
            searchable
            :search-placeholder="t('issue.templateSearch')"
            @update:model-value="emit('update:selectedTemplatePath', $event)"
          />
          <button
            class="btn btn-sm"
            type="button"
            :disabled="!selectedTemplate || templatesLoading"
            @click="emit('apply-template')"
          >
            {{ t("issue.templateApply") }}
          </button>
        </div>
        <p v-if="templatesError" class="field-message field-message-error" role="alert">
          {{ templatesError }}，{{ t("issue.templateErrorSuffix") }}
        </p>
        <p v-else-if="selectedTemplate?.description" class="field-help">
          {{ selectedTemplate.description }}。{{ t("issue.templateOverwrite") }}
        </p>
        <p v-else class="field-help">
          {{ templatesLoading ? t("issue.templateLoading") : t("issue.templateHint") }}
        </p>
      </div>

      <div class="field">
        <div class="field-label-row">
          <label for="issue-title">{{ t("issue.title") }}</label>
          <span class="required">{{ t("issue.required") }}</span>
        </div>
        <input
          id="issue-title"
          class="input"
          :value="title"
          autocomplete="off"
          autofocus
          @input="emit('update:title', ($event.target as HTMLInputElement).value)"
          :placeholder="t('issue.titlePlaceholder')"
        />
        <p class="field-help">{{ t("issue.titleHint") }}</p>
      </div>

      <div class="field">
        <label for="issue-body">{{ t("issue.body") }}</label>
        <textarea
          id="issue-body"
          class="input issue-body-input"
          :value="body"
          @input="emit('update:body', ($event.target as HTMLTextAreaElement).value)"
          :placeholder="t('issue.bodyPlaceholder')"
          rows="10"
        />
        <p class="field-help">{{ t("issue.bodyHint") }}</p>
      </div>

      <div class="field">
        <div class="field-label-row field-label-spread">
          <span class="field-caption">{{ t("issue.labels") }}</span>
          <button
            v-if="labelsError"
            class="field-retry"
            type="button"
            @click="emit('reload-labels')"
          >
            {{ t("common.reload") }}
          </button>
        </div>
        <AppMultiSelect
          :model-value="labels"
          :options="labelOptions"
          :disabled="labelsLoading"
          :placeholder="labelsLoading ? t('common.loadingMore') : t('issue.labelPlaceholder')"
          :search-placeholder="t('issue.labelSearch')"
          :empty-text="t('issue.labelEmpty')"
          :empty-search-text="t('issue.labelNoMatch')"
          :aria-label="t('issue.selectLabelsAria')"
          @update:model-value="emit('update:labels', $event)"
        />
        <p v-if="labelsError" class="field-message field-message-error" role="alert">
          {{ labelsError }}，{{ t("issue.labelErrorSuffix") }}
        </p>
        <p v-else class="field-help">
          {{ t("issue.labelHint") }}
        </p>
      </div>

      <div v-if="error" class="error" role="alert">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{{ error }}</span>
      </div>
    </div>

    <div class="form-actions">
      <span>{{ t("issue.cancelHint") }}</span>
      <div class="form-action-buttons">
        <router-link to="/issue" class="btn">{{ t("common.cancel") }}</router-link>
        <button class="btn btn-primary" type="submit" :disabled="submitting || !title.trim()">
          <svg
            v-if="!submitting"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {{ submitting ? t("issue.creating") : t("issue.create") }}
        </button>
      </div>
    </div>
  </form>
</template>

<style scoped src="./IssueForm.css"></style>

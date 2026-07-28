<script setup lang="ts">
import { computed } from "vue";
import AppMultiSelect from "@/components/shared/AppMultiSelect.vue";
import AppSelect from "@/components/shared/AppSelect.vue";
import type { IssueTemplate, PrLabel } from "@/types";

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
    { value: "", label: "不使用模板" },
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
        <h3>Issue 内容</h3>
        <p>清晰说明问题、期望结果和必要的复现信息。</p>
      </div>
    </div>

    <div class="issue-form-fields">
      <div class="field template-field">
        <div class="field-label-row field-label-spread">
          <span class="field-caption">创建模板</span>
          <button
            v-if="templatesError"
            class="field-retry"
            type="button"
            @click="emit('reload-templates')"
          >
            重新加载
          </button>
        </div>
        <div class="template-controls">
          <AppSelect
            id="issue-template"
            :model-value="selectedTemplatePath"
            :options="templateOptions"
            :placeholder="templatesLoading ? '正在拉取仓库模板…' : '不使用模板'"
            aria-label="选择 Issue 创建模板"
            searchable
            search-placeholder="搜索模板"
            @update:model-value="emit('update:selectedTemplatePath', $event)"
          />
          <button
            class="btn btn-sm"
            type="button"
            :disabled="!selectedTemplate || templatesLoading"
            @click="emit('apply-template')"
          >
            应用模板
          </button>
        </div>
        <p v-if="templatesError" class="field-message field-message-error" role="alert">
          {{ templatesError }}，仍可手动填写 Issue。
        </p>
        <p v-else-if="selectedTemplate?.description" class="field-help">
          {{ selectedTemplate.description }}。应用后会覆盖当前标题和描述。
        </p>
        <p v-else class="field-help">
          {{
            templatesLoading
              ? "正在读取目标仓库中的 Issue 模板。"
              : "可选；选择后点击“应用模板”填充内容。"
          }}
        </p>
      </div>

      <div class="field">
        <div class="field-label-row">
          <label for="issue-title">标题</label>
          <span class="required">必填</span>
        </div>
        <input
          id="issue-title"
          class="input"
          :value="title"
          autocomplete="off"
          autofocus
          @input="emit('update:title', ($event.target as HTMLInputElement).value)"
          placeholder="用一句话概括需要处理的问题"
        />
        <p class="field-help">建议包含模块或场景，方便团队快速识别。</p>
      </div>

      <div class="field">
        <label for="issue-body">描述</label>
        <textarea
          id="issue-body"
          class="input issue-body-input"
          :value="body"
          @input="emit('update:body', ($event.target as HTMLTextAreaElement).value)"
          placeholder="描述背景、当前表现、期望结果，以及可复现问题的步骤…"
          rows="10"
        />
        <p class="field-help">支持 Markdown，可粘贴代码片段、日志和任务清单。</p>
      </div>

      <div class="field">
        <div class="field-label-row field-label-spread">
          <span class="field-caption">标签</span>
          <button
            v-if="labelsError"
            class="field-retry"
            type="button"
            @click="emit('reload-labels')"
          >
            重新加载
          </button>
        </div>
        <AppMultiSelect
          :model-value="labels"
          :options="labelOptions"
          :disabled="labelsLoading"
          :placeholder="labelsLoading ? '正在拉取仓库标签…' : '选择仓库标签'"
          search-placeholder="搜索仓库标签"
          empty-text="目标仓库暂无可用标签"
          empty-search-text="没有匹配的仓库标签"
          aria-label="选择 Issue 标签"
          @update:model-value="emit('update:labels', $event)"
        />
        <p v-if="labelsError" class="field-message field-message-error" role="alert">
          {{ labelsError }}，可以不添加标签继续创建。
        </p>
        <p v-else class="field-help">
          仅可选择目标仓库已有标签；如需新标签，请先在代码托管平台创建。
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
      <span>创建后可在 Issue 列表中继续跟踪和管理。</span>
      <div class="form-action-buttons">
        <router-link to="/issue" class="btn">取消</router-link>
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
          {{ submitting ? "正在创建…" : "创建 Issue" }}
        </button>
      </div>
    </div>
  </form>
</template>

<style scoped src="./IssueForm.css"></style>

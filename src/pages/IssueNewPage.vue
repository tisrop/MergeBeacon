<script setup lang="ts">
import { onScopeDispose, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/useAuthStore";
import { useIssueStore } from "@/stores/useIssueStore";
import { useRepoStore } from "@/stores/useRepoStore";
import AppLayout from "@/components/layout/AppLayout.vue";
import IssueForm from "@/components/issue/IssueForm.vue";
import { issueCreate, issueTemplates, listRepositoryLabels } from "@/api";
import type { IssueTemplate, Platform, PrLabel } from "@/types";
import { getErrorMessage } from "@/utils/error";

const router = useRouter();
const auth = useAuthStore();
const issueStore = useIssueStore();
const repo = useRepoStore();

const title = ref("");
const body = ref("");
const labels = ref<string[]>([]);
const availableLabels = ref<PrLabel[]>([]);
const labelsLoading = ref(false);
const labelsError = ref("");
const templates = ref<IssueTemplate[]>([]);
const selectedTemplatePath = ref("");
const templatesLoading = ref(false);
const templatesError = ref("");
const submitting = ref(false);
const error = ref("");
const pendingTemplateLabels = ref<string[] | null>(null);
let labelsRequestSequence = 0;
let templatesRequestSequence = 0;
let submitRequestSequence = 0;

type RepositoryContext = {
  platform: Platform;
  owner: string;
  repo: string;
};

function currentContext(): RepositoryContext | null {
  if (!repo.activeRepo) return null;
  return {
    platform: auth.activePlatform,
    owner: repo.activeRepo.owner,
    repo: repo.activeRepo.repo,
  };
}

function matchAvailableLabels(candidates: string[]): string[] {
  const availableByName = new Map(
    availableLabels.value.map((label) => [label.name.toLocaleLowerCase(), label.name]),
  );
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const matched = availableByName.get(candidate.trim().toLocaleLowerCase());
    if (!matched || seen.has(matched)) return [];
    seen.add(matched);
    return [matched];
  });
}

function resolvePendingTemplateLabels(): void {
  if (pendingTemplateLabels.value === null) return;
  labels.value = matchAvailableLabels(pendingTemplateLabels.value);
  pendingTemplateLabels.value = null;
}

async function loadLabels(context = currentContext()) {
  const requestSequence = ++labelsRequestSequence;
  labelsError.value = "";
  if (!context) {
    labelsLoading.value = false;
    return;
  }

  labelsLoading.value = true;
  try {
    const items = await listRepositoryLabels(context.platform, context.owner, context.repo);
    if (requestSequence !== labelsRequestSequence) return;
    const seen = new Set<string>();
    availableLabels.value = items.flatMap((item) => {
      const name = item.name.trim();
      const normalized = name.toLocaleLowerCase();
      if (!normalized || seen.has(normalized)) return [];
      seen.add(normalized);
      return [{ ...item, name }];
    });
    if (pendingTemplateLabels.value !== null) resolvePendingTemplateLabels();
    else labels.value = matchAvailableLabels(labels.value);
  } catch (loadError) {
    if (requestSequence !== labelsRequestSequence) return;
    labelsError.value = getErrorMessage(loadError, "仓库标签加载失败");
  } finally {
    if (requestSequence === labelsRequestSequence) labelsLoading.value = false;
  }
}

async function loadTemplates(context = currentContext()) {
  const requestSequence = ++templatesRequestSequence;
  templatesError.value = "";
  if (!context) {
    templatesLoading.value = false;
    return;
  }

  templatesLoading.value = true;
  try {
    const items = await issueTemplates(context.platform, context.owner, context.repo);
    if (requestSequence !== templatesRequestSequence) return;
    const seen = new Set<string>();
    templates.value = items.filter((item) => {
      if (!item.source_path || seen.has(item.source_path)) return false;
      seen.add(item.source_path);
      return true;
    });
    if (selectedTemplatePath.value && !seen.has(selectedTemplatePath.value)) {
      selectedTemplatePath.value = "";
    }
  } catch (loadError) {
    if (requestSequence !== templatesRequestSequence) return;
    templatesError.value = getErrorMessage(loadError, "Issue 模板加载失败");
  } finally {
    if (requestSequence === templatesRequestSequence) templatesLoading.value = false;
  }
}

function applyTemplate() {
  const template = templates.value.find((item) => item.source_path === selectedTemplatePath.value);
  if (!template) return;
  if (template.title.trim()) title.value = template.title;
  body.value = template.body;
  pendingTemplateLabels.value = template.labels;
  if (!labelsLoading.value && !labelsError.value) resolvePendingTemplateLabels();
  error.value = "";
}

watch(
  [() => auth.activePlatform, () => repo.activeRepo?.owner, () => repo.activeRepo?.repo],
  ([platform, owner, repository]) => {
    labelsRequestSequence += 1;
    templatesRequestSequence += 1;
    submitRequestSequence += 1;
    title.value = "";
    body.value = "";
    labels.value = [];
    pendingTemplateLabels.value = null;
    selectedTemplatePath.value = "";
    error.value = "";
    submitting.value = false;
    availableLabels.value = [];
    templates.value = [];
    labelsError.value = "";
    templatesError.value = "";
    if (!owner || !repository) {
      labelsLoading.value = false;
      templatesLoading.value = false;
      return;
    }
    const context = { platform, owner, repo: repository };
    void loadLabels(context);
    void loadTemplates(context);
  },
  { immediate: true },
);

onScopeDispose(() => {
  labelsRequestSequence += 1;
  templatesRequestSequence += 1;
  submitRequestSequence += 1;
});

async function handleSubmit() {
  if (!repo.activeRepo) return;
  if (!title.value.trim()) {
    error.value = "请输入标题";
    return;
  }

  const context = currentContext();
  if (!context) return;
  const requestSequence = ++submitRequestSequence;
  submitting.value = true;
  error.value = "";
  try {
    const createdIssue = await issueCreate(
      context.platform,
      context.owner,
      context.repo,
      title.value,
      body.value,
      labels.value,
    );
    if (requestSequence !== submitRequestSequence) return;
    issueStore.rememberCreatedIssue(context.platform, context.owner, context.repo, createdIssue);
    void router.push({ name: "issue-list" });
  } catch (submitError) {
    if (requestSequence !== submitRequestSequence) return;
    error.value = getErrorMessage(submitError, "创建失败");
  } finally {
    if (requestSequence === submitRequestSequence) submitting.value = false;
  }
}
</script>

<template>
  <AppLayout>
    <template #header>
      <div class="issue-new-header page-heading">
        <div>
          <h2>新建 Issue</h2>
          <p v-if="repo.activeFullName">将在 {{ repo.activeFullName }} 中创建</p>
          <p v-else>请先选择目标仓库</p>
        </div>
        <router-link to="/issue" class="btn btn-sm">返回 Issue 列表</router-link>
      </div>
    </template>

    <div class="issue-new-content">
      <IssueForm
        v-if="repo.activeRepo"
        v-model:title="title"
        v-model:body="body"
        v-model:labels="labels"
        v-model:selected-template-path="selectedTemplatePath"
        :available-labels="availableLabels"
        :labels-loading="labelsLoading"
        :labels-error="labelsError"
        :templates="templates"
        :templates-loading="templatesLoading"
        :templates-error="templatesError"
        :error="error"
        :submitting="submitting"
        @reload-labels="loadLabels()"
        @reload-templates="loadTemplates()"
        @apply-template="applyTemplate"
        @submit="handleSubmit"
      />

      <div v-else class="issue-new-empty state-panel" role="status">
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M4 4h16v16H4z" />
          <path d="M8 9h8M8 13h5" />
        </svg>
        <strong>尚未选择目标仓库</strong>
        <p>请先从左侧仓库列表中选择一个仓库，再创建 Issue。</p>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped src="./IssueNewPage.css"></style>

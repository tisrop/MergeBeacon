<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { prDependencies } from "@/api";
import { useI18n } from "@/i18n";
import { getErrorMessage } from "@/utils/error";
import type { Platform, PrDependencyGraph, PrDependencyNode, PrState } from "@/types";

const props = defineProps<{
  platform: Platform;
  owner: string;
  repo: string;
  prNumber: number;
  revision: string;
}>();
const { t } = useI18n();

const graph = ref<PrDependencyGraph | null>(null);
const loading = ref(false);
const error = ref("");
let requestSequence = 0;

const itemName = computed(() => (props.platform === "gitlab" ? "MR" : "PR"));
const nodesByNumber = computed(
  () => new Map((graph.value?.nodes ?? []).map((node) => [node.number, node])),
);
const currentNode = computed(() => nodesByNumber.value.get(graph.value?.current_number ?? 0));
const currentIsOpen = computed(() => currentNode.value?.state === "open");
const orderedNodes = computed(() =>
  (graph.value?.suggested_merge_order ?? [])
    .map((number) => nodesByNumber.value.get(number))
    .filter((node): node is PrDependencyNode => Boolean(node)),
);
const blockingParents = computed(() => new Set(graph.value?.blocking_parent_numbers ?? []));

const stateLabels = computed<Record<PrState, string>>(() => ({
  open: t("dependency.stateOpen"),
  closed: t("dependency.stateClosed"),
  merged: t("dependency.stateMerged"),
  all: t("dependency.stateAll"),
}));

const stateBadgeClasses: Record<string, string> = {
  open: "badge-open",
  closed: "badge-closed",
  merged: "badge-merged",
};

function parentNumbers(number: number): number[] {
  return (graph.value?.edges ?? [])
    .filter((edge) => edge.child_number === number)
    .map((edge) => edge.parent_number);
}

async function loadDependencies(): Promise<void> {
  const sequence = ++requestSequence;
  loading.value = true;
  error.value = "";
  try {
    const result = await prDependencies(props.platform, props.owner, props.repo, props.prNumber);
    if (sequence === requestSequence) graph.value = result;
  } catch (cause) {
    if (sequence !== requestSequence) return;
    graph.value = null;
    error.value = getErrorMessage(cause, t("dependency.loadFailed"));
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

watch(
  () => `${props.platform}:${props.owner}:${props.repo}:${props.prNumber}:${props.revision}`,
  () => void loadDependencies(),
  { immediate: true },
);

onUnmounted(() => {
  requestSequence += 1;
});

defineExpose({ refresh: loadDependencies });
</script>

<template>
  <section class="dependency-panel" aria-labelledby="dependency-title" :aria-busy="loading">
    <header class="dependency-header">
      <div class="dependency-heading">
        <h3 id="dependency-title">{{ t("dependency.title") }}</h3>
        <span class="chip" :title="t('dependency.inferredTitle')">
          {{ t("dependency.inferred") }}
        </span>
        <span v-if="loading && graph" class="refresh-status" role="status" aria-live="polite">
          {{ t("dependency.refreshing") }}
        </span>
      </div>
      <button
        :class="['btn-icon', { 'is-loading': loading }]"
        type="button"
        :title="t('dependency.refresh')"
        :aria-label="t('dependency.refresh')"
        :disabled="loading"
        @click="loadDependencies"
      >
        <svg
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
          <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
          <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
        </svg>
      </button>
    </header>

    <div v-if="loading && !graph" class="dependency-loading" role="status">
      <div class="skeleton dependency-skeleton" />
      <div class="skeleton dependency-skeleton" />
      <div class="skeleton dependency-skeleton short" />
    </div>

    <div v-else-if="error" class="dependency-error" role="alert">
      <span>{{ error }}</span>
      <button class="btn btn-sm" type="button" @click="loadDependencies">
        {{ t("common.reload") }}
      </button>
    </div>

    <template v-else-if="graph">
      <div
        v-if="graph.truncated && orderedNodes.length > 1"
        class="dependency-warning"
        role="status"
      >
        {{ t("dependency.truncated") }}
      </div>
      <div v-if="graph.has_cycle" class="dependency-warning" role="alert">
        {{ t("dependency.cycle") }}
      </div>
      <div v-if="!currentIsOpen" class="dependency-history" role="status">
        {{ t("dependency.history", { item: itemName }) }}
      </div>
      <div
        v-else-if="!graph.has_cycle && blockingParents.size > 0"
        class="dependency-blocked"
        role="status"
      >
        {{ t("dependency.blocked", { item: itemName, count: blockingParents.size }) }}
      </div>

      <div v-if="orderedNodes.length <= 1" class="dependency-empty">
        <template v-if="graph.truncated">
          {{ t("dependency.emptyTruncated", { item: itemName }) }}
        </template>
        <template v-else>{{ t("dependency.empty", { item: itemName }) }}</template>
      </div>

      <div v-else class="merge-order">
        <div class="order-heading">
          <h4>
            {{ currentIsOpen ? t("dependency.suggestedOrder") : t("dependency.historyTitle") }}
          </h4>
          <span>{{ t("dependency.count", { count: orderedNodes.length }) }}</span>
        </div>
        <ol class="dependency-flow">
          <li
            v-for="(node, index) in orderedNodes"
            :key="node.number"
            :class="{
              current: node.number === graph.current_number,
              blocker: blockingParents.has(node.number),
            }"
          >
            <span class="order-index" aria-hidden="true">{{ index + 1 }}</span>
            <div class="dependency-node">
              <div class="node-main">
                <RouterLink
                  class="node-title"
                  :title="`#${node.number} ${node.title}`"
                  :to="{
                    name: 'pr-detail',
                    params: {
                      platform,
                      owner,
                      repo,
                      number: node.number,
                    },
                  }"
                >
                  <span>#{{ node.number }}</span>
                  {{ node.title }}
                </RouterLink>
                <div class="node-badges">
                  <span v-if="node.number === graph.current_number" class="chip chip-accent">
                    {{ t("dependency.current") }}
                  </span>
                  <span v-if="blockingParents.has(node.number)" class="chip chip-warning">
                    {{
                      node.state === "closed"
                        ? t("dependency.closedBlocker")
                        : t("dependency.blocker")
                    }}
                  </span>
                  <span :class="['badge', stateBadgeClasses[node.state] ?? 'badge-closed']">
                    {{ stateLabels[node.state] }}
                  </span>
                </div>
              </div>
              <div class="branch-chain">
                <code>{{ node.source_branch }}</code>
                <span aria-hidden="true">→</span>
                <code>{{ node.target_branch }}</code>
              </div>
              <div v-if="parentNumbers(node.number).length > 0" class="parent-links">
                {{ t("dependency.dependsOn") }}
                <span v-for="parent in parentNumbers(node.number)" :key="parent"
                  >#{{ parent }}</span
                >
              </div>
            </div>
          </li>
        </ol>
      </div>
    </template>
  </section>
</template>

<style scoped src="./PrDependenciesPanel.css"></style>

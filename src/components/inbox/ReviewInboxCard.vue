<script setup lang="ts">
import { computed } from "vue";
import PrStatusSummary from "@/components/pr/PrStatusSummary.vue";
import type { ReviewInboxItem, ReviewInboxRelationship } from "@/types";
import { useI18n } from "@/i18n";

const props = defineProps<{
  item: ReviewInboxItem;
}>();

defineEmits<{
  click: [];
  toggleRead: [];
}>();
const { locale, t } = useI18n();

const localState = computed(
  () =>
    props.item.local_state ?? {
      unread: false,
      new_commits: false,
      new_comments: false,
      status_changed: false,
    },
);

const platformLabels = {
  github: "GitHub",
  gitlab: "GitLab",
  gitee: "Gitee",
} as const;

const relationshipLabels = computed<Record<ReviewInboxRelationship, string>>(() => ({
  reviewer: t("inbox.relationshipReviewer"),
  assignee: t("inbox.relationshipAssignee"),
  tester: t("inbox.relationshipTester"),
  author: t("inbox.relationshipAuthor"),
}));

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("inbox.updatedUnknown")
    : date.toLocaleDateString(locale.value);
}
</script>

<template>
  <article class="inbox-card" :class="{ unread: localState.unread }">
    <button type="button" class="card-open" @click="$emit('click')">
      <span class="pr-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="6" cy="5" r="2.5" />
          <circle cx="18" cy="19" r="2.5" />
          <path d="M6 7.5V16a3 3 0 0 0 3 3h6.5" />
          <path d="M12 5h3a3 3 0 0 1 3 3v8.5" />
        </svg>
      </span>
      <span class="card-content">
        <span class="card-context">
          <span
            v-if="localState.unread"
            class="unread-dot"
            :title="t('inbox.unread')"
            :aria-label="t('inbox.unread')"
          />
          <span class="platform-badge" :class="`platform-${props.item.platform}`">
            {{ platformLabels[props.item.platform] }}
          </span>
          <span class="repository-name">{{ props.item.repository_full_name }}</span>
        </span>
        <span class="card-title">{{ props.item.summary.title }}</span>
        <span class="card-meta">
          <span class="pr-number">#{{ props.item.summary.number }}</span>
          <span>{{ t("inbox.itemCreated", { author: props.item.summary.author.login }) }}</span>
          <span>{{
            t("inbox.itemUpdated", { date: formatUpdatedAt(props.item.summary.updated_at) })
          }}</span>
          <span
            v-for="relationship in props.item.relationships"
            :key="relationship"
            class="chip chip-accent"
          >
            {{ relationshipLabels[relationship] }}
          </span>
          <span v-if="localState.new_commits" class="chip chip-accent">{{
            t("inbox.activityCommits")
          }}</span>
          <span v-if="localState.new_comments" class="chip chip-accent">{{
            t("inbox.activityComments")
          }}</span>
          <span v-if="localState.status_changed" class="chip chip-warning">{{
            t("inbox.activityStatus")
          }}</span>
        </span>
        <PrStatusSummary :status="props.item.status" />
      </span>
      <svg
        class="chevron"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
    <button
      type="button"
      class="read-toggle"
      :title="localState.unread ? t('inbox.markRead') : t('inbox.markUnread')"
      :aria-label="localState.unread ? t('inbox.markRead') : t('inbox.markUnread')"
      @click="$emit('toggleRead')"
    >
      {{ localState.unread ? t("inbox.readState") : t("inbox.unread") }}
    </button>
  </article>
</template>

<style scoped src="./ReviewInboxCard.css"></style>

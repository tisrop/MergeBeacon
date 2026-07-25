<script setup lang="ts">
import { computed } from "vue";
import PrStatusSummary from "@/components/pr/PrStatusSummary.vue";
import type { ReviewInboxItem, ReviewInboxRelationship } from "@/types";

const props = defineProps<{
  item: ReviewInboxItem;
}>();

defineEmits<{
  click: [];
  toggleRead: [];
}>();

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

const relationshipLabels: Record<ReviewInboxRelationship, string> = {
  reviewer: "评审人",
  assignee: "负责人",
  tester: "测试人",
  author: "我创建的",
};

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "更新时间未知" : date.toLocaleDateString("zh-CN");
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
          <span v-if="localState.unread" class="unread-dot" title="未读" aria-label="未读" />
          <span class="platform-badge" :class="`platform-${props.item.platform}`">
            {{ platformLabels[props.item.platform] }}
          </span>
          <span class="repository-name">{{ props.item.repository_full_name }}</span>
        </span>
        <span class="card-title">{{ props.item.summary.title }}</span>
        <span class="card-meta">
          <span class="pr-number">#{{ props.item.summary.number }}</span>
          <span>{{ props.item.summary.author.login }} 创建</span>
          <span>{{ formatUpdatedAt(props.item.summary.updated_at) }} 更新</span>
          <span
            v-for="relationship in props.item.relationships"
            :key="relationship"
            class="relationship-badge"
          >
            {{ relationshipLabels[relationship] }}
          </span>
          <span v-if="localState.new_commits" class="activity-badge">新提交</span>
          <span v-if="localState.new_comments" class="activity-badge">新评论</span>
          <span v-if="localState.status_changed" class="activity-badge status-change"
            >状态变化</span
          >
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
      :title="localState.unread ? '标记为已读' : '标记为未读'"
      :aria-label="localState.unread ? '标记为已读' : '标记为未读'"
      @click="$emit('toggleRead')"
    >
      {{ localState.unread ? "已读" : "未读" }}
    </button>
  </article>
</template>

<style scoped src="./ReviewInboxCard.css"></style>

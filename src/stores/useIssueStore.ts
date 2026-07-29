import { ref } from "vue";
import { defineStore } from "pinia";
import type { Issue, IssueSummary, Platform } from "@/types";

type PendingCreatedIssue = {
  platform: Platform;
  owner: string;
  repo: string;
  issue: IssueSummary;
};

function toSummary(issue: Issue): IssueSummary {
  return {
    number: issue.number,
    title: issue.title,
    author: issue.author,
    state: issue.state,
    labels: issue.labels,
    label_colors: issue.label_colors,
    created_at: issue.created_at,
  };
}

export const useIssueStore = defineStore("issues", () => {
  const pendingCreatedIssue = ref<PendingCreatedIssue | null>(null);

  function rememberCreatedIssue(
    platform: Platform,
    owner: string,
    repo: string,
    issue: Issue,
  ): void {
    pendingCreatedIssue.value = { platform, owner, repo, issue: toSummary(issue) };
  }

  function mergePendingCreatedIssue(
    platform: Platform,
    owner: string,
    repo: string,
    issues: IssueSummary[],
  ): IssueSummary[] {
    const pending = pendingCreatedIssue.value;
    if (
      !pending ||
      pending.platform !== platform ||
      pending.owner !== owner ||
      pending.repo !== repo
    ) {
      return issues;
    }

    if (issues.some((issue) => issue.number === pending.issue.number)) {
      pendingCreatedIssue.value = null;
      return issues;
    }
    return [pending.issue, ...issues];
  }

  return { pendingCreatedIssue, rememberCreatedIssue, mergePendingCreatedIssue };
});

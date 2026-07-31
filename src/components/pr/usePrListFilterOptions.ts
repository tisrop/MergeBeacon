import { ref } from "vue";
import { listRepositoryLabels, prParticipantSuggestions } from "@/api";
import type { Platform, PrLabel, User } from "@/types";
import { currentLocale, translate } from "@/i18n";

export type PrListFilterOption = { value: string; label: string };

export function userFilterOptions(users: User[], selected = ""): PrListFilterOption[] {
  const byLogin = new Map<string, User>();
  for (const user of users) {
    const login = user.login.trim();
    if (login && !byLogin.has(login.toLocaleLowerCase())) {
      byLogin.set(login.toLocaleLowerCase(), { ...user, login });
    }
  }
  if (selected && !byLogin.has(selected.toLocaleLowerCase())) {
    byLogin.set(selected.toLocaleLowerCase(), {
      id: selected,
      login: selected,
      name: "",
      avatar_url: "",
    });
  }
  return [...byLogin.values()]
    .sort((left, right) => left.login.localeCompare(right.login, currentLocale()))
    .map((user) => ({
      value: user.login,
      label: user.name && user.name !== user.login ? `${user.login} (${user.name})` : user.login,
    }));
}

export function labelFilterOptions(labels: PrLabel[], selected = ""): PrListFilterOption[] {
  const names = new Map<string, string>();
  for (const label of labels) {
    const name = label.name.trim();
    if (name && !names.has(name.toLocaleLowerCase())) names.set(name.toLocaleLowerCase(), name);
  }
  if (selected && !names.has(selected.toLocaleLowerCase())) {
    names.set(selected.toLocaleLowerCase(), selected);
  }
  return [...names.values()]
    .sort((left, right) => left.localeCompare(right, currentLocale()))
    .map((name) => ({ value: name, label: name }));
}

export function usePrListFilterOptions() {
  const participants = ref<User[]>([]);
  const labels = ref<PrLabel[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let requestSequence = 0;
  let contextKey = "";
  let loaded = false;

  function clear() {
    requestSequence += 1;
    contextKey = "";
    loaded = false;
    participants.value = [];
    labels.value = [];
    loading.value = false;
    error.value = null;
  }

  async function load(platform: Platform, owner: string, repo: string, force = false) {
    const nextContextKey = `${platform}:${owner}/${repo}`;
    if (!force && loaded && contextKey === nextContextKey) return;
    const sequence = ++requestSequence;
    if (contextKey !== nextContextKey) {
      participants.value = [];
      labels.value = [];
    }
    contextKey = nextContextKey;
    loading.value = true;
    error.value = null;

    const [participantResult, labelResult] = await Promise.allSettled([
      prParticipantSuggestions(platform, owner, repo),
      listRepositoryLabels(platform, owner, repo),
    ]);
    if (sequence !== requestSequence || contextKey !== nextContextKey) return;

    participants.value = participantResult.status === "fulfilled" ? participantResult.value : [];
    labels.value = labelResult.status === "fulfilled" ? labelResult.value : [];
    loaded = true;
    if (participantResult.status === "rejected" || labelResult.status === "rejected") {
      error.value = translate("pr.filterOptionsPartial");
    }
    loading.value = false;
  }

  return { participants, labels, loading, error, load, clear };
}

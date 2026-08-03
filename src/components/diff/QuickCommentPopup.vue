<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppSelect from "@/components/shared/AppSelect.vue";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { useDiffPopupStyle } from "./useDiffLayoutStyles";
import type { QuickCommentTarget } from "./useDiffQuickComment";

const props = defineProps<{
  modelValue: QuickCommentTarget | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [target: QuickCommentTarget | null];
  submit: [target: QuickCommentTarget, body: string];
}>();

type QuickCategoryId = "logic" | "security" | "performance" | "style" | "log";
type QuickSubcategoryId =
  | "boundary"
  | "null"
  | "exception"
  | "concurrency"
  | "state"
  | "type"
  | "injection"
  | "permission"
  | "exposure"
  | "crypto"
  | "validation"
  | "csrf"
  | "complexity"
  | "memory"
  | "io"
  | "recompute"
  | "cache"
  | "database"
  | "naming"
  | "comments"
  | "duplication"
  | "hardcoded"
  | "longFunction"
  | "structure"
  | "logLevel"
  | "logExposure"
  | "logMissing"
  | "logContext"
  | "logFormat"
  | "logVolume";

interface QuickSubcategoryDefinition {
  id: QuickSubcategoryId;
  labelKey: MessageKey;
  templateKey: MessageKey;
}

const { t } = useI18n();
const popupRef = ref<HTMLElement | null>(null);
const quickComment = computed<QuickCommentTarget | null>({
  get: () => props.modelValue,
  set: (target) => emit("update:modelValue", target),
});
const { popupPositionClass, positionPopup } = useDiffPopupStyle({
  popupRef,
  quickComment,
});
const quickBody = ref("");
const quickSubmitting = ref(false);
const quickCategory = ref<QuickCategoryId>("logic");
const quickSubCategory = ref<QuickSubcategoryId | "">("");

const quickSubcategoryDefinitions: Record<QuickCategoryId, QuickSubcategoryDefinition[]> = {
  logic: [
    {
      id: "boundary",
      labelKey: "diff.quick.boundary.label",
      templateKey: "diff.quick.boundary.template",
    },
    { id: "null", labelKey: "diff.quick.null.label", templateKey: "diff.quick.null.template" },
    {
      id: "exception",
      labelKey: "diff.quick.exception.label",
      templateKey: "diff.quick.exception.template",
    },
    {
      id: "concurrency",
      labelKey: "diff.quick.concurrency.label",
      templateKey: "diff.quick.concurrency.template",
    },
    { id: "state", labelKey: "diff.quick.state.label", templateKey: "diff.quick.state.template" },
    { id: "type", labelKey: "diff.quick.type.label", templateKey: "diff.quick.type.template" },
  ],
  security: [
    {
      id: "injection",
      labelKey: "diff.quick.injection.label",
      templateKey: "diff.quick.injection.template",
    },
    {
      id: "permission",
      labelKey: "diff.quick.permission.label",
      templateKey: "diff.quick.permission.template",
    },
    {
      id: "exposure",
      labelKey: "diff.quick.exposure.label",
      templateKey: "diff.quick.exposure.template",
    },
    {
      id: "crypto",
      labelKey: "diff.quick.crypto.label",
      templateKey: "diff.quick.crypto.template",
    },
    {
      id: "validation",
      labelKey: "diff.quick.validation.label",
      templateKey: "diff.quick.validation.template",
    },
    { id: "csrf", labelKey: "diff.quick.csrf.label", templateKey: "diff.quick.csrf.template" },
  ],
  performance: [
    {
      id: "complexity",
      labelKey: "diff.quick.complexity.label",
      templateKey: "diff.quick.complexity.template",
    },
    {
      id: "memory",
      labelKey: "diff.quick.memory.label",
      templateKey: "diff.quick.memory.template",
    },
    { id: "io", labelKey: "diff.quick.io.label", templateKey: "diff.quick.io.template" },
    {
      id: "recompute",
      labelKey: "diff.quick.recompute.label",
      templateKey: "diff.quick.recompute.template",
    },
    { id: "cache", labelKey: "diff.quick.cache.label", templateKey: "diff.quick.cache.template" },
    {
      id: "database",
      labelKey: "diff.quick.database.label",
      templateKey: "diff.quick.database.template",
    },
  ],
  style: [
    {
      id: "naming",
      labelKey: "diff.quick.naming.label",
      templateKey: "diff.quick.naming.template",
    },
    {
      id: "comments",
      labelKey: "diff.quick.comments.label",
      templateKey: "diff.quick.comments.template",
    },
    {
      id: "duplication",
      labelKey: "diff.quick.duplication.label",
      templateKey: "diff.quick.duplication.template",
    },
    {
      id: "hardcoded",
      labelKey: "diff.quick.hardcoded.label",
      templateKey: "diff.quick.hardcoded.template",
    },
    {
      id: "longFunction",
      labelKey: "diff.quick.longFunction.label",
      templateKey: "diff.quick.longFunction.template",
    },
    {
      id: "structure",
      labelKey: "diff.quick.structure.label",
      templateKey: "diff.quick.structure.template",
    },
  ],
  log: [
    {
      id: "logLevel",
      labelKey: "diff.quick.logLevel.label",
      templateKey: "diff.quick.logLevel.template",
    },
    {
      id: "logExposure",
      labelKey: "diff.quick.logExposure.label",
      templateKey: "diff.quick.logExposure.template",
    },
    {
      id: "logMissing",
      labelKey: "diff.quick.logMissing.label",
      templateKey: "diff.quick.logMissing.template",
    },
    {
      id: "logContext",
      labelKey: "diff.quick.logContext.label",
      templateKey: "diff.quick.logContext.template",
    },
    {
      id: "logFormat",
      labelKey: "diff.quick.logFormat.label",
      templateKey: "diff.quick.logFormat.template",
    },
    {
      id: "logVolume",
      labelKey: "diff.quick.logVolume.label",
      templateKey: "diff.quick.logVolume.template",
    },
  ],
};

const quickCategoryLabels = computed<Record<QuickCategoryId, string>>(() => ({
  logic: t("diff.viewer.quickCategoryLogic"),
  security: t("diff.viewer.quickCategorySecurity"),
  performance: t("diff.viewer.quickCategoryPerformance"),
  style: t("diff.viewer.quickCategoryStyle"),
  log: t("diff.viewer.quickCategoryLog"),
}));
const quickCategoryOptions = computed(() =>
  Object.entries(quickCategoryLabels.value).map(([value, label]) => ({ value, label })),
);
const quickSubcategoryOptions = computed(() => [
  { value: "", label: t("diff.viewer.quickSubcategory") },
  ...quickSubcategoryDefinitions[quickCategory.value].map((subcategory) => ({
    value: subcategory.id,
    label: t(subcategory.labelKey),
  })),
]);

function selectedQuickSubcategory(): QuickSubcategoryDefinition | undefined {
  return quickSubcategoryDefinitions[quickCategory.value].find(
    (subcategory) => subcategory.id === quickSubCategory.value,
  );
}

function quickCommentTag(): string {
  const subcategory = selectedQuickSubcategory();
  return t("diff.viewer.quickTag", {
    category: quickCategoryLabels.value[quickCategory.value],
    subcategory: subcategory
      ? t("diff.viewer.quickSubtag", { subcategory: t(subcategory.labelKey) })
      : "",
  });
}

function closePopup(): void {
  quickComment.value = null;
}

async function submitQuickComment(): Promise<void> {
  const target = quickComment.value;
  if (!target || !quickBody.value.trim()) return;
  let finalBody = quickBody.value.trim();
  if (!finalBody.startsWith("【") && !finalBody.startsWith("[")) {
    finalBody = `${quickCommentTag()}${finalBody}`;
  }
  emit("submit", target, finalBody);
  quickSubmitting.value = true;
  await new Promise((resolve) => setTimeout(resolve, 200));
  closePopup();
  quickBody.value = "";
  quickSubmitting.value = false;
}

function onCategoryChange(): void {
  quickSubCategory.value = "";
  quickBody.value = "";
}

function onSubCategoryChange(): void {
  if (!quickSubCategory.value) {
    quickBody.value = "";
    return;
  }
  const subcategory = selectedQuickSubcategory();
  if (subcategory) quickBody.value = `${quickCommentTag()}${t(subcategory.templateKey)}`;
}

function handleQuickKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submitQuickComment();
  if (event.key === "Escape") closePopup();
}

watch(
  () => props.modelValue,
  async (target) => {
    if (!target) return;
    quickBody.value = "";
    await nextTick();
    popupRef.value?.querySelector<HTMLTextAreaElement>(".quick-comment-textarea")?.focus();
    await positionPopup();
  },
);

watch([quickCategory, quickSubCategory], async () => {
  if (quickComment.value) await positionPopup();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="quickComment"
      ref="popupRef"
      class="quick-comment-popup"
      :class="popupPositionClass"
      @click.stop
      @keydown="handleQuickKeydown"
    >
      <div class="popup-header">
        <span class="file-ref">
          {{ quickComment.path.split("/").pop() }}:L{{ quickComment.startLine
          }}{{ quickComment.endLine !== quickComment.startLine ? "-L" + quickComment.endLine : "" }}
        </span>
        <button class="close-btn" type="button" :aria-label="t('common.close')" @click="closePopup">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <pre v-if="quickComment.selectedText" class="selected-code">{{
        quickComment.selectedText
      }}</pre>

      <div class="popup-category">
        <AppSelect
          v-model="quickCategory"
          :options="quickCategoryOptions"
          @update:model-value="onCategoryChange"
        />
        <AppSelect
          v-model="quickSubCategory"
          :options="quickSubcategoryOptions"
          @update:model-value="onSubCategoryChange"
        />
      </div>

      <textarea
        v-model="quickBody"
        class="quick-comment-textarea"
        :placeholder="t('diff.viewer.quickPlaceholder')"
        rows="3"
      />
      <div class="popup-actions">
        <button class="btn btn-sm" type="button" @click="closePopup">
          {{ t("diff.viewer.quickCancel") }}
        </button>
        <button
          class="btn btn-sm btn-primary"
          :disabled="!quickBody.trim() || quickSubmitting"
          @click="submitQuickComment"
        >
          {{ quickSubmitting ? t("diff.viewer.quickSubmitting") : t("diff.viewer.quickSubmit") }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped src="./QuickCommentPopup.css"></style>

<script setup lang="ts">
const props = defineProps<{
  title: string;
  body: string;
  labels: string[];
  error: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  "update:title": [value: string];
  "update:body": [value: string];
  "update:labels": [value: string[]];
  submit: [];
}>();

function addLabel(label: string) {
  if (label && !props.labels.includes(label)) {
    emit("update:labels", [...props.labels, label]);
  }
}

function removeLabel(label: string) {
  emit(
    "update:labels",
    props.labels.filter((l) => l !== label),
  );
}
</script>

<template>
  <div class="issue-form card">
    <div class="field">
      <label for="issue-title">标题 <span class="required">必填</span></label>
      <input
        id="issue-title"
        class="input"
        :value="title"
        @input="emit('update:title', ($event.target as HTMLInputElement).value)"
        placeholder="Issue 标题"
      />
    </div>

    <div class="field">
      <label for="issue-body">描述</label>
      <textarea
        id="issue-body"
        class="input"
        :value="body"
        @input="emit('update:body', ($event.target as HTMLTextAreaElement).value)"
        placeholder="详细描述..."
        rows="8"
      />
    </div>

    <div class="field">
      <label for="issue-labels">标签</label>
      <div class="labels-input">
        <div class="labels-list">
          <span v-for="label in labels" :key="label" class="label-chip">
            {{ label }}
            <button type="button" @click="removeLabel(label)">
              <svg
                width="12"
                height="12"
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
          </span>
        </div>
        <input
          id="issue-labels"
          class="input label-entry-input"
          placeholder="输入标签后回车"
          @keyup.enter="
            addLabel(($event.target as HTMLInputElement).value);
            ($event.target as HTMLInputElement).value = '';
          "
        />
      </div>
    </div>

    <div v-if="error" class="error" role="alert">{{ error }}</div>

    <div class="form-actions">
      <router-link to="/issue" class="btn">取消</router-link>
      <button
        class="btn btn-success"
        :disabled="submitting || !title.trim()"
        @click="emit('submit')"
      >
        {{ submitting ? "提交中..." : "创建 Issue" }}
      </button>
    </div>
  </div>
</template>

<style scoped src="./IssueForm.css"></style>

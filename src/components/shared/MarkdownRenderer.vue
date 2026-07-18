<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";

const props = defineProps<{
  content: string;
}>();

const html = computed(
  () => marked.parse(props.content, { async: false, gfm: true, breaks: true }) as string,
);
</script>

<template>
  <div class="markdown-renderer" v-html="html" />
</template>

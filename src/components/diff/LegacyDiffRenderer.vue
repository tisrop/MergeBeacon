<script setup lang="ts">
defineProps<{
  sanitizedHtml: string;
}>();
</script>

<template>
  <div class="legacy-diff" v-html="sanitizedHtml" />
</template>

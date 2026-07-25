<script setup lang="ts">
defineProps<{
  newName: string;
  additions: number;
  deletions: number;
}>();
</script>

<template>
  <div class="diff-file">
    <div class="file-header">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span class="file-name">{{ newName }}</span>
    </div>
    <div class="file-stats">
      <span class="stat-add">+{{ additions }}</span>
      <span class="stat-del">-{{ deletions }}</span>
    </div>
  </div>
</template>

<style scoped src="./DiffFile.css"></style>

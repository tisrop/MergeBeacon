<script setup lang="ts">
defineProps<{
  line: {
    type: "add" | "del" | "context";
    content: string;
    oldNumber?: number | null;
    newNumber?: number | null;
  };
}>();
</script>

<template>
  <div
    class="diff-line"
    :class="{
      'line-add': line.type === 'add',
      'line-del': line.type === 'del',
      'line-context': line.type === 'context',
    }"
  >
    <span class="line-num-old">{{ line.oldNumber ?? "" }}</span>
    <span class="line-num-new">{{ line.newNumber ?? "" }}</span>
    <span class="line-type">{{ line.type === "add" ? "+" : line.type === "del" ? "-" : " " }}</span>
    <span class="line-content" v-text="line.content" />
  </div>
</template>

<style scoped src="./DiffLine.css"></style>

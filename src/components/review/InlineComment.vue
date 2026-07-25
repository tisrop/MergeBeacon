<script setup lang="ts">
import type { ReviewCommentPosition } from "@/types";

defineProps<{
  comment: ReviewCommentPosition;
}>();
</script>

<template>
  <div class="inline-comment">
    <div class="comment-header">
      <span class="comment-location font-mono"> {{ comment.path }}:{{ comment.position }} </span>
    </div>
    <p class="comment-body">{{ comment.body }}</p>
  </div>
</template>

<style scoped src="./InlineComment.css"></style>

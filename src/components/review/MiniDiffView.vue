<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  diffHunk: string;
  outdated: boolean;
  commentLine?: number;
  commentStartLine?: number;
}>();

const CONTEXT_LINES = 2;

interface DisplayLine {
  content: string;
  lineNum: number;
  isOld: boolean;
  isNew: boolean;
  isComment: boolean;
}

function parseHunk(hunk: string): { lines: string[]; startLine: number } {
  const parts = hunk.split("\n");
  const header = parts[0];
  const match = header.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  const startLine = match ? parseInt(match[1], 10) : 0;
  return { lines: parts.slice(1), startLine };
}

const displayLines = computed((): DisplayLine[] => {
  const { lines, startLine } = parseHunk(props.diffHunk);
  const all: DisplayLine[] = [];
  let lineNum = startLine;

  for (const raw of lines) {
    const trimmed = raw.replace(/\n$/, "");
    if (trimmed.startsWith("\\")) continue;

    const isOld = trimmed.startsWith("-");
    const isNew = trimmed.startsWith("+");

    if (props.outdated) {
      const ln = lineNum;
      all.push({
        content: trimmed.slice(1),
        lineNum: ln,
        isOld,
        isNew,
        isComment: false,
      });
      if (!isOld) lineNum++;
    } else {
      if (isOld) continue;
      all.push({
        content: trimmed.slice(1),
        lineNum,
        isOld: false,
        isNew,
        isComment: false,
      });
      lineNum++;
    }
  }

  // Mark commented lines
  if (props.commentLine) {
    const start = props.commentStartLine ?? props.commentLine;
    const end = props.commentLine;
    for (const dl of all) {
      if (dl.lineNum >= start && dl.lineNum <= end) {
        dl.isComment = true;
      }
    }
  }

  // Trim context around commented range
  if (props.commentLine) {
    const start = props.commentStartLine ?? props.commentLine;
    const end = props.commentLine;
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < all.length; i++) {
      if (all[i].lineNum >= start && firstIdx === -1) firstIdx = i;
      if (all[i].lineNum <= end) lastIdx = i;
    }
    if (firstIdx > -1 && lastIdx > -1) {
      const from = Math.max(0, firstIdx - CONTEXT_LINES);
      const to = Math.min(all.length, lastIdx + CONTEXT_LINES + 1);
      return all.slice(from, to);
    }
  }

  return all;
});
</script>

<template>
  <div class="mini-diff-view">
    <div v-if="outdated" class="diff-header">⛔ 当时代码（已变更）</div>
    <div v-if="displayLines.length > 0" class="diff-lines">
      <div
        v-for="(line, i) in displayLines"
        :key="i"
        class="diff-line"
        :class="{
          'is-comment': line.isComment,
          'is-old': !line.isComment && line.isOld,
          'is-new': !line.isComment && !line.isOld && line.isNew,
        }"
      >
        <span class="ln">{{ line.lineNum }}</span>
        <span class="mk">{{ line.isOld ? "−" : line.isNew ? "+" : " " }}</span>
        <span class="code">
          <pre>{{ line.content }}</pre>
        </span>
      </div>
    </div>
    <div v-else class="no-code">（无代码上下文）</div>
  </div>
</template>

<style scoped src="./MiniDiffView.css"></style>

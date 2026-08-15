<script setup lang="ts">
import { computed } from "vue";
import { compactJson, formatTime } from "@/utils/format";

type LogEntry = Record<string, any>;

const props = withDefaults(defineProps<{ logs?: LogEntry[]; emptyText?: string; showOrder?: boolean }>(), {
  logs: () => [],
  emptyText: "暂无运行日志",
  showOrder: false
});

function levelOf(log: LogEntry) {
  const explicit = String(log.level || "").toLowerCase();
  if (["success", "succeeded", "ok", "complete", "completed"].includes(explicit)) return "ok";
  if (["error", "failed", "failure", "fatal", "bad"].includes(explicit)) return "error";
  if (["warn", "warning"].includes(explicit)) return "warn";
  const text = `${log.stage || ""} ${log.message || ""}`.toLowerCase();
  if (/(error|fail|declin|错误|失败|拒绝)/.test(text)) return "error";
  if (/(warn|retry|等待|待核对|暂停)/.test(text)) return "warn";
  if (/(success|succeed|completed|成功|完成)/.test(text)) return "ok";
  return "info";
}

const entries = computed(() => props.logs.map(log => {
  const meta = compactJson(log.meta_json);
  const suffix = meta && meta !== "{}" ? ` ${meta}` : "";
  const order = props.showOrder && log.order_no ? ` [${log.order_no}]` : "";
  return {
    id: log.id || `${log.created_at}-${log.stage}-${log.message}`,
    level: levelOf(log),
    text: `[${formatTime(log.created_at)}]${order} [${log.stage || log.level || "日志"}] ${log.message || ""}${suffix}`
  };
}));
</script>

<template>
  <div class="log-console log-feed">
    <template v-if="entries.length">
      <div v-for="entry in entries" :key="entry.id" class="order-log-line" :class="entry.level">
        <span class="order-log-marker">●</span><span class="order-log-text">{{ entry.text }}</span>
      </div>
    </template>
    <span v-else class="log-feed__empty">{{ emptyText }}</span>
  </div>
</template>

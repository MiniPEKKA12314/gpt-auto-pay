<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status?: string }>();

const labels: Record<string, string> = {
  queued: "排队中", running: "运行中", succeeded: "成功", failed: "失败",
  interrupted_review: "待核对", unused: "未使用", locked: "已锁定", used: "已使用",
  enabled: "启用", disabled: "禁用", standby: "备用", deleted: "已删除",
  unavailable: "不可用", paused: "已暂停", frozen: "冻结"
};

const type = computed(() => {
  if (["succeeded", "used", "enabled", "running"].includes(props.status || "")) return "success";
  if (["failed", "disabled", "deleted", "unavailable"].includes(props.status || "")) return "danger";
  if (["queued", "locked", "standby", "interrupted_review", "paused", "frozen"].includes(props.status || "")) return "warning";
  return "info";
});
</script>

<template>
  <el-tag :type="type" effect="light" size="small">{{ labels[status || ""] || status || "未知" }}</el-tag>
</template>

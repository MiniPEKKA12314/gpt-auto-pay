<script setup lang="ts">
import { computed } from "vue";
import { useMediaQuery } from "@vueuse/core";
import { ElMessage } from "element-plus";
import { CopyDocument } from "@element-plus/icons-vue";
import type { RowData } from "@/api/admin";
import { buildOrderProcessLogs, orderProcessLogText } from "@/utils/order-log";
import { formatTime } from "@/utils/format";
import LogFeed from "@/components/LogFeed.vue";
import StatusTag from "@/components/StatusTag.vue";

const props = defineProps<{ detail: RowData }>();
const processLogs = computed(() => buildOrderProcessLogs(props.detail));
const compact = useMediaQuery("(max-width: 640px)");

async function copyLogs() {
  try {
    await navigator.clipboard.writeText(orderProcessLogText(props.detail));
    ElMessage.success("订单日志已复制");
  } catch {
    ElMessage.error("复制失败，请重新操作");
  }
}
</script>

<template>
  <template v-if="detail.order">
    <el-descriptions :column="compact ? 1 : 2" border>
      <el-descriptions-item label="订单号"><span class="mono">{{ detail.order.order_no }}</span></el-descriptions-item>
      <el-descriptions-item label="状态"><StatusTag :status="detail.order.status" /></el-descriptions-item>
      <el-descriptions-item label="套餐">{{ detail.order.plan_type }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ formatTime(detail.order.created_at) }}</el-descriptions-item>
      <el-descriptions-item label="公开提示" :span="2">{{ detail.order.public_message || '-' }}</el-descriptions-item>
      <el-descriptions-item label="后台错误" :span="2">{{ detail.order.admin_error || '-' }}</el-descriptions-item>
    </el-descriptions>
    <el-tabs class="mt-5">
      <el-tab-pane label="完整日志">
        <div class="detail-toolbar"><span>订单、尝试、代理和执行日志按时间汇总</span><el-button :icon="CopyDocument" @click="copyLogs">复制日志</el-button></div>
        <LogFeed :logs="processLogs" />
      </el-tab-pane>
      <el-tab-pane label="执行尝试">
        <el-table :data="detail.attempts || []" stripe>
          <el-table-column prop="attempt_no" label="序号" width="70" />
          <el-table-column prop="status" label="状态" width="110"><template #default="{ row }"><StatusTag :status="row.status" /></template></el-table-column>
          <el-table-column prop="stage" label="阶段" min-width="140" />
          <el-table-column prop="checkout_proxy" label="提链代理" min-width="170" show-overflow-tooltip />
          <el-table-column prop="direct_card_proxy" label="直卡代理" min-width="170" show-overflow-tooltip />
          <el-table-column label="错误" min-width="240" show-overflow-tooltip><template #default="{ row }">{{ [row.error_code, row.error_message].filter(Boolean).join(': ') || '-' }}</template></el-table-column>
          <el-table-column prop="started_at" label="开始时间" min-width="170"><template #default="{ row }">{{ formatTime(row.started_at) }}</template></el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="运行资料"><pre class="log-console">{{ JSON.stringify(detail.runtime || {}, null, 2) }}</pre></el-tab-pane>
    </el-tabs>
  </template>
</template>

<style scoped>
.detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: #687384;
  font-size: 13px;
}
@media (max-width: 640px) {
  .detail-toolbar { align-items: flex-start; flex-direction: column; }
}
</style>

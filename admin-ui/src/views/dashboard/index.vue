<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { InfoFilled } from "@element-plus/icons-vue";
import type { EChartsOption } from "echarts";
import BaseChart from "@/components/BaseChart.vue";
import LogFeed from "@/components/LogFeed.vue";
import OrderDetails from "@/components/OrderDetails.vue";
import StatusTag from "@/components/StatusTag.vue";
import { ordersApi, type RowData } from "@/api/admin";
import { useDashboardStore } from "@/store/modules/dashboard";
import { formatDuration, formatTime } from "@/utils/format";

defineOptions({ name: "Dashboard" });
const dashboard = useDashboardStore();
const settings = reactive({ concurrency: 1, auto_pause_failure_count: 0 });
const detailVisible = ref(false);
const selectedDetail = ref<RowData>({});
const detailLoading = ref(false);
let detailRequest = 0;
let lastDetailRefresh = 0;

const metrics = computed(() => {
  const data = dashboard.snapshot;
  const queue = data.queue || dashboard.queue || {};
  const stats = data.order_stats || {};
  return [
    { label: "排队订单", value: queue.queued || 0, color: "#2563eb" },
    { label: "运行订单", value: queue.running || 0, color: "#0f9f83" },
    { label: "未使用兑换码", value: data.redeem_codes?.unused || 0, color: "#7c5ce5" },
    { label: "历史成功", value: stats.history_success || 0, color: "#16815d" },
    { label: "今日成功", value: stats.today_success || 0, color: "#2d8bba" },
    { label: "今日失败", value: stats.today_failed || 0, color: "#c43f4f" }
  ];
});

const orderChart = computed<EChartsOption>(() => ({
  tooltip: { trigger: "item" },
  legend: { bottom: 0, textStyle: { color: "#687384" } },
  color: ["#2563eb", "#0f9f83", "#e19a3e", "#c43f4f", "#7c5ce5"],
  series: [{ type: "pie", radius: ["52%", "74%"], center: ["50%", "43%"], itemStyle: { borderColor: "#fff", borderWidth: 3 }, label: { show: false }, data: Object.entries(dashboard.snapshot.orders || {}).map(([name, value]) => ({ name, value })) }]
} as EChartsOption));

const redeemChart = computed<EChartsOption>(() => ({
  grid: { left: 10, right: 12, top: 12, bottom: 28, containLabel: true },
  tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
  xAxis: { type: "category", data: Object.keys(dashboard.snapshot.redeem_codes || {}), axisTick: { show: false }, axisLine: { lineStyle: { color: "#dfe4ea" } } },
  yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "#eef1f4" } } },
  color: ["#0f9f83"],
  series: [{ type: "bar", barMaxWidth: 32, data: Object.values(dashboard.snapshot.redeem_codes || {}), itemStyle: { borderRadius: [4, 4, 0, 0] } }]
} as EChartsOption));

const recentOrders = computed(() => dashboard.snapshot.recent_orders || []);
const queuedOrders = computed(() => dashboard.snapshot.queued_orders || []);

async function refresh() {
  try {
    await dashboard.refresh();
    settings.concurrency = Number(dashboard.queue.concurrency || 1);
    settings.auto_pause_failure_count = Number(dashboard.queue.auto_pause_failure_count || 0);
  } catch (error: any) { ElMessage.error(error.message); }
}

async function saveQueue() {
  try { await dashboard.saveQueue(settings); ElMessage.success("队列设置已保存"); } catch (error: any) { ElMessage.error(error.message); }
}

async function action(type: "pause" | "resume" | "process") {
  try { await dashboard.queueAction(type); ElMessage.success("队列操作已完成"); } catch (error: any) { ElMessage.error(error.message); }
}

async function showOrderDetails(id: number) {
  const requestId = ++detailRequest;
  detailVisible.value = true;
  selectedDetail.value = {};
  detailLoading.value = true;
  try {
    const response = await ordersApi.details(id);
    if (requestId === detailRequest) {
      selectedDetail.value = response.data || {};
      lastDetailRefresh = Date.now();
    }
  } catch (error: any) {
    if (requestId === detailRequest) ElMessage.error(error.message);
  } finally {
    if (requestId === detailRequest) detailLoading.value = false;
  }
}

function clearOrderDetails() {
  detailRequest += 1;
  detailLoading.value = false;
  selectedDetail.value = {};
}

watch(() => dashboard.lastUpdated, async () => {
  const id = Number(selectedDetail.value.order?.id || 0);
  if (!detailVisible.value || !id || detailLoading.value || document.hidden || Date.now() - lastDetailRefresh < 4_000) return;
  const requestId = ++detailRequest;
  try {
    const response = await ordersApi.details(id);
    if (requestId === detailRequest) {
      selectedDetail.value = response.data || {};
      lastDetailRefresh = Date.now();
    }
  } catch {}
});

onMounted(async () => { await refresh(); dashboard.connectEvents(); });
onBeforeUnmount(() => dashboard.disconnectEvents());
</script>

<template>
  <div class="admin-page" v-loading="dashboard.loading">
    <header class="page-heading">
      <div><h1>运营概览</h1><p>最后同步：{{ dashboard.lastUpdated ? new Date(dashboard.lastUpdated).toLocaleTimeString() : '-' }}</p></div>
      <div class="page-actions"><StatusTag :status="dashboard.queue.status" /><el-button @click="refresh">刷新数据</el-button></div>
    </header>

    <div class="metric-grid">
      <div v-for="item in metrics" :key="item.label" class="metric-card" :style="{ '--metric-color': item.color }">
        <div class="metric-card__label"><i class="metric-dot" />{{ item.label }}</div><div class="metric-card__value">{{ item.value }}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <section class="content-panel"><div class="panel-heading"><h2>订单状态分布</h2></div><BaseChart :option="orderChart" height="270px" /></section>
      <section class="content-panel"><div class="panel-heading"><h2>兑换码状态</h2></div><BaseChart :option="redeemChart" height="270px" /></section>
    </div>

    <section class="content-panel">
      <div class="panel-heading"><h2>队列控制</h2><span class="text-xs text-gray-500">{{ dashboard.queue.worker?.busy ? '处理器忙碌' : '处理器待命' }}</span></div>
      <div class="filter-bar queue-controls">
        <div class="queue-setting"><span>全局并发数<el-tooltip content="同时允许运行中的订单数量；数值越大，资源消耗和并行请求越多。" placement="top"><el-icon class="field-help"><InfoFilled /></el-icon></el-tooltip></span><el-input-number v-model="settings.concurrency" :min="1" :max="1000" controls-position="right" /></div>
        <div class="queue-setting"><span>累计失败自动暂停阈值<el-tooltip content="累计失败达到该数量后自动暂停队列；设置为 0 表示不限制。" placement="top"><el-icon class="field-help"><InfoFilled /></el-icon></el-tooltip></span><el-input-number v-model="settings.auto_pause_failure_count" :min="0" :max="1000" controls-position="right" /></div>
        <el-button type="primary" @click="saveQueue">保存设置</el-button>
        <el-button type="warning" plain @click="action('pause')">暂停</el-button>
        <el-button type="success" plain @click="action('resume')">恢复</el-button>
        <el-button @click="action('process')">处理一次</el-button>
      </div>
    </section>

    <section class="content-panel">
      <div class="panel-heading"><h2>当前排队任务</h2><span class="text-xs text-gray-500">{{ queuedOrders.length }} 个任务等待处理</span></div>
      <el-table :data="queuedOrders" stripe empty-text="当前没有排队任务">
        <el-table-column prop="order_no" label="订单号" min-width="190"><template #default="{ row }"><span class="mono">{{ row.order_no }}</span></template></el-table-column>
        <el-table-column prop="redeem_code" label="兑换码" min-width="170"><template #default="{ row }"><span class="mono">{{ row.redeem_code || '-' }}</span></template></el-table-column>
        <el-table-column prop="plan_type" label="套餐" width="90" />
        <el-table-column prop="status" label="状态" width="100"><template #default="{ row }"><StatusTag :status="row.status" /></template></el-table-column>
        <el-table-column prop="queued_at" label="入队时间" min-width="170"><template #default="{ row }">{{ formatTime(row.queued_at || row.created_at) }}</template></el-table-column>
        <el-table-column label="等待时长" width="120"><template #default="{ row }">{{ formatDuration(row.queued_at || row.created_at) }}</template></el-table-column>
        <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="showOrderDetails(row.id)">详情</el-button></template></el-table-column>
      </el-table>
    </section>

    <section class="content-panel">
      <div class="panel-heading"><h2>最近订单</h2><router-link to="/orders"><el-button text type="primary">查看全部</el-button></router-link></div>
      <el-table :data="recentOrders" stripe>
        <el-table-column prop="order_no" label="订单号" min-width="190"><template #default="{ row }"><span class="mono">{{ row.order_no }}</span></template></el-table-column>
        <el-table-column prop="plan_type" label="套餐" width="100" />
        <el-table-column prop="status" label="状态" width="100"><template #default="{ row }"><StatusTag :status="row.status" /></template></el-table-column>
        <el-table-column prop="created_at" label="创建时间" min-width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
        <el-table-column prop="admin_error" label="错误" min-width="220" show-overflow-tooltip />
        <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="showOrderDetails(row.id)">详情</el-button></template></el-table-column>
      </el-table>
    </section>

    <section class="content-panel"><div class="panel-heading"><h2>实时运行日志</h2></div><LogFeed :logs="dashboard.snapshot.recent_logs || []" show-order /></section>

    <el-drawer v-model="detailVisible" title="订单详情与日志" size="min(860px, 94vw)" destroy-on-close @closed="clearOrderDetails">
      <div v-loading="detailLoading" class="order-detail-body">
        <OrderDetails :detail="selectedDetail" />
        <el-empty v-if="!selectedDetail.order && !detailLoading" description="暂无订单详情" :image-size="72" />
      </div>
    </el-drawer>
  </div>
</template>

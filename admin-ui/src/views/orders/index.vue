<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ordersApi, type RowData } from "@/api/admin";
import OrderDetails from "@/components/OrderDetails.vue";
import StatusTag from "@/components/StatusTag.vue";
import { formatTime } from "@/utils/format";

defineOptions({ name: "Orders" });
const loading = ref(false);
const rows = ref<RowData[]>([]);
const filter = reactive({ status: "", q: "" });
const drawer = ref(false);
const detail = ref<RowData>({});
const detailLoading = ref(false);
let detailRequest = 0;
let detailRefreshTimer = 0;

async function load() {
  loading.value = true;
  try { rows.value = (await ordersApi.list(filter)).data || []; }
  catch (error: any) { ElMessage.error(error.message); }
  finally { loading.value = false; }
}

async function showDetails(id: number) {
  const requestId = ++detailRequest;
  drawer.value = true;
  detail.value = {};
  detailLoading.value = true;
  try {
    const response = await ordersApi.details(id);
    if (requestId === detailRequest) detail.value = response.data || {};
  } catch (error: any) {
    if (requestId === detailRequest) ElMessage.error(error.message || "订单详情加载失败");
  } finally {
    if (requestId === detailRequest) detailLoading.value = false;
  }
}

function clearDetails() {
  detailRequest += 1;
  detailLoading.value = false;
  detail.value = {};
}

async function refreshOpenDetails() {
  const id = Number(detail.value.order?.id || 0);
  if (!drawer.value || !id || detailLoading.value || document.hidden) return;
  const requestId = ++detailRequest;
  try {
    const response = await ordersApi.details(id);
    if (requestId === detailRequest) detail.value = response.data || {};
  } catch {}
}

async function runAction(row: RowData, action: string, payload: RowData = {}) {
  if (["terminate", "delete"].includes(action)) {
    await ElMessageBox.confirm(`确认${action === "delete" ? "删除" : "结束"}订单 ${row.order_no}？`, "订单操作", { type: "warning", confirmButtonText: "确认", cancelButtonText: "取消" });
  }
  try {
    await ordersApi.action(row.id, action, payload);
    ElMessage.success("订单状态已更新");
    await load();
  } catch (error: any) { if (error !== "cancel") ElMessage.error(error.message); }
}

onMounted(() => {
  load();
  detailRefreshTimer = window.setInterval(refreshOpenDetails, 4_000);
});
onBeforeUnmount(() => window.clearInterval(detailRefreshTimer));
</script>

<template>
  <div class="admin-page">
    <header class="page-heading"><div><h1>订单管理</h1><p>共 {{ rows.length }} 条订单记录</p></div><div class="page-actions"><el-button @click="load">刷新</el-button></div></header>
    <section class="content-panel">
      <div class="filter-bar mb-4">
        <el-select v-model="filter.status" clearable placeholder="全部状态" style="width:150px">
          <el-option label="排队中" value="queued" /><el-option label="运行中" value="running" /><el-option label="成功" value="succeeded" /><el-option label="失败" value="failed" /><el-option label="待核对" value="interrupted_review" />
        </el-select>
        <el-input v-model="filter.q" clearable placeholder="搜索订单号或兑换码" style="width:260px" @keyup.enter="load" />
        <el-button type="primary" @click="load">查询</el-button>
      </div>
      <el-table v-loading="loading" :data="rows" stripe>
        <el-table-column prop="order_no" label="订单号" min-width="200"><template #default="{ row }"><span class="mono">{{ row.order_no }}</span></template></el-table-column>
        <el-table-column prop="redeem_code" label="兑换码" min-width="170"><template #default="{ row }"><span class="mono">{{ row.redeem_code || '-' }}</span></template></el-table-column>
        <el-table-column prop="plan_type" label="套餐" width="90" />
        <el-table-column prop="status" label="状态" width="100"><template #default="{ row }"><StatusTag :status="row.status" /></template></el-table-column>
        <el-table-column prop="created_at" label="创建时间" min-width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
        <el-table-column prop="public_message" label="公开提示" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" fixed="right" width="260">
          <template #default="{ row }"><div class="action-row">
            <el-button link type="primary" @click="showDetails(row.id)">详情</el-button>
            <el-button link @click="runAction(row,'requeue')">重排</el-button>
            <template v-if="row.status==='interrupted_review'"><el-button link type="success" @click="runAction(row,'resolve-interrupted',{action:'succeeded'})">标记成功</el-button><el-button link type="warning" @click="runAction(row,'resolve-interrupted',{action:'failed'})">标记失败</el-button></template>
            <el-button link type="warning" @click="runAction(row,'terminate')">结束</el-button>
            <el-button link type="danger" @click="runAction(row,'delete')">删除</el-button>
          </div></template>
        </el-table-column>
      </el-table>
    </section>

    <el-drawer v-model="drawer" title="订单详情" size="min(860px, 94vw)" destroy-on-close @closed="clearDetails">
      <div v-loading="detailLoading" class="order-detail-body">
      <OrderDetails :detail="detail" />
      <el-empty v-if="!detail.order && !detailLoading" description="暂无订单详情" :image-size="72" />
      </div>
    </el-drawer>
  </div>
</template>

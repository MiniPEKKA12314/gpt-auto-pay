<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { redeemApi, type RowData } from "@/api/admin";
import StatusTag from "@/components/StatusTag.vue";
import { downloadBlob } from "@/utils/format";

defineOptions({ name: "Redeem" });
const loading = ref(false);
const batches = ref<RowData[]>([]);
const codes = ref<RowData[]>([]);
const page = reactive({ page: 1, page_size: 20, total: 0, total_pages: 1 });
const filter = reactive({ q: "", status: "", batch_id: "" });
const createVisible = ref(false);
const createLoading = ref(false);
const batchForm = reactive({ name: "", plan_type: "plus", quantity: 10, note: "" });
const generated = ref("");
const selected = reactive(new Map<number, RowData>());
const format = ref("txt");
const selectedRows = computed(() => Array.from(selected.values()));

async function loadBatches() { batches.value = (await redeemApi.batches()).data || []; }
async function loadCodes(reset = false) {
  if (reset) page.page = 1;
  loading.value = true;
  try {
    const data = (await redeemApi.codes({ paginated: 1, ...filter, page: page.page, page_size: page.page_size })).data || {};
    codes.value = data.rows || []; Object.assign(page, data);
  } catch (error: any) { ElMessage.error(error.message); }
  finally { loading.value = false; }
}
async function createBatch() {
  createLoading.value = true;
  try {
    const data = (await redeemApi.createBatch(batchForm)).data || {};
    const rows = data.codes || [];
    generated.value = rows.map((item: RowData) => item.code_display).join("\n");
    rows.forEach((item: RowData) => selected.set(Number(item.id), item));
    createVisible.value = false; ElMessage.success(`已生成 ${data.count || rows.length} 个兑换码`);
    await Promise.all([loadBatches(), loadCodes(true)]);
  } catch (error: any) { ElMessage.error(error.message); }
  finally { createLoading.value = false; }
}
function selectionChange(rows: RowData[]) {
  codes.value.forEach(item => selected.delete(Number(item.id)));
  rows.forEach(item => selected.set(Number(item.id), item));
}
async function codeAction(row: RowData, action: string) {
  if (action === "delete") await ElMessageBox.confirm(`确认删除兑换码 ${row.code_display}？`, "兑换码操作", { type: "warning" });
  try { await redeemApi.action(row.id, action); selected.delete(Number(row.id)); ElMessage.success("兑换码状态已更新"); await loadCodes(); }
  catch (error: any) { if (error !== "cancel") ElMessage.error(error.message); }
}
async function exportCodes() {
  if (!selected.size) { ElMessage.warning("请先选择兑换码"); return; }
  try {
    const result = await redeemApi.exportCodes({ format: format.value, ids: selectedRows.value.map(item => item.id) });
    downloadBlob(result.blob, `redeem-codes-${Date.now()}.${format.value}`);
    ElMessage.success("导出文件已生成");
  } catch (error: any) { ElMessage.error(error.message); }
}
async function copyGenerated() { await navigator.clipboard.writeText(generated.value); ElMessage.success("已复制"); }
onMounted(() => Promise.all([loadBatches(), loadCodes()]));
</script>

<template>
  <div class="admin-page">
    <header class="page-heading"><div><h1>兑换码</h1><p>{{ page.total }} 条记录 · 已选择 {{ selected.size }} 条</p></div><div class="page-actions"><el-button @click="createVisible=true">生成批次</el-button><el-select v-model="format" style="width:90px"><el-option label="TXT" value="txt"/><el-option label="CSV" value="csv"/><el-option label="JSON" value="json"/></el-select><el-button type="primary" :disabled="!selected.size" @click="exportCodes">导出所选</el-button></div></header>
    <section class="content-panel">
      <div class="filter-bar mb-4">
        <el-input v-model="filter.q" clearable placeholder="搜索兑换码" style="width:240px" @keyup.enter="loadCodes(true)" />
        <el-select v-model="filter.status" clearable placeholder="全部状态" style="width:140px"><el-option label="未使用" value="unused"/><el-option label="锁定" value="locked"/><el-option label="已使用" value="used"/><el-option label="禁用" value="disabled"/><el-option label="不可用" value="unavailable"/></el-select>
        <el-select v-model="filter.batch_id" clearable filterable placeholder="全部批次" style="width:220px"><el-option v-for="item in batches" :key="item.id" :label="item.name" :value="item.id"/></el-select>
        <el-button type="primary" @click="loadCodes(true)">查询</el-button><el-button @click="selected.clear()">清空已选</el-button>
      </div>
      <el-table v-loading="loading" :data="codes" row-key="id" @selection-change="selectionChange">
        <el-table-column type="selection" width="48" reserve-selection/><el-table-column prop="id" label="ID" width="70"/><el-table-column prop="code_display" label="兑换码" min-width="230"><template #default="{row}"><span class="mono">{{ row.code_display }}</span></template></el-table-column><el-table-column prop="plan_type" label="套餐" width="100"/><el-table-column prop="status" label="状态" width="110"><template #default="{row}"><StatusTag :status="row.status"/></template></el-table-column>
        <el-table-column label="操作" width="210" fixed="right"><template #default="{row}"><div class="action-row"><el-button link @click="codeAction(row,'disable')">禁用</el-button><el-button link type="success" @click="codeAction(row,'restore-status')">恢复状态</el-button><el-button link type="danger" @click="codeAction(row,'delete')">删除</el-button></div></template></el-table-column>
      </el-table>
      <div class="flex justify-end mt-4"><el-pagination v-model:current-page="page.page" v-model:page-size="page.page_size" :page-sizes="[20,50,100]" :total="page.total" layout="total, sizes, prev, pager, next" @change="loadCodes()" /></div>
    </section>
    <section class="content-panel"><div class="panel-heading"><h2>批次统计</h2></div><el-table :data="batches" size="small"><el-table-column prop="id" label="ID" width="70"/><el-table-column prop="name" label="批次" min-width="180"/><el-table-column prop="plan_type" label="套餐" width="90"/><el-table-column label="统计" min-width="240"><template #default="{row}"><span class="mono">unused {{ row.stats?.unused||0 }} · used {{ row.stats?.used||0 }} · locked {{ row.stats?.locked||0 }}</span></template></el-table-column></el-table></section>
    <section v-if="generated" class="content-panel"><div class="panel-heading"><h2>最近生成</h2><el-button text type="primary" @click="copyGenerated">复制</el-button></div><div class="log-console">{{ generated }}</div></section>
    <el-dialog v-model="createVisible" title="生成兑换码批次" width="560px"><el-form :model="batchForm" label-position="top"><div class="form-grid"><el-form-item label="批次名称"><el-input v-model="batchForm.name"/></el-form-item><el-form-item label="套餐"><el-select v-model="batchForm.plan_type"><el-option label="Go" value="go"/><el-option label="Plus" value="plus"/><el-option label="Pro 5x" value="pro5x"/><el-option label="Pro 20x" value="pro20x"/></el-select></el-form-item><el-form-item label="数量"><el-input-number v-model="batchForm.quantity" :min="1" :max="1000"/></el-form-item><el-form-item label="备注"><el-input v-model="batchForm.note"/></el-form-item></div></el-form><template #footer><el-button @click="createVisible=false">取消</el-button><el-button type="primary" :loading="createLoading" @click="createBatch">生成</el-button></template></el-dialog>
  </div>
</template>

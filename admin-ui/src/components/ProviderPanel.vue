<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { providerApi, type RowData } from "@/api/admin";
import { useResourcesStore } from "@/store/modules/resources";

const props = defineProps<{ provider: "vcc" | "kimoox" }>();
const resources = useResourcesStore();
const loading = ref(false);
const output = ref<RowData | null>(null);
const isVcc = computed(() => props.provider === "vcc");
const title = computed(() => isVcc.value ? "VCC" : "Kimoox");
const config = reactive<RowData>({ timeout_ms: 15000 });
const remote = reactive<RowData>({ pageNumber: 1, pageNum: 1, pageSize: 100, all: true, card_group_id: 0, max_success_count: 1, auto_unfreeze_before_use: true, auto_freeze_after_success: true, auto_freeze_after_failure: true });
const openForm = reactive<RowData>({ cardType: "PREPAID", cardCount: 1 });
const cardForm = reactive<RowData>({});
const consumeForm = reactive<RowData>({ page: 1, pageNum: 1, pageSize: 100 });

function clean(value: RowData) { return Object.fromEntries(Object.entries(value).filter(([,item]) => item !== "" && item !== null && item !== undefined)); }
async function copyWebhook() {
  try { await navigator.clipboard.writeText(String(config.webhook_url || "")); ElMessage.success("回调地址已复制"); }
  catch { ElMessage.error("复制失败"); }
}
async function loadConfig() {
  loading.value = true;
  try { Object.assign(config, (await providerApi.config(props.provider)).data || {}); }
  catch (error: any) { ElMessage.error(error.message); }
  finally { loading.value = false; }
}
async function saveConfig() {
  const payload = clean({ ...config });
  for (const key of ["secret_key", "api_secret", "webhook_secret"]) if (!payload[key]) delete payload[key];
  try { output.value = (await providerApi.saveConfig(props.provider, payload)).data; ElMessage.success(`${title.value} 配置已保存`); await loadConfig(); }
  catch (error: any) { ElMessage.error(error.message); }
}
async function run(action: string, payload: RowData = {}, method: "get" | "post" = "post") {
  loading.value = true;
  try {
    const requestPayload = clean({ ...payload });
    if (method === "get" && isVcc.value && action === "cards" && "all" in requestPayload) {
      requestPayload.all = requestPayload.all ? 1 : 0;
    }
    const result = method === "get" ? await providerApi.get(props.provider, action, requestPayload) : await providerApi.post(props.provider, action, requestPayload);
    output.value = result.data || result as any; ElMessage.success(`${title.value} 操作已完成`);
    if (action === "import") await resources.load(true);
  } catch (error: any) { ElMessage.error(error.message); }
  finally { loading.value = false; }
}
function importCards() { run("import", { ...remote, card_group_id: Number(remote.card_group_id), max_success_count: Number(remote.max_success_count) }); }
onMounted(async () => { await resources.load(); await loadConfig(); });
</script>

<template>
  <div v-loading="loading">
    <el-tabs>
      <el-tab-pane label="接口配置">
        <el-form label-position="top"><div class="form-grid">
          <el-form-item label="接口地址"><el-input v-model="config.base_url"/></el-form-item>
          <template v-if="isVcc"><el-form-item label="User Serial"><el-input v-model="config.user_serial"/></el-form-item><el-form-item label="Secret Key"><el-input v-model="config.secret_key" type="password" show-password placeholder="留空时保留原值"/></el-form-item></template>
          <template v-else><el-form-item label="API Key"><el-input v-model="config.api_key"/></el-form-item><el-form-item label="API Secret"><el-input v-model="config.api_secret" type="password" show-password placeholder="留空时保留原值"/></el-form-item><el-form-item label="Webhook Secret"><el-input v-model="config.webhook_secret" type="password" show-password placeholder="留空时保留原值"/></el-form-item><el-form-item label="Webhook 回调地址"><el-input v-model="config.webhook_url"><template #append><el-button @click="copyWebhook">复制</el-button></template></el-input></el-form-item></template>
          <el-form-item label="超时（ms）"><el-input-number v-model="config.timeout_ms" :min="1000" :max="120000"/></el-form-item>
        </div><div class="action-row"><el-button type="primary" @click="saveConfig">保存配置</el-button><el-button @click="run('test')">查询账户状态</el-button><el-button @click="run('bins',{},'get')">拉取 BIN</el-button></div></el-form>
      </el-tab-pane>
      <el-tab-pane label="远端卡">
        <el-form label-position="top"><div class="form-grid">
          <el-form-item label="页码"><el-input-number v-model="remote[isVcc?'pageNumber':'pageNum']" :min="1"/></el-form-item><el-form-item label="每页数量"><el-input-number v-model="remote.pageSize" :min="1" :max="1000"/></el-form-item>
          <template v-if="isVcc"><el-form-item label="远端卡 ID"><el-input v-model="remote.userBankId"/></el-form-item><el-form-item label="远端卡号"><el-input v-model="remote.userBankNum"/></el-form-item><el-form-item label="查询全部"><el-switch v-model="remote.all"/></el-form-item></template>
          <template v-else><el-form-item label="远端卡 ID"><el-input v-model="remote.cardId"/></el-form-item><el-form-item label="卡类型"><el-select v-model="remote.cardType" clearable><el-option label="PREPAID" value="PREPAID"/><el-option label="BUDGET" value="BUDGET"/></el-select></el-form-item><el-form-item label="卡状态"><el-select v-model="remote.cardStatus" clearable><el-option label="ACTIVE" value="ACTIVE"/><el-option label="FROZEN" value="FROZEN"/><el-option label="OPENING" value="OPENING"/><el-option label="CANCELLED" value="CANCELLED"/></el-select></el-form-item><el-form-item label="卡号/后四位"><el-input v-model="remote.cardNo"/></el-form-item><el-form-item label="批次号"><el-input v-model="remote.batchNo"/></el-form-item><el-form-item label="备注"><el-input v-model="remote.remark"/></el-form-item></template>
          <el-form-item label="导入卡组"><el-select v-model="remote.card_group_id"><el-option v-for="group in resources.cardGroups" :key="group.id" :label="group.name" :value="group.id"/></el-select></el-form-item><el-form-item label="最大成功次数"><el-input-number v-model="remote.max_success_count" :min="1"/></el-form-item>
          <el-form-item class="full-span" label="导入后策略"><div class="action-row"><el-checkbox v-model="remote.auto_unfreeze_before_use">使用前解冻</el-checkbox><el-checkbox v-model="remote.auto_freeze_after_success">成功后冻结</el-checkbox><el-checkbox v-model="remote.auto_freeze_after_failure">失败后冻结</el-checkbox></div></el-form-item>
        </div><div class="action-row"><el-button @click="run('cards',remote,'get')">查询远端卡</el-button><el-button type="primary" @click="importCards">导入远端卡</el-button></div></el-form>
      </el-tab-pane>
      <el-tab-pane label="开卡">
        <el-form label-position="top"><div class="form-grid">
          <template v-if="isVcc"><el-form-item label="开卡 BIN"><el-input v-model="openForm.cardBin"/></el-form-item><el-form-item label="开卡金额（USD）"><el-input v-model="openForm.amount"/></el-form-item><el-form-item label="邮箱"><el-input v-model="openForm.email"/></el-form-item><el-form-item label="备注"><el-input v-model="openForm.remark"/></el-form-item><el-form-item label="开卡订单 ID"><el-input v-model="openForm.orderId"/></el-form-item></template>
          <template v-else><el-form-item label="请求号"><el-input v-model="openForm.requestNo" placeholder="留空自动生成"/></el-form-item><el-form-item label="卡类型"><el-select v-model="openForm.cardType"><el-option label="PREPAID" value="PREPAID"/><el-option label="BUDGET" value="BUDGET"/></el-select></el-form-item><el-form-item label="BIN ID"><el-input v-model="openForm.cardBinId"/></el-form-item><el-form-item label="持卡人 ID"><el-input v-model="openForm.holderId"/></el-form-item><el-form-item label="开卡数量"><el-input-number v-model="openForm.cardCount" :min="1"/></el-form-item><el-form-item label="首充金额（USD）"><el-input v-model="openForm.rechargeAmount"/></el-form-item><el-form-item label="预算卡组 ID"><el-input v-model="openForm.cardGroupId"/></el-form-item><el-form-item label="预算组 ID"><el-input v-model="openForm.budgetId"/></el-form-item><el-form-item label="任务 ID"><el-input v-model="openForm.taskId"/></el-form-item><el-form-item label="批次号"><el-input v-model="openForm.batchNo"/></el-form-item><el-form-item label="备注"><el-input v-model="openForm.remark"/></el-form-item></template>
        </div><div class="action-row"><el-button type="primary" @click="run('open-card',openForm)">提交开卡</el-button><el-button @click="run('open-detail',openForm)">查询开卡详情</el-button></div></el-form>
      </el-tab-pane>
      <el-tab-pane label="卡片操作">
        <el-form label-position="top"><div class="form-grid">
          <el-form-item label="卡 ID"><el-input v-model="cardForm.cardId"/></el-form-item><el-form-item v-if="isVcc" label="卡号"><el-input v-model="cardForm.cardNum"/></el-form-item><el-form-item label="金额（USD）"><el-input v-model="cardForm.amount"/></el-form-item><el-form-item v-if="isVcc" label="充值单 ID"><el-input v-model="cardForm.rechargeId"/></el-form-item><el-form-item v-if="isVcc" label="转出单 ID"><el-input v-model="cardForm.cashOutId"/></el-form-item>
        </div><div class="action-row"><el-button type="primary" @click="run('recharge',isVcc?{bankCardId:cardForm.cardId,bankCardNum:cardForm.cardNum,amount:cardForm.amount}:cardForm)">充值</el-button><el-button @click="run('recharge-detail',{rechargeId:cardForm.rechargeId})" v-if="isVcc">查充值详情</el-button><el-button @click="run('cash-out',isVcc?{bankCardId:cardForm.cardId,bankCardNum:cardForm.cardNum,amount:cardForm.amount}:cardForm)">资金转出</el-button><el-button @click="run('cash-out-detail',{id:cardForm.cashOutId})" v-if="isVcc">查转出详情</el-button><el-button @click="run('suspend',cardForm)">冻结</el-button><el-button @click="run('enable',cardForm)">解冻</el-button><el-button type="danger" plain @click="run('cancel',cardForm)">销卡</el-button></div></el-form>
      </el-tab-pane>
      <el-tab-pane label="交易流水"><el-form label-position="top"><div class="form-grid"><el-form-item label="卡号/后四位"><el-input v-model="consumeForm[isVcc?'number':'cardNo']"/></el-form-item><el-form-item label="页码"><el-input-number v-model="consumeForm[isVcc?'page':'pageNum']" :min="1"/></el-form-item><el-form-item label="每页数量"><el-input-number v-model="consumeForm.pageSize" :min="1" :max="1000"/></el-form-item><el-form-item v-if="!isVcc" label="交易状态"><el-input v-model="consumeForm.transactionStatus"/></el-form-item></div><el-button type="primary" @click="run('consume-orders',consumeForm)">查询流水</el-button></el-form></el-tab-pane>
    </el-tabs>
    <div v-if="output" class="mt-4"><div class="panel-heading"><h2>操作结果</h2><el-button text @click="output=null">清空</el-button></div><pre class="log-console">{{ JSON.stringify(output,null,2) }}</pre></div>
  </div>
</template>

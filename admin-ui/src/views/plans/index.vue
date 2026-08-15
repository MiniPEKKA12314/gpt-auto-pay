<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { InfoFilled } from "@element-plus/icons-vue";
import { plansApi, type RowData } from "@/api/admin";
import { useResourcesStore } from "@/store/modules/resources";

defineOptions({ name: "Plans" });
const resources = useResourcesStore();
const plans = ref<RowData[]>([]);
const selected = ref("plus");
const loading = ref(false);
const output = ref<RowData | null>(null);
const form = reactive<RowData>({});
const checkoutProxies = computed(() => resources.proxyGroups.filter(item => ["checkout","shared"].includes(item.kind)));
const directProxies = computed(() => resources.proxyGroups.filter(item => ["direct_card","shared"].includes(item.kind)));

function sync(plan: RowData) {
  Object.keys(form).forEach(key => delete form[key]);
  Object.assign(form, plan, {
    enabled: Boolean(plan.enabled), checkout_proxy_group_id: Number(plan.checkout_proxy_group_id||0), direct_card_proxy_group_id: Number(plan.direct_card_proxy_group_id||0), billing_group_id: Number(plan.billing_group_id||0),
    card_group_ids: (plan.card_groups||[]).map((item:RowData)=>Number(item.card_group_id)), remote_balance_success_fallback:Boolean(plan.remote_balance_success_fallback), lock_redeem_code_on_failure:Boolean(plan.lock_redeem_code_on_failure), allow_card_switch:Boolean(plan.allow_card_switch), remote_success_withdraw:plan.remote_success_withdraw!==0, remote_failure_withdraw:plan.remote_failure_withdraw!==0
  });
}
async function load() {
  loading.value=true;
  try { plans.value=(await plansApi.list()).data||[]; const plan=plans.value.find(item=>item.plan_type===selected.value)||plans.value[0]; if(plan){selected.value=plan.plan_type;sync(plan);} }
  catch(error:any){ElMessage.error(error.message);} finally{loading.value=false;}
}
function selectPlan(){const plan=plans.value.find(item=>item.plan_type===selected.value);if(plan)sync(plan);}
async function save(){loading.value=true;try{
  const payload:RowData={...form,card_groups:(form.card_group_ids||[]).map((id:number,index:number)=>({card_group_id:id,priority:(index+1)*100})),kimoox_issue_mode:form.card_source==="kimoox"?"per_order":"pool",kimoox_reclaim_balance:Boolean(form.remote_success_withdraw||form.remote_failure_withdraw),kimoox_cancel_after_order:form.remote_success_final_action==="cancel"||form.remote_failure_final_action==="cancel"};delete payload.card_group_ids;delete payload.plan_type;
  output.value=(await plansApi.update(selected.value,payload)).data;ElMessage.success("套餐配置已保存");await load();
}catch(error:any){ElMessage.error(error.message);}finally{loading.value=false;}}
async function readiness(){try{output.value=(await plansApi.readiness(selected.value)).data;ElMessage.success("运行条件检查完成");}catch(error:any){ElMessage.error(error.message);}}
onMounted(async()=>{await resources.load();await load();});
</script>

<template>
  <div class="admin-page" v-loading="loading||resources.loading">
    <header class="page-heading"><div><h1>套餐配置</h1><p>支付资源、重试策略与失败处理</p></div><div class="page-actions"><el-select v-model="selected" style="width:180px" @change="selectPlan"><el-option v-for="item in plans" :key="item.plan_type" :label="item.display_name" :value="item.plan_type"/></el-select><el-button @click="readiness">检查运行条件</el-button><el-button type="primary" @click="save">保存配置</el-button></div></header>
    <section class="content-panel"><div class="panel-heading"><h2>基础设置</h2><el-switch v-model="form.enabled" active-text="启用套餐"/></div><el-form :model="form" label-position="top"><div class="form-grid">
      <el-form-item label="显示名称"><el-input v-model="form.display_name"/></el-form-item><el-form-item label="支付方式"><el-segmented v-model="form.card_source" :options="[{label:'本地卡组',value:'local'},{label:'VCC 每单开卡',value:'vcc'},{label:'Kimoox 每单开卡',value:'kimoox'}]"/></el-form-item>
      <el-form-item label="付款国家"><el-input v-model="form.payment_country" placeholder="PH"/></el-form-item><el-form-item label="付款币种"><el-input v-model="form.payment_currency" placeholder="PHP"/></el-form-item>
      <el-form-item label="提链代理组"><el-select v-model="form.checkout_proxy_group_id" clearable><el-option v-for="item in checkoutProxies" :key="item.id" :label="item.name" :value="item.id"/></el-select></el-form-item><el-form-item label="直卡代理组"><el-select v-model="form.direct_card_proxy_group_id" clearable><el-option v-for="item in directProxies" :key="item.id" :label="item.name" :value="item.id"/></el-select></el-form-item>
      <el-form-item label="账单组"><el-select v-model="form.billing_group_id" clearable><el-option v-for="item in resources.billingGroups" :key="item.id" :label="item.name" :value="item.id"/></el-select></el-form-item><el-form-item label="失败提示"><el-input v-model="form.failure_message"/></el-form-item>
    </div></el-form></section>
    <section v-if="form.card_source==='local'" class="content-panel"><div class="panel-heading"><h2>本地卡策略</h2></div><el-form label-position="top"><div class="form-grid"><el-form-item class="full-span" label="可用卡组"><el-select v-model="form.card_group_ids" multiple filterable><el-option v-for="item in resources.cardGroups" :key="item.id" :label="`#${item.id} ${item.name}`" :value="item.id"/></el-select></el-form-item><el-form-item label="允许换卡"><el-switch v-model="form.allow_card_switch"/></el-form-item><el-form-item label="最多换卡数"><el-input-number v-model="form.max_card_switches" :min="0" :max="1000"/></el-form-item><el-form-item label="提链代理尝试"><el-input-number v-model="form.checkout_max_proxy_attempts" :min="1"/></el-form-item><el-form-item label="每张卡代理尝试"><el-input-number v-model="form.max_proxy_attempts_per_card" :min="1"/></el-form-item></div></el-form></section>
    <section v-else class="content-panel"><div class="panel-heading"><h2>远程卡策略</h2></div><el-form label-position="top"><div class="form-grid">
      <el-form-item><template #label>目标余额（USD）<el-tooltip content="例如 25.00；远程卡开卡/补余额生效，全部按 USD" placement="top"><el-icon class="field-help"><InfoFilled /></el-icon></el-tooltip></template><el-input v-model="form.vcc_target_balance_usd" placeholder="例如 25.00；远程卡开卡/补余额生效，全部按 USD"/></el-form-item><el-form-item><template #label>本订单最多开卡数<el-tooltip content="例如 2；达到数量后停止继续开卡" placement="top"><el-icon class="field-help"><InfoFilled /></el-icon></el-tooltip></template><el-input-number v-model="form.remote_max_cards" :min="1" placeholder="例如 2"/></el-form-item>
      <template v-if="form.card_source==='vcc'"><el-form-item label="VCC 开卡 BIN"><el-input v-model="form.vcc_card_bin" placeholder="点击卡池里的 VCC 拉取 BIN 后填入"/></el-form-item><el-form-item label="VCC 开卡邮箱"><el-input v-model="form.vcc_open_email" placeholder="可留空"/></el-form-item></template>
      <template v-if="form.card_source==='kimoox'"><el-form-item label="Kimoox BIN ID"><el-input v-model="form.kimoox_card_bin_id" placeholder="点击卡池里的 Kimoox 拉取 BIN 后填入"/></el-form-item><el-form-item label="卡类型"><el-select v-model="form.kimoox_card_type"><el-option label="PREPAID 储值卡" value="PREPAID"/><el-option label="BUDGET 预算卡" value="BUDGET"/></el-select></el-form-item><el-form-item><template #label>持卡人 ID<el-tooltip content="可留空用卡台默认" placement="top"><el-icon class="field-help"><InfoFilled /></el-icon></el-tooltip></template><el-input v-model="form.kimoox_holder_id" placeholder="可留空用卡台默认"/></el-form-item><el-form-item label="远端卡组 ID"><el-input v-model="form.kimoox_card_group_id" placeholder="预算卡按卡台要求填写"/></el-form-item><el-form-item label="预算组 ID"><el-input v-model="form.kimoox_budget_id" placeholder="预算卡按卡台要求填写"/></el-form-item></template>
      <el-form-item><template #label>余额下降成功兜底<el-tooltip content="开启后，付款页面未确认成功时，若付款后卡余额比付款前减少超过 50%，系统将按充值成功处理。仅适用于 VCC/Kimoox 远程卡。" placement="top"><el-icon class="field-help"><InfoFilled /></el-icon></el-tooltip></template><el-switch v-model="form.remote_balance_success_fallback"/></el-form-item><el-form-item><template #label>失败后锁定兑换码<el-tooltip content="开启后，即使本订单最终失败，兑换码也会标记为不可用，管理员核对后再决定是否恢复；关闭则失败后返还为未使用。" placement="top"><el-icon class="field-help"><InfoFilled /></el-icon></el-tooltip></template><el-switch v-model="form.lock_redeem_code_on_failure"/></el-form-item>
      <el-form-item label="成功后转出余额"><el-switch v-model="form.remote_success_withdraw"/></el-form-item><el-form-item label="成功后卡片处理"><el-select v-model="form.remote_success_final_action"><el-option label="销卡" value="cancel"/><el-option label="冻结" value="freeze"/><el-option label="保留" value="keep"/></el-select></el-form-item>
      <el-form-item label="失败后转出余额"><el-switch v-model="form.remote_failure_withdraw"/></el-form-item><el-form-item label="失败后卡片处理"><el-select v-model="form.remote_failure_final_action"><el-option label="销卡" value="cancel"/><el-option label="冻结" value="freeze"/><el-option label="保留" value="keep"/></el-select></el-form-item>
    </div></el-form></section>
    <section v-if="output" class="content-panel"><div class="panel-heading"><h2>检查结果</h2><el-button text @click="output=null">关闭</el-button></div><pre class="log-console">{{ JSON.stringify(output,null,2) }}</pre></section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { ordersApi, type RowData } from "@/api/admin";
import { useResourcesStore } from "@/store/modules/resources";

defineOptions({ name: "ManualOrders" });
const resources = useResourcesStore();
const formRef = ref<FormInstance>();
const loading = ref(false);
const resultVisible = ref(false);
const result = ref<RowData>({});
const emptyForm = () => ({ plan_type: "plus", account_label: "", card_group_id: 0, card_id: 0, billing_group_id: 0, billing_address_id: 0, checkout_proxy_group_id: 0, direct_card_proxy_group_id: 0, access_token: "", session_token: "", session_cookie_name: "__Secure-next-auth.session-token", checkout_input: "", note: "" });
const form = reactive(emptyForm());
const rules: FormRules = {
  plan_type: [{ required: true, message: "请选择套餐" }], card_group_id: [{ required: true, type: "number", min: 1, message: "请选择卡组" }], card_id: [{ required: true, type: "number", min: 1, message: "请选择卡" }], billing_group_id: [{ required: true, type: "number", min: 1, message: "请选择账单组" }], billing_address_id: [{ required: true, type: "number", min: 1, message: "请选择账单地址" }], access_token: [{ required: true, message: "请输入 Access Token" }], session_token: [{ required: true, message: "请输入 Session Token" }]
};
const cards = computed(() => resources.cards.filter(card => !form.card_group_id || Number(card.card_group_id) === form.card_group_id));
const addresses = computed(() => resources.billingAddresses.filter(item => !form.billing_group_id || Number(item.billing_group_id) === form.billing_group_id));
const checkoutProxies = computed(() => resources.proxyGroups.filter(item => ["checkout", "shared"].includes(item.kind)));
const directProxies = computed(() => resources.proxyGroups.filter(item => ["direct_card", "shared"].includes(item.kind)));

async function submit() {
  await formRef.value?.validate(); loading.value = true;
  try {
    result.value = (await ordersApi.createManual({ ...form })).data || {};
    form.access_token = ""; form.session_token = ""; form.checkout_input = "";
    resultVisible.value = true; ElMessage.success("手动充值订单已创建并进入队列");
  } catch (error: any) { ElMessage.error(error.message); }
  finally { loading.value = false; }
}
onMounted(() => resources.load());
</script>

<template>
  <div class="admin-page">
    <header class="page-heading"><div><h1>手动充值</h1><p>创建后将进入现有队列处理流程</p></div></header>
    <section class="content-panel" v-loading="resources.loading">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <div class="form-grid">
          <el-form-item label="订阅套餐" prop="plan_type"><el-select v-model="form.plan_type"><el-option v-for="plan in resources.plans" :key="plan.plan_type" :label="plan.display_name" :value="plan.plan_type" /></el-select></el-form-item>
          <el-form-item label="账号标识"><el-input v-model="form.account_label" placeholder="邮箱或业务备注" /></el-form-item>
          <el-form-item label="卡组" prop="card_group_id"><el-select v-model="form.card_group_id" filterable @change="form.card_id=0"><el-option v-for="item in resources.cardGroups" :key="item.id" :label="`#${item.id} ${item.name}`" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="卡" prop="card_id"><el-select v-model="form.card_id" filterable><el-option v-for="item in cards" :key="item.id" :label="`#${item.id} ${item.masked_number} · ${item.success_count}/${item.max_success_count}`" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="账单组" prop="billing_group_id"><el-select v-model="form.billing_group_id" @change="form.billing_address_id=0"><el-option v-for="item in resources.billingGroups" :key="item.id" :label="`#${item.id} ${item.name}`" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="账单地址" prop="billing_address_id"><el-select v-model="form.billing_address_id" filterable><el-option v-for="item in addresses" :key="item.id" :label="`#${item.id} ${item.name} · ${item.country} ${item.city}`" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="提链代理组"><el-select v-model="form.checkout_proxy_group_id" clearable><el-option v-for="item in checkoutProxies" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="直卡代理组"><el-select v-model="form.direct_card_proxy_group_id" clearable><el-option v-for="item in directProxies" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
          <el-form-item class="full-span" label="Access Token / AT" prop="access_token"><el-input v-model="form.access_token" type="textarea" :rows="3" /></el-form-item>
          <el-form-item class="full-span" label="Session Token" prop="session_token"><el-input v-model="form.session_token" type="textarea" :rows="3" /></el-form-item>
          <el-form-item label="Session Cookie 名称"><el-input v-model="form.session_cookie_name" /></el-form-item>
          <el-form-item label="已生成 checkout input"><el-input v-model="form.checkout_input" clearable placeholder="留空时自动提链" /></el-form-item>
          <el-form-item class="full-span" label="备注"><el-input v-model="form.note" /></el-form-item>
        </div>
        <div class="action-row"><el-button native-type="submit" type="primary" :loading="loading">创建充值订单</el-button><el-button @click="Object.assign(form,emptyForm())">重置</el-button></div>
      </el-form>
    </section>
    <el-dialog v-model="resultVisible" title="订单已创建" width="620px"><pre class="log-console">{{ JSON.stringify(result, null, 2) }}</pre><template #footer><router-link to="/orders"><el-button type="primary">前往订单管理</el-button></router-link></template></el-dialog>
  </div>
</template>

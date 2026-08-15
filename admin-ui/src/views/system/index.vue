<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { CopyDocument, Link } from "@element-plus/icons-vue";
import { authApi, systemApi, type RowData } from "@/api/admin";
import { formatTime } from "@/utils/format";

defineOptions({ name: "SystemSettings" });

const loading = ref(false);
const audits = ref<RowData[]>([]);
const detail = ref<RowData | null>(null);
const password = reactive({ current_password: "", new_password: "", confirm_password: "" });
const legacy = reactive({ enabled: true, suffix: "legacy-console", path: "/admin-legacy/legacy-console" });
const legacyUrl = computed(() => {
  const origin = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:8877` : window.location.origin;
  return `${origin}${legacy.path}`;
});

async function load() {
  loading.value = true;
  try {
    const [auditResponse, legacyResponse] = await Promise.all([systemApi.audits(), systemApi.legacyEntry()]);
    audits.value = auditResponse.data || [];
    Object.assign(legacy, legacyResponse.data || {});
  } catch (error: any) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}

async function changePassword() {
  if (password.new_password !== password.confirm_password) {
    ElMessage.warning("两次输入的新密码不一致");
    return;
  }
  loading.value = true;
  try {
    await authApi.changePassword({
      current_password: password.current_password,
      new_password: password.new_password
    });
    Object.assign(password, { current_password: "", new_password: "", confirm_password: "" });
    ElMessage.success("管理员密码已更新");
  } catch (error: any) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}

async function saveLegacyEntry() {
  const suffix = legacy.suffix.trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(suffix)) {
    ElMessage.warning("入口字符串需为 3-64 位字母、数字、短横线或下划线");
    return;
  }
  loading.value = true;
  try {
    const response = await systemApi.saveLegacyEntry({ enabled: legacy.enabled, suffix });
    Object.assign(legacy, response.data || {});
    ElMessage.success("旧版后台入口已更新");
    audits.value = (await systemApi.audits()).data || [];
  } catch (error: any) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}

async function copyLegacyUrl() {
  try {
    await navigator.clipboard.writeText(legacyUrl.value);
    ElMessage.success("旧版后台地址已复制");
  } catch {
    ElMessage.error("复制失败，请重新操作");
  }
}

function openLegacy() {
  window.open(legacyUrl.value, "_blank", "noopener,noreferrer");
}

onMounted(load);
</script>

<template>
  <div class="admin-page" v-loading="loading">
    <header class="page-heading">
      <div><h1>安全与审计</h1><p>管理员账号、兼容入口与后台操作记录</p></div>
      <div class="page-actions"><el-button @click="load">刷新配置</el-button></div>
    </header>

    <div class="dashboard-grid system-grid">
      <section class="content-panel">
        <div class="panel-heading"><h2>修改管理员密码</h2></div>
        <el-form label-position="top">
          <el-form-item label="当前密码"><el-input v-model="password.current_password" type="password" show-password /></el-form-item>
          <el-form-item label="新密码"><el-input v-model="password.new_password" type="password" show-password /></el-form-item>
          <el-form-item label="确认新密码"><el-input v-model="password.confirm_password" type="password" show-password /></el-form-item>
          <el-button type="primary" @click="changePassword">更新密码</el-button>
        </el-form>
      </section>

      <section class="content-panel">
        <div class="panel-heading"><h2>旧版后台入口</h2><el-switch v-model="legacy.enabled" inline-prompt active-text="开" inactive-text="关" /></div>
        <el-form label-position="top">
          <el-form-item label="入口拼接字符串">
            <el-input v-model="legacy.suffix" maxlength="64">
              <template #prepend>/admin-legacy/</template>
            </el-input>
          </el-form-item>
          <div class="legacy-path">
            <span>当前完整路径</span>
            <strong class="mono">{{ legacy.path }}</strong>
          </div>
          <div class="action-row legacy-actions">
            <el-button type="primary" @click="saveLegacyEntry">保存入口配置</el-button>
            <el-button :icon="CopyDocument" @click="copyLegacyUrl">复制地址</el-button>
            <el-button :icon="Link" :disabled="!legacy.enabled" @click="openLegacy">打开旧版</el-button>
          </div>
        </el-form>
      </section>
    </div>

    <section class="content-panel">
      <div class="panel-heading"><h2>安全状态</h2></div>
      <el-descriptions :column="4" border class="security-descriptions">
        <el-descriptions-item label="鉴权方式">HttpOnly 会话 Cookie</el-descriptions-item>
        <el-descriptions-item label="会话有效期">12 小时</el-descriptions-item>
        <el-descriptions-item label="登录限流">每分钟 10 次</el-descriptions-item>
        <el-descriptions-item label="旧版入口">{{ legacy.enabled ? '已开启' : '已关闭' }}</el-descriptions-item>
      </el-descriptions>
    </section>

    <section class="content-panel">
      <div class="panel-heading"><h2>操作审计</h2><span class="text-xs text-gray-500">{{ audits.length }} 条记录</span></div>
      <el-table :data="audits" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="action" label="动作" min-width="190" />
        <el-table-column prop="target_type" label="对象类型" min-width="130" />
        <el-table-column prop="target_id" label="对象 ID" width="150" />
        <el-table-column prop="ip" label="IP" min-width="140" />
        <el-table-column prop="created_at" label="时间" min-width="170"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
        <el-table-column label="详情" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="detail = row">查看</el-button></template></el-table-column>
      </el-table>
    </section>

    <el-drawer :model-value="Boolean(detail)" title="审计详情" size="min(600px, 92vw)" @close="detail = null">
      <pre class="log-console">{{ JSON.stringify(detail, null, 2) }}</pre>
    </el-drawer>
  </div>
</template>

<style scoped>
.system-grid { grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); }
.legacy-path { display:flex; flex-direction:column; gap:6px; padding:12px 14px; border:1px solid #e4e8ee; background:#f7f9fb; border-radius:6px; color:#687384; font-size:12px; }
.legacy-path strong { overflow-wrap:anywhere; color:#17202a; font-size:14px; }
.legacy-actions { margin-top:16px; }
@media (max-width: 900px) {
  .system-grid { grid-template-columns: 1fr; }
  .security-descriptions :deep(.el-descriptions__body) { overflow-x:auto; }
}
@media (max-width: 640px) {
  .legacy-actions { align-items:stretch; flex-direction:column; }
  .legacy-actions :deep(.el-button) { width:100%; margin-left:0; }
}
</style>

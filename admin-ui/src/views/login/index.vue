<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { useUserStoreHook } from "@/store/modules/user";

const router = useRouter();
const route = useRoute();
const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;
const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ username: "admin", password: "" });
const rules: FormRules = {
  username: [{ required: true, message: "请输入管理员账号", trigger: "blur" }],
  password: [{ required: true, message: "请输入管理员密码", trigger: "blur" }]
};

async function submit() {
  await formRef.value?.validate();
  loading.value = true;
  try {
    await useUserStoreHook().loginByUsername(form);
    ElMessage.success("登录成功");
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/dashboard";
    await router.replace(redirect);
  } catch (error: any) {
    ElMessage.error(error.message || "登录失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="login-screen">
    <section class="login-visual" aria-label="GPT Auto Pay 管理控制台">
      <div class="login-brand">
        <img :src="logoUrl" alt="GPT Auto Pay" />
        <span>GPT Auto Pay</span>
      </div>
      <div class="login-visual__copy">
        <span class="login-kicker">CONTROL CONSOLE</span>
        <h1>充值业务管理后台</h1>
        <div class="login-signals">
          <span><i class="signal-dot signal-dot--green" />队列状态</span>
          <span><i class="signal-dot signal-dot--blue" />订单流转</span>
          <span><i class="signal-dot signal-dot--amber" />资源调度</span>
        </div>
      </div>
    </section>

    <section class="login-form-wrap">
      <div class="login-form-panel">
        <div class="login-mobile-brand">
          <img :src="logoUrl" alt="" />
          <span>GPT Auto Pay</span>
        </div>
        <div class="login-title">
          <h2>管理员登录</h2>
          <p>使用后台管理员凭据继续</p>
        </div>
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" @submit.prevent="submit">
          <el-form-item label="账号" prop="username">
            <el-input v-model="form.username" autocomplete="username" placeholder="管理员账号" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" type="password" show-password autocomplete="current-password" placeholder="管理员密码" @keyup.enter="submit" />
          </el-form-item>
          <el-button native-type="submit" type="primary" size="large" class="login-submit" :loading="loading">登录</el-button>
        </el-form>
        <a class="back-link" href="/">返回充值前台</a>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-screen { display:grid; grid-template-columns:minmax(420px,1.1fr) minmax(420px,.9fr); min-height:100vh; background:#fff; }
.login-visual { position:relative; display:flex; flex-direction:column; justify-content:space-between; min-height:100vh; padding:38px 44px 54px; overflow:hidden; color:#fff; background:#17202a url("@/assets/login/bg.png") center/cover no-repeat; }
.login-visual::after { position:absolute; inset:0; content:""; background:linear-gradient(145deg,rgb(14 24 34 / 12%),rgb(14 24 34 / 74%)); }
.login-brand,.login-visual__copy { position:relative; z-index:1; }
.login-brand,.login-mobile-brand { display:flex; gap:12px; align-items:center; font-size:17px; font-weight:700; }
.login-brand img,.login-mobile-brand img { width:34px; height:34px; }
.login-visual__copy { max-width:580px; }
.login-kicker { font-size:12px; font-weight:700; color:#9ad9cc; }
.login-visual h1 { margin:12px 0 24px; font-size:clamp(34px,5vw,56px); line-height:1.15; }
.login-signals { display:flex; flex-wrap:wrap; gap:22px; color:#dbe2ea; font-size:13px; }
.login-signals span { display:flex; gap:8px; align-items:center; }
.signal-dot { width:8px; height:8px; border-radius:50%; }.signal-dot--green{background:#4fc59d}.signal-dot--blue{background:#7ca8ff}.signal-dot--amber{background:#efb35e}
.login-form-wrap { display:grid; place-items:center; padding:40px; }
.login-form-panel { width:100%; max-width:390px; min-width:0; }
.login-form-panel :deep(.el-form),.login-form-panel :deep(.el-form-item),.login-form-panel :deep(.el-form-item__content) { min-width:0; }
.login-mobile-brand { display:none; margin-bottom:42px; color:#17202a; }
.login-title { margin-bottom:30px; }.login-title h2{margin:0;font-size:28px}.login-title p{margin:8px 0 0;color:#687384}
.login-submit { width:100%; margin-top:6px; }.back-link{display:block;margin-top:24px;color:#687384;text-align:center;text-decoration:none}.back-link:hover{color:#2563eb}
@media(max-width:800px){.login-screen{display:block}.login-visual{display:none}.login-form-wrap{min-height:100vh;padding:28px 22px}.login-mobile-brand{display:flex}}
</style>

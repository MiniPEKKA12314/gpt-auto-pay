import { paymentCountryOptions, paymentCurrencyOptions } from "./payment_options.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAdminUi(options = {}) {
  const title = escapeHtml(options.title ?? "gpt-auto-pay 管理后台");
  const countryOptionsHtml = paymentCountryOptions().map((item) => (
    `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)} (${escapeHtml(item.code)})</option>`
  )).join("");
  const currencyOptionsHtml = paymentCurrencyOptions().map((item) => (
    `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)} (${escapeHtml(item.code)})</option>`
  )).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7fb;
      --side: #101828;
      --side-2: #1d2939;
      --card: #ffffff;
      --line: #d8dee9;
      --line-2: #eef1f6;
      --text: #111827;
      --muted: #64748b;
      --primary: #2563eb;
      --ok: #138a55;
      --bad: #c03221;
      --warn: #b25e09;
      --mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
    }
    button, input, textarea, select {
      font: inherit;
    }
    .login {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .login-box {
      width: min(420px, 100%);
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--card);
      padding: 24px;
      box-shadow: 0 18px 45px rgba(16, 24, 40, .08);
    }
    .login-title {
      margin: 0 0 18px;
      font-size: 22px;
      letter-spacing: 0;
    }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 236px minmax(0, 1fr);
    }
    aside {
      background: var(--side);
      color: #fff;
      padding: 16px 12px;
      min-width: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 8px 18px;
      border-bottom: 1px solid rgba(255,255,255,.12);
      margin-bottom: 12px;
    }
    .logo {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: #fff;
      color: var(--side);
      font-weight: 900;
      flex: none;
    }
    .brand b { display: block; font-size: 15px; line-height: 1.2; }
    .brand small { color: #b7c4d9; font-size: 11px; }
    .nav {
      display: grid;
      gap: 4px;
    }
    .nav button {
      height: 40px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #d8e1ef;
      text-align: left;
      padding: 0 10px;
      font-weight: 800;
      cursor: pointer;
    }
    .nav button.active,
    .nav button:hover {
      background: var(--side-2);
      color: #fff;
    }
    main {
      min-width: 0;
      display: grid;
      grid-template-rows: 58px minmax(0, 1fr);
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--card);
      border-bottom: 1px solid var(--line);
      padding: 0 18px;
      min-width: 0;
    }
    .topbar h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .top-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .content {
      min-width: 0;
      padding: 16px;
      overflow: auto;
    }
    .view {
      display: none;
      min-width: 0;
    }
    .view.active {
      display: grid;
      gap: 16px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--card);
      padding: 14px;
      min-width: 0;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 15px;
      letter-spacing: 0;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 12px;
      min-width: 0;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }
    .metric b {
      display: block;
      margin-top: 4px;
      font-size: 26px;
      line-height: 1.1;
    }
    label {
      display: block;
      margin: 10px 0 6px;
      color: #475467;
      font-size: 12px;
      font-weight: 800;
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 8px 10px;
      outline: none;
    }
    input, select { height: 36px; }
    select[multiple] {
      height: auto;
      min-height: 132px;
    }
    textarea {
      min-height: 96px;
      resize: vertical;
      font-family: var(--mono);
      line-height: 1.45;
    }
    input:focus, textarea:focus, select:focus {
      border-color: rgba(37, 99, 235, .55);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, .10);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 12px;
    }
    .full { grid-column: 1 / -1; }
    .check-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 6px 10px;
      padding: 8px;
      border: 1px solid #ccd3df;
      border-radius: 6px;
      background: #fff;
    }
    .check-list label {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 800;
    }
    .check-list input {
      width: auto;
      height: auto;
      margin: 0;
    }
    button {
      height: 34px;
      border: 1px solid #b7c1d2;
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 0 12px;
      font-weight: 800;
      cursor: pointer;
    }
    button:disabled {
      cursor: wait;
      opacity: .68;
    }
    button.primary {
      color: #fff;
      background: var(--primary);
      border-color: var(--primary);
    }
    button.danger {
      color: #fff;
      background: var(--bad);
      border-color: var(--bad);
    }
    button:disabled {
      opacity: .55;
      cursor: default;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 13px;
    }
    th, td {
      border-bottom: 1px solid var(--line-2);
      padding: 8px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }
    th {
      color: #475467;
      font-size: 12px;
      background: #fafbfe;
      font-weight: 900;
    }
    .mono {
      font-family: var(--mono);
      font-size: 12px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      border-radius: 999px;
      padding: 0 8px;
      background: #eef2ff;
      color: #3446a8;
      font-size: 12px;
      font-weight: 900;
    }
    .pill.ok { background: #eafaf2; color: var(--ok); }
    .pill.bad { background: #fff1ef; color: var(--bad); }
    .pill.warn { background: #fff7e7; color: var(--warn); }
    pre {
      margin: 8px 0 0;
      min-height: 120px;
      max-height: 420px;
      overflow: auto;
      border: 1px solid #172033;
      border-radius: 6px;
      background: #0c1220;
      color: #dbe8ff;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px/1.5 var(--mono);
      user-select: text;
      -webkit-user-select: text;
    }
    .log-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    .log-toolbar h2 { margin: 0; }
    .order-log-line {
      display: block;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
      -webkit-user-select: text;
    }
    .order-log-marker {
      display: inline-block;
      width: 14px;
      font-weight: 900;
    }
    .order-log-line.ok .order-log-marker,
    .order-log-line.ok .order-log-text { color: #30d158; }
    .order-log-line.error .order-log-marker,
    .order-log-line.error .order-log-text { color: #ff5a52; }
    .order-log-line.warn .order-log-marker,
    .order-log-line.warn .order-log-text { color: #f7b955; }
    .order-log-line.info .order-log-marker { color: #7f8ea3; }
    .toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      display: grid;
      gap: 8px;
      width: min(360px, calc(100vw - 32px));
      z-index: 10;
    }
    .toast div {
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #fff;
      padding: 10px 12px;
      box-shadow: 0 12px 30px rgba(16, 24, 40, .14);
      font-weight: 800;
    }
    .toast .bad { border-color: rgba(192, 50, 33, .35); color: var(--bad); }
    .toast .ok { border-color: rgba(19, 138, 85, .35); color: var(--ok); }
    .toast .warn { border-color: rgba(178, 94, 9, .35); color: var(--warn); }
    .secret-dialog {
      width: min(520px, calc(100vw - 32px));
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0;
      color: var(--text);
      background: var(--card);
      box-shadow: 0 26px 70px rgba(16, 24, 40, .22);
    }
    .secret-dialog::backdrop { background: rgba(15, 23, 42, .45); }
    .secret-dialog header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 14px;
      border-bottom: 1px solid var(--line);
    }
    .secret-dialog h2 { margin: 0; }
    .secret-dialog .body {
      display: grid;
      gap: 10px;
      padding: 14px;
    }
    .secret-row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .secret-row span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
    }
    .secret-value {
      border: 1px solid var(--line-2);
      border-radius: 6px;
      background: #f8fafc;
      padding: 9px 10px;
      word-break: break-all;
      font-family: var(--mono);
    }
    [hidden] { display: none !important; }
    @media (max-width: 980px) {
      .app { grid-template-columns: 1fr; }
      aside { position: static; }
      .nav { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .nav button { text-align: center; }
      .grid-2, .grid-3 { grid-template-columns: 1fr; }
      .form-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div id="loginView" class="login">
    <form id="loginForm" class="login-box">
      <h1 class="login-title">管理员登录</h1>
      <label for="loginUsername">账号</label>
      <input id="loginUsername" value="admin" autocomplete="username">
      <label for="loginPassword">密码</label>
      <input id="loginPassword" type="password" autocomplete="current-password">
      <div class="row" style="margin-top:16px">
        <button id="loginBtn" class="primary" type="submit">登录</button>
        <a href="/" style="color:#475467;font-weight:800;text-decoration:none">返回前台</a>
      </div>
      <pre id="loginOutput" style="min-height:70px"></pre>
    </form>
  </div>

  <div id="appView" class="app" hidden>
    <aside>
      <div class="brand">
        <div class="logo">GP</div>
        <div><b>gpt-auto-pay</b><small>Control Console</small></div>
      </div>
      <div class="nav">
        <button data-tab="overview" class="active">概览</button>
        <button data-tab="manual">手充</button>
        <button data-tab="orders">订单</button>
        <button data-tab="redeem">兑换码</button>
        <button data-tab="plans">套餐</button>
        <button data-tab="cards">卡池</button>
        <button data-tab="billing">账单</button>
        <button data-tab="proxies">代理</button>
        <button data-tab="system">系统</button>
      </div>
    </aside>
    <main>
      <div class="topbar">
        <h1 id="pageTitle">概览</h1>
        <div class="top-actions">
          <span id="autoRefreshState" class="pill ok">实时刷新</span>
          <span id="adminName" class="pill">admin</span>
          <button id="refreshBtn">刷新</button>
          <button id="logoutBtn">退出</button>
        </div>
      </div>
      <div class="content">
        <div id="overview" class="view active">
          <div class="grid-3">
            <div class="metric"><span>排队订单</span><b id="metricQueued">0</b></div>
            <div class="metric"><span>运行订单</span><b id="metricRunning">0</b></div>
            <div class="metric"><span>未使用兑换码</span><b id="metricUnused">0</b></div>
          </div>
          <div class="grid-3" style="margin-top:12px">
            <div class="metric"><span>历史成功订单</span><b id="metricHistorySuccess">0</b></div>
            <div class="metric"><span>今日成功订单</span><b id="metricTodaySuccess">0</b></div>
            <div class="metric"><span>今日失败订单</span><b id="metricTodayFailed">0</b></div>
          </div>
          <section>
            <h2>队列控制</h2>
            <div class="row">
              <span id="queueState" class="pill">unknown</span>
              <span id="queueWorkerState" class="pill">自动处理器未知</span>
              <input id="queueConcurrency" type="number" min="1" max="1000" style="width:120px">
              <button id="saveQueueBtn">保存并发</button>
              <button id="pauseQueueBtn">暂停</button>
              <button id="resumeQueueBtn" class="primary">恢复</button>
              <button id="processOnceBtn">处理一次</button>
            </div>
            <pre id="queueOutput"></pre>
          </section>
          <section>
            <h2>实时日志</h2>
            <pre id="liveRunLogsOutput"></pre>
          </section>
          <section>
            <h2>当前排队任务</h2>
            <table><thead><tr><th>订单号</th><th>兑换码</th><th>套餐</th><th>排队时间</th><th>等待时长</th><th>状态</th></tr></thead><tbody id="queuedOrdersBody"></tbody></table>
          </section>
          <section>
            <h2>最近订单</h2>
            <table><thead><tr><th>订单号</th><th>兑换码</th><th>套餐</th><th>状态</th><th>创建时间</th><th>错误</th><th>操作</th></tr></thead><tbody id="recentOrdersBody"></tbody></table>
          </section>
          <section>
            <div class="log-toolbar"><h2>最近订单详情</h2><button data-copy-order-log="recentOrderDetailOutput">复制详情</button></div>
            <pre id="recentOrderDetailOutput"></pre>
          </section>
        </div>

        <div id="manual" class="view">
          <section>
            <h2>管理员手充</h2>
            <form id="manualOrderForm" class="form-grid">
              <div><label>订阅套餐</label><select id="manualPlan" name="plan_type"></select></div>
              <div><label>账号标识</label><input id="manualAccountLabel" name="account_label" placeholder="可填邮箱或备注"></div>
              <div><label>卡组</label><select id="manualCardGroup" name="card_group_id"></select></div>
              <div><label>卡</label><select id="manualCard" name="card_id"></select></div>
              <div><label>账单组</label><select id="manualBillingGroup" name="billing_group_id"></select></div>
              <div><label>账单地址</label><select id="manualBillingAddress" name="billing_address_id"></select></div>
              <div><label>提链代理组</label><select id="manualCheckoutProxy" name="checkout_proxy_group_id"></select></div>
              <div><label>直卡代理组</label><select id="manualDirectProxy" name="direct_card_proxy_group_id"></select></div>
              <div class="full"><label>Access Token / AT</label><textarea id="manualAccessToken" name="access_token" required></textarea></div>
              <div class="full"><label>Session Token</label><textarea id="manualSessionToken" name="session_token" required></textarea></div>
              <div><label>Session Cookie 名称</label><input id="manualSessionCookieName" name="session_cookie_name" value="__Secure-next-auth.session-token"></div>
              <div><label>已生成 checkout input</label><input id="manualCheckoutInput" name="checkout_input" placeholder="可选，留空则自动提链"></div>
              <div class="full"><label>备注</label><input id="manualNote" name="note"></div>
              <div class="full row"><button class="primary" type="submit">创建手充订单</button></div>
            </form>
            <pre id="manualOutput"></pre>
          </section>
        </div>

        <div id="orders" class="view">
          <section>
            <h2>订单管理</h2>
            <div class="row">
              <select id="orderStatusFilter">
                <option value="">全部状态</option>
                <option value="queued">排队中</option>
                <option value="running">运行中</option>
                <option value="succeeded">成功</option>
                <option value="failed">失败</option>
                <option value="interrupted_review">待核对</option>
              </select>
              <input id="orderQuery" placeholder="搜索订单号/兑换码" style="width:220px">
              <button id="loadOrdersBtn">查询</button>
            </div>
            <table><thead><tr><th>订单号</th><th>兑换码</th><th>套餐</th><th>状态</th><th>创建时间</th><th>公开提示</th><th>操作</th></tr></thead><tbody id="ordersBody"></tbody></table>
          </section>
          <section>
            <div class="log-toolbar"><h2>订单详情</h2><button data-copy-order-log="orderDetailOutput">复制详情</button></div>
            <pre id="orderDetailOutput"></pre>
          </section>
        </div>

        <div id="redeem" class="view">
          <div class="grid-2">
            <section>
              <h2>批量生成</h2>
              <form id="batchForm" class="form-grid">
                <div><label>批次名称</label><input name="name" required></div>
                <div><label>套餐</label><select name="plan_type"><option value="go">Go</option><option value="plus">Plus</option><option value="pro5x">Pro 5x</option><option value="pro20x">Pro 20x</option></select></div>
                <div><label>数量</label><input name="quantity" type="number" min="1" max="1000" value="10"></div>
                <div><label>备注</label><input name="note"></div>
                <div class="full row"><button class="primary" type="submit">生成</button></div>
              </form>
              <label>本次生成</label>
              <textarea id="generatedCodes" readonly></textarea>
            </section>
            <section>
              <h2>导出</h2>
              <div class="form-grid">
                <div><label>格式</label><select id="exportFormat"><option value="txt">TXT</option><option value="csv">CSV</option><option value="json">JSON</option></select></div>
                <div><label>已选数量</label><input id="selectedCodeCount" readonly value="0"></div>
                <div class="full"><label>导出列表</label><textarea id="selectedCodesExport" readonly placeholder="勾选兑换码后会出现在这里"></textarea></div>
                <div class="full row"><button id="exportCodesBtn" type="button">下载导出</button></div>
              </div>
              <h2 style="margin-top:16px">批次</h2>
              <table><thead><tr><th>ID</th><th>名称</th><th>套餐</th><th>统计</th></tr></thead><tbody id="batchesBody"></tbody></table>
            </section>
          </div>
          <section>
            <h2>兑换码列表</h2>
            <div class="row">
              <input id="codeQuery" placeholder="搜索卡密" style="width:240px">
              <select id="codeStatusFilter"><option value="">全部状态</option><option value="unused">未使用</option><option value="locked">锁定</option><option value="used">已使用</option><option value="disabled">已禁用</option><option value="unavailable">不可用</option></select>
              <select id="codePageSize"><option value="20">20/页</option><option value="50">50/页</option><option value="100">100/页</option></select>
              <button id="loadCodesBtn">查询</button>
              <button id="selectPageCodesBtn" type="button">全选本页</button>
              <button id="clearSelectedCodesBtn" type="button">清空已选</button>
            </div>
            <table><thead><tr><th style="width:54px">选择</th><th>ID</th><th>卡密</th><th>套餐</th><th>状态</th><th>操作</th></tr></thead><tbody id="codesBody"></tbody></table>
            <div class="row" style="margin-top:8px">
              <button id="prevCodesPageBtn" type="button">上一页</button>
              <span id="codesPageInfo" class="pill">1/1</span>
              <button id="nextCodesPageBtn" type="button">下一页</button>
            </div>
          </section>
        </div>

        <div id="plans" class="view">
          <section>
            <h2>套餐配置</h2>
            <form id="planForm" class="form-grid">
              <div><label>套餐</label><select id="planSelect" name="plan_type"></select></div>
              <div><label>显示名称</label><input id="planDisplayName" name="display_name"></div>
              <div><label>付款国家</label><input id="planCountry" name="payment_country" list="paymentCountryOptions" placeholder="PH"></div>
              <div><label>付款币种</label><input id="planCurrency" name="payment_currency" list="paymentCurrencyOptions" placeholder="PHP"></div>
              <div><label>提链代理组</label><select id="planCheckoutProxy" name="checkout_proxy_group_id"></select></div>
              <div><label>直卡代理组</label><select id="planDirectProxy" name="direct_card_proxy_group_id"></select></div>
              <div><label>账单组</label><select id="planBillingGroup" name="billing_group_id"></select></div>
              <div><label>提链代理尝试</label><input id="planCheckoutMaxProxy" name="checkout_max_proxy_attempts" type="number" min="1" max="1000"></div>
              <div><label>直卡每张卡代理尝试</label><input id="planMaxProxy" name="max_proxy_attempts_per_card" type="number" min="1" max="1000"></div>
              <div><label>允许换卡</label><select id="planAllowSwitch" name="allow_card_switch"><option value="0">关闭</option><option value="1">开启</option></select></div>
              <div><label>最多换卡数</label><input id="planMaxSwitches" name="max_card_switches" type="number" min="0" max="1000"></div>
              <div class="full"><label>失败提示</label><input id="planFailureMessage" name="failure_message"></div>
              <div class="full"><label>使用卡组</label><div id="planCardGroupsList" class="check-list"></div></div>
              <div class="full row"><label style="margin:0"><input id="planEnabled" type="checkbox" style="width:auto;height:auto" checked> 启用套餐</label><button class="primary" type="submit">保存套餐</button><button id="checkReadinessBtn" type="button">检查运行条件</button></div>
            </form>
            <pre id="planOutput"></pre>
          </section>
        </div>

        <div id="cards" class="view">
          <div class="grid-2">
            <section>
              <h2>卡组</h2>
              <form id="cardGroupForm" class="form-grid">
                <div><label>名称</label><input name="name" required></div>
                <div><label>备注</label><input name="note"></div>
                <div class="full row"><button class="primary" type="submit">新增卡组</button></div>
              </form>
              <table><thead><tr><th>ID</th><th>名称</th><th>统计</th><th>操作</th></tr></thead><tbody id="cardGroupsBody"></tbody></table>
            </section>
            <section>
              <h2>新增卡</h2>
              <form id="cardForm" class="form-grid">
                <div><label>卡组</label><select name="card_group_id" id="cardGroupSelect"></select></div>
                <div><label>状态</label><select name="status"><option value="enabled">启用</option><option value="standby">备用</option><option value="disabled">禁用</option></select></div>
                <div class="full"><label>卡号</label><input name="number" required></div>
                <div><label>月</label><input name="exp_month" required></div>
                <div><label>年</label><input name="exp_year" required></div>
                <div><label>CVC</label><input name="cvc" required></div>
                <div><label>优先级</label><input name="priority" type="number" value="100"></div>
                <div><label>成功上限</label><input name="max_success_count" type="number" value="1"></div>
                <div><label>远端来源</label><select name="provider"><option value="">本地/手动卡</option><option value="vcc">VCC 卡台</option></select></div>
                <div><label>远端卡 ID</label><input name="provider_card_id" placeholder="VCC cardId，可留空用卡号操作"></div>
                <div class="full"><label>远端卡自动策略</label><div class="check-list"><label><input name="auto_unfreeze_before_use" type="checkbox" value="1"> 使用前自动解冻</label><label><input name="auto_freeze_after_success" type="checkbox" value="1"> 成功后自动冻结</label><label><input name="auto_freeze_after_failure" type="checkbox" value="1"> 失败后自动冻结</label></div></div>
                <div class="full"><label>备注</label><input name="note"></div>
                <div class="full row"><button class="primary" type="submit">新增卡</button></div>
              </form>
            </section>
          </div>
          <section>
            <h2>VCC 卡台</h2>
            <form id="vccConfigForm" class="form-grid">
              <div><label>接口地址</label><input id="vccBaseUrl" name="base_url" placeholder="http://api.vcc.center"></div>
              <div><label>User Serial</label><input id="vccUserSerial" name="user_serial"></div>
              <div><label>Secret Key</label><input id="vccSecretKey" name="secret_key" type="password" placeholder="留空则不修改"></div>
              <div><label>超时 ms</label><input id="vccTimeoutMs" name="timeout_ms" type="number" min="1000" max="120000" value="15000"></div>
              <div class="full row">
                <button class="primary" type="submit">保存 VCC 配置</button>
                <button id="vccTestBtn" type="button">测试账号</button>
              </div>
            </form>
            <div class="grid-2" style="margin-top:12px">
              <form id="vccRemoteForm" class="form-grid">
                <div><label>页码</label><input name="pageNumber" type="number" min="1" value="1"></div>
                <div><label>每页数量</label><input name="pageSize" type="number" min="1" max="1000" value="100"></div>
                <div><label>远端卡 ID</label><input name="userBankId"></div>
                <div><label>远端卡号</label><input name="userBankNum"></div>
                <div><label>查询全部</label><select name="all"><option value="1">全部卡</option><option value="0">仅激活</option></select></div>
                <div><label>导入卡组</label><select id="vccImportCardGroup" name="card_group_id"></select></div>
                <div><label>导入成功上限</label><input id="vccImportMaxSuccess" type="number" min="1" max="1000" value="1"></div>
                <div class="full"><label>导入后远端卡自动策略</label><div class="check-list"><label><input id="vccImportAutoUnfreeze" type="checkbox" value="1" checked> 使用前自动解冻</label><label><input id="vccImportAutoFreezeSuccess" type="checkbox" value="1" checked> 成功后自动冻结</label><label><input id="vccImportAutoFreezeFailure" type="checkbox" value="1" checked> 失败后自动冻结</label></div></div>
                <div class="full row">
                  <button id="vccBinsBtn" type="button">拉取 BIN</button>
                  <button id="vccRemoteCardsBtn" type="button">查看远端卡</button>
                  <button id="vccImportBtn" type="button">导入远端卡</button>
                </div>
              </form>
              <form id="vccOpenForm" class="form-grid">
                <div><label>开卡 BIN</label><input name="cardBin"></div>
                <div><label>开卡金额</label><input name="amount"></div>
                <div><label>邮箱</label><input name="email"></div>
                <div><label>备注</label><input name="remark"></div>
                <div><label>开卡订单 ID</label><input name="orderId"></div>
                <div class="full row">
                  <button id="vccOpenCardBtn" type="button">开卡</button>
                  <button id="vccOpenDetailBtn" type="button">查开卡详情</button>
                </div>
              </form>
              <form id="vccRechargeForm" class="form-grid">
                <div><label>卡 ID</label><input name="bankCardId"></div>
                <div><label>卡号</label><input name="bankCardNum"></div>
                <div><label>充值金额</label><input name="amount"></div>
                <div><label>充值单 ID</label><input name="rechargeId"></div>
                <div class="full row">
                  <button id="vccRechargeBtn" type="button">充值</button>
                  <button id="vccRechargeDetailBtn" type="button">查充值详情</button>
                </div>
              </form>
              <form id="vccCardActionForm" class="form-grid">
                <div><label>卡 ID</label><input name="cardId"></div>
                <div><label>卡号</label><input name="cardNum"></div>
                <div class="full row">
                  <button id="vccSuspendBtn" type="button">冻结</button>
                  <button id="vccEnableBtn" type="button">解冻</button>
                  <button id="vccCancelBtn" type="button" class="danger">销卡</button>
                </div>
              </form>
              <form id="vccCashOutForm" class="form-grid">
                <div><label>卡 ID</label><input name="bankCardId"></div>
                <div><label>卡号</label><input name="bankCardNum"></div>
                <div><label>转出金额</label><input name="amount"></div>
                <div><label>转出单 ID</label><input name="id"></div>
                <div class="full row">
                  <button id="vccCashOutBtn" type="button">资金转出</button>
                  <button id="vccCashOutDetailBtn" type="button">查转出详情</button>
                </div>
              </form>
              <form id="vccConsumeOrderForm" class="form-grid">
                <div><label>卡号</label><input name="number"></div>
                <div><label>页码</label><input name="page" type="number" min="1" value="1"></div>
                <div><label>每页数量</label><input name="pageSize" type="number" min="1" max="1000" value="100"></div>
                <div class="full row"><button id="vccConsumeOrdersBtn" type="button">查询交易流水</button></div>
              </form>
            </div>
            <pre id="vccOutput"></pre>
          </section>
          <section>
            <h2>卡列表</h2>
            <table><thead><tr><th>ID</th><th>卡号</th><th>卡组</th><th>来源</th><th>自动策略</th><th>状态</th><th>成功</th><th>操作</th></tr></thead><tbody id="cardsBody"></tbody></table>
            <pre id="cardSecretOutput" hidden></pre>
          </section>
        </div>

        <div id="billing" class="view">
          <div class="grid-2">
            <section>
              <h2>账单组</h2>
              <form id="billingGroupForm" class="form-grid">
                <div><label>名称</label><input name="name" required></div>
                <div><label>备注</label><input name="note"></div>
                <div class="full row"><button class="primary" type="submit">新增账单组</button></div>
              </form>
              <table><thead><tr><th>ID</th><th>名称</th><th>备注</th><th>操作</th></tr></thead><tbody id="billingGroupsBody"></tbody></table>
            </section>
            <section>
              <h2>新增账单地址</h2>
              <form id="billingAddressForm" class="form-grid">
                <div><label>账单组</label><select name="billing_group_id" id="billingGroupSelect"></select></div>
                <div><label>姓名</label><input name="name" required></div>
                <div><label>国家</label><input name="country" required></div>
                <div><label>州/省</label><input name="state"></div>
                <div><label>城市</label><input name="city" required></div>
                <div><label>邮编</label><input name="postal_code" required></div>
                <div class="full"><label>地址</label><input name="line1" required></div>
                <div><label>优先级</label><input name="priority" type="number" value="100"></div>
                <div><label>状态</label><select name="status"><option value="enabled">启用</option><option value="disabled">禁用</option></select></div>
                <div class="full"><label>备注</label><input name="note"></div>
                <div class="full row"><button class="primary" type="submit">新增地址</button></div>
              </form>
            </section>
          </div>
          <section>
            <h2>地址列表</h2>
            <table><thead><tr><th>ID</th><th>姓名</th><th>账单组</th><th>地区</th><th>地址</th><th>状态</th><th>操作</th></tr></thead><tbody id="billingAddressesBody"></tbody></table>
          </section>
        </div>

        <div id="proxies" class="view">
          <div class="grid-2">
            <section>
              <h2>新增代理组</h2>
              <form id="proxyGroupForm" class="form-grid">
                <div><label>名称</label><input name="name" required></div>
                <div><label>用途</label><select name="kind"><option value="checkout">提链</option><option value="direct_card">直卡</option><option value="shared">共用</option></select></div>
                <div><label>远端来源</label><select name="provider"><option value="">本地/手动卡</option><option value="vcc">VCC 卡台</option></select></div>
                <div><label>启用</label><select name="enabled"><option value="1">启用</option><option value="0">关闭</option></select></div>
                <div class="full proxy-static-field"><label>代理列表</label><textarea name="proxies" placeholder="https://user:pass@example.com:8443&#10;socks5://user:pass@example.com:1080"></textarea></div>
                <div class="proxy-ipwo-field"><label>IPWO 协议</label><select name="ipwo_protocol"><option value="socks5">SOCKS5</option><option value="http">HTTP/HTTPS</option></select></div>
                <div class="proxy-ipwo-field"><label>主机</label><input name="ipwo_host" placeholder="us.ipwo.net"></div>
                <div class="proxy-ipwo-field"><label>端口</label><input name="ipwo_port" type="number" min="1" max="65535" value="7878"></div>
                <div class="proxy-ipwo-field"><label>用户名</label><input name="ipwo_username" placeholder="light121"></div>
                <div class="proxy-ipwo-field"><label>密码</label><input name="ipwo_password" type="password" placeholder="light121"></div>
                <div class="proxy-ipwo-field"><label>国家/地区代码</label><input name="ipwo_country" list="paymentCountryOptions" placeholder="PH / Random"></div>
                <div class="proxy-ipwo-field"><label>州/省</label><input name="ipwo_state" placeholder="California / Random"></div>
                <div class="proxy-ipwo-field"><label>城市</label><input name="ipwo_city" placeholder="LosAngeles / Random"></div>
                <div class="proxy-ipwo-field"><label>会话模式</label><select name="ipwo_session_mode"><option value="sticky">粘性 IP</option><option value="rotate">轮换 IP</option></select></div>
                <div class="proxy-ipwo-field"><label>有效期（分钟）</label><input name="ipwo_sticky_minutes" type="number" min="1" max="43200" value="120"></div>
                <div class="full"><label>备注</label><input name="note"></div>
                <div class="full row"><button class="primary" type="submit">新增代理组</button></div>
              </form>
            </section>
            <section>
              <h2>代理组列表</h2>
              <table><thead><tr><th>ID</th><th>名称</th><th>用途</th><th>来源</th><th>启用</th><th>操作</th></tr></thead><tbody id="proxyGroupsBody"></tbody></table>
              <pre id="proxyOutput"></pre>
            </section>
            <section>
              <h2>编辑代理组详细配置</h2>
              <form id="proxyEditForm" class="form-grid">
                <input id="proxyEditId" name="id" type="hidden">
                <div><label>名称</label><input id="proxyEditName" name="name" required></div>
                <div><label>用途</label><select id="proxyEditKind" name="kind"><option value="checkout">提链</option><option value="direct_card">直卡</option><option value="shared">共用</option></select></div>
                <div><label>远端来源</label><select name="provider"><option value="">本地/手动卡</option><option value="vcc">VCC 卡台</option></select></div>
                <div><label>启用</label><select id="proxyEditEnabled" name="enabled"><option value="1">启用</option><option value="0">关闭</option></select></div>
                <div class="full proxy-edit-static-field"><label>代理列表</label><textarea id="proxyEditProxies" name="proxies" placeholder="https://user:pass@example.com:8443&#10;socks5://user:pass@example.com:1080"></textarea></div>
                <div class="proxy-edit-ipwo-field"><label>IPWO 协议</label><select id="proxyEditIpwoProtocol" name="ipwo_protocol"><option value="socks5">SOCKS5</option><option value="http">HTTP/HTTPS</option></select></div>
                <div class="proxy-edit-ipwo-field"><label>主机</label><input id="proxyEditIpwoHost" name="ipwo_host" placeholder="us.ipwo.net"></div>
                <div class="proxy-edit-ipwo-field"><label>端口</label><input id="proxyEditIpwoPort" name="ipwo_port" type="number" min="1" max="65535" value="7878"></div>
                <div class="proxy-edit-ipwo-field"><label>用户名</label><input id="proxyEditIpwoUsername" name="ipwo_username" placeholder="light121"></div>
                <div class="proxy-edit-ipwo-field"><label>密码</label><input id="proxyEditIpwoPassword" name="ipwo_password" type="password"></div>
                <div class="proxy-edit-ipwo-field"><label>国家/地区代码</label><input id="proxyEditIpwoCountry" name="ipwo_country" list="paymentCountryOptions" placeholder="PH / Random"></div>
                <div class="proxy-edit-ipwo-field"><label>州/省</label><input id="proxyEditIpwoState" name="ipwo_state" placeholder="California / Random"></div>
                <div class="proxy-edit-ipwo-field"><label>城市</label><input id="proxyEditIpwoCity" name="ipwo_city" placeholder="LosAngeles / Random"></div>
                <div class="proxy-edit-ipwo-field"><label>会话模式</label><select id="proxyEditIpwoSessionMode" name="ipwo_session_mode"><option value="sticky">粘性 IP</option><option value="rotate">轮换 IP</option></select></div>
                <div class="proxy-edit-ipwo-field"><label>有效期（分钟）</label><input id="proxyEditIpwoStickyMinutes" name="ipwo_sticky_minutes" type="number" min="1" max="43200" value="120"></div>
                <div class="full proxy-edit-api-field"><label>API 配置 JSON</label><textarea id="proxyEditApiConfig" name="api_config" placeholder='{"api_url":"https://example.com/proxies"}'></textarea></div>
                <div class="full"><label>备注</label><input id="proxyEditNote" name="note"></div>
                <div class="full row"><button class="primary" type="submit">保存代理组</button><button id="proxyEditClearBtn" type="button">清空编辑</button></div>
              </form>
            </section>
          </div>
        </div>

        <div id="system" class="view">
          <div class="grid-2">
            <section>
              <h2>修改密码</h2>
              <form id="passwordForm" class="form-grid">
                <div class="full"><label>当前密码</label><input name="current_password" type="password" autocomplete="current-password"></div>
                <div class="full"><label>新密码</label><input name="new_password" type="password" autocomplete="new-password"></div>
                <div class="full row"><button class="primary" type="submit">保存密码</button></div>
              </form>
            </section>
            <section>
              <h2>审计日志</h2>
              <button id="loadAuditBtn">刷新审计</button>
              <table><thead><tr><th>ID</th><th>动作</th><th>对象</th><th>时间</th></tr></thead><tbody id="auditBody"></tbody></table>
            </section>
          </div>
        </div>
      </div>
    </main>
  </div>
  <dialog id="cardSecretDialog" class="secret-dialog">
    <header>
      <h2>卡片详情</h2>
      <form method="dialog"><button type="submit">关闭</button></form>
    </header>
    <div class="body">
      <div class="secret-row"><span>卡号</span><div id="cardSecretNumber" class="secret-value"></div></div>
      <div class="secret-row"><span>有效期</span><div id="cardSecretExpiry" class="secret-value"></div></div>
      <div class="secret-row"><span>CVC</span><div id="cardSecretCvc" class="secret-value"></div></div>
      <div class="secret-row"><span>来源</span><div id="cardSecretProvider" class="secret-value"></div></div>
      <div class="secret-row"><span>自动策略</span><div id="cardSecretPolicy" class="secret-value"></div></div>
      <div class="secret-row"><span>编辑来源</span><div class="secret-value form-grid" style="grid-template-columns: 1fr 1fr; margin: 0"><select id="cardPolicyProvider"><option value="">本地/手动卡</option><option value="vcc">VCC 卡台</option></select><input id="cardPolicyProviderCardId" placeholder="远端卡 ID，可留空用卡号操作"></div></div>
      <div class="secret-row"><span>编辑策略</span><div class="secret-value check-list"><label><input id="cardPolicyUnfreeze" type="checkbox" style="width:auto;height:auto"> 使用前自动解冻</label><label><input id="cardPolicyFreezeSuccess" type="checkbox" style="width:auto;height:auto"> 成功后自动冻结</label><label><input id="cardPolicyFreezeFailure" type="checkbox" style="width:auto;height:auto"> 失败后自动冻结</label></div></div>
      <div class="row"><button id="cardPolicySaveBtn" type="button">保存远端策略</button></div>
    </div>
  </dialog>
  <div id="toast" class="toast"></div>
  <datalist id="paymentCountryOptions">${countryOptionsHtml}</datalist>
  <datalist id="paymentCurrencyOptions">${currencyOptionsHtml}</datalist>

  <script>
    const $ = (id) => document.getElementById(id);
    const AUTO_REFRESH_MS = 2000;
    const state = {
      tab: "overview",
      admin: null,
      dashboard: null,
      queue: null,
      orders: [],
      batches: [],
      codes: [],
      codesPage: { rows: [], total: 0, page: 1, page_size: 20, total_pages: 1 },
      codePage: 1,
      codePageSize: 20,
      selectedCodesById: new Map(),
      plans: [],
      cardGroups: [],
      cards: [],
      vccConfig: null,
      billingGroups: [],
      billingAddresses: [],
      proxyGroups: [],
      audits: [],
      autoRefreshTimer: null,
      autoRefreshBusy: false,
      openOrderDetailId: 0,
      planFormDirty: false,
      selectedPlanType: "",
      orderDetailPlainText: ""
    };

    function h(value) {
      return String(value == null ? "" : value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function showToast(message, tone) {
      const box = document.createElement("div");
      box.className = tone || "ok";
      box.textContent = message;
      $("toast").appendChild(box);
      window.setTimeout(function() { box.remove(); }, 3500);
    }

    async function api(path, options) {
      const response = await fetch(path, Object.assign({
        credentials: "same-origin",
        headers: { "content-type": "application/json" }
      }, options || {}));
      const contentType = response.headers.get("content-type") || "";
      const body = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        if (response.status === 401) showLogin();
        const error = new Error((body && body.message) || response.statusText);
        error.data = body;
        throw error;
      }
      return body;
    }

    function formData(form) {
      const data = Object.fromEntries(new FormData(form).entries());
      form.querySelectorAll('input[type="checkbox"][name]').forEach(function(input) {
        if (!Object.hasOwn(data, input.name)) data[input.name] = "";
      });
      return data;
    }

    function numeric(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    function yesNo(value) {
      return value ? "是" : "否";
    }

    function timeText(seconds) {
      const n = Number(seconds || 0);
      if (!n) return "";
      return new Date(n * 1000).toLocaleString();
    }

    function durationText(fromSeconds) {
      const from = Number(fromSeconds || 0);
      if (!from) return "";
      const seconds = Math.floor(Math.max(0, Date.now() / 1000 - from));
      if (seconds < 60) return seconds + " 秒";
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return minutes + " 分 " + (seconds % 60) + " 秒";
      const hours = Math.floor(minutes / 60);
      return hours + " 小时 " + (minutes % 60) + " 分";
    }

    function queueStatusLabel(status) {
      if (status === "running") return "自动开启";
      if (status === "paused") return "已暂停";
      return status || "未知";
    }

    function workerStatusLabel(worker) {
      if (!worker || worker.enabled !== true) return "自动处理器未启动";
      if (worker.busy) return "自动处理中";
      if (worker.started) return "自动待命";
      return "自动处理器已停止";
    }

    function queueSummaryText(queue) {
      const worker = queue.worker || {};
      const parts = [
        "队列开关：" + queueStatusLabel(queue.status),
        "自动处理器：" + workerStatusLabel(worker),
        "并发：" + (queue.concurrency || 1),
        "排队：" + (queue.queued || 0),
        "运行：" + (queue.running || 0)
      ];
      if (worker.last_event) {
        parts.push("最近处理：" + JSON.stringify(worker.last_event));
      }
      return parts.join("\\n");
    }

    function statusPill(status) {
      const bad = ["failed", "cancelled", "disabled", "deleted"];
      const ok = ["succeeded", "used", "enabled"];
      const cls = ok.includes(status) ? "ok" : bad.includes(status) ? "bad" : "warn";
      return '<span class="pill ' + cls + '">' + h(status) + '</span>';
    }

    function logTime(seconds) {
      const n = Number(seconds || 0);
      if (!n) return "--:--:--";
      return new Date(n * 1000).toLocaleTimeString();
    }

    function safeJson(value) {
      if (!value) return {};
      if (typeof value === "object") return value;
      try { return JSON.parse(String(value)); } catch { return {}; }
    }

    function compactOrderLogMeta(value, stage) {
      const json = safeJson(value);
      if (!json || Object.keys(json).length === 0) return "";
      const rawStage = String(stage || "");
      const lowerStage = rawStage.toLowerCase();
      const isProxyStage = lowerStage.includes("proxy") || /\u4ee3\u7406/.test(rawStage);
      if (isProxyStage) {
        const parts = [];
        if (json.redactedProxyUrl) parts.push("\u4ee3\u7406=" + json.redactedProxyUrl);
        if (json.provider) parts.push("\u6765\u6e90=" + json.provider);
        if (json.kind) parts.push("\u7528\u9014=" + (json.kind === "checkout" ? "\u63d0\u94fe" : (json.kind === "direct_card" ? "\u76f4\u5361" : json.kind)));
        if (json.ipwo && json.ipwo.session) parts.push("session=" + json.ipwo.session);
        if (json.reason) parts.push("\u539f\u56e0=" + json.reason);
        if (json.error) parts.push("\u9519\u8bef=" + json.error);
      return parts.length ? parts.join(" / ") : "未开启";
      }
      const summary = {};
      ["code", "status", "ok", "action", "category", "message", "error", "reason"].forEach(function(key) {
        if (json[key] !== undefined && json[key] !== "" && json[key] !== null) summary[key] = json[key];
      });
      if (json.retry && json.retry.policy) {
        summary.retry = {
          attempt_no: json.retry.attempt_no,
          checkout_proxy_attempt_index: json.retry.checkout_proxy_attempt_index,
          proxy_attempt_index: json.retry.proxy_attempt_index,
          card_attempt_index: json.retry.card_attempt_index
        };
      }
      return Object.keys(summary).length ? " " + JSON.stringify(summary) : "";
    }

    function normalizeOrderLogLevel(explicitLevel, stage, message) {
      const level = String(explicitLevel || "").toLowerCase();
      if (["error", "failed", "failure", "fatal", "bad"].includes(level)) return "error";
      if (["success", "succeeded", "ok", "complete", "completed"].includes(level)) return "ok";
      if (["warn", "warning"].includes(level)) return "warn";
      const rawStage = String(stage || "");
      const stageText = rawStage.toLowerCase();
      const messageText = String(message || "");
      const isProxyStage = stageText.includes("proxy") || /\u4ee3\u7406/.test(rawStage);
      const actualErrorPattern = /(failed|fail|failure|fatal|error|err|exception|timeout|timed out|econnreset|authentication failed|connect failed|invalid|declined|not approved|payment was not approved|payment not approved|do not honor|insufficient funds|incorrect cvc|expired card|ok=false|success=false|status=[45][0-9][0-9]|\u72b6\u6001[=:]?\s*[45][0-9][0-9]|\u9519\u8bef|\u5f02\u5e38|\u5931\u8d25|\u62d2\u7edd|\u88ab\u62d2|\u4e0d\u53ef\u7528|\u6ca1\u6709\u53ef\u7528|\u672a\u80fd|\u65e0\u6cd5|\u5931\u6548|\u8fc7\u671f)/i;
      if (isProxyStage && !actualErrorPattern.test(messageText)) return "info";
      const text = rawStage + " " + messageText;
      if (actualErrorPattern.test(text) || /no usable sandbox|chrome exited before devtools|invalid http response from proxy tunnel|proxy connect failed|socks5 authentication failed|err_ssl_packet_length_too_long/i.test(text)) {
        return "error";
      }
      if (/success|succeeded|successful|ok|filled|completed|complete|approved|active|subscribed|status=2[0-9][0-9]|\u72b6\u6001[=:]?\s*2[0-9][0-9]|\u6210\u529f|\u5b8c\u6210|\u5df2\u5199\u5165|\u5df2\u5b9a\u4f4d|\u5df2\u70b9\u51fb|\u5df2\u8ba2\u9605|\u8ba2\u9605\u6210\u529f|\u8ba2\u9605\u5df2\u751f\u6548|\u4ed8\u6b3e\u6210\u529f|\u652f\u4ed8\u6210\u529f|\u5df2\u6fc0\u6d3b/i.test(text)) {
        return "ok";
      }
      if (/warn|warning|retry|pending|queued|running|processing|authentication_required|requires_action|3ds|3d secure|otp|captcha|verification|challenge|waiting|\u91cd\u8bd5|\u6362\u4ee3\u7406|\u5207\u6362|\u6392\u961f|\u8fd0\u884c|\u7b49\u5f85|\u5904\u7406\u4e2d|\u9a8c\u8bc1|\u4eba\u673a|\u8bca\u65ad|\u9700\u8981\u989d\u5916\u9a8c\u8bc1/i.test(text)) {
        return "warn";
      }
      return "info";
    }

    function appendLogLine(lines, seconds, stage, message, level) {
      const entry = {
        time: logTime(seconds),
        stage: stage || "\u4e8b\u4ef6",
        message: String(message || "")
      };
      entry.level = normalizeOrderLogLevel(level, entry.stage, entry.message);
      lines.push(entry);
    }

    function renderOrderLogLine(line) {
      const text = "[" + line.time + "] [" + line.stage + "] " + line.message;
      const level = ["ok", "error", "warn", "info"].includes(line.level) ? line.level : "info";
      return '<span class="order-log-line ' + level + '"><span class="order-log-marker">&#9679;</span> <span class="order-log-text">' + h(text) + '</span></span>';
    }

    function orderLogLineText(line) {
      return "\u25cf [" + line.time + "] [" + line.stage + "] " + line.message;
    }

    function formatOrderProcessLog(data) {
      const order = data.order || {};
      const attempts = Array.isArray(data.attempts) ? data.attempts : [];
      const logs = Array.isArray(data.logs) ? data.logs : [];
      const runtime = data.runtime || {};
      const lines = [];
      appendLogLine(lines, order.created_at, "\u8ba2\u5355", "\u8ba2\u5355\u53f7: " + (order.order_no || "") + "; \u5957\u9910: " + (order.plan_type || "") + "; \u72b6\u6001: " + (order.status || ""), order.status);
      if (order.public_message) appendLogLine(lines, order.updated_at || order.created_at, "\u516c\u5f00\u63d0\u793a", order.public_message);
      if (order.admin_error) appendLogLine(lines, order.updated_at || order.finished_at || order.created_at, "\u9519\u8bef", order.admin_error, "error");
      if (runtime) {
        const runtimeBits = [];
        if (runtime.has_access_token) runtimeBits.push("Access Token \u5df2\u4fdd\u5b58");
        if (runtime.has_session_token) runtimeBits.push("Session Token \u5df2\u4fdd\u5b58");
        if (runtime.checkout_input) runtimeBits.push("checkout_input=" + runtime.checkout_input);
        if (runtimeBits.length) appendLogLine(lines, runtime.updated_at || order.updated_at || order.created_at, "\u8fd0\u884c\u8d44\u6599", runtimeBits.join("; "));
      }
      attempts.forEach(function(attempt) {
        const title = "\u5c1d\u8bd5 #" + (attempt.attempt_no || attempt.id);
        appendLogLine(lines, attempt.started_at || attempt.created_at, title, "\u72b6\u6001: " + (attempt.status || "") + "; \u9636\u6bb5: " + (attempt.stage || ""), attempt.status);
        if (attempt.checkout_proxy || attempt.direct_card_proxy) {
          appendLogLine(lines, attempt.started_at || attempt.created_at, "\u4ee3\u7406", "\u63d0\u94fe\u4ee3\u7406: " + (attempt.checkout_proxy || "\u65e0") + "; \u76f4\u5361\u4ee3\u7406: " + (attempt.direct_card_proxy || "\u65e0"), "info");
        }
        if (attempt.error_code || attempt.error_message) {
          appendLogLine(lines, attempt.finished_at || attempt.started_at, "\u9519\u8bef", (attempt.error_code ? attempt.error_code + ": " : "") + (attempt.error_message || ""), "error");
        }
      });
      if (logs.length) {
        logs.forEach(function(log) {
          const stage = log.stage || log.level || "\u65e5\u5fd7";
          appendLogLine(lines, log.created_at, stage, (log.message || "") + compactOrderLogMeta(log.meta_json, stage), log.level);
        });
      } else {
        appendLogLine(lines, order.updated_at || order.created_at, "\u65e5\u5fd7", "\u6682\u65e0\u8fd0\u884c\u65e5\u5fd7");
      }
      if (order.status === "succeeded") appendLogLine(lines, order.finished_at || order.updated_at, "\u7ed3\u679c", "\u8ba2\u9605\u6210\u529f\uff0c\u8ba2\u5355\u5df2\u5b8c\u6210", "success");
      if (order.status === "failed") appendLogLine(lines, order.finished_at || order.updated_at, "\u7ed3\u679c", "\u8ba2\u5355\u5931\u8d25" + (order.admin_error ? ": " + order.admin_error : ""), "error");
      return {
        html: lines.map(renderOrderLogLine).join("\\n"),
        text: lines.map(orderLogLineText).join("\\n")
      };
    }

    function formatDashboardRunLogs(logs) {
      const rows = Array.isArray(logs) ? logs : [];
      if (!rows.length) return "";
      const lines = [];
      rows.forEach(function(log) {
        const orderNo = log.order_no ? "[" + log.order_no + "] " : "";
        const stage = log.stage || log.level || "\u65e5\u5fd7";
        appendLogLine(
          lines,
          log.created_at,
          stage,
          orderNo + (log.message || "") + compactOrderLogMeta(log.meta_json, stage),
          log.level,
        );
      });
      return lines.map(renderOrderLogLine).join("\\n");
    }

    function queryString(params) {
      const search = new URLSearchParams();
      Object.entries(params || {}).forEach(function(entry) {
        const key = entry[0];
        const value = entry[1];
        if (value === undefined || value === null || value === "") return;
        search.set(key, String(value));
      });
      const text = search.toString();
      return text ? "?" + text : "";
    }

    function rememberSelectedCode(code) {
      const id = Number(code && code.id);
      if (!id) return;
      state.selectedCodesById.set(id, {
        id,
        code_display: code.code_display || "",
        plan_type: code.plan_type || "",
        status: code.status || ""
      });
    }

    function selectedCodeRows() {
      return Array.from(state.selectedCodesById.values()).sort(function(a, b) {
        return Number(a.id) - Number(b.id);
      });
    }

    function syncSelectedCodesExport() {
      const rows = selectedCodeRows();
      if ($("selectedCodeCount")) $("selectedCodeCount").value = String(rows.length);
      if ($("selectedCodesExport")) {
        $("selectedCodesExport").value = rows.map(function(code) { return code.code_display; }).join("\\n");
      }
    }

    function replaceSelectedCodes(rows) {
      state.selectedCodesById.clear();
      (rows || []).forEach(rememberSelectedCode);
      syncSelectedCodesExport();
    }

    function errorText(error) {
      return (error && error.data && (error.data.message || error.data.error))
        || (error && error.message)
        || String(error || "操作失败");
    }

    async function runWithFeedback(button, busyText, task, doneText) {
      const oldText = button ? button.textContent : "";
      if (button) {
        button.disabled = true;
        button.textContent = busyText || "处理中...";
      }
      showToast(busyText || "处理中...", "warn");
      try {
        const result = await task();
        if (doneText) showToast(doneText, "ok");
        return result;
      } catch (error) {
        showToast(errorText(error), "bad");
        return null;
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = oldText;
        }
      }
    }

    function submitWithFeedback(event, busyText, handler) {
      event.preventDefault();
      return runWithFeedback(event.submitter, busyText, function() { return handler(event); });
    }

    function clickWithFeedback(buttonId, busyText, handler, doneText) {
      $(buttonId).addEventListener("click", function(event) {
        runWithFeedback(event.currentTarget, busyText, handler, doneText);
      });
    }

    async function refreshAfterMutation(successText, refreshTask) {
      try {
        await refreshTask();
        showToast(successText, "ok");
      } catch (error) {
        console.warn(successText + "，但刷新失败", error);
        showToast(successText + "，但页面刷新失败，请点右上角刷新", "warn");
      }
    }

    function lookupName(rows, id) {
      const found = (rows || []).find(function(row) { return Number(row.id) === Number(id); });
      return found ? found.name : "#" + id;
    }

    function setAutoRefreshState(text, tone) {
      if (!$("autoRefreshState")) return;
      $("autoRefreshState").textContent = text;
      $("autoRefreshState").className = "pill " + (tone || "ok");
    }

    function isEditingField() {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    }

    function stopAutoRefresh() {
      if (state.autoRefreshTimer) window.clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
      state.autoRefreshBusy = false;
    }

    function startAutoRefresh() {
      if (state.autoRefreshTimer) return;
      setAutoRefreshState("实时刷新开启", "ok");
      state.autoRefreshTimer = window.setInterval(function() {
        refreshRealtimeData();
      }, AUTO_REFRESH_MS);
    }

    function showLogin() {
      stopAutoRefresh();
      $("appView").hidden = true;
      $("loginView").hidden = false;
    }

    function showApp() {
      $("loginView").hidden = true;
      $("appView").hidden = false;
    }

    async function checkMe() {
      try {
        const result = await api("/api/admin/me");
        state.admin = result.data;
        $("adminName").textContent = result.data.username || "admin";
        showApp();
      } catch {
        showLogin();
        return;
      }
      try {
        await refreshAll();
        startAutoRefresh();
      } catch (error) {
        showToast("登录成功，但后台数据刷新失败：" + errorText(error), "bad");
        startAutoRefresh();
      }
    }

    async function login(event) {
      event.preventDefault();
      $("loginBtn").disabled = true;
      try {
        const result = await api("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({
            username: $("loginUsername").value,
            password: $("loginPassword").value
          })
        });
        $("loginOutput").textContent = JSON.stringify(result, null, 2);
        await checkMe();
        showToast("登录成功", "ok");
      } catch (error) {
        $("loginOutput").textContent = JSON.stringify(error.data || error.message, null, 2);
      } finally {
        $("loginBtn").disabled = false;
      }
    }

    async function logout() {
      stopAutoRefresh();
      try { await api("/api/admin/logout", { method: "POST", body: "{}" }); } catch {}
      state.admin = null;
      showLogin();
    }

    function setTab(tab) {
      state.tab = tab;
      document.querySelectorAll("[data-tab]").forEach(function(button) {
        button.classList.toggle("active", button.dataset.tab === tab);
      });
      document.querySelectorAll(".view").forEach(function(view) {
        view.classList.toggle("active", view.id === tab);
      });
      const titles = { overview: "概览", manual: "手充", orders: "订单", redeem: "兑换码", plans: "套餐", cards: "卡池", billing: "账单", proxies: "代理", system: "系统" };
      $("pageTitle").textContent = titles[tab] || tab;
      if (state.admin) refreshRealtimeData({ force: true });
    }

    async function safeLoad(label, fn, options = {}) {
      try {
        return await fn();
      } catch (error) {
        if (!options.quiet) showToast(label + "加载失败：" + ((error.data && error.data.message) || error.message), "bad");
        return null;
      }
    }

    async function refreshAll() {
      await Promise.all([
        safeLoad("概览", loadDashboard),
        safeLoad("队列", loadQueue),
        safeLoad("订单", loadOrders),
        safeLoad("批次", loadBatches),
        safeLoad("兑换码", loadCodes),
        safeLoad("套餐", loadPlans),
        safeLoad("卡组", loadCardGroups),
        safeLoad("卡", loadCards),
        safeLoad("VCC", loadVccConfig),
        safeLoad("账单组", loadBillingGroups),
        safeLoad("账单地址", loadBillingAddresses),
        safeLoad("代理组", loadProxyGroups)
      ]);
      populateSelects();
      renderAll();
    }

    async function refreshRealtimeData(options = {}) {
      if (!state.admin || state.autoRefreshBusy) return;
      if (document.hidden && options.force !== true) return;
      state.autoRefreshBusy = true;
      const focused = isEditingField();
      const tab = state.tab;
      try {
        const jobs = [
          safeLoad("概览", loadDashboard, { quiet: true }),
          safeLoad("队列", loadQueue, { quiet: true })
        ];
        if (tab === "orders") {
          jobs.push(safeLoad("订单", loadOrders, { quiet: true }));
        } else if (tab === "redeem") {
          jobs.push(safeLoad("批次", loadBatches, { quiet: true }));
          jobs.push(safeLoad("兑换码", loadCodes, { quiet: true }));
        } else if (tab === "manual") {
          jobs.push(safeLoad("套餐", loadPlans, { quiet: true }));
          jobs.push(safeLoad("卡组", loadCardGroups, { quiet: true }));
          jobs.push(safeLoad("卡", loadCards, { quiet: true }));
          jobs.push(safeLoad("账单组", loadBillingGroups, { quiet: true }));
          jobs.push(safeLoad("账单地址", loadBillingAddresses, { quiet: true }));
          jobs.push(safeLoad("代理组", loadProxyGroups, { quiet: true }));
        } else if (tab === "plans") {
          jobs.push(safeLoad("套餐", loadPlans, { quiet: true }));
          jobs.push(safeLoad("卡组", loadCardGroups, { quiet: true }));
          jobs.push(safeLoad("账单组", loadBillingGroups, { quiet: true }));
          jobs.push(safeLoad("代理组", loadProxyGroups, { quiet: true }));
        } else if (tab === "cards") {
          jobs.push(safeLoad("卡组", loadCardGroups, { quiet: true }));
          jobs.push(safeLoad("卡", loadCards, { quiet: true }));
          jobs.push(safeLoad("VCC", loadVccConfig, { quiet: true }));
        } else if (tab === "billing") {
          jobs.push(safeLoad("账单组", loadBillingGroups, { quiet: true }));
          jobs.push(safeLoad("账单地址", loadBillingAddresses, { quiet: true }));
        } else if (tab === "proxies") {
          jobs.push(safeLoad("代理组", loadProxyGroups, { quiet: true }));
        } else if (tab === "system") {
          jobs.push(safeLoad("审计日志", loadAudits, { quiet: true }));
        }
        await Promise.all(jobs);

        renderOverview();
        if (tab === "overview" && state.openOrderDetailId && !selectionInsideOrderDetail()) await showOrderDetails(state.openOrderDetailId, { quiet: true });
        if (tab === "orders") {
          renderOrders();
          if (state.openOrderDetailId && !selectionInsideOrderDetail()) await showOrderDetails(state.openOrderDetailId, { quiet: true });
        } else if (tab === "redeem") {
          renderRedeem();
        } else if (tab === "manual") {
          if (!focused) populateSelects();
        } else if (tab === "plans") {
          if (!focused && !state.planFormDirty) {
            populateSelects();
            renderPlans();
          }
        } else if (tab === "cards") {
          renderCards();
          if (!focused) {
            renderVccConfig();
            populateSelects();
          }
        } else if (tab === "billing") {
          renderBilling();
          if (!focused) populateSelects();
        } else if (tab === "proxies") {
          renderProxies();
          if (!focused) populateSelects();
        } else if (tab === "system") {
          renderAudits();
        }
        setAutoRefreshState("实时刷新 " + new Date().toLocaleTimeString(), "ok");
      } catch (error) {
        setAutoRefreshState("实时刷新异常", "bad");
        if (options.force) showToast("实时刷新失败：" + errorText(error), "bad");
      } finally {
        state.autoRefreshBusy = false;
      }
    }

    async function loadDashboard() {
      state.dashboard = (await api("/api/admin/dashboard")).data;
    }

    async function loadQueue() {
      state.queue = (await api("/api/admin/queue")).data;
    }

    async function loadOrders() {
      const status = $("orderStatusFilter") ? $("orderStatusFilter").value : "";
      const q = $("orderQuery") ? $("orderQuery").value.trim() : "";
      state.orders = (await api("/api/admin/orders" + queryString({ status, q }))).data;
    }

    async function loadBatches() {
      state.batches = (await api("/api/admin/redeem/batches")).data;
    }

    async function loadCodes(options = {}) {
      const status = $("codeStatusFilter") ? $("codeStatusFilter").value : "";
      const q = $("codeQuery") ? $("codeQuery").value.trim() : "";
      if (options.resetPage) state.codePage = 1;
      if (options.page) state.codePage = Math.max(1, Number(options.page));
      state.codePageSize = $("codePageSize") ? numeric($("codePageSize").value, 20) : state.codePageSize;
      const pageData = (await api("/api/admin/redeem/codes" + queryString({
        paginated: 1,
        status,
        q,
        page: state.codePage,
        page_size: state.codePageSize
      }))).data;
      state.codesPage = pageData;
      state.codes = Array.isArray(pageData.rows) ? pageData.rows : [];
      state.codePage = Number(pageData.page || state.codePage || 1);
      state.codePageSize = Number(pageData.page_size || state.codePageSize || 20);
      state.codes.forEach(function(code) {
        if (state.selectedCodesById.has(Number(code.id))) rememberSelectedCode(code);
      });
      syncSelectedCodesExport();
    }

    async function loadPlans() {
      state.plans = (await api("/api/admin/plans")).data;
    }

    async function loadCardGroups() {
      state.cardGroups = (await api("/api/admin/card-groups")).data;
    }

    async function loadCards() {
      state.cards = (await api("/api/admin/cards")).data;
    }

    async function loadVccConfig() {
      state.vccConfig = (await api("/api/admin/card-providers/vcc/config")).data;
    }

    async function loadBillingGroups() {
      state.billingGroups = (await api("/api/admin/billing-groups")).data;
    }

    async function loadBillingAddresses() {
      state.billingAddresses = (await api("/api/admin/billing-addresses")).data;
    }

    async function loadProxyGroups() {
      state.proxyGroups = (await api("/api/admin/proxy-groups")).data;
    }

    async function loadAudits() {
      state.audits = (await api("/api/admin/audit-logs")).data;
      renderAudits();
    }

    function optionHtml(rows, valueField, labelFn, selected, emptyLabel) {
      let html = emptyLabel ? '<option value="0">' + h(emptyLabel) + '</option>' : "";
      html += rows.map(function(row) {
        const value = String(row[valueField]);
        return '<option value="' + h(value) + '"' + (String(selected || "") === value ? " selected" : "") + '>' + h(labelFn(row)) + '</option>';
      }).join("");
      return html;
    }

    function setSelectHtml(id, html) {
      const el = $(id);
      const oldValue = el.value;
      el.innerHTML = html;
      if (oldValue && Array.from(el.options).some(function(option) { return option.value === oldValue; })) {
        el.value = oldValue;
      }
    }

    function populateSelects() {
      const currentPlanType = state.selectedPlanType || ($("planSelect") && $("planSelect").value) || "";
      const planOptions = state.plans.map(function(plan) {
        return '<option value="' + h(plan.plan_type) + '">' + h(plan.display_name) + '</option>';
      }).join("");
      if (!state.planFormDirty) {
        $("planSelect").innerHTML = planOptions;
        if (currentPlanType && state.plans.some(function(plan) { return plan.plan_type === currentPlanType; })) {
          $("planSelect").value = currentPlanType;
          state.selectedPlanType = currentPlanType;
        } else if ($("planSelect").value) {
          state.selectedPlanType = $("planSelect").value;
        }
      }
      setSelectHtml("manualPlan", planOptions);
      $("cardGroupSelect").innerHTML = optionHtml(state.cardGroups, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "请选择卡组");
      $("vccImportCardGroup").innerHTML = optionHtml(state.cardGroups, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "请选择卡组");
      if (!state.planFormDirty) {
        $("planCardGroupsList").innerHTML = state.cardGroups.map(function(row) {
          return "<label><input type='checkbox' data-plan-card-group='" + h(row.id) + "'> #" + h(row.id) + " " + h(row.name) + "</label>";
        }).join("");
      }
      setSelectHtml("manualCardGroup", optionHtml(state.cardGroups, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "请选择卡组"));
      $("billingGroupSelect").innerHTML = optionHtml(state.billingGroups, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "请选择账单组");
      setSelectHtml("manualBillingGroup", optionHtml(state.billingGroups, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "请选择账单组"));
      const checkoutProxies = state.proxyGroups.filter(function(row) { return row.kind === "checkout" || row.kind === "shared"; });
      const directProxies = state.proxyGroups.filter(function(row) { return row.kind === "direct_card" || row.kind === "shared"; });
      if (!state.planFormDirty) {
        $("planCheckoutProxy").innerHTML = optionHtml(checkoutProxies, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "不使用");
        $("planDirectProxy").innerHTML = optionHtml(directProxies, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "不使用");
        $("planBillingGroup").innerHTML = optionHtml(state.billingGroups, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "不使用");
      }
      setSelectHtml("manualCheckoutProxy", optionHtml(checkoutProxies, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "不使用"));
      setSelectHtml("manualDirectProxy", optionHtml(directProxies, "id", function(row) { return "#" + row.id + " " + row.name; }, "", "不使用"));
      syncPlanForm();
      renderManual();
    }

    function renderAll() {
      renderOverview();
      renderManual();
      renderOrders();
      renderRedeem();
      renderPlans();
      renderCards();
      renderVccConfig();
      renderBilling();
      renderProxies();
    }

    function renderManual() {
      const cardGroupId = Number($("manualCardGroup").value || 0);
      const cards = state.cards.filter(function(card) {
        return !cardGroupId || Number(card.card_group_id) === cardGroupId;
      });
      setSelectHtml("manualCard", optionHtml(cards, "id", function(card) {
        return "#" + card.id + " " + card.masked_number + " · " + lookupName(state.cardGroups, card.card_group_id) + " · " + card.success_count + "/" + card.max_success_count;
      }, "", "请选择卡"));

      const billingGroupId = Number($("manualBillingGroup").value || 0);
      const addresses = state.billingAddresses.filter(function(address) {
        return !billingGroupId || Number(address.billing_group_id) === billingGroupId;
      });
      setSelectHtml("manualBillingAddress", optionHtml(addresses, "id", function(address) {
        return "#" + address.id + " " + address.name + " · " + lookupName(state.billingGroups, address.billing_group_id) + " · " + address.country + " " + (address.state || "") + " " + address.city;
      }, "", "请选择账单地址"));
    }

    function renderOverview() {
      const dashboard = state.dashboard || {};
      const queue = dashboard.queue || state.queue || {};
      $("metricQueued").textContent = queue.queued || 0;
      $("metricRunning").textContent = queue.running || 0;
      $("metricUnused").textContent = (dashboard.redeem_codes && dashboard.redeem_codes.unused) || 0;
      const stats = dashboard.order_stats || {};
      $("metricHistorySuccess").textContent = stats.history_success || 0;
      $("metricTodaySuccess").textContent = stats.today_success || 0;
      $("metricTodayFailed").textContent = stats.today_failed || 0;
      $("queueState").textContent = queueStatusLabel(queue.status);
      $("queueState").className = "pill " + (queue.status === "running" ? "ok" : "warn");
      $("queueWorkerState").textContent = workerStatusLabel(queue.worker);
      $("queueWorkerState").className = "pill " + (queue.worker && queue.worker.enabled && queue.worker.started ? "ok" : "warn");
      if (document.activeElement !== $("queueConcurrency")) $("queueConcurrency").value = queue.concurrency || 1;
      $("queueOutput").textContent = queueSummaryText(queue);
      if ($("liveRunLogsOutput")) $("liveRunLogsOutput").innerHTML = formatDashboardRunLogs(dashboard.recent_logs || []);
      const queuedOrders = Array.isArray(dashboard.queued_orders)
        ? dashboard.queued_orders
        : state.orders.filter(function(order) { return order.status === "queued"; }).slice(0, 20);
      $("queuedOrdersBody").innerHTML = queuedOrders.length ? queuedOrders.map(function(order) {
        return "<tr><td class='mono'>" + h(order.order_no) + "</td><td class='mono'>" + h(order.redeem_code || "") + "</td><td>" + h(order.plan_type) + "</td><td>" + h(timeText(order.queued_at || order.created_at)) + "</td><td>" + h(durationText(order.queued_at || order.created_at)) + "</td><td>" + statusPill(order.status) + "</td></tr>";
      }).join("") : "<tr><td colspan='6'>暂无排队任务</td></tr>";
      const recentOrders = Array.isArray(dashboard.recent_orders) ? dashboard.recent_orders : state.orders.slice(0, 8);
      $("recentOrdersBody").innerHTML = recentOrders.map(function(order) {
        return "<tr><td class='mono'>" + h(order.order_no) + "</td><td class='mono'>" + h(order.redeem_code || "") + "</td><td>" + h(order.plan_type) + "</td><td>" + statusPill(order.status) + "</td><td>" + h(timeText(order.created_at)) + "</td><td>" + h(order.admin_error || "") + "</td><td class='row'><button data-order-detail='" + order.id + "'>详情</button><button class='danger' data-order-delete='" + order.id + "' data-order-no='" + h(order.order_no) + "'>删除</button></td></tr>";
      }).join("");
    }

    function renderOrders() {
      $("ordersBody").innerHTML = state.orders.map(function(order) {
        return "<tr><td class='mono'>" + h(order.order_no) + "</td><td class='mono'>" + h(order.redeem_code || "") + "</td><td>" + h(order.plan_type) + "</td><td>" + statusPill(order.status) + "</td><td>" + h(timeText(order.created_at)) + "</td><td>" + h(order.public_message || "") + "</td><td class='row'><button data-order-detail='" + order.id + "'>详情</button><button data-order-requeue='" + order.id + "'>重排</button><button class='danger' data-order-terminate='" + order.id + "'>结束</button><button class='danger' data-order-delete='" + order.id + "' data-order-no='" + h(order.order_no) + "'>删除</button></td></tr>";
      }).join("");
    }

    function renderRedeem() {
      $("batchesBody").innerHTML = state.batches.map(function(batch) {
        const stats = batch.stats || {};
        return "<tr><td>" + batch.id + "</td><td>" + h(batch.name) + "</td><td>" + h(batch.plan_type) + "</td><td class='mono'>unused:" + (stats.unused || 0) + " used:" + (stats.used || 0) + " locked:" + (stats.locked || 0) + "</td></tr>";
      }).join("");
      $("codesBody").innerHTML = state.codes.map(function(code) {
        const id = Number(code.id);
        const checked = state.selectedCodesById.has(id) ? " checked" : "";
        return "<tr><td><input type='checkbox' data-code-select='" + id + "' style='width:auto;height:auto'" + checked + "></td><td>" + id + "</td><td class='mono'>" + h(code.code_display) + "</td><td>" + h(code.plan_type) + "</td><td>" + statusPill(code.status) + "</td><td class='row'><button data-code-disable='" + id + "'>禁用</button><button data-code-restore-status='" + id + "'>恢复状态</button><button class='danger' data-code-delete='" + id + "'>删除</button></td></tr>";
      }).join("");
      const page = state.codesPage || {};
      const pageNo = Number(page.page || state.codePage || 1);
      const totalPages = Math.max(1, Number(page.total_pages || 1));
      $("codesPageInfo").textContent = pageNo + "/" + totalPages + " · " + Number(page.total || 0) + " 条";
      $("prevCodesPageBtn").disabled = pageNo <= 1;
      $("nextCodesPageBtn").disabled = pageNo >= totalPages;
      syncSelectedCodesExport();
    }

    function selectedPlan() {
      const planType = state.selectedPlanType || $("planSelect").value || (state.plans[0] && state.plans[0].plan_type);
      return state.plans.find(function(plan) { return plan.plan_type === planType; }) || state.plans[0] || null;
    }

    function syncPlanForm(options = {}) {
      if (state.planFormDirty && options.force !== true) return;
      const plan = selectedPlan();
      if (!plan) return;
      state.selectedPlanType = plan.plan_type;
      $("planSelect").value = plan.plan_type;
      $("planDisplayName").value = plan.display_name || "";
      $("planCountry").value = plan.payment_country || "";
      $("planCurrency").value = plan.payment_currency || "";
      $("planCheckoutProxy").value = String(plan.checkout_proxy_group_id || 0);
      $("planDirectProxy").value = String(plan.direct_card_proxy_group_id || 0);
      $("planBillingGroup").value = String(plan.billing_group_id || 0);
      $("planCheckoutMaxProxy").value = plan.checkout_max_proxy_attempts || 4;
      $("planMaxProxy").value = plan.max_proxy_attempts_per_card || 4;
      $("planAllowSwitch").value = plan.allow_card_switch ? "1" : "0";
      $("planMaxSwitches").value = plan.max_card_switches || 0;
      $("planFailureMessage").value = plan.failure_message || "";
      $("planEnabled").checked = Boolean(plan.enabled);
      const selectedCardGroupIds = new Set((plan.card_groups || []).map(function(group) { return String(group.card_group_id); }));
      document.querySelectorAll("[data-plan-card-group]").forEach(function(input) {
        input.checked = selectedCardGroupIds.has(String(input.dataset.planCardGroup));
      });
    }

    function renderPlans() {
      syncPlanForm();
    }

    function cardPolicyLabel(card) {
      const parts = [];
      if (card.auto_unfreeze_before_use) parts.push("用前解冻");
      if (card.auto_freeze_after_success) parts.push("成功冻结");
      if (card.auto_freeze_after_failure) parts.push("失败冻结");
      return parts.length ? parts.join(" / ") : "未开启";
    }

    function cardProviderLabel(card) {
      if (!card.provider) return "本地";
      return String(card.provider).toUpperCase() + (card.provider_card_id ? " #" + card.provider_card_id : "");
    }

    function renderCards() {
      $("cardGroupsBody").innerHTML = state.cardGroups.map(function(group) {
        const stats = group.stats || {};
        return "<tr><td>" + group.id + "</td><td>" + h(group.name) + "</td><td class='mono'>enabled:" + (stats.enabled || 0) + " standby:" + (stats.standby || 0) + " disabled:" + (stats.disabled || 0) + "</td><td class='row'><button class='danger' data-card-group-delete='" + group.id + "'>删除</button></td></tr>";
      }).join("");
      $("cardsBody").innerHTML = state.cards.map(function(card) {
        const statusAction = card.status === "disabled"
          ? "<button data-card-restore='" + card.id + "'>恢复</button>"
          : "<button data-card-disable='" + card.id + "'>禁用</button>";
        return "<tr><td>" + card.id + "</td><td class='mono'>" + h(card.masked_number) + "</td><td>" + h(lookupName(state.cardGroups, card.card_group_id)) + "</td><td class='mono'>" + h(cardProviderLabel(card)) + "</td><td>" + h(cardPolicyLabel(card)) + "</td><td>" + statusPill(card.status) + "</td><td>" + h(card.success_count) + "/" + h(card.max_success_count) + "</td><td class='row'><button data-card-secret='" + card.id + "'>查看</button>" + statusAction + "<button class='danger' data-card-delete='" + card.id + "'>删除</button></td></tr>";
      }).join("");
    }

    function renderVccConfig() {
      const config = state.vccConfig || {};
      $("vccBaseUrl").value = config.base_url || "http://api.vcc.center";
      $("vccUserSerial").value = config.user_serial || "";
      $("vccSecretKey").value = "";
      $("vccSecretKey").placeholder = config.secret_configured ? "已保存，留空则不修改" : "尚未保存";
      $("vccTimeoutMs").value = config.timeout_ms || 15000;
    }

    function renderBilling() {
      $("billingGroupsBody").innerHTML = state.billingGroups.map(function(group) {
        return "<tr><td>" + group.id + "</td><td>" + h(group.name) + "</td><td>" + h(group.note || "") + "</td><td class='row'><button class='danger' data-billing-group-delete='" + group.id + "'>删除</button></td></tr>";
      }).join("");
      $("billingAddressesBody").innerHTML = state.billingAddresses.map(function(row) {
        const statusAction = row.status === "disabled"
          ? "<button data-billing-restore='" + row.id + "'>恢复</button>"
          : "<button data-billing-disable='" + row.id + "'>禁用</button>";
        return "<tr><td>" + row.id + "</td><td>" + h(row.name) + "</td><td>" + h(lookupName(state.billingGroups, row.billing_group_id)) + "</td><td>" + h(row.country + " " + (row.state || "") + " " + row.city) + "</td><td>" + h(row.line1 + " " + row.postal_code) + "</td><td>" + statusPill(row.status) + "</td><td class='row'>" + statusAction + "<button class='danger' data-billing-delete='" + row.id + "'>删除</button></td></tr>";
      }).join("");
    }

    function renderProxies() {
      $("proxyGroupsBody").innerHTML = state.proxyGroups.map(function(group) {
        return "<tr><td>" + group.id + "</td><td>" + h(group.name) + "</td><td>" + h(group.kind) + "</td><td>" + h(group.provider) + "</td><td>" + h(yesNo(group.enabled)) + "</td><td class='row'><button data-proxy-group-edit='" + group.id + "'>编辑</button><button data-proxy-group-test='" + group.id + "'>测试</button><button class='danger' data-proxy-group-delete='" + group.id + "'>删除</button></td></tr>";
      }).join("");
    }

    function confirmGroupDelete(kind) {
      const messages = {
        card: "确认删除这个卡组？\\n该卡组下所有卡会一并删除。",
        billing: "确认删除这个账单组？\\n该账单组下所有账单地址会一并删除。",
        proxy: "确认删除这个代理组？\\n该代理组会从提链/直卡可选列表移除，组内代理配置会一并删除。"
      };
      return window.confirm(messages[kind] || "确认删除这个分组？");
    }

    function confirmOrderDelete(orderNo) {
      return window.confirm("确认删除订单 " + (orderNo || "") + "？\\n删除后会从最近订单和订单列表隐藏，但审计与运行日志仍会保留。");
    }

    function syncProxyProviderFields() {
      const provider = $("proxyProviderSelect").value;
      document.querySelectorAll(".proxy-static-field").forEach(function(node) {
        node.hidden = provider !== "static";
      });
      document.querySelectorAll(".proxy-ipwo-field").forEach(function(node) {
        node.hidden = provider !== "ipwo";
      });
    }

    function syncProxyEditProviderFields() {
      const provider = $("proxyEditProvider").value;
      document.querySelectorAll(".proxy-edit-static-field").forEach(function(node) {
        node.hidden = provider !== "static";
      });
      document.querySelectorAll(".proxy-edit-ipwo-field").forEach(function(node) {
        node.hidden = provider !== "ipwo";
      });
      document.querySelectorAll(".proxy-edit-api-field").forEach(function(node) {
        node.hidden = provider !== "api";
      });
    }

    function selectionInsideOrderDetail() {
      const selection = window.getSelection && window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      const orderBox = $("orderDetailOutput");
      const recentBox = $("recentOrderDetailOutput");
      return Boolean(
        (orderBox && (orderBox.contains(anchor) || orderBox.contains(focus))) ||
        (recentBox && (recentBox.contains(anchor) || recentBox.contains(focus)))
      );
    }

    function setOrderDetailText(detail) {
      const html = typeof detail === "object" && detail ? detail.html : String(detail || "");
      const text = typeof detail === "object" && detail ? detail.text : String(detail || "");
      state.orderDetailPlainText = text || "";
      if ($("orderDetailOutput")) $("orderDetailOutput").innerHTML = html || "";
      if ($("recentOrderDetailOutput")) $("recentOrderDetailOutput").innerHTML = html || "";
    }

    function renderAudits() {
      $("auditBody").innerHTML = state.audits.slice(-80).reverse().map(function(row) {
        return "<tr><td>" + row.id + "</td><td>" + h(row.action) + "</td><td>" + h(row.target_type + " " + (row.target_id || "")) + "</td><td>" + h(timeText(row.created_at)) + "</td></tr>";
      }).join("");
    }

    async function saveQueue() {
      const result = await api("/api/admin/queue/settings", {
        method: "PATCH",
        body: JSON.stringify({ global_concurrency: numeric($("queueConcurrency").value, 1) })
      });
      $("queueOutput").textContent = JSON.stringify(result, null, 2);
      await refreshAll();
    }

    async function queueAction(path) {
      const result = await api(path, { method: "POST", body: "{}" });
      $("queueOutput").textContent = JSON.stringify(result, null, 2);
      await refreshAll();
    }

    async function createBatch(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formData(form);
      payload.quantity = numeric(payload.quantity, 1);
      const result = await api("/api/admin/redeem/batches", { method: "POST", body: JSON.stringify(payload) });
      $("generatedCodes").value = result.data.codes.map(function(code) { return code.code_display; }).join("\\n");
      replaceSelectedCodes(result.data.codes || []);
      showToast("兑换码已生成", "ok");
      await Promise.all([loadBatches(), loadCodes(), loadDashboard()]);
      renderAll();
    }

    async function createManualOrder(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formData(form);
      payload.card_group_id = numeric(payload.card_group_id, 0);
      payload.card_id = numeric(payload.card_id, 0);
      payload.billing_group_id = numeric(payload.billing_group_id, 0);
      payload.billing_address_id = numeric(payload.billing_address_id, 0);
      payload.checkout_proxy_group_id = numeric(payload.checkout_proxy_group_id, 0);
      payload.direct_card_proxy_group_id = numeric(payload.direct_card_proxy_group_id, 0);
      if (!payload.card_group_id) throw new Error("请选择卡组");
      if (!payload.card_id) throw new Error("请选择卡");
      if (!payload.billing_group_id) throw new Error("请选择账单组");
      if (!payload.billing_address_id) throw new Error("请选择账单地址");
      const result = await api("/api/admin/manual-orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      $("manualOutput").textContent = JSON.stringify(result.data, null, 2);
      $("manualAccessToken").value = "";
      $("manualSessionToken").value = "";
      $("manualCheckoutInput").value = "";
      await Promise.all([loadDashboard(), loadQueue(), loadOrders()]);
      renderOverview();
      renderOrders();
      showToast("手充订单已创建并进入队列", "ok");
    }

    async function exportCodes() {
      const format = $("exportFormat").value;
      const ids = selectedCodeRows().map(function(code) { return code.id; });
      if (ids.length === 0) throw new Error("请先在兑换码列表中勾选要导出的卡密");
      const response = await fetch("/api/admin/redeem/export", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: format, ids: ids })
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text);
      const blob = new Blob([text], { type: response.headers.get("content-type") || "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "redeem-codes-" + Date.now() + "." + format;
      link.click();
      URL.revokeObjectURL(link.href);
    }

    function selectedPlanCardGroups() {
      return Array.from(document.querySelectorAll("[data-plan-card-group]:checked")).map(function(input, index) {
        return { card_group_id: numeric(input.dataset.planCardGroup, 0), priority: (index + 1) * 100 };
      }).filter(function(row) { return row.card_group_id > 0; });
    }

    async function savePlan(event) {
      event.preventDefault();
      const planType = $("planSelect").value;
      state.selectedPlanType = planType;
      const payload = {
        display_name: $("planDisplayName").value,
        enabled: $("planEnabled").checked,
        payment_country: $("planCountry").value,
        payment_currency: $("planCurrency").value,
        checkout_proxy_group_id: numeric($("planCheckoutProxy").value, 0),
        direct_card_proxy_group_id: numeric($("planDirectProxy").value, 0),
        billing_group_id: numeric($("planBillingGroup").value, 0),
        checkout_max_proxy_attempts: numeric($("planCheckoutMaxProxy").value, 4),
        max_proxy_attempts_per_card: numeric($("planMaxProxy").value, 4),
        allow_card_switch: $("planAllowSwitch").value === "1",
        max_card_switches: numeric($("planMaxSwitches").value, 0),
        failure_message: $("planFailureMessage").value,
        card_groups: selectedPlanCardGroups()
      };
      const result = await api("/api/admin/plans/" + encodeURIComponent(planType), {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      $("planOutput").textContent = JSON.stringify(result, null, 2);
      await loadPlans();
      state.selectedPlanType = planType;
      state.planFormDirty = false;
      populateSelects();
      syncPlanForm({ force: true });
      showToast("套餐配置已保存", "ok");
    }

    async function checkReadiness() {
      const planType = $("planSelect").value;
      state.selectedPlanType = planType;
      const result = await api("/api/admin/plans/" + encodeURIComponent(planType) + "/runtime-readiness");
      state.selectedPlanType = planType;
      $("planSelect").value = planType;
      $("planOutput").textContent = JSON.stringify(result, null, 2);
    }

    async function createCardGroup(event) {
      event.preventDefault();
      const form = event.currentTarget;
      await api("/api/admin/card-groups", { method: "POST", body: JSON.stringify(formData(form)) });
      form.reset();
      await refreshAfterMutation("卡组已新增", async function() {
        await Promise.all([loadCardGroups(), loadDashboard()]);
        populateSelects();
        renderCards();
      });
    }

    async function createCard(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formData(form);
      payload.priority = numeric(payload.priority, 100);
      payload.max_success_count = numeric(payload.max_success_count, 1);
      payload.auto_unfreeze_before_use = Boolean(payload.auto_unfreeze_before_use);
      payload.auto_freeze_after_success = Boolean(payload.auto_freeze_after_success);
      payload.auto_freeze_after_failure = Boolean(payload.auto_freeze_after_failure);
      await api("/api/admin/cards", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await Promise.all([loadCards(), loadCardGroups(), loadDashboard()]);
      populateSelects();
      renderCards();
      showToast("卡已新增", "ok");
    }

    async function saveVccConfig(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formData(form);
      payload.timeout_ms = numeric(payload.timeout_ms, 15000);
      if (!payload.secret_key) delete payload.secret_key;
      const result = await api("/api/admin/card-providers/vcc/config", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      state.vccConfig = result.data;
      renderVccConfig();
      $("vccOutput").textContent = JSON.stringify(result, null, 2);
      showToast("VCC 配置已保存", "ok");
    }

    async function vccAction(path, payload) {
      const result = await api(path, {
        method: "POST",
        body: JSON.stringify(payload || {})
      });
      $("vccOutput").textContent = JSON.stringify(result, null, 2);
      return result;
    }

    function cleanPayload(payload) {
      const result = {};
      Object.entries(payload || {}).forEach(function(entry) {
        const key = entry[0];
        const value = entry[1];
        if (value !== undefined && value !== null && String(value).trim() !== "") result[key] = value;
      });
      return result;
    }

    function vccFormPayload(formId) {
      return cleanPayload(formData($(formId)));
    }

    function vccRemoteParams() {
      const payload = vccFormPayload("vccRemoteForm");
      payload.pageNumber = numeric(payload.pageNumber, 1);
      payload.pageSize = numeric(payload.pageSize, 100);
      payload.all = payload.all === "1";
      return payload;
    }

    async function testVccProvider() {
      await vccAction("/api/admin/card-providers/vcc/test");
      showToast("VCC 账号测试完成", "ok");
    }

    async function loadVccBins() {
      const result = await api("/api/admin/card-providers/vcc/bins");
      $("vccOutput").textContent = JSON.stringify(result, null, 2);
      showToast("VCC BIN 已拉取", "ok");
    }

    async function loadVccRemoteCards() {
      const payload = vccRemoteParams();
      const query = new URLSearchParams({
        pageNumber: String(payload.pageNumber),
        pageSize: String(payload.pageSize),
        all: payload.all ? "1" : "0",
        userBankId: payload.userBankId || "",
        userBankNum: payload.userBankNum || ""
      });
      const result = await api("/api/admin/card-providers/vcc/cards?" + query.toString());
      $("vccOutput").textContent = JSON.stringify(result, null, 2);
      showToast("VCC 远端卡已拉取", "ok");
    }

    async function importVccCards() {
      const cardGroupId = numeric($("vccImportCardGroup").value, 0);
      if (!cardGroupId) {
        showToast("请选择导入卡组", "bad");
        return;
      }
      const remote = vccRemoteParams();
      const result = await vccAction("/api/admin/card-providers/vcc/import", {
        card_group_id: cardGroupId,
        max_success_count: numeric($("vccImportMaxSuccess").value, 1),
        auto_unfreeze_before_use: $("vccImportAutoUnfreeze").checked,
        auto_freeze_after_success: $("vccImportAutoFreezeSuccess").checked,
        auto_freeze_after_failure: $("vccImportAutoFreezeFailure").checked,
        all: remote.all,
        pageNumber: remote.pageNumber,
        pageSize: remote.pageSize,
        userBankId: remote.userBankId || "",
        userBankNum: remote.userBankNum || ""
      });
      await Promise.all([loadCards(), loadCardGroups(), loadDashboard()]);
      populateSelects();
      renderCards();
      showToast("VCC 导入完成：" + result.data.imported_count + " 张", "ok");
    }

    async function openVccCard() {
      await vccAction("/api/admin/card-providers/vcc/open-card", vccFormPayload("vccOpenForm"));
      showToast("VCC 开卡请求已提交", "ok");
    }

    async function loadVccOpenDetail() {
      await vccAction("/api/admin/card-providers/vcc/open-detail", vccFormPayload("vccOpenForm"));
      showToast("VCC 开卡详情已返回", "ok");
    }

    async function rechargeVccCard() {
      await vccAction("/api/admin/card-providers/vcc/recharge", vccFormPayload("vccRechargeForm"));
      showToast("VCC 充值请求已提交", "ok");
    }

    async function loadVccRechargeDetail() {
      await vccAction("/api/admin/card-providers/vcc/recharge-detail", vccFormPayload("vccRechargeForm"));
      showToast("VCC 充值详情已返回", "ok");
    }

    async function vccCardStateAction(path, label) {
      await vccAction(path, vccFormPayload("vccCardActionForm"));
      showToast(label + "完成", "ok");
    }

    async function cashOutVccCard() {
      await vccAction("/api/admin/card-providers/vcc/cash-out", vccFormPayload("vccCashOutForm"));
      showToast("VCC 资金转出请求已提交", "ok");
    }

    async function loadVccCashOutDetail() {
      await vccAction("/api/admin/card-providers/vcc/cash-out-detail", vccFormPayload("vccCashOutForm"));
      showToast("VCC 转出详情已返回", "ok");
    }

    async function loadVccConsumeOrders() {
      const payload = vccFormPayload("vccConsumeOrderForm");
      payload.page = numeric(payload.page, 1);
      payload.pageSize = numeric(payload.pageSize, 100);
      await vccAction("/api/admin/card-providers/vcc/consume-orders", payload);
      showToast("VCC 交易流水已返回", "ok");
    }

    async function createBillingGroup(event) {
      event.preventDefault();
      const form = event.currentTarget;
      await api("/api/admin/billing-groups", { method: "POST", body: JSON.stringify(formData(form)) });
      form.reset();
      await refreshAfterMutation("账单组已新增", async function() {
        await loadBillingGroups();
        populateSelects();
        renderBilling();
      });
    }

    async function createBillingAddress(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = formData(form);
      payload.priority = numeric(payload.priority, 100);
      await api("/api/admin/billing-addresses", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      await loadBillingAddresses();
      populateSelects();
      renderBilling();
      showToast("账单地址已新增", "ok");
    }

    async function createProxyGroup(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = proxyPayloadFromForm(form);
      await api("/api/admin/proxy-groups", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      syncProxyProviderFields();
      await refreshAfterMutation("代理组已新增", async function() {
        await loadProxyGroups();
        populateSelects();
        renderProxies();
      });
    }

    function proxyPayloadFromForm(form) {
      const payload = formData(form);
      payload.enabled = payload.enabled === "1" || payload.enabled === "true" || payload.enabled === true;
      if (payload.provider === "ipwo") {
        payload.config = {
          host: payload.ipwo_host,
          port: numeric(payload.ipwo_port, 7878),
          username: payload.ipwo_username,
          password: payload.ipwo_password,
          protocol: payload.ipwo_protocol || "http",
          country: payload.ipwo_country,
          state: payload.ipwo_state,
          city: payload.ipwo_city,
          session_mode: payload.ipwo_session_mode || "sticky",
          sticky_minutes: numeric(payload.ipwo_sticky_minutes, 120),
          session_param: "sid",
          state_param: "st"
        };
      } else if (payload.provider === "api") {
        const raw = String(payload.api_config || "").trim();
        payload.config = raw ? JSON.parse(raw) : {};
      } else {
        payload.config = { proxies: String(payload.proxies || "").split(/\\r?\\n/).map(function(line) { return line.trim(); }).filter(Boolean) };
      }
      delete payload.id;
      delete payload.proxies;
      delete payload.api_config;
      delete payload.ipwo_protocol;
      delete payload.ipwo_host;
      delete payload.ipwo_port;
      delete payload.ipwo_username;
      delete payload.ipwo_password;
      delete payload.ipwo_country;
      delete payload.ipwo_state;
      delete payload.ipwo_city;
      delete payload.ipwo_session_mode;
      delete payload.ipwo_sticky_minutes;
      return payload;
    }

    function proxyEntriesToText(entries) {
      return (entries || []).map(function(entry) {
        return typeof entry === "string" ? entry : (entry.url || entry.proxy || "");
      }).filter(Boolean).join("\\n");
    }

    function fillProxyEditForm(group) {
      const config = group.config || {};
      $("proxyEditId").value = group.id || "";
      $("proxyEditName").value = group.name || "";
      $("proxyEditKind").value = group.kind || "shared";
      $("proxyEditProvider").value = group.provider || "static";
      $("proxyEditEnabled").value = group.enabled ? "1" : "0";
      $("proxyEditNote").value = group.note || "";
      $("proxyEditProxies").value = proxyEntriesToText(config.proxies || []);
      $("proxyEditIpwoProtocol").value = config.protocol || "socks5";
      $("proxyEditIpwoHost").value = config.host || "";
      $("proxyEditIpwoPort").value = config.port || 7878;
      $("proxyEditIpwoUsername").value = config.username || "";
      $("proxyEditIpwoPassword").value = config.password || "";
      $("proxyEditIpwoCountry").value = config.country || "";
      $("proxyEditIpwoState").value = config.state || "";
      $("proxyEditIpwoCity").value = config.city || "";
      $("proxyEditIpwoSessionMode").value = config.session_mode || "sticky";
      $("proxyEditIpwoStickyMinutes").value = config.sticky_minutes || 120;
      $("proxyEditApiConfig").value = group.provider === "api" ? JSON.stringify(config, null, 2) : "";
      syncProxyEditProviderFields();
    }

    async function editProxyGroup(groupId) {
      const result = await api("/api/admin/proxy-groups/" + groupId);
      fillProxyEditForm(result.data || {});
      $("proxyOutput").textContent = JSON.stringify(result.data, null, 2);
      showToast("代理组配置已载入", "ok");
    }

    async function saveProxyEdit(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const id = numeric($("proxyEditId").value, 0);
      if (!id) throw new Error("请先在代理组列表中点击编辑");
      const payload = proxyPayloadFromForm(form);
      const result = await api("/api/admin/proxy-groups/" + id, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      $("proxyOutput").textContent = JSON.stringify(result.data, null, 2);
      await loadProxyGroups();
      renderProxies();
      populateSelects();
      showToast("代理组配置已保存", "ok");
    }

    async function testProxyGroup(groupId) {
      const result = await api("/api/admin/proxy-groups/" + groupId + "/test", {
        method: "POST",
        body: JSON.stringify({ attempt_index: 0, timeout_ms: 15000 })
      });
      $("proxyOutput").textContent = JSON.stringify(result, null, 2);
      const connectivity = result.data && result.data.connectivity;
      showToast(result.ok ? (connectivity && connectivity.message ? connectivity.message : "\u4ee3\u7406\u8fde\u901a\u6027\u6d4b\u8bd5\u901a\u8fc7") : ((connectivity && connectivity.message) || result.message || "\u4ee3\u7406\u8fde\u901a\u6027\u6d4b\u8bd5\u672a\u901a\u8fc7"), result.ok ? "ok" : "bad");
    }

    async function changePassword(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const result = await api("/api/admin/password", { method: "POST", body: JSON.stringify(formData(form)) });
      form.reset();
      showToast(result.message || "密码已更新", "ok");
    }

    async function showOrderDetails(orderId, options = {}) {
      state.openOrderDetailId = Number(orderId || 0);
      const result = await api("/api/admin/orders/" + orderId + "/details");
      setOrderDetailText(formatOrderProcessLog(result.data || {}));
      if (!options.quiet) showToast("订单详情已加载", "ok");
    }

    async function copyOrderLog(outputId) {
      const node = $(outputId);
      const selection = window.getSelection ? window.getSelection() : null;
      const selectedText = selection ? String(selection) : "";
      const selectedInNode = Boolean(
        selectedText && node && selection && selection.anchorNode &&
        (node.contains(selection.anchorNode) || (selection.focusNode && node.contains(selection.focusNode)))
      );
      const text = selectedInNode ? selectedText : (state.orderDetailPlainText || (node ? node.innerText : ""));
      if (!text.trim()) throw new Error("\u6682\u65e0\u53ef\u590d\u5236\u7684\u8ba2\u5355\u8be6\u60c5");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      showToast("\u8ba2\u5355\u8be6\u60c5\u5df2\u590d\u5236", "ok");
    }

    async function showCardSecret(cardId) {
      const result = await api("/api/admin/cards/" + cardId + "?secret=1");
      const card = result.data || {};
      $("cardSecretOutput").textContent = JSON.stringify(card, null, 2);
      $("cardSecretNumber").textContent = card.number || "";
      $("cardSecretExpiry").textContent = (card.exp_month || "") + "/" + (card.exp_year || "");
      $("cardSecretCvc").textContent = card.cvc || "";
      $("cardSecretProvider").textContent = cardProviderLabel(card);
      $("cardSecretPolicy").textContent = cardPolicyLabel(card);
      $("cardPolicyProvider").value = card.provider || "";
      $("cardPolicyProviderCardId").value = card.provider_card_id || "";
      $("cardPolicyUnfreeze").checked = Boolean(card.auto_unfreeze_before_use);
      $("cardPolicyFreezeSuccess").checked = Boolean(card.auto_freeze_after_success);
      $("cardPolicyFreezeFailure").checked = Boolean(card.auto_freeze_after_failure);
      $("cardPolicySaveBtn").dataset.cardId = String(card.id || cardId || "");
      const dialog = $("cardSecretDialog");
      if (dialog && typeof dialog.showModal === "function") dialog.showModal();
      else window.alert("卡号: " + (card.number || "") + "\\n有效期: " + (card.exp_month || "") + "/" + (card.exp_year || "") + "\\nCVC: " + (card.cvc || ""));
    }

    async function saveCardPolicy() {
      const cardId = Number($("cardPolicySaveBtn").dataset.cardId || 0);
      if (!cardId) throw new Error("请先打开一张卡的详情");
      const payload = {
        provider: $("cardPolicyProvider").value,
        provider_card_id: $("cardPolicyProviderCardId").value,
        auto_unfreeze_before_use: $("cardPolicyUnfreeze").checked,
        auto_freeze_after_success: $("cardPolicyFreezeSuccess").checked,
        auto_freeze_after_failure: $("cardPolicyFreezeFailure").checked
      };
      const result = await api("/api/admin/cards/" + cardId, { method: "PATCH", body: JSON.stringify(payload) });
      await Promise.all([loadCards(), loadCardGroups(), loadDashboard()]);
      populateSelects();
      renderCards();
      const card = result.data || {};
      $("cardSecretProvider").textContent = cardProviderLabel(card);
      $("cardSecretPolicy").textContent = cardPolicyLabel(card);
      $("cardSecretOutput").textContent = JSON.stringify(card, null, 2);
      showToast("远端卡自动策略已保存", "ok");
      return result;
    }

    async function postSimple(path) {
      const result = await api(path, { method: "POST", body: "{}" });
      showToast("操作完成", "ok");
      await refreshAll();
      return result;
    }

    async function deleteOrder(orderId) {
      if (Number(state.openOrderDetailId) === Number(orderId)) {
        state.openOrderDetailId = 0;
        setOrderDetailText("");
      }
      return postSimple("/api/admin/orders/" + orderId + "/delete");
    }

    function selectCurrentCodesPage() {
      state.codes.forEach(rememberSelectedCode);
      renderRedeem();
    }

    function clearSelectedCodes() {
      replaceSelectedCodes([]);
      renderRedeem();
    }

    document.addEventListener("click", async function(event) {
      const target = event.target;
      if (!target || target.tagName !== "BUTTON") return;
      try {
        if (target.dataset.tab) setTab(target.dataset.tab);
        if (target.dataset.orderDetail) await runWithFeedback(target, "正在读取订单详情...", function() { return showOrderDetails(target.dataset.orderDetail); });
        if (target.dataset.copyOrderLog) await runWithFeedback(target, "正在复制订单详情...", function() { return copyOrderLog(target.dataset.copyOrderLog); });
        if (target.dataset.orderRequeue) await runWithFeedback(target, "正在重排订单...", function() { return postSimple("/api/admin/orders/" + target.dataset.orderRequeue + "/requeue"); });
        if (target.dataset.orderTerminate) await runWithFeedback(target, "正在结束订单...", function() { return postSimple("/api/admin/orders/" + target.dataset.orderTerminate + "/terminate"); });
        if (target.dataset.orderDelete && confirmOrderDelete(target.dataset.orderNo)) await runWithFeedback(target, "正在删除订单...", function() { return deleteOrder(target.dataset.orderDelete); });
        if (target.dataset.codeDisable) await runWithFeedback(target, "正在禁用兑换码...", function() { return postSimple("/api/admin/redeem/codes/" + target.dataset.codeDisable + "/disable"); });
        if (target.dataset.codeRestoreStatus) await runWithFeedback(target, "正在恢复兑换码...", function() { return postSimple("/api/admin/redeem/codes/" + target.dataset.codeRestoreStatus + "/restore-status"); });
        if (target.dataset.codeDelete) await runWithFeedback(target, "正在删除兑换码...", function() { return postSimple("/api/admin/redeem/codes/" + target.dataset.codeDelete + "/delete"); });
        if (target.dataset.cardSecret) {
          await runWithFeedback(target, "正在读取卡详情...", function() { return showCardSecret(target.dataset.cardSecret); });
        }
        if (target.dataset.cardGroupDelete && confirmGroupDelete("card")) await runWithFeedback(target, "正在删除卡组...", function() { return postSimple("/api/admin/card-groups/" + target.dataset.cardGroupDelete + "/delete"); });
        if (target.dataset.cardDisable) await runWithFeedback(target, "正在禁用卡...", function() { return postSimple("/api/admin/cards/" + target.dataset.cardDisable + "/disable"); });
        if (target.dataset.cardRestore) await runWithFeedback(target, "正在恢复卡...", function() { return postSimple("/api/admin/cards/" + target.dataset.cardRestore + "/restore"); });
        if (target.dataset.cardDelete) await runWithFeedback(target, "正在删除卡...", function() { return postSimple("/api/admin/cards/" + target.dataset.cardDelete + "/delete"); });
        if (target.dataset.billingGroupDelete && confirmGroupDelete("billing")) await runWithFeedback(target, "正在删除账单组...", function() { return postSimple("/api/admin/billing-groups/" + target.dataset.billingGroupDelete + "/delete"); });
        if (target.dataset.billingDisable) await runWithFeedback(target, "正在禁用账单地址...", function() { return postSimple("/api/admin/billing-addresses/" + target.dataset.billingDisable + "/disable"); });
        if (target.dataset.billingRestore) await runWithFeedback(target, "正在恢复账单地址...", function() { return postSimple("/api/admin/billing-addresses/" + target.dataset.billingRestore + "/restore"); });
        if (target.dataset.billingDelete) await runWithFeedback(target, "正在删除账单地址...", function() { return postSimple("/api/admin/billing-addresses/" + target.dataset.billingDelete + "/delete"); });
        if (target.dataset.proxyGroupEdit) await runWithFeedback(target, "正在载入代理组配置...", function() { return editProxyGroup(target.dataset.proxyGroupEdit); });
        if (target.dataset.proxyGroupTest) await runWithFeedback(target, "正在测试代理组...", function() { return testProxyGroup(target.dataset.proxyGroupTest); });
        if (target.dataset.proxyGroupDelete && confirmGroupDelete("proxy")) await runWithFeedback(target, "正在删除代理组...", function() { return postSimple("/api/admin/proxy-groups/" + target.dataset.proxyGroupDelete + "/delete"); });
      } catch (error) {
        showToast((error.data && error.data.message) || error.message, "bad");
      }
    });

    document.addEventListener("change", function(event) {
      const target = event.target;
      if (!target || !target.dataset || !target.dataset.codeSelect) return;
      const id = Number(target.dataset.codeSelect);
      if (target.checked) {
        const code = state.codes.find(function(row) { return Number(row.id) === id; });
        if (code) rememberSelectedCode(code);
      } else {
        state.selectedCodesById.delete(id);
      }
      syncSelectedCodesExport();
    });

    $("loginForm").addEventListener("submit", login);
    clickWithFeedback("logoutBtn", "正在退出...", logout);
    clickWithFeedback("refreshBtn", "正在刷新数据...", refreshAll, "数据已刷新");
    clickWithFeedback("saveQueueBtn", "正在保存并发...", saveQueue);
    clickWithFeedback("pauseQueueBtn", "正在暂停队列...", function() { return queueAction("/api/admin/queue/pause"); });
    clickWithFeedback("resumeQueueBtn", "正在恢复队列...", function() { return queueAction("/api/admin/queue/resume"); });
    clickWithFeedback("processOnceBtn", "正在处理一次队列...", function() { return queueAction("/api/admin/queue/process-once"); });
    clickWithFeedback("loadOrdersBtn", "正在查询订单...", async function() { await loadOrders(); renderOrders(); }, "订单已刷新");
    clickWithFeedback("loadCodesBtn", "正在查询兑换码...", async function() { await loadCodes({ resetPage: true }); renderRedeem(); }, "兑换码已刷新");
    $("selectPageCodesBtn").addEventListener("click", function(event) { selectCurrentCodesPage(); showToast("已全选本页兑换码", "ok"); });
    $("clearSelectedCodesBtn").addEventListener("click", function(event) { clearSelectedCodes(); showToast("已清空导出选择", "ok"); });
    clickWithFeedback("prevCodesPageBtn", "正在加载上一页...", async function() { await loadCodes({ page: Math.max(1, state.codePage - 1) }); renderRedeem(); }, "上一页已加载");
    clickWithFeedback("nextCodesPageBtn", "正在加载下一页...", async function() { await loadCodes({ page: state.codePage + 1 }); renderRedeem(); }, "下一页已加载");
    $("codePageSize").addEventListener("change", function(event) { runWithFeedback(null, "正在切换分页大小...", async function() { await loadCodes({ resetPage: true }); renderRedeem(); }, "分页已刷新"); });
    $("manualCardGroup").addEventListener("change", renderManual);
    $("manualBillingGroup").addEventListener("change", renderManual);
    $("manualOrderForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在创建手充订单...", createManualOrder); });
    $("batchForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在生成兑换码...", createBatch); });
    clickWithFeedback("exportCodesBtn", "正在导出兑换码...", exportCodes, "兑换码已开始下载");
    $("planForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在保存套餐配置...", savePlan); });
    $("planForm").addEventListener("input", function(event) {
      if (event.target && event.target.id !== "planSelect") state.planFormDirty = true;
    });
    $("planForm").addEventListener("change", function(event) {
      if (event.target && event.target.id !== "planSelect") state.planFormDirty = true;
    });
    $("planSelect").addEventListener("change", function() {
      state.selectedPlanType = $("planSelect").value;
      state.planFormDirty = false;
      syncPlanForm({ force: true });
    });
    clickWithFeedback("checkReadinessBtn", "正在检查运行条件...", checkReadiness, "运行条件检查完成");
    $("cardGroupForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在新增卡组...", createCardGroup); });
    $("cardForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在新增卡...", createCard); });
    clickWithFeedback("cardPolicySaveBtn", "正在保存远端卡自动策略...", saveCardPolicy, "远端卡自动策略已保存");
    $("vccConfigForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在保存 VCC 配置...", saveVccConfig); });
    clickWithFeedback("vccTestBtn", "正在测试 VCC 账号...", testVccProvider);
    clickWithFeedback("vccBinsBtn", "正在拉取 VCC BIN...", loadVccBins);
    clickWithFeedback("vccRemoteCardsBtn", "正在拉取远端卡...", loadVccRemoteCards);
    clickWithFeedback("vccImportBtn", "正在导入远端卡...", importVccCards);
    clickWithFeedback("vccOpenCardBtn", "正在提交开卡请求...", openVccCard);
    clickWithFeedback("vccOpenDetailBtn", "正在查询开卡详情...", loadVccOpenDetail);
    clickWithFeedback("vccRechargeBtn", "正在提交充值请求...", rechargeVccCard);
    clickWithFeedback("vccRechargeDetailBtn", "正在查询充值详情...", loadVccRechargeDetail);
    clickWithFeedback("vccSuspendBtn", "正在冻结远端卡...", function() { return vccCardStateAction("/api/admin/card-providers/vcc/suspend", "冻结"); });
    clickWithFeedback("vccEnableBtn", "正在解冻远端卡...", function() { return vccCardStateAction("/api/admin/card-providers/vcc/enable", "解冻"); });
    $("vccCancelBtn").addEventListener("click", function() {
      if (!window.confirm("确定要对这张远端卡执行销卡吗？")) return;
      runWithFeedback($("vccCancelBtn"), "正在销卡...", function() { return vccCardStateAction("/api/admin/card-providers/vcc/cancel", "销卡"); });
    });
    clickWithFeedback("vccCashOutBtn", "正在提交资金转出...", cashOutVccCard);
    clickWithFeedback("vccCashOutDetailBtn", "正在查询转出详情...", loadVccCashOutDetail);
    clickWithFeedback("vccConsumeOrdersBtn", "正在查询交易流水...", loadVccConsumeOrders);
    $("billingGroupForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在新增账单组...", createBillingGroup); });
    $("billingAddressForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在新增账单地址...", createBillingAddress); });
    $("proxyProviderSelect").addEventListener("change", syncProxyProviderFields);
    $("proxyGroupForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在新增代理组...", createProxyGroup); });
    $("proxyEditProvider").addEventListener("change", syncProxyEditProviderFields);
    $("proxyEditForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在保存代理组...", saveProxyEdit); });
    $("proxyEditClearBtn").addEventListener("click", function() {
      $("proxyEditForm").reset();
      $("proxyEditId").value = "";
      $("proxyOutput").textContent = "";
      syncProxyEditProviderFields();
      showToast("已清空编辑区", "ok");
    });
    $("passwordForm").addEventListener("submit", function(event) { submitWithFeedback(event, "正在修改密码...", changePassword); });
    clickWithFeedback("loadAuditBtn", "正在刷新审计日志...", loadAudits, "审计日志已刷新");
    document.addEventListener("visibilitychange", function() {
      if (!document.hidden) refreshRealtimeData({ force: true });
    });

    syncProxyProviderFields();
    syncProxyEditProviderFields();
    checkMe();
  </script>
</body>
</html>`;
}

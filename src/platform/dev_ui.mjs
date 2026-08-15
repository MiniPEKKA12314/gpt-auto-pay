export function renderDevUi(options = {}) {
  const token = String(options.defaultAdminToken ?? "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>gpt-auto-pay dev</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6f8;
      --panel: #ffffff;
      --line: #d8dde6;
      --text: #18202f;
      --muted: #627084;
      --accent: #2563eb;
      --ok: #14803c;
      --bad: #b42318;
      --warn: #a15c00;
      --mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
    }
    header {
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0;
    }
    main {
      display: grid;
      grid-template-columns: minmax(340px, 460px) minmax(420px, 1fr);
      gap: 16px;
      padding: 16px;
      min-height: calc(100vh - 56px);
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-width: 0;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0;
    }
    label {
      display: block;
      margin: 10px 0 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    input {
      width: 100%;
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 10px;
      font: 14px var(--mono);
      color: var(--text);
      background: #fff;
    }
    button {
      height: 36px;
      border: 1px solid #b9c2d2;
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 0 12px;
      font-weight: 700;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button:disabled {
      opacity: .55;
      cursor: default;
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .seed {
      margin-top: 8px;
    }
    .seed button {
      height: 30px;
      font-family: var(--mono);
      font-size: 12px;
      font-weight: 600;
    }
    .grid {
      display: grid;
      gap: 16px;
    }
    .statusbar {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 12px;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--muted);
    }
    .dot.ok { background: var(--ok); }
    .dot.bad { background: var(--bad); }
    .dot.warn { background: var(--warn); }
    pre {
      margin: 10px 0 0;
      min-height: 180px;
      max-height: 420px;
      overflow: auto;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #202938;
      background: #0d1420;
      color: #dce7f7;
      font: 12px/1.55 var(--mono);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .events {
      min-height: 360px;
      max-height: calc(100vh - 210px);
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      min-width: 0;
    }
    .metric b {
      display: block;
      font-size: 20px;
      margin-top: 2px;
    }
    .metric span {
      color: var(--muted);
      font-size: 12px;
    }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
      .summary { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>gpt-auto-pay dev</h1>
    <div class="statusbar"><span id="healthDot" class="dot"></span><span id="healthText">checking</span></div>
  </header>
  <main>
    <div class="grid">
      <section>
        <h2>用户前台测试</h2>
        <label for="codeInput">兑换码</label>
        <input id="codeInput" autocomplete="off" placeholder="输入已生成的兑换码">
        <label for="orderInput">订单号</label>
        <input id="orderInput" autocomplete="off">
        <div class="row" style="margin-top:12px">
          <button id="redeemBtn" class="primary">提交兑换码</button>
          <button id="recoverBtn">恢复查询</button>
          <button id="statusBtn">查询订单</button>
        </div>
        <pre id="publicOutput"></pre>
      </section>

      <section>
        <h2>管理员连接</h2>
        <label for="tokenInput">Admin Token</label>
        <input id="tokenInput" value="${escapeHtml(token)}" autocomplete="off">
        <div class="row" style="margin-top:12px">
          <button id="dashboardBtn" class="primary">刷新 Dashboard</button>
          <button id="eventsBtn">连接 SSE</button>
          <button id="closeEventsBtn">断开 SSE</button>
        </div>
        <div class="summary">
          <div class="metric"><span>排队</span><b id="metricQueued">0</b></div>
          <div class="metric"><span>运行</span><b id="metricRunning">0</b></div>
          <div class="metric"><span>未用码</span><b id="metricUnused">0</b></div>
        </div>
      </section>
    </div>

    <section>
      <h2>实时状态</h2>
      <pre id="adminOutput" class="events"></pre>
    </section>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);
    let events = null;
    let polling = null;

    function print(target, value) {
      target.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }

    function append(target, line) {
      const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 8;
      target.textContent += line + '\\n';
      if (atBottom) target.scrollTop = target.scrollHeight;
    }

    async function requestJson(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {})
        }
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.message || response.statusText);
        error.response = response;
        error.data = data;
        throw error;
      }
      return data;
    }

    function adminHeaders() {
      return { 'x-admin-token': $('tokenInput').value.trim() };
    }

    function updateMetrics(data) {
      $('metricQueued').textContent = data?.queue?.queued ?? data?.queued ?? 0;
      $('metricRunning').textContent = data?.queue?.running ?? data?.running ?? 0;
      $('metricUnused').textContent = data?.redeem_codes?.unused ?? 0;
    }

    async function checkHealth() {
      try {
        const data = await requestJson('/health');
        $('healthDot').className = 'dot ok';
        $('healthText').textContent = data.ok ? 'online' : 'unknown';
      } catch (error) {
        $('healthDot').className = 'dot bad';
        $('healthText').textContent = 'offline';
      }
    }

    async function redeem() {
      try {
        const data = await requestJson('/api/public/redeem', {
          method: 'POST',
          body: JSON.stringify({ code: $('codeInput').value.trim() })
        });
        print($('publicOutput'), data);
        if (data?.data?.order_id) {
          $('orderInput').value = data.data.order_id;
          startPolling(data.data.order_id);
        }
        await dashboard();
      } catch (error) {
        print($('publicOutput'), error.data || error.message);
      }
    }

    async function recover() {
      try {
        const data = await requestJson('/api/public/recover', {
          method: 'POST',
          body: JSON.stringify({ code: $('codeInput').value.trim() })
        });
        print($('publicOutput'), data);
        if (data?.data?.order_id) $('orderInput').value = data.data.order_id;
      } catch (error) {
        print($('publicOutput'), error.data || error.message);
      }
    }

    async function orderStatus() {
      const orderId = $('orderInput').value.trim();
      if (!orderId) return;
      try {
        const data = await requestJson('/api/public/orders/' + encodeURIComponent(orderId));
        print($('publicOutput'), data);
      } catch (error) {
        print($('publicOutput'), error.data || error.message);
      }
    }

    function startPolling(orderId) {
      if (polling) clearInterval(polling);
      polling = setInterval(() => {
        if ($('orderInput').value.trim() === orderId) orderStatus();
      }, 2500);
    }

    async function dashboard() {
      try {
        const data = await requestJson('/api/admin/dashboard', { headers: adminHeaders() });
        updateMetrics(data.data);
        append($('adminOutput'), '[dashboard] ' + JSON.stringify(data.data));
      } catch (error) {
        append($('adminOutput'), '[dashboard:error] ' + JSON.stringify(error.data || error.message));
      }
    }

    function connectEvents() {
      if (events) events.close();
      const token = encodeURIComponent($('tokenInput').value.trim());
      events = new EventSource('/api/admin/events?token=' + token);
      events.addEventListener('queue.snapshot', (event) => {
        const data = JSON.parse(event.data);
        $('metricQueued').textContent = data.queued ?? 0;
        $('metricRunning').textContent = data.running ?? 0;
        append($('adminOutput'), '[queue.snapshot] ' + event.data);
      });
      events.addEventListener('ping', () => append($('adminOutput'), '[ping]'));
      events.onerror = () => append($('adminOutput'), '[sse:error]');
      append($('adminOutput'), '[sse] connecting');
    }

    function closeEvents() {
      if (events) events.close();
      events = null;
      append($('adminOutput'), '[sse] closed');
    }

    $('redeemBtn').addEventListener('click', redeem);
    $('recoverBtn').addEventListener('click', recover);
    $('statusBtn').addEventListener('click', orderStatus);
    $('dashboardBtn').addEventListener('click', dashboard);
    $('eventsBtn').addEventListener('click', connectEvents);
    $('closeEventsBtn').addEventListener('click', closeEvents);

    checkHealth();
    dashboard();
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

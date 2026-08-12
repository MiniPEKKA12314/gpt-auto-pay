function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPublicUi(options = {}) {
  const title = escapeHtml(options.title ?? "自助服务台");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <meta name="application-name" content="gpt-auto-pay platform API">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7fb;
      --card: #ffffff;
      --text: #12172a;
      --muted: #667085;
      --line: #e3e6ef;
      --primary: #5752e8;
      --primary-2: #8b5cf6;
      --ok: #12805c;
      --bad: #b42318;
      --warn: #b25e09;
      --soft: #f1f2ff;
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
    .shell {
      width: min(960px, calc(100% - 32px));
      margin: 0 auto;
      padding: 20px 0 48px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin: 4px 0 28px;
      min-width: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .logo {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      color: #fff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      font-weight: 900;
      box-shadow: 0 12px 24px rgba(87, 82, 232, .18);
      flex: none;
    }
    .brand small {
      display: block;
      color: var(--primary);
      font-weight: 800;
      text-transform: uppercase;
      font-size: 11px;
      line-height: 1.2;
    }
    h1 {
      margin: 2px 0 0;
      font-size: 22px;
      line-height: 1.15;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    nav {
      display: flex;
      gap: 8px;
      padding: 6px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--card);
      box-shadow: 0 8px 18px rgba(12, 18, 35, .04);
    }
    nav a {
      color: var(--text);
      text-decoration: none;
      font-weight: 800;
      padding: 8px 12px;
      border-radius: 6px;
    }
    nav a[aria-current="page"] {
      color: var(--primary);
      background: var(--soft);
    }
    .heading {
      display: grid;
      gap: 8px;
      margin-bottom: 18px;
    }
    .heading b {
      color: var(--primary);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .heading h2 {
      margin: 0;
      font-size: 38px;
      line-height: 1.08;
      letter-spacing: 0;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(280px, .9fr);
      gap: 16px;
      align-items: start;
    }
    section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--card);
      box-shadow: 0 18px 48px rgba(12, 18, 35, .05);
      padding: 24px;
      min-width: 0;
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 18px;
    }
    .step {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      color: var(--muted);
      font-weight: 800;
      font-size: 13px;
    }
    .step.active {
      color: var(--primary);
      border-color: rgba(87, 82, 232, .35);
      background: var(--soft);
    }
    .step.ok {
      color: var(--ok);
      border-color: rgba(18, 128, 92, .32);
      background: #effaf5;
    }
    label {
      display: block;
      margin: 14px 0 7px;
      color: #394150;
      font-size: 13px;
      font-weight: 800;
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      padding: 12px;
      font: 14px ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      outline: none;
    }
    input { height: 46px; }
    textarea {
      min-height: 190px;
      resize: vertical;
      line-height: 1.5;
    }
    input:focus, textarea:focus {
      border-color: rgba(87, 82, 232, .52);
      box-shadow: 0 0 0 3px rgba(87, 82, 232, .10);
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 18px;
    }
    button {
      height: 42px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--text);
      padding: 0 18px;
      font-weight: 900;
      cursor: pointer;
    }
    button.primary {
      border-color: transparent;
      color: #fff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      box-shadow: 0 12px 24px rgba(87, 82, 232, .22);
    }
    button:disabled {
      cursor: default;
      opacity: .58;
      box-shadow: none;
    }
    .status {
      display: grid;
      gap: 12px;
    }
    .query-title {
      display: grid;
      gap: 4px;
      margin-bottom: 4px;
    }
    .query-title strong {
      font-size: 16px;
      line-height: 1.2;
    }
    .query-title span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .state {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fafbff;
    }
    .state strong {
      display: block;
      font-size: 18px;
      line-height: 1.25;
      margin-bottom: 6px;
    }
    .state.ok { border-color: rgba(18, 128, 92, .32); background: #effaf5; }
    .state.bad { border-color: rgba(180, 35, 24, .30); background: #fff3f1; }
    .state.warn { border-color: rgba(178, 94, 9, .30); background: #fff8eb; }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      word-break: break-all;
    }
    .muted { color: var(--muted); }
    .field-hint {
      min-height: 20px;
      margin-top: 7px;
      font-size: 12px;
      line-height: 1.45;
      color: var(--muted);
      font-weight: 800;
    }
    .field-hint.ok { color: var(--ok); }
    .field-hint.bad { color: var(--bad); }
    .field-hint.warn { color: var(--warn); }
    .hidden-api-marker {
      position: fixed;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @media (max-width: 820px) {
      .shell { width: calc(100% - 24px); padding-top: 12px; }
      header { align-items: flex-start; }
      nav { display: none; }
      .heading h2 { font-size: 30px; }
      .layout { grid-template-columns: 1fr; }
      section { padding: 18px; }
      .steps { grid-template-columns: 1fr; }
      .actions button { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand">
        <div class="logo">GP</div>
        <div>
          <small>Service Desk</small>
          <h1>自助服务台</h1>
        </div>
      </div>
      <nav aria-label="公开页面导航">
        <a href="/" aria-current="page">充值</a>
      </nav>
    </header>

    <div class="heading">
      <b>Recharge</b>
      <h2>卡密验证充值</h2>
    </div>

    <div class="layout">
      <section>
        <div class="steps">
          <div id="stepCode" class="step active">1. 验证</div>
          <div id="stepSubmit" class="step">2. 提交</div>
          <div id="stepWait" class="step">3. 等待</div>
        </div>
        <form id="redeemForm">
          <label for="codeInput">CDK 卡密</label>
          <input id="codeInput" name="code" autocomplete="off" placeholder="请输入 CDK">
          <label for="credentialInput">充值授权凭证</label>
          <textarea id="credentialInput" name="credential" placeholder="粘贴从 chatgpt.com/api/auth/session 复制的完整 JSON"></textarea>
          <div id="credentialHint" class="field-hint"></div>
          <div class="actions">
            <button id="submitBtn" class="primary" type="submit">提交订单</button>
            <button id="recoverBtn" type="button">查询卡密订单</button>
          </div>
        </form>
      </section>

      <section class="status">
        <div id="statusBox" class="state warn">
          <strong>等待提交</strong>
          <div class="muted">订单状态会显示在这里。</div>
        </div>
        <div>
          <div class="query-title">
            <strong>订单查询</strong>
            <span>可输入订单号查询，也可手动刷新当前订单状态。</span>
          </div>
          <label for="orderInput">订单号</label>
          <input id="orderInput" class="mono" autocomplete="off">
          <div class="actions">
            <button id="queryBtn" type="button">查询订单</button>
            <button id="refreshStatusBtn" type="button">刷新状态</button>
            <button id="clearBtn" type="button">清空</button>
          </div>
        </div>
      </section>
    </div>
  </div>
  <span class="hidden-api-marker">gpt-auto-pay platform API</span>

  <script>
    const $ = (id) => document.getElementById(id);
    let pollTimer = null;

    function setStep(name) {
      $("stepWait").textContent = name === "done" ? "3. 完成" : "3. 等待";
      $("stepCode").classList.toggle("active", name === "code");
      $("stepSubmit").classList.toggle("active", name === "submit");
      $("stepWait").classList.toggle("active", name === "wait" || name === "done");
      $("stepWait").classList.toggle("ok", name === "done");
    }

    function isPendingStatus(status) {
      return ["created", "queued", "running"].includes(status);
    }

    function isTerminalStatus(status) {
      return ["succeeded", "failed", "cancelled"].includes(status);
    }

    function statusLabel(status) {
      const map = {
        created: "已创建",
        queued: "排队中",
        running: "正在处理",
        succeeded: "充值成功",
        failed: "充值失败",
        interrupted_review: "异常待核对",
        cancelled: "已取消"
      };
      return map[status] || status || "未知状态";
    }

    function statusTone(status) {
      if (status === "succeeded") return "ok";
      if (status === "failed" || status === "cancelled") return "bad";
      return "warn";
    }

    function renderStatus(data) {
      const box = $("statusBox");
      const tone = statusTone(data && data.status);
      box.className = "state " + tone;
      const orderLine = data && data.order_id ? '<div class="mono muted">' + escapeHtml(data.order_id) + '</div>' : "";
      const planLine = data && data.plan_name ? '<div>套餐：' + escapeHtml(data.plan_name) + '</div>' : "";
      box.innerHTML = '<strong>' + escapeHtml(statusLabel(data && data.status)) + '</strong>' + planLine + '<div>' + escapeHtml((data && data.message) || "") + '</div>' + orderLine;
      if (data && isTerminalStatus(data.status)) {
        localStorage.removeItem("gpt_auto_pay_last_order");
      }
      if (data && data.order_id) {
        $("orderInput").value = data.order_id;
        if (isPendingStatus(data.status)) {
          localStorage.setItem("gpt_auto_pay_last_order", data.order_id);
        }
      }
      if (data && isTerminalStatus(data.status) && pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      if (data && data.status === "succeeded") {
        setStep("done");
      } else if (data && (data.status === "failed" || data.status === "cancelled")) {
        setStep("code");
      } else if (data && data.status === "queued") {
        setStep("submit");
      } else if (data && (data.status === "running" || data.status === "created" || data.status === "interrupted_review")) {
        setStep(data.status === "created" ? "code" : "wait");
      } else if (data && data.status) {
        setStep("code");
      }
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    async function requestJson(path, options) {
      const response = await fetch(path, Object.assign({
        credentials: "same-origin",
        headers: { "content-type": "application/json" }
      }, options || {}));
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.message || response.statusText);
        error.data = data;
        throw error;
      }
      return data;
    }

    function setCredentialHint(message, tone) {
      const node = $("credentialHint");
      if (!node) return;
      node.className = "field-hint " + (tone || "");
      node.textContent = message || "";
    }

    function normalizeCredentialText(raw) {
      let text = String(raw || "").trim();
      if (!text) return "";
      const fence = String.fromCharCode(96, 96, 96);
      if (text.startsWith(fence)) {
        const lineBreak = text.indexOf("\\n");
        text = lineBreak >= 0 ? text.slice(lineBreak + 1).trim() : text.slice(fence.length).trim();
        if (text.endsWith(fence)) text = text.slice(0, -fence.length).trim();
      }
      const objectStart = text.indexOf("{");
      const arrayStart = text.indexOf("[");
      const starts = [objectStart, arrayStart].filter(function(index) { return index >= 0; });
      if (starts.length && Math.min.apply(null, starts) > 0) {
        text = text.slice(Math.min.apply(null, starts)).trim();
      }
      return text;
    }

    function missingJsonClosers(text) {
      const stack = [];
      let inString = false;
      let escaping = false;
      for (let index = 0; index < text.length; index += 1) {
        const ch = text[index];
        if (escaping) {
          escaping = false;
          continue;
        }
        if (ch === "\\\\") {
          escaping = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === "{") stack.push("}");
        else if (ch === "[") stack.push("]");
        else if (ch === "}" || ch === "]") {
          if (stack.pop() !== ch) return "";
        }
      }
      return stack.reverse().join("");
    }

    function parseJsonWithSmallRepair(text) {
      try {
        return { value: JSON.parse(text), repaired: false };
      } catch (firstError) {
        const closers = missingJsonClosers(text);
        if (closers && closers.length <= 2) {
          try {
            return { value: JSON.parse(text + closers), repaired: true };
          } catch {
          }
        }
        const error = new Error("授权凭证 JSON 格式不完整，请检查是否少复制了末尾的 } 或 ]");
        error.cause = firstError;
        throw error;
      }
    }

    function findDeepString(value, names, seen) {
      if (!value || typeof value !== "object") return "";
      if (!seen) seen = new Set();
      if (seen.has(value)) return "";
      seen.add(value);
      for (const name of names) {
        if (typeof value[name] === "string" && value[name].trim()) return value[name].trim();
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findDeepString(item, names, seen);
          if (found) return found;
        }
        return "";
      }
      for (const key of Object.keys(value)) {
        const found = findDeepString(value[key], names, seen);
        if (found) return found;
      }
      return "";
    }

    function collectCredentialFromJson(json, out) {
      out.accessToken = out.accessToken || findDeepString(json, ["accessToken", "access_token", "access-token"]);
      out.sessionToken = out.sessionToken || findDeepString(json, ["sessionToken", "session_token", "session-token"]);
      out.sessionCookieName = out.sessionCookieName || findDeepString(json, ["sessionCookieName", "session_cookie_name"]);
      if (!out.sessionToken && Array.isArray(json && json.cookies)) {
        const found = json.cookies.find(function(cookie) {
          return cookie && /session-token/.test(String(cookie.name || ""));
        });
        if (found) {
          out.sessionToken = String(found.value || "").trim();
          out.sessionCookieName = String(found.name || "").trim();
        }
      }
    }

    function decodeJsonStringPart(value) {
      try {
        return JSON.parse('"' + value + '"');
      } catch {
        return value;
      }
    }

    function collectCredentialWithRegex(text, out) {
      const accessMatch = text.match(/"(?:accessToken|access_token|access-token)"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"/i);
      const sessionMatch = text.match(/"(?:sessionToken|session_token|session-token)"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"/i);
      if (!out.accessToken && accessMatch) out.accessToken = decodeJsonStringPart(accessMatch[1]).trim();
      if (!out.sessionToken && sessionMatch) out.sessionToken = decodeJsonStringPart(sessionMatch[1]).trim();
      const cookieMatch = text.match(/(?:^|;\\s*)(__Secure-next-auth\\.session-token|next-auth\\.session-token)=([^;\\s]+)/);
      if (!out.sessionToken && cookieMatch) {
        out.sessionCookieName = cookieMatch[1];
        try {
          out.sessionToken = decodeURIComponent(cookieMatch[2]);
        } catch {
          out.sessionToken = cookieMatch[2];
        }
      }
    }

    function credentialMissingMessage(out, parseError) {
      const missing = [];
      if (!out.accessToken) missing.push("Access Token");
      if (!out.sessionToken) missing.push("Session Token");
      const suffix = parseError ? "；同时没有识别到必要字段，请重新全选复制 session JSON" : "，请粘贴从 chatgpt.com/api/auth/session 复制的完整 JSON";
      return "没有识别到 " + missing.join(" 和 ") + suffix;
    }

    function parseCredential(raw) {
      const text = normalizeCredentialText(raw);
      const out = {};
      if (!text) throw new Error("请粘贴从 chatgpt.com/api/auth/session 复制的完整 JSON");
      let parseError = "";
      const looksJson = text[0] === "{" || text[0] === "[";
      if (looksJson) {
        try {
          const parsed = parseJsonWithSmallRepair(text);
          collectCredentialFromJson(parsed.value, out);
          if (parsed.repaired) out.warning = "检测到 JSON 末尾缺少括号，已自动补齐并解析";
        } catch (error) {
          parseError = error.message || String(error);
        }
      }
      collectCredentialWithRegex(text, out);
      if (!out.accessToken || !out.sessionToken) {
        throw new Error(credentialMissingMessage(out, parseError));
      }
      if (parseError && !out.warning) {
        out.warning = "JSON 格式不完整，已从文本中识别到必要字段";
      }
      return out;
    }

    let credentialPreviewTimer = null;

    function previewCredential() {
      const text = $("credentialInput").value;
      if (!String(text || "").trim()) {
        setCredentialHint("", "");
        return;
      }
      try {
        const credential = parseCredential(text);
        setCredentialHint(credential.warning || "已识别 Access Token 和 Session Token", credential.warning ? "warn" : "ok");
      } catch (error) {
        setCredentialHint(error.message || "授权凭证格式不正确", "bad");
      }
    }

    function scheduleCredentialPreview() {
      if (credentialPreviewTimer) window.clearTimeout(credentialPreviewTimer);
      credentialPreviewTimer = window.setTimeout(previewCredential, 300);
    }

    async function submitOrder(event) {
      event.preventDefault();
      const code = $("codeInput").value.trim();
      if (!code) {
        renderStatus({ status: "failed", message: "请输入 CDK 卡密" });
        return;
      }
      $("submitBtn").disabled = true;
      setStep("submit");
      try {
        const credential = parseCredential($("credentialInput").value);
        setCredentialHint(credential.warning || "已识别 Access Token 和 Session Token", credential.warning ? "warn" : "ok");
        const payload = {
          code: code,
          accessToken: credential.accessToken,
          sessionToken: credential.sessionToken
        };
        if (credential.sessionCookieName) payload.sessionCookieName = credential.sessionCookieName;
        const result = await requestJson("/api/public/redeem", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        renderStatus(result.data);
        startPolling(result.data.order_id);
      } catch (error) {
        renderStatus({ status: "failed", message: (error.data && error.data.message) || error.message });
      } finally {
        $("submitBtn").disabled = false;
      }
    }

    async function recoverOrder() {
      const code = $("codeInput").value.trim();
      if (!code) return renderStatus({ status: "failed", message: "请输入 CDK 卡密" });
      try {
        const result = await requestJson("/api/public/recover", {
          method: "POST",
          body: JSON.stringify({ code: code })
        });
        renderStatus(result.data);
        startPolling(result.data.order_id);
      } catch (error) {
        renderStatus({ status: "failed", message: (error.data && error.data.message) || error.message });
      }
    }

    async function queryOrder() {
      const orderId = $("orderInput").value.trim();
      if (!orderId) return renderStatus({ status: "failed", message: "请输入订单号" });
      try {
        const result = await requestJson("/api/public/orders/" + encodeURIComponent(orderId));
        renderStatus(result.data);
        return result.data;
      } catch (error) {
        renderStatus({ status: "failed", message: (error.data && error.data.message) || error.message });
      }
      return null;
    }

    async function refreshCurrentOrder() {
      const orderId = $("orderInput").value.trim() || localStorage.getItem("gpt_auto_pay_last_order") || "";
      if (!orderId) return renderStatus({ status: "created", message: "暂无订单号，请先提交订单或输入订单号查询" });
      $("orderInput").value = orderId;
      return queryOrder();
    }

    function startPolling(orderId) {
      if (pollTimer) window.clearInterval(pollTimer);
      if (!orderId) return;
      pollTimer = window.setInterval(async function() {
        $("orderInput").value = orderId;
        const data = await queryOrder();
        if (data && !["queued", "running", "created"].includes(data.status)) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      }, 3000);
    }

    $("redeemForm").addEventListener("submit", submitOrder);
    $("credentialInput").addEventListener("input", scheduleCredentialPreview);
    $("credentialInput").addEventListener("blur", previewCredential);
    $("recoverBtn").addEventListener("click", recoverOrder);
    $("queryBtn").addEventListener("click", queryOrder);
    $("refreshStatusBtn").addEventListener("click", refreshCurrentOrder);
    $("clearBtn").addEventListener("click", function() {
      $("orderInput").value = "";
      localStorage.removeItem("gpt_auto_pay_last_order");
      renderStatus({ status: "created", message: "等待提交" });
      setStep("code");
    });

    const lastOrder = localStorage.getItem("gpt_auto_pay_last_order");
    if (lastOrder) {
      $("orderInput").value = lastOrder;
      queryOrder();
      startPolling(lastOrder);
    }
  </script>
</body>
</html>`;
}

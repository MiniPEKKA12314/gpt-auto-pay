import { createServer } from "node:http";
import { URL } from "node:url";

import { renderAdminUi } from "./admin_ui.mjs";
import { createAuditLog } from "./audit.mjs";
import { ADMIN_SESSION_COOKIE, buildAdminSessionCookie, clearAdminSessionCookie, parseCookies, verifyPassword } from "./auth.mjs";
import { createVccCardProvider } from "./card_provider_vcc.mjs";
import { renderDevUi } from "./dev_ui.mjs";
import { PlatformStoreError } from "./db.mjs";
import { OrderStatus } from "./constants.mjs";
import { createPlatformPaymentAdapterFactory } from "./order_processor.mjs";
import { publicOrderSummary } from "./orders.mjs";
import { testProxyConnectivity } from "./proxy_connectivity.mjs";
import { selectProxyForAttemptAsync } from "./proxy_pool.mjs";
import { renderPublicUi } from "./public_ui.mjs";
import { normalizeRedeemCode } from "./redeem.mjs";
import { MemoryRateLimiter } from "./rate_limit.mjs";
import { checkPlanRuntimeReadiness } from "./runtime_readiness.mjs";
import { PlatformQueueWorker, runQueueOnce } from "./worker.mjs";

const JSON_TYPE = "application/json; charset=utf-8";

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(text);
}

function sendJson(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": JSON_TYPE,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res, statusCode, code, message, details = {}) {
  sendJson(res, statusCode, { ok: false, code, message, details });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PlatformStoreError("BAD_JSON", "请求 JSON 格式不正确");
  }
}

function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

function adminAuth(req, adminToken, url) {
  if (adminToken && req.headers["x-admin-token"] === adminToken) {
    return { id: 1, username: "admin", method: "token" };
  }
  if (adminToken && url?.searchParams?.get("token") === adminToken) {
    return { id: 1, username: "admin", method: "token" };
  }
  const sessionId = parseCookies(req).get(ADMIN_SESSION_COOKIE);
  const session = req.platformStore?.getAdminSession(sessionId);
  if (!session) return null;
  return {
    id: session.admin_id,
    username: session.username,
    method: "session",
    session_id: session.id,
    expires_at: session.expires_at,
  };
}

function requireAdmin(req, res, adminToken, url) {
  const auth = adminAuth(req, adminToken, url);
  if (auth) {
    req.platformAdmin = auth;
    return true;
  }
  sendError(res, 401, "ADMIN_UNAUTHORIZED", "管理员未登录");
  return false;
  if (!adminToken) return true;
  if (req.headers["x-admin-token"] === adminToken) return true;
  if (url?.searchParams?.get("token") === adminToken) return true;
  sendError(res, 401, "ADMIN_UNAUTHORIZED", "管理员未登录");
  return false;
}

function rateLimit(res, limiter, key, limit, windowMs) {
  const result = limiter.allow(key, limit, windowMs);
  if (result.allowed) return true;
  res.setHeader("retry-after", String(Math.ceil(result.retryAfterMs / 1000)));
  sendError(res, 429, "RATE_LIMITED", "请求过于频繁，请稍后再试");
  return false;
}

function mapStoreError(error) {
  if (!(error instanceof PlatformStoreError)) {
    return { statusCode: 500, code: "INTERNAL_ERROR", message: error.message || "服务器错误" };
  }
  const code = error.code;
  if (code === "BAD_JSON") return { statusCode: 400, code, message: error.message };
  if (code === "REDEEM_CODE_NOT_FOUND") return { statusCode: 404, code, message: "兑换码不存在" };
  if (code === "REDEEM_CODE_DELETED") return { statusCode: 410, code, message: "兑换码已删除" };
  if (code === "REDEEM_CODE_NOT_UNUSED") return { statusCode: 409, code, message: "兑换码正在处理或已使用", details: error.details };
  if (code === "PLAN_NOT_FOUND") return { statusCode: 404, code, message: "套餐配置不存在", details: error.details };
  if (code === "NOT_FOUND") return { statusCode: 404, code, message: "记录不存在" };
  return { statusCode: 400, code, message: error.message, details: error.details ?? {} };
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function adminAudit(store, req, input) {
  store.insertAuditLog(createAuditLog({
    admin_id: 1,
    action: input.action,
    target_type: input.target_type,
    target_id: input.target_id,
    ip: clientIp(req),
    user_agent: req.headers["user-agent"] || "",
    before: input.before ?? {},
    after: input.after ?? {},
  }));
}

function exportContentType(format) {
  if (format === "json") return "application/json; charset=utf-8";
  if (format === "csv") return "text/csv; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function createVccProviderFromStore(store, fetchImpl) {
  const config = store.getCardProviderConfig("vcc", { includeSecret: true });
  if (!config.user_serial || !config.secret_key) {
    throw new PlatformStoreError("VCC_CONFIG_MISSING", "VCC 卡台配置不完整，请先填写 userSerial 和 secretKey");
  }
  return createVccCardProvider(config, { fetchImpl });
}

function publicVccCard(card = {}) {
  return {
    provider: card.provider ?? "vcc",
    provider_card_id: card.provider_card_id ?? "",
    organization: card.organization ?? "",
    state: card.state ?? "",
    masked_number: card.masked_number ?? "",
    exp_month: card.exp_month ?? "",
    exp_year: card.exp_year ?? "",
    remark: card.remark ?? "",
    card_balance: card.card_balance ?? "",
    create_time: card.create_time ?? "",
    modify_time: card.modify_time ?? "",
  };
}

function vccResultSummary(data = {}) {
  if (!data || typeof data !== "object") return data;
  return {
    id: data.id ?? data.orderId ?? "",
    userBankCardId: data.userBankCardId ?? data.bankCard?.id ?? "",
    state: data.state ?? "",
    remark: data.remark ?? "",
    amount: data.amount ?? "",
  };
}

function maskSensitiveNumber(value) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (digits.length < 8) return digits ? "****" : "";
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

function sanitizeVccOperationPayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeVccOperationPayload);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === "cvv" || lower === "cvc") {
      result[key] = "***";
    } else if (["number", "cardnumber", "bankcardnum", "userbankcardnum", "cardnum"].includes(lower)) {
      result[key] = maskSensitiveNumber(item);
    } else {
      result[key] = sanitizeVccOperationPayload(item);
    }
  }
  return result;
}

function vccCardTargetSummary(body = {}) {
  return {
    card_id: body.card_id ?? body.cardId ?? body.bank_card_id ?? body.bankCardId ?? "",
    card_num: body.card_num || body.cardNum || body.bank_card_num || body.bankCardNum ? "provided" : "",
    amount: body.amount ?? "",
  };
}

function queueSnapshotWithWorker(store, workerStatusProvider) {
  const queue = store.queueSnapshot();
  if (typeof workerStatusProvider !== "function") return queue;
  return {
    ...queue,
    worker: workerStatusProvider(),
  };
}

function dashboardSnapshotWithWorker(store, workerStatusProvider) {
  const dashboard = store.dashboardSnapshot();
  return {
    ...dashboard,
    queue: queueSnapshotWithWorker(store, workerStatusProvider),
  };
}

function summarizeWorkerEvent(event) {
  const summary = {
    type: event?.type || "unknown",
    at: Date.now() / 1000,
  };
  if (event?.type === "tick") {
    const results = Array.isArray(event.results) ? event.results : [];
    summary.started = Array.isArray(event.started) ? event.started.length : 0;
    summary.results = results.length;
    summary.succeeded = results.filter((row) => row.ok === true).length;
    summary.failed = results.filter((row) => row.ok !== true).length;
  } else if (event?.type === "recovery") {
    summary.recovered = Number(event.recovered || 0);
  } else if (event?.type === "error") {
    summary.message = event.error?.message || String(event.error || "");
  }
  return summary;
}

export function createPlatformRequestHandler(options = {}) {
  const store = options.store;
  if (!store) throw new Error("store is required");
  const limiter = options.rateLimiter ?? new MemoryRateLimiter();
  const adminToken = options.adminToken ?? "";
  const queueAdapterFactory = options.queueAdapterFactory ?? createPlatformPaymentAdapterFactory({ store });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const proxyConnectivityTester = options.proxyConnectivityTester ?? testProxyConnectivity;
  const workerStatusProvider = typeof options.workerStatusProvider === "function" ? options.workerStatusProvider : null;

  return async function platformRequestHandler(req, res) {
    req.platformStore = store;
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const ip = clientIp(req);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/recharge" || url.pathname === "/query")) {
        sendText(res, 200, renderPublicUi(), "text/html; charset=utf-8");
        return;
      }

      if (req.method === "GET" && url.pathname === "/api") {
        sendText(res, 200, [
          "gpt-auto-pay platform API",
          "",
          "GET  /",
          "GET  /dev",
          "GET  /admin",
          "GET  /health",
          "POST /api/public/redeem",
          "POST /api/public/recover",
          "GET  /api/public/orders/:order_id",
          "GET  /api/admin/dashboard",
          "GET  /api/admin/events",
        ].join("\n"));
        return;
      }

      if (req.method === "GET" && url.pathname === "/dev") {
        sendText(res, 200, renderDevUi({ defaultAdminToken: adminToken }), "text/html; charset=utf-8");
        return;
      }

      if (req.method === "GET" && url.pathname === "/admin") {
        sendText(res, 200, renderAdminUi(), "text/html; charset=utf-8");
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/public/redeem") {
        if (!rateLimit(res, limiter, `redeem:ip:${ip}`, 5, 60_000)) return;
        const body = await readJson(req);
        const code = normalizeRedeemCode(body.code);
        if (!code) {
          sendError(res, 400, "CODE_REQUIRED", "请输入兑换码");
          return;
        }
        if (!rateLimit(res, limiter, `redeem:code:${code}`, 1, 30_000)) return;
        const { order } = store.lockCodeAndCreateOrder({
          code,
          user_ip: ip,
          user_agent: req.headers["user-agent"] || "",
        });
        if (body.accessToken || body.access_token || body.sessionToken || body.session_token || body.sessionCookieName || body.session_cookie_name) {
          store.setOrderRuntimeSecrets(order.id, {
            accessToken: body.accessToken ?? body.access_token,
            sessionToken: body.sessionToken ?? body.session_token,
            sessionCookieName: body.sessionCookieName ?? body.session_cookie_name,
          });
        }
        sendJson(res, 200, { ok: true, data: publicOrderSummary(order) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/public/recover") {
        if (!rateLimit(res, limiter, `recover:ip:${ip}`, 5, 60_000)) return;
        const body = await readJson(req);
        const code = normalizeRedeemCode(body.code);
        if (!code) {
          sendError(res, 400, "CODE_REQUIRED", "请输入兑换码");
          return;
        }
        const order = store.getOrderForRedeemCodeDisplay(code);
        if (!order) {
          sendError(res, 404, "ORDER_NOT_FOUND", "未找到该兑换码对应的订单");
          return;
        }
        sendJson(res, 200, { ok: true, data: publicOrderSummary(order) });
        return;
      }

      const orderMatch = url.pathname.match(/^\/api\/public\/orders\/([^/]+)$/);
      if (req.method === "GET" && orderMatch) {
        if (!rateLimit(res, limiter, `status:ip:${ip}`, 5, 60_000)) return;
        const order = store.getOrderByNo(decodeURIComponent(orderMatch[1]));
        if (!order) {
          sendError(res, 404, "ORDER_NOT_FOUND", "订单不存在");
          return;
        }
        sendJson(res, 200, { ok: true, data: publicOrderSummary(order) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/login") {
        if (!rateLimit(res, limiter, `admin-login:ip:${ip}`, 10, 60_000)) return;
        const body = await readJson(req);
        if (!store.isAdminPasswordConfigured(1)) {
          sendError(res, 503, "ADMIN_PASSWORD_NOT_CONFIGURED", "管理员密码未初始化，请先设置 PLATFORM_ADMIN_PASSWORD");
          return;
        }
        const admin = store.verifyAdminLogin(body.username ?? "admin", body.password ?? "");
        if (!admin) {
          sendError(res, 401, "ADMIN_LOGIN_FAILED", "账号或密码不正确");
          return;
        }
        const session = store.createAdminSession(admin.id, {
          ip,
          user_agent: req.headers["user-agent"] || "",
          ttlSeconds: 12 * 60 * 60,
        });
        adminAudit(store, req, {
          action: "admin_login",
          target_type: "admin_user",
          target_id: String(admin.id),
          after: { username: admin.username },
        });
        const secureCookie = String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
        sendJson(res, 200, {
          ok: true,
          data: {
            username: admin.username,
            expires_at: session.expires_at,
          },
        }, {
          "set-cookie": buildAdminSessionCookie(session.id, { maxAgeSeconds: 12 * 60 * 60, secure: secureCookie }),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/logout") {
        const sessionId = parseCookies(req).get(ADMIN_SESSION_COOKIE);
        if (sessionId) store.deleteAdminSession(sessionId);
        sendJson(res, 200, { ok: true }, { "set-cookie": clearAdminSessionCookie() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/me") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, {
          ok: true,
          data: {
            id: req.platformAdmin.id,
            username: req.platformAdmin.username,
            method: req.platformAdmin.method,
            expires_at: req.platformAdmin.expires_at ?? 0,
          },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/password") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const admin = store.getAdminById(req.platformAdmin.id);
        if (!admin || !verifyPassword(body.current_password ?? body.currentPassword ?? "", admin.password_hash)) {
          sendError(res, 403, "ADMIN_PASSWORD_INVALID", "当前密码不正确");
          return;
        }
        const before = { id: admin.id, username: admin.username };
        const after = store.setAdminPassword(admin.id, body.new_password ?? body.newPassword ?? "");
        adminAudit(store, req, {
          action: "admin_password_update",
          target_type: "admin_user",
          target_id: String(admin.id),
          before,
          after: { id: after.id, username: after.username },
        });
        sendJson(res, 200, { ok: true, message: "管理员密码已更新" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/dashboard") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: dashboardSnapshotWithWorker(store, workerStatusProvider) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/queue") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: queueSnapshotWithWorker(store, workerStatusProvider) });
        return;
      }

      if (req.method === "PATCH" && url.pathname === "/api/admin/queue/settings") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const before = store.getQueueSettings();
        const body = await readJson(req);
        const after = store.setQueueSettings(body, 1);
        adminAudit(store, req, {
          action: "queue_settings_update",
          target_type: "queue",
          target_id: "settings",
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/queue/pause") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const before = store.getQueueSettings();
        const after = store.pauseQueue(1);
        adminAudit(store, req, {
          action: "queue_pause",
          target_type: "queue",
          target_id: "global",
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: queueSnapshotWithWorker(store, workerStatusProvider) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/queue/resume") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const before = store.getQueueSettings();
        const after = store.resumeQueue(1);
        adminAudit(store, req, {
          action: "queue_resume",
          target_type: "queue",
          target_id: "global",
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: queueSnapshotWithWorker(store, workerStatusProvider) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/queue/dispatch") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const orders = store.dispatchQueuedOrders();
        adminAudit(store, req, {
          action: "queue_dispatch",
          target_type: "queue",
          target_id: "global",
          after: { order_ids: orders.map((order) => order.id) },
        });
        sendJson(res, 200, { ok: true, data: orders });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/queue/process-once") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const result = await runQueueOnce(store, queueAdapterFactory, { ignorePaused: true });
        adminAudit(store, req, {
          action: "queue_process_once",
          target_type: "queue",
          target_id: "global",
          after: {
            started: result.started.length,
            results: result.results.map((row) => ({ order_no: row.order_no, ok: row.ok })),
          },
        });
        sendJson(res, 200, { ok: true, data: result });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/orders") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, {
          ok: true,
          data: store.listOrders({
            status: url.searchParams.get("status") || "",
            plan_type: url.searchParams.get("plan_type") || url.searchParams.get("planType") || "",
            q: url.searchParams.get("q") || url.searchParams.get("query") || "",
          }),
        });
        return;
      }

      const orderAction = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/(requeue|terminate|resolve-interrupted|delete)$/);
      if (req.method === "POST" && orderAction) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const orderId = Number(orderAction[1]);
        const action = orderAction[2];
        const before = store.getOrderById(orderId);
        const body = await readJson(req);
        let after;
        if (action === "requeue") after = store.requeueOrder(orderId);
        else if (action === "terminate") after = store.terminateOrder(orderId, body.reason ?? "terminated_by_admin");
        else if (action === "delete") after = store.softDeleteOrder(orderId, 1, body.reason ?? "deleted_by_admin");
        else after = store.resolveInterruptedOrder(orderId, body.action);
        adminAudit(store, req, {
          action: `order_${action}`,
          target_type: "order",
          target_id: String(orderId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      const orderDetail = url.pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
      if (req.method === "GET" && orderDetail) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.getOrderById(Number(orderDetail[1])) });
        return;
      }

      const orderDetails = url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/details$/);
      if (req.method === "GET" && orderDetails) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const orderId = Number(orderDetails[1]);
        sendJson(res, 200, {
          ok: true,
          data: {
            order: store.getOrderById(orderId),
            attempts: store.listOrderAttempts(orderId),
            logs: store.listRunLogs(orderId),
            runtime: store.getOrderRuntimeSecrets(orderId),
          },
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/plans") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.listPlanConfigs({ includeCardGroups: true }) });
        return;
      }

      const planCardGroups = url.pathname.match(/^\/api\/admin\/plans\/(go|plus|pro5x|pro20x)\/card-groups$/);
      if ((req.method === "POST" || req.method === "PUT") && planCardGroups) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const planType = planCardGroups[1];
        const before = store.getPlanConfig(planType, { includeCardGroups: true });
        const body = await readJson(req);
        const groups = Array.isArray(body.card_groups) ? body.card_groups : (Array.isArray(body.cardGroups) ? body.cardGroups : []);
        const after = store.setPlanCardGroups(planType, groups);
        adminAudit(store, req, {
          action: "plan_card_groups_update",
          target_type: "plan_config",
          target_id: planType,
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      const planDetail = url.pathname.match(/^\/api\/admin\/plans\/(go|plus|pro5x|pro20x)$/);
      const planReadiness = url.pathname.match(/^\/api\/admin\/plans\/(go|plus|pro5x|pro20x)\/runtime-readiness$/);
      if (req.method === "GET" && planReadiness) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: checkPlanRuntimeReadiness(store, planReadiness[1]) });
        return;
      }

      if (req.method === "GET" && planDetail) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.getPlanConfig(planDetail[1], { includeCardGroups: true }) });
        return;
      }

      if (req.method === "PATCH" && planDetail) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const planType = planDetail[1];
        const before = store.getPlanConfig(planType, { includeCardGroups: true });
        const body = await readJson(req);
        let after = store.upsertPlanConfig({ ...body, plan_type: planType });
        if (Array.isArray(body.card_groups) || Array.isArray(body.cardGroups)) {
          after = store.setPlanCardGroups(planType, body.card_groups ?? body.cardGroups);
        }
        adminAudit(store, req, {
          action: "plan_config_update",
          target_type: "plan_config",
          target_id: planType,
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/redeem/batches") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const created = store.createRedeemBatchWithCodes({
          name: body.name,
          plan_type: body.plan_type ?? body.planType,
          quantity: body.quantity,
          note: body.note,
          channel_enabled: body.channel_enabled ?? body.channelEnabled,
          channel: body.channel,
          created_by: 1,
        });
        const codes = store.listRedeemCodes({ batch_id: created.batchId });
        adminAudit(store, req, {
          action: "redeem_batch_create",
          target_type: "redeem_batch",
          target_id: String(created.batchId),
          after: { plan_type: body.plan_type ?? body.planType, quantity: body.quantity },
        });
        sendJson(res, 200, {
          ok: true,
          data: {
            batch_id: created.batchId,
            count: codes.length,
            codes,
          },
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/manual-orders") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const created = store.createManualOrder({
          ...body,
          user_ip: ip,
          user_agent: req.headers["user-agent"] || "",
          created_by: req.platformAdmin?.id ?? 1,
        });
        adminAudit(store, req, {
          action: "manual_order_create",
          target_type: "order",
          target_id: String(created.order.id),
          after: {
            order: created.order,
            manualOptions: created.manualOptions,
            runtime: created.runtime,
          },
        });
        sendJson(res, 200, { ok: true, data: created });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/redeem/batches") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.listRedeemBatches() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/redeem/codes") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const filter = {
          status: url.searchParams.get("status") || "",
          plan_type: url.searchParams.get("plan_type") || url.searchParams.get("planType") || "",
          batch_id: url.searchParams.get("batch_id") || url.searchParams.get("batchId") || "",
          q: url.searchParams.get("q") || url.searchParams.get("query") || url.searchParams.get("code") || "",
          page: Number(url.searchParams.get("page") || 1),
          page_size: Number(url.searchParams.get("page_size") || url.searchParams.get("pageSize") || 20),
        };
        sendJson(res, 200, {
          ok: true,
          data: url.searchParams.get("paginated") === "1"
            ? store.listRedeemCodesPage(filter)
            : store.listRedeemCodes({
                status: filter.status,
                plan_type: filter.plan_type,
                batch_id: filter.batch_id,
                q: filter.q,
              }),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/redeem/export") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const format = String(body.format ?? "txt").toLowerCase();
        const content = store.exportRedeemCodes({
          format,
          status: body.status,
          plan_type: body.plan_type ?? body.planType,
          batch_id: body.batch_id ?? body.batchId,
          ids: body.ids ?? body.code_ids ?? body.codeIds,
          q: body.q ?? body.query ?? body.code,
        });
        const selected = body.ids ?? body.code_ids ?? body.codeIds;
        adminAudit(store, req, {
          action: "redeem_export",
          target_type: "redeem_codes",
          target_id: "",
          after: {
            format,
            status: body.status,
            plan_type: body.plan_type ?? body.planType,
            batch_id: body.batch_id ?? body.batchId,
            selected_count: Array.isArray(selected) ? selected.length : 0,
          },
        });
        sendText(res, 200, content, exportContentType(format));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-groups") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const id = store.createCardGroup({ name: body.name, note: body.note });
        const row = store.getCardGroupById(id);
        adminAudit(store, req, {
          action: "card_group_create",
          target_type: "card_group",
          target_id: String(id),
          after: row,
        });
        sendJson(res, 200, { ok: true, data: row });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/card-groups") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.listCardGroups() });
        return;
      }

      const cardGroupAction = url.pathname.match(/^\/api\/admin\/card-groups\/(\d+)\/(delete|restore)$/);
      if (req.method === "POST" && cardGroupAction) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const groupId = Number(cardGroupAction[1]);
        const action = cardGroupAction[2];
        const before = store.getCardGroupById(groupId);
        const body = await readJson(req);
        const after = action === "delete"
          ? store.softDeleteCardGroup(groupId, 1, body.reason ?? "")
          : store.restoreCardGroup(groupId);
        adminAudit(store, req, {
          action: `card_group_${action}`,
          target_type: "card_group",
          target_id: String(groupId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      const cardGroupUpdate = url.pathname.match(/^\/api\/admin\/card-groups\/(\d+)$/);
      if (req.method === "PATCH" && cardGroupUpdate) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const groupId = Number(cardGroupUpdate[1]);
        const before = store.getCardGroupById(groupId);
        const body = await readJson(req);
        const after = store.updateCardGroup(groupId, body);
        adminAudit(store, req, {
          action: "card_group_update",
          target_type: "card_group",
          target_id: String(groupId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/cards") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const id = store.createCard(body);
        const row = store.getCardById(id);
        adminAudit(store, req, {
          action: "card_create",
          target_type: "card",
          target_id: String(id),
          after: row,
        });
        sendJson(res, 200, { ok: true, data: row });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/cards") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const includeSecret = url.searchParams.get("include_secret") === "1";
        sendJson(res, 200, {
          ok: true,
          data: store.listCards({
            status: url.searchParams.get("status") || "",
            card_group_id: url.searchParams.get("card_group_id") || url.searchParams.get("cardGroupId") || "",
          }, { includeSecret }),
        });
        return;
      }

      const cardAction = url.pathname.match(/^\/api\/admin\/cards\/(\d+)\/(disable|delete|restore|success)$/);
      if (req.method === "POST" && cardAction) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const cardId = Number(cardAction[1]);
        const action = cardAction[2];
        const before = store.getCardById(cardId, { includeSecret: true });
        const body = await readJson(req);
        let after;
        if (action === "disable") after = store.disableCard(cardId, 1);
        else if (action === "delete") after = store.softDeleteCard(cardId, 1, body.reason ?? "");
        else if (action === "success") after = store.incrementCardSuccessCount(cardId);
        else after = store.restoreCard(cardId);
        adminAudit(store, req, {
          action: `card_${action}`,
          target_type: "card",
          target_id: String(cardId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      const cardDetail = url.pathname.match(/^\/api\/admin\/cards\/(\d+)$/);
      if (req.method === "GET" && cardDetail) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.getCardById(Number(cardDetail[1]), { includeSecret: url.searchParams.get("secret") === "1" }) });
        return;
      }

      const cardUpdate = url.pathname.match(/^\/api\/admin\/cards\/(\d+)$/);
      if (req.method === "PATCH" && cardUpdate) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const cardId = Number(cardUpdate[1]);
        const before = store.getCardById(cardId, { includeSecret: true });
        const body = await readJson(req);
        const after = store.updateCard(cardId, body);
        adminAudit(store, req, {
          action: "card_update",
          target_type: "card",
          target_id: String(cardId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/card-providers/vcc/config") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.getCardProviderConfig("vcc") });
        return;
      }

      if ((req.method === "PUT" || req.method === "PATCH") && url.pathname === "/api/admin/card-providers/vcc/config") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const before = store.getCardProviderConfig("vcc");
        const body = await readJson(req);
        const after = store.setCardProviderConfig("vcc", body, 1);
        adminAudit(store, req, {
          action: "card_provider_vcc_config_update",
          target_type: "card_provider",
          target_id: "vcc",
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/test") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const provider = createVccProviderFromStore(store, fetchImpl);
        const data = await provider.getUserInfo();
        sendJson(res, 200, { ok: true, data });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/card-providers/vcc/bins") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const provider = createVccProviderFromStore(store, fetchImpl);
        sendJson(res, 200, { ok: true, data: await provider.listBins() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/card-providers/vcc/cards") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const provider = createVccProviderFromStore(store, fetchImpl);
        const cards = await provider.listCards({
          page_number: Number(url.searchParams.get("pageNumber") || url.searchParams.get("page_number") || 1),
          page_size: Number(url.searchParams.get("pageSize") || url.searchParams.get("page_size") || 100),
          all: url.searchParams.get("all") === "1",
          user_bank_id: url.searchParams.get("userBankId") || url.searchParams.get("user_bank_id") || "",
          user_bank_num: url.searchParams.get("userBankNum") || url.searchParams.get("user_bank_num") || "",
        });
        sendJson(res, 200, { ok: true, data: cards.map(publicVccCard) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/import") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        const remoteCards = await provider.listCards({
          page_number: body.page_number ?? body.pageNumber ?? 1,
          page_size: body.page_size ?? body.pageSize ?? 100,
          all: body.all === true || body.all === 1 || body.all === "1",
          user_bank_id: body.user_bank_id ?? body.userBankId ?? "",
          user_bank_num: body.user_bank_num ?? body.userBankNum ?? "",
        });
        const result = store.importProviderCards({
          provider: "vcc",
          card_group_id: body.card_group_id ?? body.cardGroupId,
          cards: remoteCards,
          priority: body.priority,
          max_success_count: body.max_success_count ?? body.maxSuccessCount,
          status: body.status ?? "enabled",
          note_prefix: body.note_prefix ?? body.notePrefix ?? "vcc",
        });
        adminAudit(store, req, {
          action: "card_provider_vcc_import",
          target_type: "card_provider",
          target_id: "vcc",
          after: {
            imported_count: result.imported_count,
            skipped_count: result.skipped_count,
            card_group_id: body.card_group_id ?? body.cardGroupId,
          },
        });
        sendJson(res, 200, { ok: true, data: result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/open-card") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        const data = await provider.openCard(body);
        adminAudit(store, req, {
          action: "card_provider_vcc_open_card",
          target_type: "card_provider",
          target_id: "vcc",
          after: { card_bin: body.card_bin ?? body.cardBin, amount: body.amount, result: vccResultSummary(data) },
        });
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(data) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/open-detail") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(await provider.getOpenCardDetail(body)) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/recharge") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        const data = await provider.rechargeCard(body);
        adminAudit(store, req, {
          action: "card_provider_vcc_recharge",
          target_type: "card_provider",
          target_id: "vcc",
          after: {
            bank_card_id: body.bank_card_id ?? body.bankCardId ?? "",
            bank_card_num: body.bank_card_num || body.bankCardNum ? "provided" : "",
            amount: body.amount,
            result: vccResultSummary(data),
          },
        });
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(data) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/recharge-detail") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(await provider.getRechargeDetail(body)) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/cancel") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        const data = await provider.cancelCard(body);
        adminAudit(store, req, {
          action: "card_provider_vcc_cancel",
          target_type: "card_provider",
          target_id: "vcc",
          after: { target: vccCardTargetSummary(body), result: sanitizeVccOperationPayload(data) },
        });
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(data) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/suspend") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        const data = await provider.suspendCard(body);
        adminAudit(store, req, {
          action: "card_provider_vcc_suspend",
          target_type: "card_provider",
          target_id: "vcc",
          after: { target: vccCardTargetSummary(body), result: sanitizeVccOperationPayload(data) },
        });
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(data) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/enable") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        const data = await provider.enableCard(body);
        adminAudit(store, req, {
          action: "card_provider_vcc_enable",
          target_type: "card_provider",
          target_id: "vcc",
          after: { target: vccCardTargetSummary(body), result: sanitizeVccOperationPayload(data) },
        });
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(data) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/cash-out") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        const data = await provider.cashOutCard(body);
        adminAudit(store, req, {
          action: "card_provider_vcc_cash_out",
          target_type: "card_provider",
          target_id: "vcc",
          after: { target: vccCardTargetSummary(body), result: vccResultSummary(data) },
        });
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(data) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/cash-out-detail") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(await provider.getCashOutDetail(body)) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/card-providers/vcc/consume-orders") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const provider = createVccProviderFromStore(store, fetchImpl);
        sendJson(res, 200, { ok: true, data: sanitizeVccOperationPayload(await provider.listConsumeOrders(body)) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/proxy-groups") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const id = store.createProxyGroup(body);
        const row = store.getProxyGroupById(id);
        adminAudit(store, req, {
          action: "proxy_group_create",
          target_type: "proxy_group",
          target_id: String(id),
          after: row,
        });
        sendJson(res, 200, { ok: true, data: row });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/proxy-groups") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, {
          ok: true,
          data: store.listProxyGroups({
            kind: url.searchParams.get("kind") || "",
            provider: url.searchParams.get("provider") || "",
          }),
        });
        return;
      }

      const proxyGroupAction = url.pathname.match(/^\/api\/admin\/proxy-groups\/(\d+)\/(delete|restore)$/);
      if (req.method === "POST" && proxyGroupAction) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const groupId = Number(proxyGroupAction[1]);
        const action = proxyGroupAction[2];
        const before = store.getProxyGroupById(groupId);
        const body = await readJson(req);
        const after = action === "delete"
          ? store.softDeleteProxyGroup(groupId, 1, body.reason ?? "")
          : store.restoreProxyGroup(groupId);
        adminAudit(store, req, {
          action: `proxy_group_${action}`,
          target_type: "proxy_group",
          target_id: String(groupId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      const proxyGroupDetail = url.pathname.match(/^\/api\/admin\/proxy-groups\/(\d+)$/);
      if (req.method === "GET" && proxyGroupDetail) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.getProxyGroupById(Number(proxyGroupDetail[1])) });
        return;
      }

      const proxyGroupTest = url.pathname.match(/^\/api\/admin\/proxy-groups\/(\d+)\/test$/);
      if (req.method === "POST" && proxyGroupTest) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const group = store.getProxyGroupById(Number(proxyGroupTest[1]));
        const result = await selectProxyForAttemptAsync(group, {
          attemptIndex: body.attempt_index ?? body.attemptIndex ?? 0,
          fetchImpl,
        });
        const connectivity = result.proxyUrl
          ? await proxyConnectivityTester(result.proxyUrl, {
              test_url: body.test_url ?? body.testUrl,
              timeout_ms: body.timeout_ms ?? body.timeoutMs,
            })
          : {
              ok: false,
              message: result.reason ? `代理组没有可测试的代理：${result.reason}` : "代理组没有可测试的代理",
            };
        sendJson(res, 200, {
          ok: !result.reason && connectivity.ok === true,
          data: {
            provider: result.provider,
            kind: result.kind,
            reason: result.reason,
            error: result.error,
            redactedProxyUrl: result.redactedProxyUrl,
            api: result.api,
            ipwo: result.ipwo,
            connectivity,
          },
          message: connectivity.message,
        });
        return;
      }

      if (req.method === "PATCH" && proxyGroupDetail) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const groupId = Number(proxyGroupDetail[1]);
        const before = store.getProxyGroupById(groupId);
        const body = await readJson(req);
        const after = store.updateProxyGroup(groupId, body);
        adminAudit(store, req, {
          action: "proxy_group_update",
          target_type: "proxy_group",
          target_id: String(groupId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/billing-groups") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const id = store.createBillingGroup({ name: body.name, note: body.note });
        const row = store.getBillingGroupById(id);
        adminAudit(store, req, {
          action: "billing_group_create",
          target_type: "billing_group",
          target_id: String(id),
          after: row,
        });
        sendJson(res, 200, { ok: true, data: row });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/billing-groups") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.listBillingGroups() });
        return;
      }

      const billingGroupAction = url.pathname.match(/^\/api\/admin\/billing-groups\/(\d+)\/(delete|restore)$/);
      if (req.method === "POST" && billingGroupAction) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const groupId = Number(billingGroupAction[1]);
        const action = billingGroupAction[2];
        const before = store.getBillingGroupById(groupId);
        const body = await readJson(req);
        const after = action === "delete"
          ? store.softDeleteBillingGroup(groupId, 1, body.reason ?? "")
          : store.restoreBillingGroup(groupId);
        adminAudit(store, req, {
          action: `billing_group_${action}`,
          target_type: "billing_group",
          target_id: String(groupId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      const billingGroupUpdate = url.pathname.match(/^\/api\/admin\/billing-groups\/(\d+)$/);
      if (req.method === "PATCH" && billingGroupUpdate) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const groupId = Number(billingGroupUpdate[1]);
        const before = store.getBillingGroupById(groupId);
        const body = await readJson(req);
        const after = store.updateBillingGroup(groupId, body);
        adminAudit(store, req, {
          action: "billing_group_update",
          target_type: "billing_group",
          target_id: String(groupId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/billing-addresses") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const body = await readJson(req);
        const id = store.createBillingAddress(body);
        const row = store.getBillingAddressById(id);
        adminAudit(store, req, {
          action: "billing_address_create",
          target_type: "billing_address",
          target_id: String(id),
          after: row,
        });
        sendJson(res, 200, { ok: true, data: row });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/billing-addresses") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, {
          ok: true,
          data: store.listBillingAddresses({
            status: url.searchParams.get("status") || "",
            billing_group_id: url.searchParams.get("billing_group_id") || url.searchParams.get("billingGroupId") || "",
          }),
        });
        return;
      }

      const billingAddressAction = url.pathname.match(/^\/api\/admin\/billing-addresses\/(\d+)\/(disable|delete|restore)$/);
      if (req.method === "POST" && billingAddressAction) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const addressId = Number(billingAddressAction[1]);
        const action = billingAddressAction[2];
        const before = store.getBillingAddressById(addressId);
        const body = await readJson(req);
        let after;
        if (action === "disable") after = store.disableBillingAddress(addressId, 1);
        else if (action === "delete") after = store.softDeleteBillingAddress(addressId, 1, body.reason ?? "");
        else after = store.restoreBillingAddress(addressId);
        adminAudit(store, req, {
          action: `billing_address_${action}`,
          target_type: "billing_address",
          target_id: String(addressId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      const billingAddressUpdate = url.pathname.match(/^\/api\/admin\/billing-addresses\/(\d+)$/);
      if (req.method === "PATCH" && billingAddressUpdate) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const addressId = Number(billingAddressUpdate[1]);
        const before = store.getBillingAddressById(addressId);
        const body = await readJson(req);
        const after = store.updateBillingAddress(addressId, body);
        adminAudit(store, req, {
          action: "billing_address_update",
          target_type: "billing_address",
          target_id: String(addressId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      const redeemAction = url.pathname.match(/^\/api\/admin\/redeem\/codes\/(\d+)\/(disable|delete|restore|restore-status)$/);
      if (req.method === "POST" && redeemAction) {
        if (!requireAdmin(req, res, adminToken, url)) return;
        const codeId = Number(redeemAction[1]);
        const action = redeemAction[2];
        const before = store.getRedeemCodeById(codeId);
        const body = await readJson(req);
        let after;
        if (action === "disable") after = store.disableRedeemCode(codeId, 1);
        else if (action === "delete") after = store.softDeleteRedeemCode(codeId, 1, body.reason ?? "");
        else if (action === "restore-status") after = store.restoreRedeemCodeStatus(codeId, 1);
        else after = store.restoreRedeemCode(codeId);
        adminAudit(store, req, {
          action: `redeem_code_${action}`,
          target_type: "redeem_code",
          target_id: String(codeId),
          before,
          after,
        });
        sendJson(res, 200, { ok: true, data: after });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/audit-logs") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        sendJson(res, 200, { ok: true, data: store.listAuditLogs() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/events") {
        if (!requireAdmin(req, res, adminToken, url)) return;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "connection": "keep-alive",
          "x-accel-buffering": "no",
        });
        writeSse(res, "queue.snapshot", dashboardSnapshotWithWorker(store, workerStatusProvider).queue);
        const heartbeat = setInterval(() => writeSse(res, "ping", {}), 15_000);
        req.on("close", () => clearInterval(heartbeat));
        return;
      }

      sendError(res, 404, "NOT_FOUND", "接口不存在");
    } catch (error) {
      const mapped = mapStoreError(error);
      sendError(res, mapped.statusCode, mapped.code, mapped.message, mapped.details ?? {});
    }
  };
}

export function listenPlatformServer(options = {}) {
  const store = options.store;
  const queueAdapterFactory = options.queueAdapterFactory ?? (store ? createPlatformPaymentAdapterFactory({ store }) : undefined);
  let queueWorker = null;
  let lastWorkerEvent = null;
  const workerStatusProvider = () => ({
    enabled: options.autoQueueWorker === true,
    started: queueWorker?.started === true,
    busy: queueWorker?.running === true,
    interval_ms: queueWorker?.intervalMs ?? Number(options.queueWorkerIntervalMs ?? 0),
    last_event: lastWorkerEvent,
  });
  const server = createServer(createPlatformRequestHandler({
    ...options,
    queueAdapterFactory,
    workerStatusProvider,
  }));
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      if (options.autoQueueWorker === true) {
        queueWorker = new PlatformQueueWorker({
          store,
          adapterFactory: queueAdapterFactory,
          intervalMs: options.queueWorkerIntervalMs ?? 1000,
          recoverRunningOnStart: options.recoverRunningOnStart === true,
          logger: (event) => {
            lastWorkerEvent = summarizeWorkerEvent(event);
            if (typeof options.queueWorkerLogger === "function") options.queueWorkerLogger(event);
          },
        }).start();
      }
      const address = server.address();
      resolve({
        server,
        host,
        port: address.port,
        url: `http://${host}:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => {
          if (queueWorker) queueWorker.stop();
          server.close((error) => error ? closeReject(error) : closeResolve());
        }),
      });
    });
  });
}

export function adminQueueEventFromOrder(order) {
  return {
    order_id: order.order_no,
    status: order.status ?? OrderStatus.CREATED,
    stage: order.stage ?? "",
  };
}

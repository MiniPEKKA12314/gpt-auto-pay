import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { listenPlatformServer } from "../../src/platform/server.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await delay(25);
  }
  return fn();
}

async function createTestApp(options = {}) {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { adminPassword: options.adminPassword });
  store.createRedeemBatchWithCodes({
    name: "server test",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-SERVER-1",
  }, 10);
  const app = await listenPlatformServer({
    store,
    adminToken: options.adminToken ?? "",
    queueAdapterFactory: options.queueAdapterFactory,
    fetchImpl: options.fetchImpl,
    autoQueueWorker: options.autoQueueWorker,
    queueWorkerIntervalMs: options.queueWorkerIntervalMs,
    recoverRunningOnStart: options.recoverRunningOnStart,
    proxyConnectivityTester: options.proxyConnectivityTester,
  });
  return {
    ...app,
    store,
    async closeAll() {
      await app.close();
      store.close();
    },
  };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

test("public API redeems a code, returns status, and supports recover", async () => {
  const app = await createTestApp();
  try {
    const index = await fetch(`${app.url}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /gpt-auto-pay platform API/);

    const dev = await fetch(`${app.url}/dev`);
    assert.equal(dev.status, 200);
    assert.match(await dev.text(), /用户前台测试/);

    const redeemed = await jsonFetch(`${app.url}/api/public/redeem`, {
      method: "POST",
      body: JSON.stringify({
        code: "PLUS-SERVER-1",
        accessToken: "access-token-secret",
        sessionToken: "session-token-secret",
      }),
    });
    assert.equal(redeemed.response.status, 200);
    assert.equal(redeemed.body.ok, true);
    assert.equal(redeemed.body.data.plan_name, "Plus");
    assert.equal(redeemed.body.data.status, "queued");
    assert.equal(redeemed.body.data.message, "排队中");

    const orderId = redeemed.body.data.order_id;
    const orderRow = app.store.getOrderByNo(orderId);
    const runtime = app.store.getOrderRuntimeSecrets(orderRow.id, { includeSecret: true });
    assert.equal(runtime.accessToken, "access-token-secret");
    assert.equal(runtime.sessionToken, "session-token-secret");

    const status = await jsonFetch(`${app.url}/api/public/orders/${orderId}`);
    assert.equal(status.response.status, 200);
    assert.equal(status.body.data.order_id, orderId);

    const recover = await jsonFetch(`${app.url}/api/public/recover`, {
      method: "POST",
      body: JSON.stringify({ code: "PLUS-SERVER-1" }),
    });
    assert.equal(recover.response.status, 200);
    assert.equal(recover.body.data.order_id, orderId);
  } finally {
    await app.closeAll();
  }
});

test("public redeem endpoint rate limits repeated code submissions", async () => {
  const app = await createTestApp();
  try {
    const first = await jsonFetch(`${app.url}/api/public/redeem`, {
      method: "POST",
      body: JSON.stringify({ code: "PLUS-SERVER-1" }),
    });
    assert.equal(first.response.status, 200);

    const second = await jsonFetch(`${app.url}/api/public/redeem`, {
      method: "POST",
      body: JSON.stringify({ code: "PLUS-SERVER-1" }),
    });
    assert.equal(second.response.status, 429);
    assert.equal(second.body.code, "RATE_LIMITED");
  } finally {
    await app.closeAll();
  }
});

test("admin dashboard requires token when configured", async () => {
  const app = await createTestApp({ adminToken: "admin-token" });
  try {
    const denied = await jsonFetch(`${app.url}/api/admin/dashboard`);
    assert.equal(denied.response.status, 401);

    const allowed = await jsonFetch(`${app.url}/api/admin/dashboard`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.ok, true);
    assert.equal(allowed.body.data.redeem_codes.unused, 1);
  } finally {
    await app.closeAll();
  }
});

test("admin login creates a session cookie for browser admin APIs", async () => {
  const app = await createTestApp({ adminPassword: "Strong-Test-Password-2026!" });
  try {
    const adminUi = await fetch(`${app.url}/admin`);
    assert.equal(adminUi.status, 200);
    const adminHtml = await adminUi.text();
    assert.match(adminHtml, /id="orderQuery"/);
    assert.match(adminHtml, /id="selectedCodesExport"/);
    assert.match(adminHtml, /id="paymentCountryOptions"/);
    assert.match(adminHtml, /id="cardSecretDialog"/);
    assert.match(adminHtml, /id="autoRefreshState"/);
    assert.match(adminHtml, /id="queueWorkerState"/);
    assert.match(adminHtml, /data-tab="manual"/);
    assert.match(adminHtml, /id="manualOrderForm"/);
    assert.match(adminHtml, /id="planCheckoutMaxProxy"/);
    assert.match(adminHtml, /auto_unfreeze_before_use/);
    assert.match(adminHtml, /vccImportAutoFreezeSuccess/);
    assert.match(adminHtml, /id="proxyEditForm"/);
    assert.match(adminHtml, /data-proxy-group-edit/);
    assert.match(adminHtml, /order-log-line/);
    assert.match(adminHtml, /账单组<\/th><th>地区/);
    const adminScript = adminHtml.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
    assert.doesNotThrow(() => new Function(adminScript));

    const denied = await jsonFetch(`${app.url}/api/admin/dashboard`);
    assert.equal(denied.response.status, 401);

    const login = await jsonFetch(`${app.url}/api/admin/login`, {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "Strong-Test-Password-2026!",
      }),
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.ok, true);
    const cookie = login.response.headers.get("set-cookie");
    assert.match(cookie, /gpt_auto_pay_admin=/);

    const me = await jsonFetch(`${app.url}/api/admin/me`, {
      headers: { cookie },
    });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.data.username, "admin");
    assert.equal(me.body.data.method, "session");

    const dashboard = await jsonFetch(`${app.url}/api/admin/dashboard`, {
      headers: { cookie },
    });
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.body.data.redeem_codes.unused, 1);

    const logout = await jsonFetch(`${app.url}/api/admin/logout`, {
      method: "POST",
      headers: { cookie },
      body: "{}",
    });
    assert.equal(logout.response.status, 200);
  } finally {
    await app.closeAll();
  }
});

test("admin redeem APIs generate, filter, export, disable, delete, and restore codes", async () => {
  const app = await createTestApp({ adminToken: "admin-token" });
  try {
    const batch = await jsonFetch(`${app.url}/api/admin/redeem/batches`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        name: "pro5x admin batch",
        plan_type: "pro5x",
        quantity: 2,
        note: "admin api test",
      }),
    });
    assert.equal(batch.response.status, 200);
    assert.equal(batch.body.data.count, 2);
    assert.equal(batch.body.data.codes.every((code) => code.code_display.startsWith("PRO5X-")), true);
    const batchId = batch.body.data.batch_id;
    const firstCodeId = batch.body.data.codes[0].id;
    const secondCodeId = batch.body.data.codes[1].id;

    const batches = await jsonFetch(`${app.url}/api/admin/redeem/batches`, {
      headers: { "x-admin-token": "admin-token" },
    });
    const createdBatch = batches.body.data.find((row) => row.id === batchId);
    assert.equal(createdBatch.stats.unused, 2);
    assert.equal(createdBatch.stats.total, 2);

    const filtered = await jsonFetch(`${app.url}/api/admin/redeem/codes?status=unused&batch_id=${batchId}`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(filtered.body.data.length, 2);

    const searchedPage = await jsonFetch(`${app.url}/api/admin/redeem/codes?paginated=1&page=1&page_size=1&q=PRO5X-&batch_id=${batchId}`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(searchedPage.body.data.total, 2);
    assert.equal(searchedPage.body.data.rows.length, 1);
    assert.equal(searchedPage.body.data.page_size, 1);

    const exported = await fetch(`${app.url}/api/admin/redeem/export`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "admin-token" },
      body: JSON.stringify({ format: "txt", batch_id: batchId }),
    });
    assert.equal(exported.status, 200);
    assert.match(await exported.text(), /PRO5X-/);

    const selectedExport = await fetch(`${app.url}/api/admin/redeem/export`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-token": "admin-token" },
      body: JSON.stringify({ format: "json", ids: [secondCodeId, firstCodeId] }),
    });
    assert.equal(selectedExport.status, 200);
    assert.deepEqual((await selectedExport.json()).map((code) => code.id), [secondCodeId, firstCodeId]);

    const disabled = await jsonFetch(`${app.url}/api/admin/redeem/codes/${firstCodeId}/disable`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(disabled.body.data.status, "disabled");

    const restoredStatus = await jsonFetch(`${app.url}/api/admin/redeem/codes/${firstCodeId}/restore-status`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(restoredStatus.body.data.status, "unused");

    const deleted = await jsonFetch(`${app.url}/api/admin/redeem/codes/${secondCodeId}/delete`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "local test" }),
    });
    assert.ok(deleted.body.data.deleted_at > 0);

    const afterDelete = await jsonFetch(`${app.url}/api/admin/redeem/codes?batch_id=${batchId}`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.deepEqual(afterDelete.body.data.map((code) => code.id), [firstCodeId]);

    const restored = await jsonFetch(`${app.url}/api/admin/redeem/codes/${secondCodeId}/restore`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(restored.body.data.deleted_at, 0);

    assert.deepEqual(
      app.store.listAuditLogs().map((row) => row.action),
      [
        "redeem_batch_create",
        "redeem_export",
        "redeem_export",
        "redeem_code_disable",
        "redeem_code_restore-status",
        "redeem_code_delete",
        "redeem_code_restore",
      ],
    );
  } finally {
    await app.closeAll();
  }
});

test("admin plan APIs list and update plan runtime configuration", async () => {
  const app = await createTestApp({ adminToken: "admin-token" });
  try {
    const plans = await jsonFetch(`${app.url}/api/admin/plans`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(plans.response.status, 200);
    assert.deepEqual(plans.body.data.map((plan) => plan.plan_type), ["go", "plus", "pro20x", "pro5x"]);

    const firstGroup = await jsonFetch(`${app.url}/api/admin/card-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "first group" }),
    });
    const secondGroup = await jsonFetch(`${app.url}/api/admin/card-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "second group" }),
    });

    const updated = await jsonFetch(`${app.url}/api/admin/plans/plus`, {
      method: "PATCH",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        payment_country: "PH",
        payment_currency: "PHP",
        billing_group_id: 3,
        checkout_max_proxy_attempts: 5,
        max_proxy_attempts_per_card: 6,
        allow_card_switch: true,
        max_card_switches: 2,
        card_groups: [
          { card_group_id: firstGroup.body.data.id, priority: 20 },
          { card_group_id: secondGroup.body.data.id, priority: 10 },
        ],
      }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.payment_country, "PH");
    assert.equal(updated.body.data.checkout_max_proxy_attempts, 5);
    assert.equal(updated.body.data.allow_card_switch, 1);
    assert.deepEqual(
      updated.body.data.card_groups.map((group) => [group.card_group_id, group.priority]),
      [[secondGroup.body.data.id, 10], [firstGroup.body.data.id, 20]],
    );

    const cardGroupsOnly = await jsonFetch(`${app.url}/api/admin/plans/plus/card-groups`, {
      method: "PUT",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        card_groups: [{ card_group_id: firstGroup.body.data.id, priority: 1 }],
      }),
    });
    assert.deepEqual(
      cardGroupsOnly.body.data.card_groups.map((group) => [group.card_group_id, group.priority]),
      [[firstGroup.body.data.id, 1]],
    );

    const detail = await jsonFetch(`${app.url}/api/admin/plans/plus`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(detail.body.data.payment_currency, "PHP");
    assert.equal(detail.body.data.card_groups.length, 1);

    const readiness = await jsonFetch(`${app.url}/api/admin/plans/plus/runtime-readiness`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(readiness.response.status, 200);
    assert.equal(readiness.body.data.ok, false);
    assert.match(readiness.body.data.issues.join("\n"), /账单地址组里没有可用账单地址/);
  } finally {
    await app.closeAll();
  }
});

test("admin queue APIs manage settings, dispatch, orders, and termination", async () => {
  const app = await createTestApp({ adminToken: "admin-token" });
  try {
    const redeemed = await jsonFetch(`${app.url}/api/public/redeem`, {
      method: "POST",
      body: JSON.stringify({ code: "PLUS-SERVER-1" }),
    });
    const orderNo = redeemed.body.data.order_id;
    const order = app.store.getOrderByNo(orderNo);

    const queuedDashboard = await jsonFetch(`${app.url}/api/admin/dashboard`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(queuedDashboard.body.data.queued_orders.length, 1);
    assert.equal(queuedDashboard.body.data.queued_orders[0].order_no, orderNo);
    assert.equal(queuedDashboard.body.data.queued_orders[0].redeem_code, "PLUS-SERVER-1");
    assert.equal(queuedDashboard.body.data.queued_orders[0].status, "queued");

    const settings = await jsonFetch(`${app.url}/api/admin/queue/settings`, {
      method: "PATCH",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ global_concurrency: 2 }),
    });
    assert.equal(settings.body.data.global_concurrency, 2);

    const paused = await jsonFetch(`${app.url}/api/admin/queue/pause`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(paused.body.data.status, "paused");

    const dispatchWhilePaused = await jsonFetch(`${app.url}/api/admin/queue/dispatch`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(dispatchWhilePaused.body.data.length, 0);

    await jsonFetch(`${app.url}/api/admin/queue/resume`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    const dispatched = await jsonFetch(`${app.url}/api/admin/queue/dispatch`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.deepEqual(dispatched.body.data.map((row) => row.order_no), [orderNo]);

    const runningOrders = await jsonFetch(`${app.url}/api/admin/orders?status=running`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(runningOrders.body.data.length, 1);
    assert.equal(runningOrders.body.data[0].redeem_code, "PLUS-SERVER-1");

    const searchedOrders = await jsonFetch(`${app.url}/api/admin/orders?q=PLUS-SERVER-1`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.deepEqual(searchedOrders.body.data.map((row) => row.order_no), [orderNo]);

    const dashboard = await jsonFetch(`${app.url}/api/admin/dashboard`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(dashboard.body.data.recent_orders[0].redeem_code, "PLUS-SERVER-1");

    const terminated = await jsonFetch(`${app.url}/api/admin/orders/${order.id}/terminate`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "local test" }),
    });
    assert.equal(terminated.body.data.order.status, "failed");
    assert.equal(terminated.body.data.redeemCode.status, "unused");
    app.store.addRunLog({
      order_id: order.id,
      level: "error",
      stage: "direct_card",
      message: "local detail log",
    }, 100);
    const detail = await jsonFetch(`${app.url}/api/admin/orders/${order.id}/details`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.order.order_no, orderNo);
    assert.equal(detail.body.data.logs.some((log) => log.message === "local detail log"), true);

    const deleted = await jsonFetch(`${app.url}/api/admin/orders/${order.id}/delete`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "hide from recent" }),
    });
    assert.equal(deleted.response.status, 200);
    assert.ok(deleted.body.data.deleted_at > 0);
    const afterDeleteOrders = await jsonFetch(`${app.url}/api/admin/orders?q=${encodeURIComponent(orderNo)}`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(afterDeleteOrders.body.data.length, 0);
    const afterDeleteDashboard = await jsonFetch(`${app.url}/api/admin/dashboard`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(afterDeleteDashboard.body.data.recent_orders.some((row) => row.order_no === orderNo), false);
    assert.match(app.store.listAuditLogs().map((row) => row.action).join(","), /queue_settings_update/);
    assert.match(app.store.listAuditLogs().map((row) => row.action).join(","), /order_terminate/);
    assert.match(app.store.listAuditLogs().map((row) => row.action).join(","), /order_delete/);
  } finally {
    await app.closeAll();
  }
});

test("admin queue process-once executes queued orders through the configured worker adapter", async () => {
  let workerCalls = 0;
  const app = await createTestApp({
    adminToken: "admin-token",
    queueAdapterFactory: async () => ({
      async execute() {
        workerCalls += 1;
        return { status: "success", message: "worker processed" };
      },
    }),
  });
  try {
    const cardGroupId = app.store.createCardGroup({ name: "server worker cards" }, 10);
    app.store.createCard({
      card_group_id: cardGroupId,
      number: "4242424242424242",
      exp_month: "12",
      exp_year: "2030",
      cvc: "123",
      max_success_count: 10,
    }, 11);
    const billingGroupId = app.store.createBillingGroup({ name: "server worker billing" }, 12);
    app.store.createBillingAddress({
      billing_group_id: billingGroupId,
      name: "Worker User",
      country: "US",
      city: "Los Angeles",
      line1: "1 Worker Ave",
      postal_code: "90001",
    }, 13);
    app.store.upsertPlanConfig({ plan_type: "plus", billing_group_id: billingGroupId }, 14);
    app.store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 15);

    const redeemed = await jsonFetch(`${app.url}/api/public/redeem`, {
      method: "POST",
      body: JSON.stringify({ code: "PLUS-SERVER-1" }),
    });
    assert.equal(redeemed.response.status, 200);
    const orderNo = redeemed.body.data.order_id;

    await jsonFetch(`${app.url}/api/admin/queue/pause`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    const processed = await jsonFetch(`${app.url}/api/admin/queue/process-once`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(processed.response.status, 200);
    assert.equal(processed.body.data.results[0].ok, true);
    assert.equal(workerCalls, 1);
    const completedOrder = app.store.getOrderByNo(orderNo);
    assert.equal(completedOrder.status, "succeeded");
    const details = await jsonFetch(`${app.url}/api/admin/orders/${completedOrder.id}/details`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(details.response.status, 200);
    assert.equal(details.body.data.order.status, "succeeded");
    assert.equal(details.body.data.attempts.length, 1);
    assert.equal(details.body.data.logs.some((log) => /worker processed/.test(log.message)), true);
    assert.equal(Object.hasOwn(details.body.data.runtime ?? {}, "accessToken"), false);
    assert.match(app.store.listAuditLogs().map((row) => row.action).join(","), /queue_process_once/);
  } finally {
    await app.closeAll();
  }
});

test("auto queue worker consumes queued orders when enabled", async () => {
  let workerCalls = 0;
  const app = await createTestApp({
    adminToken: "admin-token",
    autoQueueWorker: true,
    queueWorkerIntervalMs: 25,
    queueAdapterFactory: async () => ({
      async execute() {
        workerCalls += 1;
        return { status: "success", message: "auto worker processed" };
      },
    }),
  });
  try {
    const cardGroupId = app.store.createCardGroup({ name: "auto worker cards" }, 10);
    app.store.createCard({
      card_group_id: cardGroupId,
      number: "4242424242424242",
      exp_month: "12",
      exp_year: "2030",
      cvc: "123",
      max_success_count: 10,
    }, 11);
    const billingGroupId = app.store.createBillingGroup({ name: "auto worker billing" }, 12);
    app.store.createBillingAddress({
      billing_group_id: billingGroupId,
      name: "Auto Worker User",
      country: "US",
      city: "Los Angeles",
      line1: "1 Auto Ave",
      postal_code: "90001",
    }, 13);
    app.store.upsertPlanConfig({ plan_type: "plus", billing_group_id: billingGroupId }, 14);
    app.store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 15);

    const redeemed = await jsonFetch(`${app.url}/api/public/redeem`, {
      method: "POST",
      body: JSON.stringify({ code: "PLUS-SERVER-1" }),
    });
    assert.equal(redeemed.response.status, 200);
    const orderNo = redeemed.body.data.order_id;
    const completedOrder = await waitFor(() => {
      const row = app.store.getOrderByNo(orderNo);
      return row.status === "succeeded" ? row : null;
    });
    assert.equal(completedOrder.status, "succeeded");
    assert.equal(workerCalls, 1);

    const dashboard = await jsonFetch(`${app.url}/api/admin/dashboard`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(dashboard.body.data.queue.worker.enabled, true);
    assert.equal(dashboard.body.data.queue.worker.started, true);
    assert.equal(dashboard.body.data.queue.worker.last_event.type, "tick");
  } finally {
    await app.closeAll();
  }
});

test("admin manual order API creates a queued order with selected resources", async () => {
  let observed = null;
  const app = await createTestApp({
    adminToken: "admin-token",
    queueAdapterFactory: async ({ card, billingAddress }) => ({
      async execute() {
        observed = { card, billingAddress };
        return { status: "success", message: "manual processed" };
      },
    }),
  });
  try {
    const cardGroupId = app.store.createCardGroup({ name: "manual api cards" }, 10);
    const cardId = app.store.createCard({
      card_group_id: cardGroupId,
      number: "5555555555554444",
      exp_month: "11",
      exp_year: "2031",
      cvc: "222",
      max_success_count: 10,
    }, 11);
    const billingGroupId = app.store.createBillingGroup({ name: "manual api billing" }, 12);
    const billingAddressId = app.store.createBillingAddress({
      billing_group_id: billingGroupId,
      name: "Manual API User",
      country: "US",
      city: "Los Angeles",
      line1: "2 Manual Ave",
      postal_code: "90001",
    }, 13);

    const manual = await jsonFetch(`${app.url}/api/admin/manual-orders`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        plan_type: "plus",
        card_group_id: cardGroupId,
        card_id: cardId,
        billing_group_id: billingGroupId,
        billing_address_id: billingAddressId,
        access_token: "manual-at",
        session_token: "manual-session",
        account_label: "manual@example.test",
      }),
    });
    assert.equal(manual.response.status, 200);
    assert.equal(manual.body.data.order.status, "queued");
    assert.equal(manual.body.data.manualOptions.card_id, cardId);
    assert.equal(manual.body.data.runtime.has_access_token, true);
    assert.equal(app.store.listRedeemCodes({ q: "MANUAL" }).length, 0);

    const processed = await jsonFetch(`${app.url}/api/admin/queue/process-once`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(processed.response.status, 200);
    assert.equal(processed.body.data.results[0].ok, true);
    assert.equal(observed.card.id, cardId);
    assert.equal(observed.billingAddress.id, billingAddressId);
    assert.match(app.store.listAuditLogs().map((row) => row.action).join(","), /manual_order_create/);
  } finally {
    await app.closeAll();
  }
});

test("admin card APIs manage groups, encrypted cards, and audit actions", async () => {
  const app = await createTestApp({ adminToken: "admin-token" });
  try {
    const group = await jsonFetch(`${app.url}/api/admin/card-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "primary cards", note: "api" }),
    });
    assert.equal(group.response.status, 200);
    const groupId = group.body.data.id;

    const card = await jsonFetch(`${app.url}/api/admin/cards`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        card_group_id: groupId,
        number: "4242424242421234",
        exp_month: "12",
        exp_year: "2030",
        cvc: "123",
        priority: 1,
        max_success_count: 10,
        provider: "vcc",
        provider_card_id: "remote-server-1",
        auto_unfreeze_before_use: true,
        auto_freeze_after_success: true,
        auto_freeze_after_failure: true,
      }),
    });
    assert.equal(card.response.status, 200);
    assert.equal(card.body.data.masked_number, "4242 **** **** 1234");
    assert.equal(card.body.data.provider, "vcc");
    assert.equal(card.body.data.provider_card_id, "remote-server-1");
    assert.equal(card.body.data.auto_unfreeze_before_use, 1);
    assert.equal(card.body.data.auto_freeze_after_success, 1);
    assert.equal(card.body.data.auto_freeze_after_failure, 1);
    assert.equal(Object.hasOwn(card.body.data, "number"), false);
    const cardId = card.body.data.id;

    const detail = await jsonFetch(`${app.url}/api/admin/cards/${cardId}?secret=1`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(detail.body.data.number, "4242424242421234");
    assert.equal(detail.body.data.cvc, "123");

    const disabledCard = await jsonFetch(`${app.url}/api/admin/cards/${cardId}/disable`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(disabledCard.body.data.status, "disabled");

    const restoredDisabledCard = await jsonFetch(`${app.url}/api/admin/cards/${cardId}/restore`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(restoredDisabledCard.body.data.status, "enabled");

    const success = await jsonFetch(`${app.url}/api/admin/cards/${cardId}/success`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(success.body.data.success_count, 1);

    const deleted = await jsonFetch(`${app.url}/api/admin/cards/${cardId}/delete`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "local" }),
    });
    assert.ok(deleted.body.data.deleted_at > 0);

    const restored = await jsonFetch(`${app.url}/api/admin/cards/${cardId}/restore`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(restored.body.data.deleted_at, 0);

    const groupDeleted = await jsonFetch(`${app.url}/api/admin/card-groups/${groupId}/delete`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "remove group" }),
    });
    assert.ok(groupDeleted.body.data.deleted_at > 0);
    assert.ok(app.store.getCardById(cardId).deleted_at > 0);

    const recreatedGroup = await jsonFetch(`${app.url}/api/admin/card-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "primary cards", note: "same name after delete" }),
    });
    assert.equal(recreatedGroup.response.status, 200);
    const duplicateGroup = await jsonFetch(`${app.url}/api/admin/card-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "primary cards" }),
    });
    assert.equal(duplicateGroup.response.status, 400);
    assert.equal(duplicateGroup.body.message, "卡组名称已存在，请换一个名称");
    assert.deepEqual(
      app.store.listAuditLogs().map((row) => row.action),
      ["card_group_create", "card_create", "card_disable", "card_restore", "card_success", "card_delete", "card_restore", "card_group_delete", "card_group_create"],
    );
  } finally {
    await app.closeAll();
  }
});

test("admin VCC provider APIs save config, list masked remote cards, and import into local card pool", async () => {
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options });
    if (url.includes("/bank_card/user_info")) {
      return new Response(JSON.stringify({ code: 0, content: { name: "vcc user", balance: "88.00" } }), { status: 200 });
    }
    if (url.includes("/bank_card/my_cards_page")) {
      return new Response(JSON.stringify({
        code: 0,
        rows: [
          {
            id: "remote-card-1",
            organization: "VISA",
            state: "1",
            number: "5572710152044444",
            expiryDate: "10/25",
            cvv: "456",
            remark: "api card",
            cardBalance: "100",
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/bank_card/enable_bin")) {
      return new Response(JSON.stringify({ code: 0, content: [{ bin: "491090", enable: true }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 0, content: {} }), { status: 200 });
  };
  const app = await createTestApp({ adminToken: "admin-token", fetchImpl });
  try {
    const config = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/config`, {
      method: "PUT",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        base_url: "http://api.vcc.center",
        user_serial: "user-serial",
        secret_key: "secret-key",
        timeout_ms: 5000,
      }),
    });
    assert.equal(config.response.status, 200);
    assert.equal(config.body.data.secret_configured, true);
    assert.equal(Object.hasOwn(config.body.data, "secret_key"), false);

    const testInfo = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/test`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(testInfo.body.data.balance, "88.00");

    const remoteCards = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/cards?all=1`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(remoteCards.body.data[0].masked_number, "5572 **** **** 4444");
    assert.equal(Object.hasOwn(remoteCards.body.data[0], "number"), false);
    assert.equal(Object.hasOwn(remoteCards.body.data[0], "cvc"), false);

    const bins = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/bins`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(bins.body.data[0].bin, "491090");

    const group = await jsonFetch(`${app.url}/api/admin/card-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "vcc imported" }),
    });
    const imported = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/import`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ card_group_id: group.body.data.id, max_success_count: 3, all: true }),
    });
    assert.equal(imported.body.data.imported_count, 1);
    const cardId = imported.body.data.imported[0].id;
    const detail = app.store.getCardById(cardId, { includeSecret: true });
    assert.equal(detail.number, "5572710152044444");
    assert.equal(detail.cvc, "456");
    assert.equal(detail.max_success_count, 3);
    assert.equal(fetchCalls.some((call) => String(call.url).includes("sign=")), true);
  } finally {
    await app.closeAll();
  }
});

test("admin VCC management APIs expose card operation controls with sanitized output", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    if (path === "/bank_card/recharge" || path === "/bank_card/recharge_detail") {
      return new Response(JSON.stringify({
        code: 0,
        content: {
          id: "recharge-1",
          state: 10,
          bankCard: { number: "5572710152044444", cvv: "456" },
        },
      }), { status: 200 });
    }
    if (path === "/bank_card/consume_order") {
      return new Response(JSON.stringify({
        code: 0,
        rows: [{ id: "tx-1", number: "5572710152044444", type: "Recharge" }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 0, content: { id: "op-1", state: 10 } }), { status: 200 });
  };
  const app = await createTestApp({ adminToken: "admin-token", fetchImpl });
  try {
    await jsonFetch(`${app.url}/api/admin/card-providers/vcc/config`, {
      method: "PUT",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ user_serial: "user-serial", secret_key: "secret-key" }),
    });

    const open = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/open-card`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ cardBin: "491090", amount: "10" }),
    });
    assert.equal(open.response.status, 200);

    const recharge = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/recharge`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ bankCardId: "card-1", amount: "5" }),
    });
    assert.equal(recharge.body.data.bankCard.number, "5572****4444");
    assert.equal(recharge.body.data.bankCard.cvv, "***");

    const suspend = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/suspend`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ cardId: "card-1" }),
    });
    assert.equal(suspend.response.status, 200);

    const enabled = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/enable`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ cardId: "card-1" }),
    });
    assert.equal(enabled.response.status, 200);

    const cancel = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/cancel`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ cardId: "card-1" }),
    });
    assert.equal(cancel.response.status, 200);

    const cashOut = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/cash-out`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ bankCardId: "card-1", amount: "3" }),
    });
    assert.equal(cashOut.response.status, 200);

    const cashOutDetail = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/cash-out-detail`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ id: "cash-1" }),
    });
    assert.equal(cashOutDetail.response.status, 200);

    const transactions = await jsonFetch(`${app.url}/api/admin/card-providers/vcc/consume-orders`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ number: "5572710152044444", page: 1, pageSize: 20 }),
    });
    assert.equal(transactions.body.data[0].number, "5572****4444");

    const byPath = Object.fromEntries(calls.map((call) => [new URL(call.url).pathname, call]));
    assert.equal(byPath["/bank_card/open_card"].options.method, "POST");
    assert.equal(byPath["/bank_card/suspend"].options.method, "PUT");
    assert.equal(byPath["/bank_card/enable"].options.method, "PUT");
    assert.equal(byPath["/bank_card/cancel"].options.method, "DELETE");
    assert.equal(byPath["/bank_card/card_cash_out"].options.method, "POST");
    assert.equal(byPath["/bank_card/card_cash_out_detail"].options.method, "GET");
    assert.equal(byPath["/bank_card/consume_order"].options.method, "GET");
    assert.match(app.store.listAuditLogs().map((row) => row.action).join(","), /card_provider_vcc_cancel/);
  } finally {
    await app.closeAll();
  }
});

test("admin proxy group APIs manage static checkout and direct-card proxy pools", async () => {
  const app = await createTestApp({ adminToken: "admin-token" });
  try {
    const created = await jsonFetch(`${app.url}/api/admin/proxy-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        name: "checkout PH",
        kind: "checkout",
        provider: "static",
        config: {
          proxies: [
            "https://user:pass@example.com:8443",
            "socks5://foo:bar@example.net:1080",
          ],
        },
      }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.body.data.kind, "checkout");
    assert.equal(created.body.data.config.proxies.length, 2);
    const groupId = created.body.data.id;

    const listed = await jsonFetch(`${app.url}/api/admin/proxy-groups?kind=checkout`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(listed.body.data.length, 1);

    const updated = await jsonFetch(`${app.url}/api/admin/proxy-groups/${groupId}`, {
      method: "PATCH",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        kind: "direct_card",
        enabled: false,
        config: {
          proxies: [{ url: "socks5://a:b@example.org:1080", priority: 1 }],
        },
      }),
    });
    assert.equal(updated.body.data.kind, "direct_card");
    assert.equal(updated.body.data.enabled, 0);
    assert.equal(updated.body.data.config.proxies[0].priority, 1);

    const detail = await jsonFetch(`${app.url}/api/admin/proxy-groups/${groupId}`, {
      headers: { "x-admin-token": "admin-token" },
    });
    assert.equal(detail.body.data.name, "checkout PH");

    const deleted = await jsonFetch(`${app.url}/api/admin/proxy-groups/${groupId}/delete`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "local" }),
    });
    assert.ok(deleted.body.data.deleted_at > 0);

    const restored = await jsonFetch(`${app.url}/api/admin/proxy-groups/${groupId}/restore`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(restored.body.data.deleted_at, 0);
    await jsonFetch(`${app.url}/api/admin/proxy-groups/${groupId}/delete`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "same name test" }),
    });
    const recreated = await jsonFetch(`${app.url}/api/admin/proxy-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        name: "checkout PH",
        kind: "shared",
        provider: "static",
        config: { proxies: [] },
      }),
    });
    assert.equal(recreated.response.status, 200);
    const duplicate = await jsonFetch(`${app.url}/api/admin/proxy-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        name: "checkout PH",
        kind: "shared",
        provider: "static",
        config: { proxies: [] },
      }),
    });
    assert.equal(duplicate.response.status, 400);
    assert.equal(duplicate.body.message, "代理组名称已存在，请换一个名称");
    assert.deepEqual(
      app.store.listAuditLogs().map((row) => row.action),
      ["proxy_group_create", "proxy_group_update", "proxy_group_delete", "proxy_group_restore", "proxy_group_delete", "proxy_group_create"],
    );
  } finally {
    await app.closeAll();
  }
});

test("admin proxy group APIs support IPWO dynamic provider test", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    code: 0,
    success: true,
    msg: "操作成功",
    request_ip: "127.0.0.1",
    data: [{ ip: "8.8.8.8", port: 8888 }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  const testedProxyUrls = [];
  const app = await createTestApp({
    adminToken: "admin-token",
    fetchImpl,
    proxyConnectivityTester: async (proxyUrl) => {
      testedProxyUrls.push(proxyUrl);
      return {
        ok: true,
        status: 200,
        ip: "8.8.8.8",
        message: "代理连通性测试成功，出口 IP: 8.8.8.8",
      };
    },
  });
  try {
    const created = await jsonFetch(`${app.url}/api/admin/proxy-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        name: "ipwo checkout",
        kind: "checkout",
        provider: "ipwo",
        config: {
          api_url: "https://api.example.com/extract?token=secret",
          regions: "US",
          protocol: "http",
          num: 1,
        },
      }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.body.data.provider, "ipwo");
    assert.equal(created.body.data.config.protocol, "http");

    const tested = await jsonFetch(`${app.url}/api/admin/proxy-groups/${created.body.data.id}/test`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(tested.response.status, 200);
    assert.equal(tested.body.ok, true);
    assert.equal(tested.body.data.redactedProxyUrl, "http://8.8.8.8:8888/");
    assert.equal(tested.body.data.api.count, 1);
    assert.deepEqual(testedProxyUrls, ["http://8.8.8.8:8888"]);
    assert.equal(tested.body.data.connectivity.ip, "8.8.8.8");
  } finally {
    await app.closeAll();
  }
});

test("admin proxy group APIs support IPWO credential provider test", async () => {
  const testedProxyUrls = [];
  const app = await createTestApp({
    adminToken: "admin-token",
    proxyConnectivityTester: async (proxyUrl) => {
      testedProxyUrls.push(proxyUrl);
      return {
        ok: true,
        status: 200,
        ip: "1.2.3.4",
        message: "代理连通性测试成功，出口 IP: 1.2.3.4",
      };
    },
  });
  try {
    const created = await jsonFetch(`${app.url}/api/admin/proxy-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        name: "ipwo credential",
        kind: "direct_card",
        provider: "ipwo",
        config: {
          host: "us.ipwo.net",
          port: 7878,
          username: "light121",
          password: "light121",
          protocol: "socks5",
          country: "US",
          session_mode: "sticky",
          sticky_minutes: 120,
        },
      }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.body.data.config.mode, "credential");

    const tested = await jsonFetch(`${app.url}/api/admin/proxy-groups/${created.body.data.id}/test`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ attempt_index: 0 }),
    });
    assert.equal(tested.response.status, 200);
    assert.equal(tested.body.ok, true);
    assert.equal(tested.body.data.redactedProxyUrl, "socks5://<user>:<pass>@us.ipwo.net:7878");
    assert.equal(tested.body.data.ipwo.params.country, "US");
    assert.match(tested.body.data.ipwo.session, /^[a-f0-9]{12}$/);
    assert.equal(testedProxyUrls.length, 1);
    assert.match(testedProxyUrls[0], /^socks5:\/\/light121_custom_zone_US_sid_[a-f0-9]{12}_time_120:light121@us\.ipwo\.net:7878$/);
    assert.equal(tested.body.data.connectivity.ip, "1.2.3.4");
  } finally {
    await app.closeAll();
  }
});

test("admin billing APIs manage groups and addresses", async () => {
  const app = await createTestApp({ adminToken: "admin-token" });
  try {
    const group = await jsonFetch(`${app.url}/api/admin/billing-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "US billing", note: "api" }),
    });
    const groupId = group.body.data.id;

    const address = await jsonFetch(`${app.url}/api/admin/billing-addresses`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({
        billing_group_id: groupId,
        name: "Test User",
        country: "US",
        state: "CA",
        city: "Los Angeles",
        line1: "1 Test Ave",
        postal_code: "90001",
        priority: 2,
      }),
    });
    assert.equal(address.response.status, 200);
    assert.equal(address.body.data.city, "Los Angeles");
    const addressId = address.body.data.id;

    const updated = await jsonFetch(`${app.url}/api/admin/billing-addresses/${addressId}`, {
      method: "PATCH",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ city: "San Diego" }),
    });
    assert.equal(updated.body.data.city, "San Diego");

    const disabled = await jsonFetch(`${app.url}/api/admin/billing-addresses/${addressId}/disable`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(disabled.body.data.status, "disabled");

    const restoredDisabled = await jsonFetch(`${app.url}/api/admin/billing-addresses/${addressId}/restore`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(restoredDisabled.body.data.status, "enabled");

    await jsonFetch(`${app.url}/api/admin/billing-addresses/${addressId}/disable`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });

    const deleted = await jsonFetch(`${app.url}/api/admin/billing-addresses/${addressId}/delete`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "local" }),
    });
    assert.ok(deleted.body.data.deleted_at > 0);

    const restored = await jsonFetch(`${app.url}/api/admin/billing-addresses/${addressId}/restore`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({}),
    });
    assert.equal(restored.body.data.deleted_at, 0);

    const groupDeleted = await jsonFetch(`${app.url}/api/admin/billing-groups/${groupId}/delete`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ reason: "remove group" }),
    });
    assert.ok(groupDeleted.body.data.deleted_at > 0);
    assert.ok(app.store.getBillingAddressById(addressId).deleted_at > 0);

    const recreatedGroup = await jsonFetch(`${app.url}/api/admin/billing-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "US billing", note: "same name after delete" }),
    });
    assert.equal(recreatedGroup.response.status, 200);
    const duplicateGroup = await jsonFetch(`${app.url}/api/admin/billing-groups`, {
      method: "POST",
      headers: { "x-admin-token": "admin-token" },
      body: JSON.stringify({ name: "US billing" }),
    });
    assert.equal(duplicateGroup.response.status, 400);
    assert.equal(duplicateGroup.body.message, "账单组名称已存在，请换一个名称");
  } finally {
    await app.closeAll();
  }
});

test("admin SSE emits an initial queue snapshot", async () => {
  const app = await createTestApp({ adminToken: "admin-token" });
  const controller = new AbortController();
  try {
    const response = await fetch(`${app.url}/api/admin/events?token=admin-token`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    const reader = response.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.match(text, /event: queue\.snapshot/);
    assert.match(text, /"queued":0/);
  } finally {
    controller.abort();
    await app.closeAll();
  }
});

test("public order status endpoint enforces per-IP rate limit", async () => {
  const app = await createTestApp();
  try {
    for (let i = 0; i < 5; i += 1) {
      const result = await jsonFetch(`${app.url}/api/public/orders/missing-${i}`);
      assert.equal(result.response.status, 404);
    }
    const limited = await jsonFetch(`${app.url}/api/public/orders/missing-6`);
    assert.equal(limited.response.status, 429);
    assert.equal(limited.body.code, "RATE_LIMITED");
  } finally {
    await app.closeAll();
  }
});

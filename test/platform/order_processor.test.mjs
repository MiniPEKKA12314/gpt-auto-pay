import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { createPlatformPaymentAdapterFactory, resolveAttemptProxy } from "../../src/platform/order_processor.mjs";
import { runPlatformOrderWithRetry } from "../../src/platform/runner_adapter.mjs";

function createProcessorStore(options = {}) {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  const cardGroupId = store.createCardGroup({ name: `processor cards ${Math.random()}` }, 10);
  const cardId = store.createCard({
    card_group_id: cardGroupId,
    number: "4242424242424242",
    exp_month: "12",
    exp_year: "2030",
    cvc: "123",
    max_success_count: 10,
  }, 11);
  const billingGroupId = store.createBillingGroup({ name: `processor billing ${Math.random()}` }, 12);
  const billingAddressId = store.createBillingAddress({
    billing_group_id: billingGroupId,
    name: "Processor User",
    country: "US",
    state: "CA",
    city: "Los Angeles",
    line1: "3 Processor Ave",
    postal_code: "90003",
  }, 13);
  const checkoutProxyGroupId = options.checkoutProxy
    ? store.createProxyGroup({
        name: `checkout proxy ${Math.random()}`,
        kind: "checkout",
        provider: "static",
        config: { proxies: [options.checkoutProxy] },
      }, 14)
    : 0;
  const directCardProxyGroupId = options.directCardProxy
    ? store.createProxyGroup({
        name: `direct proxy ${Math.random()}`,
        kind: "direct_card",
        provider: "static",
        config: { proxies: [options.directCardProxy] },
      }, 15)
    : 0;
  store.upsertPlanConfig({
    plan_type: "plus",
    billing_group_id: billingGroupId,
    payment_country: "PH",
    payment_currency: "PHP",
    checkout_proxy_group_id: checkoutProxyGroupId,
    direct_card_proxy_group_id: directCardProxyGroupId,
    max_proxy_attempts_per_card: options.maxProxyAttemptsPerCard ?? 1,
  }, 16);
  store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 17);
  store.createRedeemBatchWithCodes({
    name: "processor batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-PROCESSOR-1",
  }, 18);
  const locked = store.lockCodeAndCreateOrder({ code: "PLUS-PROCESSOR-1", order_no: "ord_processor" }, 19);
  store.setOrderRuntimeSecrets(locked.order.id, {
    accessToken: "access-token",
    sessionToken: "session-token",
  }, 20);
  return {
    store,
    cardId,
    billingAddressId,
    orderId: locked.order.id,
    checkoutProxyGroupId,
    directCardProxyGroupId,
  };
}

test("attempt proxy resolution returns direct when no group is configured", () => {
  const { store, orderId } = createProcessorStore();
  try {
    const plan = store.getPlanConfig("plus", { includeCardGroups: true });
    const proxy = resolveAttemptProxy(store, plan, "checkout_proxy_group_id", { proxy_attempt_index: 0 });
    assert.equal(proxy.proxyUrl, "");
    assert.equal(proxy.reason, "direct");
    assert.equal(store.getOrderById(orderId).order_no, "ord_processor");
  } finally {
    store.close();
  }
});

test("attempt proxy resolution separates checkout and direct-card indexes", () => {
  const { store, orderId } = createProcessorStore({
    checkoutProxy: "https://checkout-a.example.com:8443",
    directCardProxy: "socks5://direct-a.example.com:1080",
  });
  try {
    const checkoutGroupId = store.getPlanConfig("plus").checkout_proxy_group_id;
    const directGroupId = store.getPlanConfig("plus").direct_card_proxy_group_id;
    const checkoutGroup = store.getProxyGroupById(checkoutGroupId);
    const directGroup = store.getProxyGroupById(directGroupId);
    store.updateProxyGroup(checkoutGroupId, {
      ...checkoutGroup,
      config: { proxies: ["https://checkout-a.example.com:8443", "https://checkout-b.example.com:8443"] },
    }, 30);
    store.updateProxyGroup(directGroupId, {
      ...directGroup,
      config: { proxies: ["socks5://direct-a.example.com:1080", "socks5://direct-b.example.com:1080"] },
    }, 31);

    const plan = store.getPlanConfig("plus", { includeCardGroups: true });
    const retry = { checkout_proxy_attempt_index: 1, proxy_attempt_index: 0 };
    assert.equal(resolveAttemptProxy(store, plan, "checkout_proxy_group_id", retry).proxyUrl, "https://checkout-b.example.com:8443");
    assert.equal(resolveAttemptProxy(store, plan, "direct_card_proxy_group_id", retry).proxyUrl, "socks5://direct-a.example.com:1080");
    assert.equal(store.getOrderById(orderId).order_no, "ord_processor");
  } finally {
    store.close();
  }
});

test("platform payment processor runs checkout, saves checkout input, then runs direct card", async () => {
  const checkoutProxy = "https://user:pass@example.com:8443";
  const directCardProxy = "socks5://foo:bar@example.net:1080";
  const { store, cardId, orderId } = createProcessorStore({ checkoutProxy, directCardProxy });
  try {
    let checkoutContext = null;
    let directOptions = null;
    const factory = createPlatformPaymentAdapterFactory({
      checkoutAdapterFactory: () => ({
        async execute(context) {
          checkoutContext = context;
          return {
            ok: true,
            status: "success",
            checkoutInput: "oaics_processor_demo",
            checkout_input: "oaics_processor_demo",
            message: "提链成功",
          };
        },
      }),
      directCardAdapterFactory: (options) => {
        directOptions = options;
        return {
          async execute(context) {
            assert.equal(context.checkoutInput, "oaics_processor_demo");
            return { status: "success", message: "订阅成功" };
          },
        };
      },
    });

    const result = await runPlatformOrderWithRetry(store, orderId, factory, { now: () => 100 });
    assert.equal(result.ok, true);
    assert.equal(result.order.status, "succeeded");
    assert.equal(result.redeemCode.status, "used");
    assert.equal(store.getCardById(cardId).success_count, 1);
    assert.equal(store.getOrderRuntimeSecrets(orderId, { includeSecret: true }).checkoutInput, "oaics_processor_demo");
    assert.equal(checkoutContext.checkoutProxyUrl, checkoutProxy);
    assert.equal(directOptions.checkoutInput, "oaics_processor_demo");
    assert.equal(directOptions.sessionToken, "session-token");
    assert.equal(directOptions.proxyUrl, directCardProxy);
    const attempt = store.listOrderAttempts(orderId)[0];
    assert.equal(attempt.checkout_proxy, "https://<user>:<pass>@example.com:8443");
    assert.equal(attempt.direct_card_proxy, "socks5://<user>:<pass>@example.net:1080");
    assert.match(store.listRunLogs(orderId).map((log) => log.message).join("\n"), /提链代理/);
    assert.match(store.listRunLogs(orderId).map((log) => log.message).join("\n"), /直卡代理/);
  } finally {
    store.close();
  }
});

test("platform payment processor reuses saved checkout input without running checkout again", async () => {
  const { store, orderId } = createProcessorStore();
  try {
    store.setOrderRuntimeCheckoutInput(orderId, "oaics_saved_demo", 30);
    let checkoutCalled = false;
    const factory = createPlatformPaymentAdapterFactory({
      checkoutAdapterFactory: () => ({
        async execute() {
          checkoutCalled = true;
          return { ok: false, status: "failed", message: "should not run" };
        },
      }),
      directCardAdapterFactory: (options) => ({
        async execute() {
          assert.equal(options.checkoutInput, "oaics_saved_demo");
          return { status: "success", message: "订阅成功" };
        },
      }),
    });

    const result = await runPlatformOrderWithRetry(store, orderId, factory, { now: () => 100 });
    assert.equal(result.ok, true);
    assert.equal(checkoutCalled, false);
  } finally {
    store.close();
  }
});

test("platform payment processor stops before direct card when checkout fails", async () => {
  const { store, orderId } = createProcessorStore();
  try {
    let directCalled = false;
    const factory = createPlatformPaymentAdapterFactory({
      checkoutAdapterFactory: () => ({
        async execute() {
          return { ok: false, status: "failed", code: "CHECKOUT_FAILED", message: "checkout/create 返回状态 400" };
        },
      }),
      directCardAdapterFactory: () => ({
        async execute() {
          directCalled = true;
          return { status: "success" };
        },
      }),
    });

    const result = await runPlatformOrderWithRetry(store, orderId, factory, { now: () => 100 });
    assert.equal(result.ok, false);
    assert.equal(result.order.status, "failed");
    assert.equal(result.redeemCode.status, "unused");
    assert.equal(directCalled, false);
    assert.equal(store.getOrderRuntimeSecrets(orderId, { includeSecret: true }).checkoutInput, "");
  } finally {
    store.close();
  }
});

test("shared IPWO credential proxy reuses successful checkout session for first direct-card attempt", async () => {
  const { store, orderId } = createProcessorStore();
  try {
    const sharedGroupId = store.createProxyGroup({
      name: `shared ipwo ${Math.random()}`,
      kind: "shared",
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
    }, 40);
    store.upsertPlanConfig({
      ...store.getPlanConfig("plus"),
      checkout_proxy_group_id: sharedGroupId,
      direct_card_proxy_group_id: sharedGroupId,
      checkout_max_proxy_attempts: 2,
      max_proxy_attempts_per_card: 2,
    }, 41);

    const seen = [];
    const factory = createPlatformPaymentAdapterFactory({
      checkoutAdapterFactory: () => ({
        async execute(context) {
          seen.push({ phase: "checkout", proxy: context.checkoutProxyUrl });
          if (seen.filter((item) => item.phase === "checkout").length === 1) {
            return { ok: false, status: "failed", code: "CHECKOUT_FAILED", phase: "checkout", message: "checkout/create ECONNRESET" };
          }
          return { ok: true, status: "success", checkoutInput: "oaics_shared_session", checkout_input: "oaics_shared_session" };
        },
      }),
      directCardAdapterFactory: (options) => ({
        async execute(context) {
          seen.push({ phase: "direct", proxy: options.proxyUrl, reused: context.directCardProxy?.session });
          return { status: "success", message: "订阅成功" };
        },
      }),
    });

    const result = await runPlatformOrderWithRetry(store, orderId, factory, { now: () => 100 });
    assert.equal(result.ok, true);
    assert.equal(seen.length, 3);
    assert.notEqual(seen[0].proxy, seen[1].proxy);
    assert.equal(seen[2].proxy, seen[1].proxy);
    const attempts = store.listOrderAttempts(orderId);
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0].checkout_proxy_session, attempts[1].checkout_proxy_session);
    assert.equal(attempts[1].direct_card_proxy_session, attempts[1].checkout_proxy_session);
    assert.equal(result.result.directCardProxy.reusedCheckoutSession, true);
  } finally {
    store.close();
  }
});

test("shared IPWO credential proxy switches direct-card session after direct proxy retry", async () => {
  const { store, orderId } = createProcessorStore();
  try {
    const sharedGroupId = store.createProxyGroup({
      name: `shared ipwo retry ${Math.random()}`,
      kind: "shared",
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
    }, 50);
    store.upsertPlanConfig({
      ...store.getPlanConfig("plus"),
      checkout_proxy_group_id: sharedGroupId,
      direct_card_proxy_group_id: sharedGroupId,
      checkout_max_proxy_attempts: 1,
      max_proxy_attempts_per_card: 2,
    }, 51);

    const seen = [];
    const factory = createPlatformPaymentAdapterFactory({
      checkoutAdapterFactory: () => ({
        async execute(context) {
          seen.push({ phase: "checkout", proxy: context.checkoutProxyUrl });
          return { ok: true, status: "success", checkoutInput: "oaics_shared_retry", checkout_input: "oaics_shared_retry" };
        },
      }),
      directCardAdapterFactory: (options) => ({
        async execute(context) {
          seen.push({ phase: "direct", proxy: options.proxyUrl, retry: context.retry.proxy_attempt_index });
          if (context.retry.proxy_attempt_index === 0) return { status: "failed", message: "ECONNRESET from proxy" };
          return { status: "success", message: "订阅成功" };
        },
      }),
    });

    const result = await runPlatformOrderWithRetry(store, orderId, factory, { now: () => 200 });
    assert.equal(result.ok, true);
    assert.equal(seen.length, 3);
    assert.equal(seen[1].proxy, seen[0].proxy);
    assert.notEqual(seen[2].proxy, seen[0].proxy);
    const attempts = store.listOrderAttempts(orderId);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].direct_card_proxy_session, attempts[0].checkout_proxy_session);
    assert.notEqual(attempts[1].direct_card_proxy_session, attempts[0].checkout_proxy_session);
  } finally {
    store.close();
  }
});

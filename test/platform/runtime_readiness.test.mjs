import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { checkPlanRuntimeReadiness } from "../../src/platform/runtime_readiness.mjs";

test("plan readiness reports missing card groups and billing groups", () => {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db);
  try {
    const readiness = checkPlanRuntimeReadiness(store, "plus");
    assert.equal(readiness.ok, false);
    assert.match(readiness.issues.join("\n"), /套餐未绑定卡组/);
    assert.match(readiness.issues.join("\n"), /套餐未绑定账单地址组/);
  } finally {
    store.close();
  }
});

test("plan readiness succeeds when cards, billing, and static proxies are configured", () => {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  try {
    const cardGroupId = store.createCardGroup({ name: "ready cards" }, 10);
    const cardId = store.createCard({
      card_group_id: cardGroupId,
      number: "4242424242424242",
      exp_month: "12",
      exp_year: "2030",
      cvc: "123",
      max_success_count: 10,
    }, 11);
    const billingGroupId = store.createBillingGroup({ name: "ready billing" }, 12);
    const billingAddressId = store.createBillingAddress({
      billing_group_id: billingGroupId,
      name: "Ready User",
      country: "US",
      city: "Los Angeles",
      line1: "1 Ready Ave",
      postal_code: "90001",
    }, 13);
    const checkoutProxyGroupId = store.createProxyGroup({
      name: "ready checkout proxy",
      kind: "checkout",
      provider: "static",
      config: { proxies: ["https://user:pass@example.com:8443"] },
    }, 14);
    const directProxyGroupId = store.createProxyGroup({
      name: "ready direct proxy",
      kind: "direct_card",
      provider: "static",
      config: { proxies: ["socks5://user:pass@example.net:1080"] },
    }, 15);
    store.upsertPlanConfig({
      plan_type: "plus",
      payment_country: "PH",
      payment_currency: "PHP",
      billing_group_id: billingGroupId,
      checkout_proxy_group_id: checkoutProxyGroupId,
      direct_card_proxy_group_id: directProxyGroupId,
    }, 16);
    store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 17);

    const readiness = checkPlanRuntimeReadiness(store, "plus");
    assert.equal(readiness.ok, true);
    assert.equal(readiness.resources.card.id, cardId);
    assert.equal(readiness.resources.billingAddress.id, billingAddressId);
    assert.equal(readiness.proxies.checkout.proxy_count, 1);
    assert.equal(readiness.proxies.direct_card.proxy_count, 1);
  } finally {
    store.close();
  }
});

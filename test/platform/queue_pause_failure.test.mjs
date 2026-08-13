import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { runQueueOnce } from "../../src/platform/worker.mjs";

function createQueuedStore() {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  const cardGroupId = store.createCardGroup({ name: "pause cards" }, 10);
  store.createCard({ card_group_id: cardGroupId, number: "4242424242424242", exp_month: "12", exp_year: "2030", cvc: "123" }, 11);
  const billingGroupId = store.createBillingGroup({ name: "pause billing" }, 12);
  store.createBillingAddress({ billing_group_id: billingGroupId, name: "Pause User", country: "US", state: "CA", city: "LA", line1: "1", postal_code: "90001" }, 13);
  store.upsertPlanConfig({ plan_type: "plus", billing_group_id: billingGroupId, checkout_max_proxy_attempts: 1, max_proxy_attempts_per_card: 1 }, 14);
  store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 15);
  store.createRedeemBatchWithCodes({ name: "pause batch", plan_type: "plus", quantity: 2, codeFactory: (index) => `PLUS-PAUSE-${index}` }, 16);
  const first = store.lockCodeAndCreateOrder({ code: "PLUS-PAUSE-0", order_no: "ord_pause_0" }, 17);
  const second = store.lockCodeAndCreateOrder({ code: "PLUS-PAUSE-1", order_no: "ord_pause_1" }, 18);
  store.setOrderRuntimeSecrets(first.order.id, { accessToken: "at", sessionToken: "st" }, 19);
  store.setOrderRuntimeSecrets(second.order.id, { accessToken: "at", sessionToken: "st" }, 20);
  return { store };
}

test("queue can pause automatically after an exhausted order failure", async () => {
  const { store } = createQueuedStore();
  try {
    store.setQueueSettings({ global_concurrency: 1, pause_on_order_failure: true }, 1, 30);
    const result = await runQueueOnce(store, async () => ({
      async execute() {
        return { ok: false, status: "failed", code: "DIRECT_CARD_FAILED", message: "test failure" };
      },
    }), { now: () => 40 });
    assert.equal(result.results.length, 1);
    assert.equal(result.paused_on_failure, true);
    assert.equal(store.getQueueSettings().status, "paused");
    assert.equal(store.queueSnapshot().queued, 1);
    assert.match(store.listRunLogs(result.results[0].order_id).map((log) => log.message).join("\n"), /自动暂停/);
  } finally {
    store.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { listenPlatformServer } from "../../src/platform/server.mjs";

test("admin error-center endpoints return grouped orders and problem-only logs", async () => {
  const store = new PlatformStore(openPlatformDb(":memory:"));
  store.createRedeemBatchWithCodes({
    name: "error api batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-ERROR-API",
  }, 100);
  const locked = store.lockCodeAndCreateOrder({ code: "PLUS-ERROR-API", order_no: "ord_error_api" }, 101);
  store.addRunLog({ order_id: locked.order.id, level: "info", stage: "checkout", message: "normal progress" }, 102);
  store.addRunLog({ order_id: locked.order.id, level: "error", stage: "direct_card", message: "payment rejected" }, 103);
  const app = await listenPlatformServer({ store, adminToken: "error-test-token" });
  try {
    const headers = { "x-admin-token": "error-test-token" };
    const list = await fetch(`${app.url}/api/admin/error-orders?from=100&to=110`, { headers });
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(listBody.data.stats.order_count, 1);
    assert.equal(listBody.data.orders[0].order_no, "ord_error_api");

    const logs = await fetch(`${app.url}/api/admin/error-orders/${locked.order.id}/logs?from=100&to=110`, { headers });
    assert.equal(logs.status, 200);
    const logsBody = await logs.json();
    assert.deepEqual(logsBody.data.logs.map((row) => row.message), ["payment rejected"]);
  } finally {
    await app.close();
    store.close();
  }
});

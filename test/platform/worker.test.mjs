import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { OrderStatus } from "../../src/platform/constants.mjs";
import { PlatformQueueWorker, recoverWorkerRuntime, runQueueOnce } from "../../src/platform/worker.mjs";

function createWorkerStore(quantity = 1, options = {}) {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  const cardGroupId = store.createCardGroup({ name: `worker cards ${quantity}` }, 10);
  store.createCard({
    card_group_id: cardGroupId,
    number: "4242424242424242",
    exp_month: "12",
    exp_year: "2030",
    cvc: "123",
    max_success_count: 10,
  }, 11);
  const billingGroupId = store.createBillingGroup({ name: `worker billing ${quantity}` }, 12);
  store.createBillingAddress({
    billing_group_id: billingGroupId,
    name: "Test User",
    country: "US",
    state: "CA",
    city: "Los Angeles",
    line1: "1 Worker Ave",
    postal_code: "90001",
  }, 13);
  store.upsertPlanConfig({
    plan_type: "plus",
    billing_group_id: billingGroupId,
    ...(options.plan ?? {}),
  }, 14);
  store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 15);
  store.createRedeemBatchWithCodes({
    name: `worker batch ${quantity}`,
    plan_type: "plus",
    quantity,
    codeFactory: (index) => `PLUS-WORKER-${quantity}-${index}`,
  }, 16);
  const orders = [];
  for (let index = 0; index < quantity; index += 1) {
    const locked = store.lockCodeAndCreateOrder({
      code: `PLUS-WORKER-${quantity}-${index}`,
      order_no: `ord_worker_${quantity}_${index}`,
    }, 17 + index);
    orders.push(locked.order);
  }
  return { store, orders };
}

test("runQueueOnce drains queued orders through the injected adapter", async () => {
  const { store, orders } = createWorkerStore(2);
  try {
    store.setQueueSettings({ global_concurrency: 2 }, 1, 20);
    const seen = [];
    const result = await runQueueOnce(store, async ({ order }) => ({
      async execute({ emit }) {
        seen.push(order.order_no);
        emit({ level: "info", stage: "fake", message: `processed ${order.order_no}` });
        return { status: "success", message: "done" };
      },
    }), { now: () => 100 });

    assert.deepEqual(result.started.map((order) => order.order_no), orders.map((order) => order.order_no));
    assert.deepEqual(seen, orders.map((order) => order.order_no));
    assert.equal(result.results.every((row) => row.ok), true);
    assert.deepEqual(store.listOrders().map((order) => order.status), [OrderStatus.SUCCEEDED, OrderStatus.SUCCEEDED]);
    assert.equal(store.listRedeemCodes({ status: "used" }).length, 2);
    assert.match(store.listRunLogs(orders[0].id).map((log) => log.message).join("\n"), /processed ord_worker_2_0/);
  } finally {
    store.close();
  }
});

test("runQueueOnce executes dispatched orders concurrently", async () => {
  const { store } = createWorkerStore(2);
  try {
    store.setQueueSettings({ global_concurrency: 2 }, 1, 20);
    let active = 0;
    let maxActive = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let entered = 0;

    const running = runQueueOnce(store, async () => ({
      async execute() {
        active += 1;
        entered += 1;
        maxActive = Math.max(maxActive, active);
        if (entered === 2) release();
        await gate;
        active -= 1;
        return { status: "success", message: "concurrent success" };
      },
    }), { now: () => 100 });

    const result = await running;
    assert.equal(result.results.length, 2);
    assert.equal(maxActive, 2);
    assert.equal(result.results.every((row) => row.ok), true);
  } finally {
    store.close();
  }
});

test("runQueueOnce respects paused queues", async () => {
  const { store, orders } = createWorkerStore(1);
  try {
    store.pauseQueue(1, 20);
    const result = await runQueueOnce(store, async () => ({
      async execute() {
        throw new Error("should not run");
      },
    }), { now: () => 100 });

    assert.equal(result.started.length, 0);
    assert.equal(store.getOrderById(orders[0].id).status, OrderStatus.QUEUED);
  } finally {
    store.close();
  }
});

test("runQueueOnce can force one manual pass while queue is paused", async () => {
  const { store, orders } = createWorkerStore(1);
  try {
    store.pauseQueue(1, 20);
    const result = await runQueueOnce(store, async () => ({
      async execute() {
        return { status: "success", message: "manual pass processed" };
      },
    }), { now: () => 100, ignorePaused: true });

    assert.equal(result.started.length, 1);
    assert.equal(store.getOrderById(orders[0].id).status, OrderStatus.SUCCEEDED);
  } finally {
    store.close();
  }
});

test("runQueueOnce releases the redeem code when the adapter fails", async () => {
  const { store, orders } = createWorkerStore(1);
  try {
    const result = await runQueueOnce(store, async () => ({
      async execute() {
        return { status: "failed", message: "payment declined" };
      },
    }), { now: () => 100 });

    assert.equal(result.results[0].ok, false);
    assert.equal(store.getOrderById(orders[0].id).status, OrderStatus.FAILED);
    assert.equal(store.listRedeemCodes({ status: "unused" }).length, 1);
    assert.match(store.listRunLogs(orders[0].id).map((log) => log.message).join("\n"), /payment declined/);
  } finally {
    store.close();
  }
});

test("runQueueOnce converts adapter factory exceptions into failed attempts", async () => {
  const { store, orders } = createWorkerStore(1);
  try {
    const result = await runQueueOnce(store, async () => {
      throw new Error("factory exploded");
    }, { now: () => 100 });

    assert.equal(result.results[0].ok, false);
    assert.equal(store.getOrderById(orders[0].id).status, OrderStatus.FAILED);
    assert.match(store.listRunLogs(orders[0].id).map((log) => log.message).join("\n"), /factory exploded/);
  } finally {
    store.close();
  }
});

test("runQueueOnce passes retry context to the adapter factory on each attempt", async () => {
  const { store, orders } = createWorkerStore(1, {
    plan: { max_proxy_attempts_per_card: 2 },
  });
  try {
    const seenRetry = [];
    const result = await runQueueOnce(store, async ({ retry }) => {
      seenRetry.push(retry.proxy_attempt_index);
      return {
        async execute() {
          if (retry.proxy_attempt_index === 0) {
            return { status: "failed", message: "ECONNRESET from proxy" };
          }
          return { status: "success", message: "retry context success" };
        },
      };
    }, { now: () => 100 });

    assert.equal(result.results[0].ok, true);
    assert.deepEqual(seenRetry, [0, 1]);
    assert.equal(store.getOrderById(orders[0].id).status, OrderStatus.SUCCEEDED);
    assert.deepEqual(store.listOrderAttempts(orders[0].id).map((attempt) => attempt.status), ["failed", "success"]);
  } finally {
    store.close();
  }
});

test("worker runtime recovery moves running orders to manual review", () => {
  const { store, orders } = createWorkerStore(1);
  try {
    store.dispatchQueuedOrders(50);
    const recovered = recoverWorkerRuntime(store, "boot recovered", 60);
    assert.equal(recovered.recovered, 1);
    assert.equal(store.getOrderById(orders[0].id).status, OrderStatus.INTERRUPTED_REVIEW);
    assert.equal(store.listRedeemCodes({ status: "unavailable" }).length, 1);
  } finally {
    store.close();
  }
});

test("PlatformQueueWorker can tick once and report progress", async () => {
  const { store, orders } = createWorkerStore(1);
  try {
    const logs = [];
    const worker = new PlatformQueueWorker({
      store,
      intervalMs: 10000,
      logger: (event) => logs.push(event),
      adapterFactory: async () => ({
        async execute() {
          return { status: "success", message: "worker tick success" };
        },
      }),
      now: () => 100,
    });

    const result = await worker.tick();
    worker.stop();
    assert.equal(result.results[0].ok, true);
    assert.equal(store.getOrderById(orders[0].id).status, OrderStatus.SUCCEEDED);
    assert.equal(logs.some((event) => event.type === "tick"), true);
  } finally {
    store.close();
  }
});

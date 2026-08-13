import assert from "node:assert/strict";
import test from "node:test";

import { OrderStatus, QueueStatus, RedeemStatus } from "../../src/platform/constants.mjs";
import {
  canStartMore,
  createQueueSettings,
  pickNextQueuedOrder,
  recoverInterruptedRuntime,
} from "../../src/platform/queue.mjs";

test("queue settings validate concurrency and pause state", () => {
  assert.deepEqual(createQueueSettings({}), {
    status: QueueStatus.RUNNING,
    global_concurrency: 1,
    pause_on_order_failure: false,
  });
  assert.equal(createQueueSettings({ pause_on_order_failure: true }).pause_on_order_failure, true);
  assert.equal(createQueueSettings({ status: "paused", global_concurrency: 1000 }).global_concurrency, 1000);
  assert.throws(() => createQueueSettings({ global_concurrency: 0 }), /between 1 and 1000/);
  assert.throws(() => createQueueSettings({ global_concurrency: 1001 }), /between 1 and 1000/);
});

test("queue starts only when running and below global concurrency", () => {
  assert.equal(canStartMore({ status: "running", global_concurrency: 2 }, 1), true);
  assert.equal(canStartMore({ status: "running", global_concurrency: 2 }, 2), false);
  assert.equal(canStartMore({ status: "paused", global_concurrency: 2 }, 0), false);
});

test("queue picks the oldest queued order", () => {
  const orders = [
    { id: 1, status: OrderStatus.QUEUED, queued_at: 20 },
    { id: 2, status: OrderStatus.RUNNING, queued_at: 1 },
    { id: 3, status: OrderStatus.QUEUED, queued_at: 10 },
    { id: 4, status: OrderStatus.QUEUED, queued_at: 5, deleted_at: 1 },
  ];
  assert.equal(pickNextQueuedOrder(orders).id, 3);
});

test("runtime recovery moves running orders and locked codes to review", () => {
  const result = recoverInterruptedRuntime({
    now: 99,
    reason: "boot_recovery",
    orders: [
      { id: 1, status: OrderStatus.RUNNING, updated_at: 1 },
      { id: 2, status: OrderStatus.QUEUED, updated_at: 1 },
    ],
    redeemCodes: [
      { id: 10, status: RedeemStatus.LOCKED, locked_order_id: 1 },
      { id: 11, status: RedeemStatus.LOCKED, locked_order_id: 2 },
      { id: 12, status: RedeemStatus.UNUSED, locked_order_id: 0 },
    ],
  });

  assert.equal(result.recovered, 1);
  assert.equal(result.orders.find((order) => order.id === 1).status, OrderStatus.INTERRUPTED_REVIEW);
  assert.equal(result.orders.find((order) => order.id === 2).status, OrderStatus.QUEUED);
  assert.equal(result.redeemCodes.find((code) => code.id === 10).status, RedeemStatus.UNAVAILABLE);
  assert.equal(result.redeemCodes.find((code) => code.id === 11).status, RedeemStatus.LOCKED);
});

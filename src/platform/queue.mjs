import { OrderStatus, QueueStatus, RedeemStatus, nowSeconds } from "./constants.mjs";

export function normalizeConcurrency(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new Error("global concurrency must be an integer between 1 and 1000");
  }
  return n;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

export function createQueueSettings(options = {}) {
  return {
    status: options.status === QueueStatus.PAUSED ? QueueStatus.PAUSED : QueueStatus.RUNNING,
    global_concurrency: normalizeConcurrency(options.global_concurrency ?? 1),
    pause_on_order_failure: toBoolean(options.pause_on_order_failure ?? options.pauseOnOrderFailure, false),
  };
}

export function canStartMore(settings, runningCount) {
  const normalized = createQueueSettings(settings);
  if (normalized.status !== QueueStatus.RUNNING) return false;
  return Number(runningCount ?? 0) < normalized.global_concurrency;
}

export function pickNextQueuedOrder(orders = []) {
  return [...orders]
    .filter((order) => order.status === OrderStatus.QUEUED)
    .filter((order) => !order.deleted_at)
    .sort((left, right) =>
      Number(left.queued_at ?? left.created_at ?? 0) - Number(right.queued_at ?? right.created_at ?? 0) ||
      Number(left.id ?? 0) - Number(right.id ?? 0))
    [0] ?? null;
}

export function recoverInterruptedRuntime({ orders = [], redeemCodes = [], now = nowSeconds(), reason = "process_recovered" } = {}) {
  const runningOrderIds = new Set(
    orders
      .filter((order) => order.status === OrderStatus.RUNNING)
      .map((order) => Number(order.id)),
  );
  const nextOrders = orders.map((order) => {
    if (!runningOrderIds.has(Number(order.id))) return order;
    return {
      ...order,
      status: OrderStatus.INTERRUPTED_REVIEW,
      admin_error: reason,
      updated_at: now,
    };
  });
  const nextRedeemCodes = redeemCodes.map((code) => {
    if (code.status !== RedeemStatus.LOCKED) return code;
    if (!runningOrderIds.has(Number(code.locked_order_id))) return code;
    return {
      ...code,
      status: RedeemStatus.UNAVAILABLE,
      unavailable_at: now,
      unavailable_reason: reason,
    };
  });
  return {
    orders: nextOrders,
    redeemCodes: nextRedeemCodes,
    recovered: runningOrderIds.size,
  };
}

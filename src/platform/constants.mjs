export const PLAN_TYPES = Object.freeze(["go", "plus", "pro5x", "pro20x"]);

export const RedeemStatus = Object.freeze({
  UNUSED: "unused",
  LOCKED: "locked",
  USED: "used",
  UNAVAILABLE: "unavailable",
  DISABLED: "disabled",
  DELETED: "deleted",
});

export const OrderStatus = Object.freeze({
  CREATED: "created",
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  INTERRUPTED_REVIEW: "interrupted_review",
  CANCELLED: "cancelled",
  DELETED: "deleted",
});

export const CardStatus = Object.freeze({
  ENABLED: "enabled",
  STANDBY: "standby",
  DISABLED: "disabled",
  DELETED: "deleted",
});

export const BillingAddressStatus = Object.freeze({
  ENABLED: "enabled",
  DISABLED: "disabled",
  DELETED: "deleted",
});

export const QueueStatus = Object.freeze({
  RUNNING: "running",
  PAUSED: "paused",
});

export function normalizePlanType(planType) {
  const normalized = String(planType ?? "").trim().toLowerCase();
  if (!PLAN_TYPES.includes(normalized)) {
    throw new Error(`invalid plan_type: ${String(planType ?? "")}`);
  }
  return normalized;
}

export function nowSeconds() {
  return Date.now() / 1000;
}

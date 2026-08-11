import { normalizePlanType, OrderStatus, nowSeconds } from "./constants.mjs";
import { DEFAULT_FAILURE_MESSAGE, DEFAULT_PLAN_NAMES, normalizePlanConfig } from "./plans.mjs";

export function createOrder(input = {}, now = nowSeconds()) {
  const planType = normalizePlanType(input.plan_type ?? input.planType);
  if (!input.redeem_code_id && !input.redeemCodeId) {
    throw new Error("redeem_code_id is required");
  }
  const idPart = input.order_no ?? input.orderNo ?? `ord_${Math.floor(now * 1000)}`;
  return {
    id: input.id ?? 0,
    order_no: String(idPart),
    redeem_code_id: Number(input.redeem_code_id ?? input.redeemCodeId),
    plan_type: planType,
    status: input.status ?? OrderStatus.CREATED,
    user_ip: String(input.user_ip ?? input.userIp ?? ""),
    user_agent: String(input.user_agent ?? input.userAgent ?? ""),
    public_message: String(input.public_message ?? ""),
    admin_error: String(input.admin_error ?? ""),
    queued_at: 0,
    started_at: 0,
    finished_at: 0,
    created_at: now,
    updated_at: now,
  };
}

export function transitionOrder(order, status, now = nowSeconds(), fields = {}) {
  const next = {
    ...order,
    ...fields,
    status,
    updated_at: now,
  };
  if (status === OrderStatus.QUEUED && !next.queued_at) next.queued_at = now;
  if (status === OrderStatus.RUNNING && !next.started_at) next.started_at = now;
  if ([OrderStatus.SUCCEEDED, OrderStatus.FAILED, OrderStatus.CANCELLED].includes(status) && !next.finished_at) {
    next.finished_at = now;
  }
  return next;
}

export function publicOrderSummary(order, planConfig = {}) {
  const plan = normalizePlanConfig({
    plan_type: order.plan_type,
    display_name: DEFAULT_PLAN_NAMES[order.plan_type],
    failure_message: DEFAULT_FAILURE_MESSAGE,
    ...planConfig,
  });
  const status = order.status;
  let message = order.public_message || "";
  if (!message) {
    if (status === OrderStatus.CREATED || status === OrderStatus.QUEUED) message = "排队中";
    else if (status === OrderStatus.RUNNING) message = "正在处理";
    else if (status === OrderStatus.SUCCEEDED) message = `${plan.display_name} 充值成功`;
    else if (status === OrderStatus.INTERRUPTED_REVIEW) message = "订单异常，请联系管理员";
    else if (status === OrderStatus.FAILED) message = plan.failure_message || DEFAULT_FAILURE_MESSAGE;
    else message = "处理中";
  }
  return {
    order_id: order.order_no,
    plan_type: order.plan_type,
    plan_name: plan.display_name,
    status,
    message,
  };
}

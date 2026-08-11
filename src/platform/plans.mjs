import { normalizePlanType } from "./constants.mjs";

export const DEFAULT_PLAN_NAMES = Object.freeze({
  go: "Go",
  plus: "Plus",
  pro5x: "Pro 5x",
  pro20x: "Pro 20x",
});

export const DEFAULT_FAILURE_MESSAGE = "充值失败，兑换码已返还，请稍后重试或联系管理员。";

function integerInRange(value, fallback, min, max, field) {
  const n = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

export function normalizePlanConfig(input = {}, defaults = {}) {
  const planType = normalizePlanType(input.plan_type ?? input.planType);
  const defaultFailureMessage = String(defaults.failure_message ?? defaults.failureMessage ?? DEFAULT_FAILURE_MESSAGE);
  return {
    plan_type: planType,
    display_name: String(input.display_name ?? input.displayName ?? DEFAULT_PLAN_NAMES[planType]),
    enabled: normalizeBoolean(input.enabled, true),
    payment_country: String(input.payment_country ?? input.paymentCountry ?? defaults.payment_country ?? ""),
    payment_currency: String(input.payment_currency ?? input.paymentCurrency ?? defaults.payment_currency ?? ""),
    checkout_template_key: String(input.checkout_template_key ?? input.checkoutTemplateKey ?? ""),
    checkout_proxy_group_id: integerInRange(input.checkout_proxy_group_id ?? input.checkoutProxyGroupId, 0, 0, Number.MAX_SAFE_INTEGER, "checkout_proxy_group_id"),
    direct_card_proxy_group_id: integerInRange(input.direct_card_proxy_group_id ?? input.directCardProxyGroupId, 0, 0, Number.MAX_SAFE_INTEGER, "direct_card_proxy_group_id"),
    billing_group_id: integerInRange(input.billing_group_id ?? input.billingGroupId, 0, 0, Number.MAX_SAFE_INTEGER, "billing_group_id"),
    failure_message: String(input.failure_message ?? input.failureMessage ?? defaultFailureMessage),
    checkout_max_proxy_attempts: integerInRange(input.checkout_max_proxy_attempts ?? input.checkoutMaxProxyAttempts, 4, 1, 1000, "checkout_max_proxy_attempts"),
    max_proxy_attempts_per_card: integerInRange(input.max_proxy_attempts_per_card ?? input.maxProxyAttemptsPerCard, 4, 1, 1000, "max_proxy_attempts_per_card"),
    allow_card_switch: normalizeBoolean(input.allow_card_switch ?? input.allowCardSwitch, false),
    max_card_switches: integerInRange(input.max_card_switches ?? input.maxCardSwitches, 0, 0, 1000, "max_card_switches"),
  };
}

export function normalizePlanCardGroups(groups = []) {
  return groups
    .map((group) => ({
      card_group_id: integerInRange(group.card_group_id ?? group.cardGroupId ?? group.id, 0, 1, Number.MAX_SAFE_INTEGER, "card_group_id"),
      priority: integerInRange(group.priority, 100, 0, 1000000, "priority"),
    }))
    .sort((left, right) => left.priority - right.priority || left.card_group_id - right.card_group_id);
}

export function buildPlanRuntimeConfig(planConfig, planCardGroups = []) {
  const normalized = normalizePlanConfig(planConfig);
  return {
    ...normalized,
    card_groups: normalizePlanCardGroups(planCardGroups),
  };
}

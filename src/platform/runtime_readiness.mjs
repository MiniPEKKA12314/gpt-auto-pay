import { normalizePlanType } from "./constants.mjs";
import { normalizeIpwoConfig } from "./proxy_provider_ipwo.mjs";
import { normalizeProxyEntries } from "./proxy_pool.mjs";
import { selectBillingAddress, selectCard } from "./selection.mjs";

function proxySummary(store, groupId, label) {
  const id = Number(groupId ?? 0);
  if (!id) {
    return {
      ok: true,
      mode: "direct",
      label,
      group_id: 0,
      message: `${label}: 直连`,
    };
  }

  let group;
  try {
    group = store.getProxyGroupById(id);
  } catch {
    return {
      ok: false,
      mode: "missing",
      label,
      group_id: id,
      message: `${label}: 代理组不存在`,
    };
  }

  if (!group.enabled) {
    return {
      ok: false,
      mode: "disabled",
      label,
      group_id: id,
      name: group.name,
      message: `${label}: 代理组已关闭`,
    };
  }

  if (group.provider === "ipwo") {
    try {
      const config = normalizeIpwoConfig(group.config ?? {});
      return {
        ok: true,
        mode: "ipwo",
        label,
        group_id: id,
        name: group.name,
        provider: group.provider,
        protocol: config.protocol,
        regions: config.regions,
        message: `${label}: IPWO 动态代理已配置（运行时提取）`,
      };
    } catch (error) {
      return {
        ok: false,
        mode: "ipwo_config_invalid",
        label,
        group_id: id,
        name: group.name,
        provider: group.provider,
        message: `${label}: IPWO 配置不完整：${error.message}`,
      };
    }
  }

  if (group.provider !== "static") {
    return {
      ok: false,
      mode: "api_not_connected",
      label,
      group_id: id,
      name: group.name,
      provider: group.provider,
      message: `${label}: API 代理商尚未接入`,
    };
  }

  const entries = normalizeProxyEntries(group.config?.proxies ?? []).filter((entry) => entry.enabled);
  return {
    ok: entries.length > 0,
    mode: "static",
    label,
    group_id: id,
    name: group.name,
    provider: group.provider,
    proxy_count: entries.length,
    message: entries.length > 0 ? `${label}: ${entries.length} 个代理可用` : `${label}: 没有可用代理`,
  };
}

function lightweightCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    card_group_id: card.card_group_id,
    masked_number: card.masked_number,
    priority: card.priority,
    success_count: card.success_count,
    max_success_count: card.max_success_count,
  };
}

function lightweightBillingAddress(address) {
  if (!address) return null;
  return {
    id: address.id,
    billing_group_id: address.billing_group_id,
    name: address.name,
    country: address.country,
    state: address.state,
    city: address.city,
    postal_code: address.postal_code,
    priority: address.priority,
  };
}

export function checkPlanRuntimeReadiness(store, planType) {
  const normalizedPlan = normalizePlanType(planType);
  const plan = store.getPlanConfig(normalizedPlan, { includeCardGroups: true });
  const issues = [];
  const warnings = [];

  if (!plan.enabled) issues.push("套餐已关闭");
  if (!plan.payment_country) warnings.push("付款国家未设置，将使用旧链路默认值 PH");
  if (!plan.payment_currency) warnings.push("付款币种未设置，将使用旧链路默认值 PHP");

  const cardGroups = Array.isArray(plan.card_groups) ? plan.card_groups : [];
  if (cardGroups.length === 0) issues.push("套餐未绑定卡组");
  const kimooxPerOrder = String(plan.kimoox_issue_mode ?? "pool").toLowerCase() === "per_order";
  const card = kimooxPerOrder ? null : selectCard(store.listCards(), cardGroups);
  if (!kimooxPerOrder && cardGroups.length > 0 && !card) issues.push("套餐绑定的卡组里没有可用卡");
  if (kimooxPerOrder) {
    if (!String(plan.kimoox_card_bin_id ?? "").trim()) issues.push("Kimoox 按订单开卡未配置 BIN ID");
    if (!String(plan.vcc_target_balance_usd ?? "").trim()) issues.push("Kimoox 按订单开卡未配置目标余额（USD）");
  }

  if (!Number(plan.billing_group_id)) issues.push("套餐未绑定账单地址组");
  const billingAddress = selectBillingAddress(store.listBillingAddresses(), plan.billing_group_id);
  if (Number(plan.billing_group_id) && !billingAddress) issues.push("账单地址组里没有可用账单地址");

  const checkoutProxy = proxySummary(store, plan.checkout_proxy_group_id, "提链代理");
  const directCardProxy = proxySummary(store, plan.direct_card_proxy_group_id, "直卡代理");
  if (!checkoutProxy.ok) issues.push(checkoutProxy.message);
  if (!directCardProxy.ok) issues.push(directCardProxy.message);

  return {
    ok: issues.length === 0,
    plan_type: normalizedPlan,
    issues,
    warnings,
    plan,
    resources: {
      card: lightweightCard(card),
      billingAddress: lightweightBillingAddress(billingAddress),
    },
    proxies: {
      checkout: checkoutProxy,
      direct_card: directCardProxy,
    },
  };
}

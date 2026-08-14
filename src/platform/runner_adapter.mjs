import { OrderStatus } from "./constants.mjs";
import { cleanupKimooxPerOrderCard, planCardSource } from "./card_lifecycle.mjs";
import { decideNextCheckoutRetry, decideNextRetry, isCheckoutPhaseResult, normalizeRetryPolicy } from "./retry_policy.mjs";
import { selectBillingAddress, selectCard } from "./selection.mjs";

export class RunnerAdapter {
  async execute() {
    throw new Error("RunnerAdapter.execute is not implemented");
  }
}

export function createFunctionRunnerAdapter(fn) {
  if (typeof fn !== "function") throw new Error("runner function is required");
  return {
    execute: fn,
  };
}

function resultFailed(message, extra = {}) {
  return {
    status: "failed",
    message,
    ...extra,
  };
}

function isSuccessResult(result) {
  return result?.status === "success" || result?.ok === true;
}

function resultMessage(result, fallback = "runner failed") {
  return result?.message || result?.error || result?.postClick?.message || result?.postClick?.rawError || fallback;
}

function manualEffectivePlan(plan, manualOptions) {
  if (!manualOptions) return plan;
  const cardGroupId = Number(manualOptions.card_group_id || 0);
  return {
    ...plan,
    billing_group_id: Number(manualOptions.billing_group_id ?? plan.billing_group_id ?? 0),
    checkout_proxy_group_id: Number(manualOptions.checkout_proxy_group_id ?? 0),
    direct_card_proxy_group_id: Number(manualOptions.direct_card_proxy_group_id ?? 0),
    card_groups: cardGroupId > 0 ? [{ card_group_id: cardGroupId, priority: 0 }] : plan.card_groups,
    allow_card_switch: manualOptions.card_id ? false : plan.allow_card_switch,
    max_card_switches: manualOptions.card_id ? 0 : plan.max_card_switches,
  };
}

function failureCodeFields(plan = {}) {
  const lockCode = plan.lock_redeem_code_on_failure === true
    || plan.lock_redeem_code_on_failure === 1
    || plan.lock_redeem_code_on_failure === "1";
  return {
    lock_redeem_code_on_failure: lockCode,
    unavailable_reason: "订单失败后按套餐设置锁定兑换码",
  };
}

async function failOrder(store, orderId, attemptId, message, stage = "runner", now, plan = {}) {
  store.updateOrderAttempt(attemptId, {
    status: "failed",
    stage,
    error_code: "RUNNER_FAILED",
    error_message: message,
  }, now);
  store.addRunLog({
    order_id: orderId,
    attempt_id: attemptId,
    level: "error",
    stage,
    message,
  }, now);
  return store.markOrderFailedAndReleaseCode(orderId, {
    admin_error: message,
    ...failureCodeFields(plan),
  }, now);
}

function remotePerOrderPlaceholderCard(plan = {}) {
  const source = planCardSource(plan);
  if (!["vcc", "kimoox"].includes(source)) return null;
  return {
    id: 0,
    card_group_id: Number(plan.card_groups?.[0]?.card_group_id ?? 0),
    masked_number: source === "kimoox" ? "Kimoox 按订单开卡" : "VCC 按订单开卡",
    provider: source,
    provider_card_id: "",
    success_count: 0,
    max_success_count: 1,
    status: "enabled",
  };
}

function resultCardId(result = {}) {
  return Number(result?.card?.id ?? result?.kimoox_per_order_card?.local_card_id ?? 0);
}


async function cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime = {}, options = {}, attemptId = 0, now = () => Date.now() / 1000, directResult = null) {
  const source = planCardSource(plan);
  if (!["vcc", "kimoox"].includes(source)) return null;
  const cardId = Number(
    source === "vcc"
      ? (retryRuntime.vccPerOrderCardId ?? retryRuntime.vcc_per_order_card_id ?? 0)
      : (retryRuntime.kimooxPerOrderCardId ?? retryRuntime.kimoox_per_order_card_id ?? 0)
  );
  if (!cardId) return null;
  let card;
  try {
    card = store.getCardById(cardId, { includeSecret: true });
  } catch (error) {
    store.addRunLog({
      order_id: order.id,
      attempt_id: attemptId,
      level: "error",
      stage: "kimoox_cleanup",
      message: `${source.toUpperCase()} 临时卡收尾失败：本地卡不存在 ${cardId}`,
      meta: { error: error.message || String(error), card_id: cardId },
    }, now());
    return { ok: false, local_card_id: cardId, errors: [error.message || String(error)] };
  }
  if (card.deleted_at) return { skipped: true, reason: "already_deleted", local_card_id: cardId };
  const emit = createEmit(store, order.id, attemptId, now);
  const cleanup = await cleanupKimooxPerOrderCard({
    store,
    order,
    plan,
    card,
    emit,
    now,
    fetchImpl: options.fetchImpl,
    cardProviderFactory: options.cardProviderFactory,
    retryRuntime,
    directResult,
    success: directResult?.ok === true || directResult?.status === "success",
  });
  retryRuntime.kimooxPerOrderCleanup = cleanup;
  return cleanup;
}

function mergeCleanupIntoResult(result = {}, cleanup = null) {
  if (!cleanup) return result;
  return {
    ...result,
    kimoox_per_order_card: {
      ...(result.kimoox_per_order_card ?? {}),
      cleanup,
    },
  };
}

export function resolveOrderResources(store, order) {
  const manualOptions = typeof store.getManualOrderOptions === "function" ? store.getManualOrderOptions(order.id) : null;
  const plan = manualEffectivePlan(store.getPlanConfig(order.plan_type, { includeCardGroups: true }), manualOptions);
  const card = manualOptions?.card_id
    ? store.getCardById(manualOptions.card_id)
    : remotePerOrderPlaceholderCard(plan) || selectCard(store.listCards(), plan.card_groups);
  const billingAddress = manualOptions?.billing_address_id
    ? store.getBillingAddressById(manualOptions.billing_address_id)
    : selectBillingAddress(store.listBillingAddresses(), plan.billing_group_id);
  return { plan, card, billingAddress, manualOptions };
}

export async function runPlatformOrder(store, orderId, adapter, options = {}) {
  if (!adapter || typeof adapter.execute !== "function") {
    throw new Error("adapter.execute is required");
  }
  const now = options.now ?? (() => Date.now() / 1000);
  let order = store.getOrderById(orderId);
  if (order.status === OrderStatus.QUEUED) {
    order = store.markOrderRunning(order.id, now());
  }
  if (order.status !== OrderStatus.RUNNING) {
    throw new Error(`order must be queued or running, got ${order.status}`);
  }

  const { plan, card, billingAddress } = resolveOrderResources(store, order);
  const retryRuntime = {};
  const attemptNo = store.nextAttemptNo(order.id);
  const attemptId = store.createOrderAttempt({
    order_id: order.id,
    attempt_no: attemptNo,
    card_id: card?.id ?? 0,
    billing_address_id: billingAddress?.id ?? 0,
    status: "running",
    stage: "resource_selected",
  }, now());

  const emit = (event = {}) => {
    store.addRunLog({
      order_id: order.id,
      attempt_id: attemptId,
      level: event.level ?? "info",
      stage: event.stage ?? "runner",
      message: event.message ?? "",
      meta: event.meta ?? {},
    }, now());
  };

  if (!card) {
    return {
      ok: false,
      result: resultFailed("没有可用卡"),
      ...await failOrder(store, order.id, attemptId, "没有可用卡", "select_card", now(), plan),
    };
  }

  if (!billingAddress) {
    return {
      ok: false,
      result: resultFailed("没有可用账单地址"),
      ...await failOrder(store, order.id, attemptId, "没有可用账单地址", "select_billing", now(), plan),
    };
  }

  const secretCard = card.id ? store.getCardById(card.id, { includeSecret: true }) : card;
  emit({ level: "info", stage: "runner", message: "runner 开始执行" });

  let runnerResult;
  try {
    runnerResult = await adapter.execute({
      order,
      plan,
      card: secretCard,
      billingAddress,
      attemptNo,
      attemptId,
      emit,
      retryRuntime,
      signal: options.signal,
      ...options,
    });
  } catch (error) {
    runnerResult = resultFailed(error.message || "runner exception", { error });
  }

  if (isSuccessResult(runnerResult)) {
    const cleanup = await cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
    runnerResult = mergeCleanupIntoResult(runnerResult, cleanup);
    store.updateOrderAttempt(attemptId, {
      status: "success",
      stage: "completed",
    }, now());
    store.addRunLog({
      order_id: order.id,
      attempt_id: attemptId,
      level: "success",
      stage: "completed",
      message: runnerResult.message ?? "订阅成功",
      meta: runnerResult,
    }, now());
    const result = store.markOrderSucceeded(order.id, now());
      const succeededCardId = resultCardId(runnerResult) || card.id;
    const updatedCard = succeededCardId ? store.incrementCardSuccessCount(succeededCardId, now()) : card;
    return {
      ok: true,
      result: runnerResult,
      order: result.order,
      redeemCode: result.redeemCode,
      card: updatedCard,
      billingAddress,
      attempt: store.updateOrderAttempt(attemptId, { status: "success", stage: "completed" }, now()),
    };
  }

  const cleanup = await cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
  runnerResult = mergeCleanupIntoResult(runnerResult, cleanup);
  const message = runnerResult?.message || runnerResult?.error || "runner failed";
  const failed = await failOrder(store, order.id, attemptId, message, "runner", now(), plan);
  return {
    ok: false,
    result: runnerResult,
    order: failed.order,
    redeemCode: failed.redeemCode,
    card,
    billingAddress,
    attempt: store.updateOrderAttempt(attemptId, { status: "failed", stage: "runner", error_message: message }, now()),
  };
}

function createEmit(store, orderId, attemptId, now) {
  return (event = {}) => {
    store.addRunLog({
      order_id: orderId,
      attempt_id: attemptId,
      level: event.level ?? "info",
      stage: event.stage ?? "runner",
      message: event.message ?? "",
      meta: event.meta ?? {},
    }, now());
  };
}

function retryContext(policy, attemptPosition, previousResults) {
  return {
    policy,
    attempt_no: Number(attemptPosition.attempt_no ?? 0),
    card_attempt_index: Number(attemptPosition.card_attempt_index ?? 0),
    checkout_proxy_attempt_index: Number(attemptPosition.checkout_proxy_attempt_index ?? 0),
    proxy_attempt_index: Number(attemptPosition.proxy_attempt_index ?? 0),
    previous_results: previousResults,
  };
}

function ensureAdapter(adapter) {
  if (!adapter || typeof adapter.execute !== "function") {
    throw new Error("adapter.execute is required");
  }
  return adapter;
}

async function finalizeRetriedFailure(store, order, attemptId, runnerResult, message, now) {
  store.updateOrderAttempt(attemptId, {
    status: "failed",
    stage: "runner",
    error_code: runnerResult?.code ?? "RUNNER_FAILED",
    error_message: message,
  }, now());
  store.addRunLog({
    order_id: order.id,
    attempt_id: attemptId,
    level: "error",
    stage: "runner",
    message,
    meta: runnerResult,
  }, now());
}

export async function runPlatformOrderWithRetry(store, orderId, adapterFactory, options = {}) {
  if (typeof adapterFactory !== "function") throw new Error("adapterFactory is required");
  const now = options.now ?? (() => Date.now() / 1000);
  let order = store.getOrderById(orderId);
  if (order.status === OrderStatus.QUEUED) {
    order = store.markOrderRunning(order.id, now());
  }
  if (order.status !== OrderStatus.RUNNING) {
    throw new Error(`order must be queued or running, got ${order.status}`);
  }

  const manualOptions = typeof store.getManualOrderOptions === "function" ? store.getManualOrderOptions(order.id) : null;
  const plan = manualEffectivePlan(store.getPlanConfig(order.plan_type, { includeCardGroups: true }), manualOptions);
  const policy = normalizeRetryPolicy(plan);
  const billingAddress = manualOptions?.billing_address_id
    ? store.getBillingAddressById(manualOptions.billing_address_id)
    : selectBillingAddress(store.listBillingAddresses(), plan.billing_group_id);
  const previousResults = [];
  const retryRuntime = {};
  const attemptedCardIds = new Set();
  let card = null;
  let cardAttemptIndex = 0;
  let checkoutProxyAttemptIndex = 0;
  let proxyAttemptIndex = 0;
  const maxLoopCount = policy.checkout_max_proxy_attempts + (policy.max_card_count * policy.max_proxy_attempts_per_card) + 2;

  for (let loop = 0; loop < maxLoopCount; loop += 1) {
    if (!billingAddress) {
      const attemptId = store.createOrderAttempt({
        order_id: order.id,
        attempt_no: store.nextAttemptNo(order.id),
        card_id: card?.id ?? 0,
        billing_address_id: 0,
        status: "failed",
        stage: "select_billing",
        error_code: "NO_BILLING_ADDRESS",
        error_message: "没有可用账单地址",
      }, now());
      const failed = await failOrder(store, order.id, attemptId, "没有可用账单地址", "select_billing", now(), plan);
      return {
        ok: false,
        result: resultFailed("没有可用账单地址", { code: "NO_BILLING_ADDRESS" }),
        order: failed.order,
        redeemCode: failed.redeemCode,
        card,
        billingAddress: null,
        attempts: previousResults,
      };
    }

    if (!card) {
      card = manualOptions?.card_id
        ? store.getCardById(manualOptions.card_id)
        : remotePerOrderPlaceholderCard(plan) || selectCard(store.listCards(), plan.card_groups, { excludeCardIds: attemptedCardIds });
      if (!card) {
        const attemptId = store.createOrderAttempt({
          order_id: order.id,
          attempt_no: store.nextAttemptNo(order.id),
          card_id: 0,
          billing_address_id: billingAddress.id,
          status: "failed",
          stage: "select_card",
          error_code: "NO_CARD_AVAILABLE",
          error_message: "没有可用卡",
        }, now());
        const failed = await failOrder(store, order.id, attemptId, "没有可用卡", "select_card", now(), plan);
        return {
          ok: false,
          result: resultFailed("没有可用卡", { code: "NO_CARD_AVAILABLE" }),
          order: failed.order,
          redeemCode: failed.redeemCode,
          card: null,
          billingAddress,
          attempts: previousResults,
        };
      }
      if (card.id) attemptedCardIds.add(Number(card.id));
    }

    const secretCard = card.id ? store.getCardById(card.id, { includeSecret: true }) : card;
    const attemptNo = store.nextAttemptNo(order.id);
    const attemptPosition = {
      attempt_no: attemptNo,
      card_attempt_index: cardAttemptIndex,
      checkout_proxy_attempt_index: checkoutProxyAttemptIndex,
      proxy_attempt_index: proxyAttemptIndex,
    };
    const attemptId = store.createOrderAttempt({
      order_id: order.id,
      attempt_no: attemptNo,
      card_id: card.id ?? 0,
      billing_address_id: billingAddress.id,
      status: "running",
      stage: "resource_selected",
    }, now());
    const emit = createEmit(store, order.id, attemptId, now);
    const retry = retryContext(policy, attemptPosition, previousResults);
    retry.runtime = retryRuntime;
    retry.retry_runtime = retryRuntime;
    emit({
      level: "info",
      stage: "runner",
      message: `runner 开始执行：提链代理尝试 ${checkoutProxyAttemptIndex + 1}/${policy.checkout_max_proxy_attempts}，卡尝试 ${cardAttemptIndex + 1}/${policy.max_card_count}，直卡代理尝试 ${proxyAttemptIndex + 1}/${policy.max_proxy_attempts_per_card}`,
      meta: { retry },
    });

    let runnerResult;
    try {
      const adapter = ensureAdapter(await adapterFactory({
        store,
        order,
        plan,
        card: secretCard,
        billingAddress,
        attemptNo,
        attemptId,
        retry,
        retryRuntime,
        signal: options.signal,
      }));
      runnerResult = await adapter.execute({
        order,
        plan,
        card: secretCard,
        billingAddress,
        attemptNo,
        attemptId,
        retry,
        retryRuntime,
        emit,
        signal: options.signal,
        ...options,
      });
    } catch (error) {
      runnerResult = resultFailed(error.message || "runner exception", {
        code: "RUNNER_EXCEPTION",
        error,
      });
    }

    if (isSuccessResult(runnerResult)) {
      const cleanup = await cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
      runnerResult = mergeCleanupIntoResult(runnerResult, cleanup);
      store.updateOrderAttempt(attemptId, {
        status: "success",
        stage: "completed",
      }, now());
      store.addRunLog({
        order_id: order.id,
        attempt_id: attemptId,
        level: "success",
        stage: "completed",
        message: runnerResult.message ?? "订阅成功",
        meta: runnerResult,
      }, now());
      const result = store.markOrderSucceeded(order.id, now());
      const succeededCardId = resultCardId(runnerResult) || card.id;
      const updatedCard = succeededCardId ? store.incrementCardSuccessCount(succeededCardId, now()) : card;
      return {
        ok: true,
        result: runnerResult,
        order: result.order,
        redeemCode: result.redeemCode,
        card: updatedCard,
        billingAddress,
        attempt: store.updateOrderAttempt(attemptId, { status: "success", stage: "completed" }, now()),
        attempts: previousResults.concat({
          attempt_id: attemptId,
          attempt_no: attemptNo,
          card_id: card.id ?? 0,
          billing_address_id: billingAddress.id,
          result: runnerResult,
          decision: { action: "complete" },
        }),
      };
    }

    const message = resultMessage(runnerResult);
    await finalizeRetriedFailure(store, order, attemptId, runnerResult, message, now);
    const checkoutFailure = isCheckoutPhaseResult(runnerResult);
    const decision = checkoutFailure
      ? decideNextCheckoutRetry(runnerResult, policy, attemptPosition)
      : decideNextRetry(runnerResult, policy, attemptPosition);
    previousResults.push({
      attempt_id: attemptId,
      attempt_no: attemptNo,
      card_id: card.id ?? 0,
      billing_address_id: billingAddress.id,
      result: runnerResult,
      decision,
    });

    if (decision.action === "retry_checkout_proxy") {
      store.addRunLog({
        order_id: order.id,
        attempt_id: attemptId,
        level: "warn",
        stage: "retry",
        message: `提链失败，继续换提链代理重试：下一次提链代理尝试 ${decision.next.checkout_proxy_attempt_index + 1}/${policy.checkout_max_proxy_attempts}`,
        meta: decision,
      }, now());
      checkoutProxyAttemptIndex = decision.next.checkout_proxy_attempt_index;
      continue;
    }

    if (decision.action === "retry_proxy") {
      store.addRunLog({
        order_id: order.id,
        attempt_id: attemptId,
        level: "warn",
        stage: "retry",
        message: `本次失败，继续换代理重试：下一次代理尝试 ${decision.next.proxy_attempt_index + 1}/${policy.max_proxy_attempts_per_card}`,
        meta: decision,
      }, now());
      proxyAttemptIndex = decision.next.proxy_attempt_index;
      continue;
    }

    if (decision.action === "switch_card") {
      store.addRunLog({
        order_id: order.id,
        attempt_id: attemptId,
        level: "warn",
        stage: "retry",
        message: `本次失败，切换下一张卡重试：下一张卡尝试 ${decision.next.card_attempt_index + 1}/${policy.max_card_count}`,
        meta: decision,
      }, now());
      cardAttemptIndex = decision.next.card_attempt_index;
      proxyAttemptIndex = decision.next.proxy_attempt_index;
      card = null;
      continue;
    }

    const cleanup = await cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
    runnerResult = mergeCleanupIntoResult(runnerResult, cleanup);
    const cleanupSuffix = cleanup?.ok === false ? `?Kimoox ???????: ${(cleanup.errors || []).join("; ")}` : "";
    const failed = store.markOrderFailedAndReleaseCode(order.id, {
      admin_error: message + cleanupSuffix,
      ...failureCodeFields(plan),
    }, now());
    return {
      ok: false,
      result: runnerResult,
      order: failed.order,
      redeemCode: failed.redeemCode,
      card,
      billingAddress,
      attempt: store.updateOrderAttempt(attemptId, {
        status: "failed",
        stage: "runner",
        error_message: message,
      }, now()),
      attempts: previousResults,
    };
  }

  const runnerResult = null;
  const message = "重试次数异常耗尽";
  const attemptId = store.createOrderAttempt({
    order_id: order.id,
    attempt_no: store.nextAttemptNo(order.id),
    card_id: card?.id ?? 0,
    billing_address_id: billingAddress?.id ?? 0,
    status: "failed",
    stage: "retry_guard",
    error_code: "RETRY_GUARD_EXHAUSTED",
    error_message: message,
  }, now());
  const cleanup = await cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
  const failed = await failOrder(store, order.id, attemptId, message + (cleanup?.ok === false ? `；远程临时卡收尾失败: ${(cleanup.errors || []).join("; ")}` : ""), "retry_guard", now(), plan);
  return {
    ok: false,
    result: resultFailed(message, { code: "RETRY_GUARD_EXHAUSTED" }),
    order: failed.order,
    redeemCode: failed.redeemCode,
    card,
    billingAddress,
    attempts: previousResults,
  };
}

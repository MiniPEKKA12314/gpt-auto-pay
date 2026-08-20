import { OrderStatus } from "./constants.mjs";
import { cleanupKimooxPerOrderCard, createCardLifecycleProvider, planCardSource } from "./card_lifecycle.mjs";
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

function executionWasCancelled(store, orderId, signal) {
  if (signal?.aborted) return true;
  try {
    return store.getOrderById(orderId).status !== "running";
  } catch {
    return Boolean(signal?.aborted);
  }
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

function releaseOrderLeases(store, orderId, now) {
  if (typeof store.releaseOrderResourceLeases === "function") {
    store.releaseOrderResourceLeases(orderId, now());
  }
}

function clearKimooxPerOrderRetryRuntime(retryRuntime = {}) {
  if (!retryRuntime || typeof retryRuntime !== "object") return;
  delete retryRuntime.kimooxPerOrderCardId;
  delete retryRuntime.kimoox_per_order_card_id;
  delete retryRuntime.kimooxProviderCardId;
  delete retryRuntime.kimoox_provider_card_id;
  delete retryRuntime.kimooxRequestNo;
  delete retryRuntime.kimoox_request_no;
  delete retryRuntime.kimooxApplyTaskId;
  delete retryRuntime.kimooxApplyBatchNo;
  delete retryRuntime.kimooxOpenSubmitted;
  delete retryRuntime.kimooxPerOrderCleanup;
}

function collectKimooxCardIds(value, result = new Set(), seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectKimooxCardIds(item, result, seen);
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/card(?:Id|_id)|userBankId|bankCardId/i.test(key) && (typeof child === "string" || typeof child === "number")) {
      const text = String(child).trim();
      if (text) result.add(text);
    }
    collectKimooxCardIds(child, result, seen);
  }
  return result;
}

async function resolveKimooxRemoteCard(provider, order, retryRuntime = {}) {
  const providerCardId = String(retryRuntime.kimooxProviderCardId ?? retryRuntime.kimoox_provider_card_id ?? "").trim();
  const requestNo = String(retryRuntime.kimooxRequestNo ?? retryRuntime.kimoox_request_no ?? "").trim();
  const taskId = String(retryRuntime.kimooxApplyTaskId ?? retryRuntime.kimoox_apply_task_id ?? "").trim();
  const batchNo = String(retryRuntime.kimooxApplyBatchNo ?? retryRuntime.kimoox_apply_batch_no ?? "").trim();
  const candidates = [];
  if (providerCardId) candidates.push({ cardId: providerCardId });
  if (!providerCardId && (taskId || batchNo || requestNo)) {
    const detail = await provider.getOpenCardDetail({ taskId, batchNo, requestNo });
    for (const id of collectKimooxCardIds(detail)) candidates.push({ cardId: id });
  }
  if (batchNo) candidates.push({ batchNo });
  if (order?.order_no) candidates.push({ remark: `order ${order.order_no}`.slice(0, 40) });
  if (requestNo) candidates.push({ remark: requestNo });
  const seen = new Set();
  for (const input of candidates) {
    const key = JSON.stringify(input);
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = await provider.listCards({ ...input, pageNum: 1, pageSize: 20 });
    const remote = Array.isArray(rows)
      ? rows.find((row) => String(row.provider_card_id ?? row.providerCardId ?? "").trim())
      : null;
    if (remote) return remote;
  }
  return null;
}

function recordKimooxCleanup(store, attemptId, cleanup, now) {
  if (!attemptId || typeof store.updateOrderAttemptProviderCleanup !== "function" || !cleanup) return;
  const completed = (cleanup.ok === true || cleanup.skipped === true) && cleanup.pending !== true;
  store.updateOrderAttemptProviderCleanup(attemptId, {
    status: completed ? "completed" : "pending",
    error: completed ? "" : (cleanup.errors || []).join("; "),
    at: now(),
  }, now());
}


async function cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime = {}, options = {}, attemptId = 0, now = () => Date.now() / 1000, directResult = null) {
  const source = planCardSource(plan);
  if (!["vcc", "kimoox"].includes(source)) return null;
  const cardId = Number(
    source === "vcc"
      ? (retryRuntime.vccPerOrderCardId ?? retryRuntime.vcc_per_order_card_id ?? 0)
      : (retryRuntime.kimooxPerOrderCardId ?? retryRuntime.kimoox_per_order_card_id ?? 0)
  );
  if (!cardId && source === "kimoox" && retryRuntime.kimooxOpenSubmitted) {
    const requestNo = String(retryRuntime.kimooxRequestNo ?? retryRuntime.kimoox_request_no ?? "").trim();
    if (!requestNo) return { ok: false, pending: true, errors: ["Kimoox 开卡请求已提交但缺少 requestNo，无法定位远端卡"] };
    try {
      const provider = createCardLifecycleProvider(store, options)("kimoox");
      const remote = await resolveKimooxRemoteCard(provider, order, retryRuntime);
      if (!remote) {
        const pending = { ok: false, pending: true, request_no: requestNo, errors: ["Kimoox 开卡请求已提交，但当前尚未查询到对应远端卡；已保留请求信息等待后续核对"] };
        store.addRunLog({ order_id: order.id, attempt_id: attemptId, level: "error", stage: "kimoox_cleanup", message: pending.errors[0], meta: pending }, now());
        return pending;
      }
      const remoteCard = {
        id: 0,
        provider: "kimoox",
        provider_card_id: remote.provider_card_id,
        masked_number: remote.masked_number || remote.cardNoMask || "Kimoox remote card",
        status: "enabled",
      };
      const cleanup = await cleanupKimooxPerOrderCard({
        store,
        order,
        plan,
        card: remoteCard,
        emit: createEmit(store, order.id, attemptId, now),
        now,
        fetchImpl: options.fetchImpl,
        cardProviderFactory: options.cardProviderFactory,
        retryRuntime,
        directResult,
        success: directResult?.ok === true || directResult?.status === "success",
      });
      return { ...cleanup, orphan_recovered: true, provider_card_id: remote.provider_card_id, request_no: requestNo };
    } catch (error) {
      const errorMessage = error.message || String(error);
      if (/开卡任务不存在|open(?:ing)? card task (?:does not exist|not found)/i.test(errorMessage)) {
        const skipped = {
          ok: true,
          skipped: true,
          reason: "open_request_not_created",
          request_no: requestNo,
          message: "Kimoox 未创建对应开卡任务，无远端卡需要收尾",
        };
        store.addRunLog({
          order_id: order.id,
          attempt_id: attemptId,
          level: "warn",
          stage: "kimoox_cleanup",
          message: skipped.message,
          meta: { ...skipped, provider_error: errorMessage },
        }, now());
        return skipped;
      }
      const failed = { ok: false, pending: true, request_no: requestNo, errors: [errorMessage] };
      store.addRunLog({ order_id: order.id, attempt_id: attemptId, level: "error", stage: "kimoox_cleanup", message: `Kimoox 孤儿卡清理失败: ${failed.errors[0]}`, meta: failed }, now());
      return failed;
    }
  }
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

export async function reconcileKimooxOrphanOperation(store, attempt, options = {}) {
  if (!store || !attempt?.order_id || !attempt.provider_request_no) return { skipped: true, reason: "missing_operation" };
  const order = store.getOrderById(attempt.order_id);
  const plan = store.getPlanConfig(order.plan_type, { includeCardGroups: true });
  const retryRuntime = {
    kimooxOpenSubmitted: true,
    kimooxRequestNo: attempt.provider_request_no,
    kimooxApplyTaskId: attempt.provider_task_id,
    kimooxApplyBatchNo: attempt.provider_batch_no,
    kimooxProviderCardId: attempt.provider_card_id,
    kimooxPerOrderCardId: attempt.card_id,
  };
  const cleanup = await cleanupPerOrderRuntimeCard(
    store,
    order,
    plan,
    retryRuntime,
    options,
    attempt.id,
    options.now ?? (() => Date.now() / 1000),
    order.status === "succeeded" ? { ok: true, status: "success" } : null,
  );
  recordKimooxCleanup(store, attempt.id, cleanup, options.now ?? (() => Date.now() / 1000));
  return cleanup;
}

async function safeCleanupAfterSuccess(store, order, plan, retryRuntime, options, attemptId, now, runnerResult) {
  try {
    const cleanup = await cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
    recordKimooxCleanup(store, attemptId, cleanup, now);
    return cleanup;
  } catch (error) {
    const cleanup = { ok: false, errors: [error.message || String(error)] };
    store.addRunLog({
      order_id: order.id,
      attempt_id: attemptId,
      level: "error",
      stage: "post_success_cleanup",
      message: `Payment was confirmed, but remote-card cleanup failed: ${cleanup.errors[0]}`,
      meta: cleanup,
    }, now());
    return cleanup;
  }
}

function incrementCardSuccessSafely(store, order, attemptId, cardId, card, now) {
  if (!cardId) return card;
  try {
    return store.incrementCardSuccessCount(cardId, now());
  } catch (error) {
    store.addRunLog({
      order_id: order.id,
      attempt_id: attemptId,
      level: "error",
      stage: "post_success_card_stats",
      message: `Payment was confirmed, but card success statistics failed: ${error.message || error}`,
      meta: { card_id: cardId },
    }, now());
    return card;
  }
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

  try {
  const { plan, card, billingAddress } = resolveOrderResources(store, order);
  const cardLeased = !card?.id || store.acquireCardLease(card.id, order.id, now());
  const billingLeased = !billingAddress?.id || store.acquireBillingAddressLease(billingAddress.id, order.id, now());
  if (card?.id) store.touchCardLastUsed(card.id, now());
  if (billingAddress?.id) store.touchBillingAddressLastUsed(billingAddress.id, now());
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

  if (!card || !cardLeased) {
    releaseOrderLeases(store, order.id, now);
    return {
      ok: false,
      result: resultFailed("没有可用卡"),
      ...await failOrder(store, order.id, attemptId, "没有可用卡", "select_card", now(), plan),
    };
  }

  if (!billingAddress || !billingLeased) {
    releaseOrderLeases(store, order.id, now);
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
    const result = store.markOrderSucceeded(order.id, now());
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
    const cleanup = await safeCleanupAfterSuccess(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
    runnerResult = mergeCleanupIntoResult(runnerResult, cleanup);
    const succeededCardId = resultCardId(runnerResult) || card.id;
    const updatedCard = incrementCardSuccessSafely(store, order, attemptId, succeededCardId, card, now);
    releaseOrderLeases(store, order.id, now);
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
  recordKimooxCleanup(store, attemptId, cleanup, now);
  runnerResult = mergeCleanupIntoResult(runnerResult, cleanup);
  const message = runnerResult?.message || runnerResult?.error || "runner failed";
  const failed = await failOrder(store, order.id, attemptId, message, "runner", now(), plan);
  releaseOrderLeases(store, order.id, now);
  return {
    ok: false,
    result: runnerResult,
    order: failed.order,
    redeemCode: failed.redeemCode,
    card,
    billingAddress,
    attempt: store.updateOrderAttempt(attemptId, { status: "failed", stage: "runner", error_message: message }, now()),
  };
  } finally {
    releaseOrderLeases(store, order.id, now);
  }
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

  try {
  const manualOptions = typeof store.getManualOrderOptions === "function" ? store.getManualOrderOptions(order.id) : null;
  const plan = manualEffectivePlan(store.getPlanConfig(order.plan_type, { includeCardGroups: true }), manualOptions);
  const policy = normalizeRetryPolicy(plan);
  const billingAddress = manualOptions?.billing_address_id
    ? store.getBillingAddressById(manualOptions.billing_address_id)
    : selectBillingAddress(store.listBillingAddresses(), plan.billing_group_id);
  if (billingAddress?.id) store.touchBillingAddressLastUsed(billingAddress.id, now());
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
      if (card.id) {
        if (!store.acquireCardLease(card.id, order.id, now())) {
          attemptedCardIds.add(Number(card.id));
          card = null;
          continue;
        }
        attemptedCardIds.add(Number(card.id));
        store.touchCardLastUsed(card.id, now());
      }
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
        code: error.code || "RUNNER_EXCEPTION",
        error,
      });
    }

    if (executionWasCancelled(store, order.id, options.signal)) {
      store.updateOrderAttempt(attemptId, {
        status: "cancelled",
        stage: "interrupted",
        error_code: "ORDER_EXECUTION_CANCELLED",
        error_message: "订单已被管理员终止，未再修改订单最终状态",
      }, now());
      store.addRunLog({
        order_id: order.id,
        attempt_id: attemptId,
        level: "error",
        stage: "interrupted",
        message: "订单执行已中断；订单保持待核对状态，兑换码不会自动返还",
        meta: { cancelled: true, signal_aborted: Boolean(options.signal?.aborted) },
      }, now());
      return {
        ok: false,
        cancelled: true,
        result: resultFailed("订单执行已被终止，等待管理员核对", { code: "ORDER_EXECUTION_CANCELLED" }),
        order: store.getOrderById(order.id),
        redeemCode: store.getRedeemCodeById(order.redeem_code_id),
        card,
        billingAddress,
        attempt: store.listOrderAttempts(order.id).find((row) => Number(row.id) === Number(attemptId)) ?? null,
        attempts: previousResults,
      };
    }

    if (isSuccessResult(runnerResult)) {
      const result = store.markOrderSucceeded(order.id, now());
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
      const cleanup = await safeCleanupAfterSuccess(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
      runnerResult = mergeCleanupIntoResult(runnerResult, cleanup);
      const succeededCardId = resultCardId(runnerResult) || card.id;
      const updatedCard = incrementCardSuccessSafely(store, order, attemptId, succeededCardId, card, now);
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
      if (card?.id) store.releaseCardLease(card.id, order.id, now());
      let previousCardCleanup = null;
      if (planCardSource(plan) === "kimoox") {
        try {
          previousCardCleanup = await cleanupPerOrderRuntimeCard(
            store,
            order,
            plan,
            retryRuntime,
            options,
            attemptId,
            now,
            runnerResult,
          );
          recordKimooxCleanup(store, attemptId, previousCardCleanup, now);
        } catch (error) {
          previousCardCleanup = { ok: false, errors: [error.message || String(error)] };
          store.addRunLog({
            order_id: order.id,
            attempt_id: attemptId,
            level: "error",
            stage: "kimoox_cleanup",
            message: `Kimoox 临时卡切换前收尾异常，已保留异常记录并继续开新卡：${error.message || error}`,
            meta: previousCardCleanup,
          }, now());
        }
        previousResults[previousResults.length - 1].previous_card_cleanup = previousCardCleanup;
        if (previousCardCleanup && (previousCardCleanup.ok === false || previousCardCleanup.pending === true)) {
          const cleanupError = (previousCardCleanup.errors || ["Kimoox 临时卡收尾未确认"]).join("; ");
          const failed = store.markOrderFailedAndReleaseCode(order.id, {
            admin_error: `${message}；Kimoox 临时卡收尾未确认: ${cleanupError}`,
            ...failureCodeFields(plan),
          }, now());
          return {
            ok: false,
            cleanup_pending: true,
            result: mergeCleanupIntoResult(runnerResult, previousCardCleanup),
            order: failed.order,
            redeemCode: failed.redeemCode,
            card,
            billingAddress,
            attempts: previousResults,
          };
        }
        clearKimooxPerOrderRetryRuntime(retryRuntime);
      }
      store.addRunLog({
        order_id: order.id,
        attempt_id: attemptId,
        level: "warn",
        stage: "retry",
        message: planCardSource(plan) === "kimoox"
          ? `本次失败，已按失败策略收尾当前 Kimoox 临时卡并新开下一张卡重试：下一张卡尝试 ${decision.next.card_attempt_index + 1}/${policy.max_card_count}`
          : `本次失败，切换下一张卡重试：下一张卡尝试 ${decision.next.card_attempt_index + 1}/${policy.max_card_count}`,
        meta: { ...decision, previous_card_cleanup: previousCardCleanup },
      }, now());
      cardAttemptIndex = decision.next.card_attempt_index;
      proxyAttemptIndex = decision.next.proxy_attempt_index;
      card = null;
      continue;
    }

    const cleanup = await cleanupPerOrderRuntimeCard(store, order, plan, retryRuntime, options, attemptId, now, runnerResult);
    recordKimooxCleanup(store, attemptId, cleanup, now);
    runnerResult = mergeCleanupIntoResult(runnerResult, cleanup);
    const cleanupSuffix = cleanup?.ok === false
      ? `；Kimoox 临时卡收尾未确认: ${(cleanup.errors || []).join("; ")}`
      : "";
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
  recordKimooxCleanup(store, attemptId, cleanup, now);
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
  } finally {
    releaseOrderLeases(store, order.id, now);
  }
}

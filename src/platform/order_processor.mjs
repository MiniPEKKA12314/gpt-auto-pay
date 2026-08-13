import { CheckoutSessionAdapter } from "./checkout_runner_adapter.mjs";
import { DirectCardRunnerAdapter } from "./direct_card_runner_adapter.mjs";
import {
  ensureVccCardBalanceBeforeDirectCard,
  planUsesKimooxPerOrder,
  prepareKimooxPerOrderCard,
  runCardLifecycleAction,
} from "./card_lifecycle.mjs";
import { PlatformStoreError } from "./db.mjs";
import { selectProxyForAttempt, selectProxyForAttemptAsync } from "./proxy_pool.mjs";

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return "";
}

function failedResult(message, code, extra = {}) {
  return {
    ok: false,
    status: "failed",
    code,
    message,
    ...extra,
  };
}

function proxyGroupForPlan(store, plan, field) {
  const groupId = Number(plan?.[field] ?? 0);
  if (!groupId) return null;
  try {
    return store.getProxyGroupById(groupId);
  } catch (error) {
    if (error instanceof PlatformStoreError && error.code === "NOT_FOUND") return { missing: true, id: groupId };
    throw error;
  }
}

export function resolveAttemptProxy(store, plan, field, retry = {}) {
  const proxyGroup = proxyGroupForPlan(store, plan, field);
  if (!proxyGroup) {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      proxyChain: [],
      reason: "direct",
    };
  }
  if (proxyGroup.missing) {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      proxyChain: [],
      reason: "proxy_group_not_found",
      error: `代理组不存在: ${proxyGroup.id}`,
    };
  }
  const attemptIndex = field === "checkout_proxy_group_id"
    ? retry.checkout_proxy_attempt_index ?? retry.checkoutProxyAttemptIndex ?? retry.proxy_attempt_index ?? retry.proxyAttemptIndex ?? 0
    : retry.proxy_attempt_index ?? retry.proxyAttemptIndex ?? 0;
  const selected = selectProxyForAttempt(proxyGroup, {
    attemptIndex,
  });
  return {
    ...selected,
    proxyChain: selected.proxyUrl ? [selected.proxyUrl] : [],
    group: proxyGroup,
    error: selected.reason && selected.reason !== "direct" ? `代理组不可用: ${selected.reason}` : "",
  };
}

export async function resolveAttemptProxyAsync(store, plan, field, retry = {}, options = {}) {
  const proxyGroup = proxyGroupForPlan(store, plan, field);
  if (!proxyGroup) {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      proxyChain: [],
      reason: "direct",
    };
  }
  if (proxyGroup.missing) {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      proxyChain: [],
      reason: "proxy_group_not_found",
      error: `代理组不存在: ${proxyGroup.id}`,
    };
  }
  const attemptIndex = field === "checkout_proxy_group_id"
    ? retry.checkout_proxy_attempt_index ?? retry.checkoutProxyAttemptIndex ?? retry.proxy_attempt_index ?? retry.proxyAttemptIndex ?? 0
    : retry.proxy_attempt_index ?? retry.proxyAttemptIndex ?? 0;
  const selected = await selectProxyForAttemptAsync(proxyGroup, {
    attemptIndex,
    fetchImpl: options.fetchImpl,
    session: options.session ?? options.session_id ?? options.sessionId,
  });
  return {
    ...selected,
    proxyChain: selected.proxyUrl ? [selected.proxyUrl] : [],
    group: proxyGroup,
    error: selected.reason && selected.reason !== "direct"
      ? `代理组不可用: ${selected.reason}${selected.error ? ` (${selected.error})` : ""}`
      : "",
  };
}

export class PlatformPaymentAttemptAdapter {
  constructor(options = {}) {
    this.store = options.store;
    if (!this.store) throw new Error("store is required");
    this.checkoutAdapterFactory = options.checkoutAdapterFactory ?? ((adapterOptions) => new CheckoutSessionAdapter(adapterOptions));
    this.directCardAdapterFactory = options.directCardAdapterFactory ?? ((adapterOptions) => new DirectCardRunnerAdapter(adapterOptions));
    this.checkoutAdapterOptions = options.checkoutAdapterOptions ?? {};
    this.directCardAdapterOptions = options.directCardAdapterOptions ?? {};
    this.runtimeResolver = options.runtimeResolver;
    this.fetchImpl = options.fetchImpl;
    this.cardProviderFactory = options.cardProviderFactory;
  }

  async resolveRuntime(context) {
    if (typeof this.runtimeResolver === "function") return await this.runtimeResolver(context);
    return this.store.getOrderRuntimeSecrets(context.order.id, { includeSecret: true }) ?? {};
  }

  async execute(context = {}) {
    const emit = typeof context.emit === "function" ? context.emit : () => {};
    const runtime = await this.resolveRuntime(context);
    const checkoutInputAlreadyKnown = firstString(runtime.checkoutInput, runtime.checkout_input);
    let checkoutInput = checkoutInputAlreadyKnown;
    let checkoutProxy = null;
    let checkoutResult = checkoutInput
      ? {
          ok: true,
          status: "success",
          code: "CHECKOUT_REUSED",
          message: "复用已生成的付款链接",
          checkoutInput,
          checkout_input: checkoutInput,
        }
      : null;

    if (!checkoutInput) {
      checkoutProxy = await resolveAttemptProxyAsync(this.store, context.plan, "checkout_proxy_group_id", context.retry);
      if (checkoutProxy.error) {
        return failedResult(checkoutProxy.error, "CHECKOUT_PROXY_UNAVAILABLE", { phase: "checkout", proxy: checkoutProxy });
      }
      if (context.attemptId) {
        this.store.setOrderAttemptProxies(context.attemptId, {
          checkoutProxy: checkoutProxy.redactedProxyUrl || "",
          checkoutProxySession: checkoutProxy.session || checkoutProxy.ipwo?.session || checkoutProxy.entry?.session || "",
        });
      }
      emit({
        level: "info",
        stage: "checkout_proxy",
        message: checkoutProxy.proxyUrl ? `提链代理: ${checkoutProxy.redactedProxyUrl}` : "提链代理: 直连",
        meta: checkoutProxy,
      });

      const checkoutAdapter = this.checkoutAdapterFactory({
        ...this.checkoutAdapterOptions,
      });
      checkoutResult = await checkoutAdapter.execute({
        ...context,
        runtime,
        checkoutProxyUrl: checkoutProxy.proxyUrl,
        checkoutProxyChain: checkoutProxy.proxyChain,
        redactedCheckoutProxyUrl: checkoutProxy.redactedProxyUrl,
        emit,
      });
      if (!checkoutResult?.ok) {
        return {
          ...checkoutResult,
          phase: "checkout",
          code: checkoutResult?.code ?? "CHECKOUT_FAILED",
        };
      }
      checkoutInput = firstString(checkoutResult.checkoutInput, checkoutResult.checkout_input);
      if (!checkoutInput) {
        return failedResult("提链成功但没有返回可用于直卡的 checkout input", "CHECKOUT_INPUT_MISSING", { phase: "checkout", checkout: checkoutResult });
      }
      this.store.setOrderRuntimeCheckoutInput(context.order.id, checkoutInput);
    } else {
      emit({
        level: "info",
        stage: "checkout",
        message: "复用订单已保存的 checkout input",
      });
    }

    const reuseCheckoutProxySession = Boolean(
      checkoutProxy?.session &&
      checkoutProxy?.group?.kind === "shared" &&
      Number(context.plan?.checkout_proxy_group_id || 0) > 0 &&
      Number(context.plan?.checkout_proxy_group_id || 0) === Number(context.plan?.direct_card_proxy_group_id || 0) &&
      Number(context.retry?.proxy_attempt_index ?? context.retry?.proxyAttemptIndex ?? 0) === 0
    );
    const directCardProxy = await resolveAttemptProxyAsync(
      this.store,
      context.plan,
      "direct_card_proxy_group_id",
      context.retry,
      reuseCheckoutProxySession ? { session: checkoutProxy.session } : {},
    );
    if (directCardProxy.error) {
      return failedResult(directCardProxy.error, "DIRECT_CARD_PROXY_UNAVAILABLE", {
        phase: "direct_card",
        checkout: checkoutResult,
        proxy: directCardProxy,
      });
    }
    if (context.attemptId) {
      this.store.setOrderAttemptProxies(context.attemptId, {
        directCardProxy: directCardProxy.redactedProxyUrl || "",
        directCardProxySession: directCardProxy.session || directCardProxy.ipwo?.session || directCardProxy.entry?.session || "",
      });
    }
    emit({
      level: "info",
      stage: "direct_card_proxy",
      message: directCardProxy.proxyUrl ? `直卡代理: ${directCardProxy.redactedProxyUrl}` : "直卡代理: 直连",
      meta: directCardProxy,
    });

    const directCardAdapter = this.directCardAdapterFactory({
      ...this.directCardAdapterOptions,
      checkoutInput,
      accessToken: runtime.accessToken ?? runtime.access_token,
      sessionToken: runtime.sessionToken ?? runtime.session_token,
      sessionCookieName: runtime.sessionCookieName ?? runtime.session_cookie_name,
      proxyUrl: directCardProxy.proxyUrl,
      proxyChain: directCardProxy.proxyChain,
    });
    let directResult;
    let directStarted = false;
    let lifecycleAfterAction = "freeze_failure";
    let effectiveCard = context.card;
    let lifecycleContext;
    let perOrderCard = null;
    try {
      lifecycleContext = {
        ...context,
        card: effectiveCard,
        store: this.store,
        emit,
        fetchImpl: this.fetchImpl ?? context.fetchImpl,
        cardProviderFactory: this.cardProviderFactory ?? context.cardProviderFactory,
        retryRuntime: context.retryRuntime ?? context.retry?.runtime ?? context.retry?.retry_runtime,
      };
      if (planUsesKimooxPerOrder(context.plan)) {
        perOrderCard = await prepareKimooxPerOrderCard(lifecycleContext);
        effectiveCard = perOrderCard.card;
        lifecycleContext = { ...lifecycleContext, card: effectiveCard };
      }
      await runCardLifecycleAction("unfreeze", lifecycleContext);
      directStarted = true;
      await ensureVccCardBalanceBeforeDirectCard(lifecycleContext);
      directResult = await directCardAdapter.execute({
        ...context,
        card: effectiveCard,
        runtime,
        checkoutInput,
        checkoutResult,
        directCardProxy,
        emit,
      });
      lifecycleAfterAction = directResult?.status === "success" || directResult?.ok === true ? "freeze_success" : "freeze_failure";
    } catch (error) {
      const errorCode = String(error?.code || "");
      const resultCode = errorCode.startsWith("VCC_") || errorCode.startsWith("KIMOOX_") ? errorCode : "DIRECT_CARD_EXCEPTION";
      directResult = failedResult(error.message || "direct card exception", resultCode, {
        phase: "direct_card",
        error,
      });
      lifecycleAfterAction = "freeze_failure";
    } finally {
      if (directStarted) {
        try {
          await runCardLifecycleAction(lifecycleAfterAction, lifecycleContext ?? {
            ...context,
            card: effectiveCard,
            store: this.store,
            emit,
            fetchImpl: this.fetchImpl ?? context.fetchImpl,
            cardProviderFactory: this.cardProviderFactory ?? context.cardProviderFactory,
          });
        } catch (error) {
          const message = error.message || "VCC remote card freeze failed";
          emit({
            level: "error",
            stage: "card_freeze",
            message,
            meta: { error: message },
          });
          if (directResult?.status === "success" || directResult?.ok === true) {
            directResult = failedResult("Subscription may have succeeded, but VCC remote card freeze failed: " + message, "CARD_FREEZE_FAILED", {
              phase: "direct_card",
              previous: directResult,
            });
          }
        }
      }
    }
    return {
      ...directResult,
      checkout: checkoutResult,
      card: effectiveCard ? {
        id: effectiveCard.id ?? 0,
        masked_number: effectiveCard.masked_number ?? "",
        provider: effectiveCard.provider ?? "",
        provider_card_id: effectiveCard.provider_card_id ?? "",
      } : null,
      directCardProxy: {
        reason: directCardProxy.reason,
        redactedProxyUrl: directCardProxy.redactedProxyUrl,
        session: directCardProxy.session || directCardProxy.ipwo?.session || directCardProxy.entry?.session || "",
        reusedCheckoutSession: reuseCheckoutProxySession,
      },
    };
  }
}

export function createPlatformPaymentAdapterFactory(options = {}) {
  return async ({ store, ...context }) => new PlatformPaymentAttemptAdapter({
    store: options.store ?? store,
    checkoutAdapterFactory: options.checkoutAdapterFactory,
    directCardAdapterFactory: options.directCardAdapterFactory,
    checkoutAdapterOptions: options.checkoutAdapterOptions,
    directCardAdapterOptions: options.directCardAdapterOptions,
    runtimeResolver: options.runtimeResolver,
    context,
    fetchImpl: options.fetchImpl,
    cardProviderFactory: options.cardProviderFactory,
  });
}

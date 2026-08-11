import {
  createCheckoutSession,
  describeCheckoutFailure,
  normalizeCheckoutPlanName,
} from "../../checkout_ph_dry_run.mjs";

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return "";
}

function billingAddressForCheckout(billingAddress = {}) {
  return {
    name: firstString(billingAddress.name),
    address: {
      line1: firstString(billingAddress.line1, billingAddress.address),
      line2: firstString(billingAddress.line2),
      city: firstString(billingAddress.city),
      state: firstString(billingAddress.state),
      postal_code: firstString(billingAddress.postal_code, billingAddress.postalCode),
      country: firstString(billingAddress.country).toUpperCase(),
    },
  };
}

function planNameForCheckout(plan = {}) {
  return normalizeCheckoutPlanName(firstString(
    plan.checkout_template_key,
    plan.checkoutTemplateKey,
    plan.plan_type,
    plan.planType,
    "plus",
  ));
}

function resultMessage(result, fallback = "提链失败") {
  if (!result || typeof result !== "object") return fallback;
  return firstString(
    result.message,
    result.error,
    result.failureStage ? `${result.failureStage} 返回状态 ${result.status ?? ""}` : "",
    fallback,
  );
}

export function normalizeCheckoutRunnerResult(result = {}, options = {}) {
  if (!result || typeof result !== "object") {
    return {
      ok: false,
      status: "failed",
      code: "CHECKOUT_EMPTY_RESULT",
      message: "提链没有返回有效结果",
      checkout: result,
    };
  }

  if (result.ok && result.directCardCheckoutInput) {
    return {
      ok: true,
      status: "success",
      code: "CHECKOUT_SUCCEEDED",
      message: "提链成功",
      checkoutInput: result.directCardCheckoutInput,
      checkout_input: result.directCardCheckoutInput,
      links: result.links ?? [],
      redacted: result.redacted ?? null,
      checkout: {
        ok: result.ok,
        status: result.status,
        planName: result.planName,
        createPlanName: result.createPlanName,
        paymentCountry: result.paymentCountry,
        paymentCurrency: result.paymentCurrency,
        directCardCheckoutInput: result.directCardCheckoutInput,
        checkoutUpdate: result.checkoutUpdate,
      },
    };
  }

  const failureText = describeCheckoutFailure(result, {
    proxyUrl: options.proxyUrl,
    proxyChain: options.proxyChain ?? [],
  });
  return {
    ok: false,
    status: "failed",
    code: "CHECKOUT_FAILED",
    message: firstString(failureText, resultMessage(result)),
    checkout: {
      ok: result.ok,
      status: result.status,
      failureStage: result.failureStage,
      text: result.text,
      parsed: result.parsed,
      redacted: result.redacted,
    },
  };
}

export class CheckoutSessionAdapter {
  constructor(options = {}) {
    this.options = options;
    this.createCheckoutSessionImpl = options.createCheckoutSessionImpl ?? createCheckoutSession;
  }

  async execute(context = {}) {
    const plan = context.plan ?? {};
    const billingAddress = context.billingAddress ?? {};
    const runtime = context.runtime ?? {};
    const accessToken = firstString(
      context.accessToken,
      context.access_token,
      runtime.accessToken,
      runtime.access_token,
      this.options.accessToken,
      this.options.access_token,
    );
    if (!accessToken) {
      return {
        ok: false,
        status: "failed",
        code: "CHECKOUT_ACCESS_TOKEN_REQUIRED",
        message: "提链需要 Access Token",
      };
    }

    const proxyUrl = firstString(context.checkoutProxyUrl, context.proxyUrl, this.options.proxyUrl);
    const proxyChain = Array.isArray(context.checkoutProxyChain)
      ? context.checkoutProxyChain
      : Array.isArray(context.proxyChain)
        ? context.proxyChain
        : Array.isArray(this.options.proxyChain)
          ? this.options.proxyChain
          : [];

    context.emit?.({
      level: "info",
      stage: "checkout",
      message: `开始提链：套餐=${plan.plan_type ?? ""} 地区=${plan.payment_country || "PH"}/${plan.payment_currency || "PHP"}`,
      meta: {
        proxy: context.redactedCheckoutProxyUrl ?? "",
      },
    });

    let result;
    try {
      result = await this.createCheckoutSessionImpl({
        accessToken,
        checkoutEntry: this.options.checkoutEntry,
        proxyUrl,
        proxyChain,
        planName: planNameForCheckout(plan),
        country: firstString(plan.payment_country, plan.paymentCountry, "PH"),
        currency: firstString(plan.payment_currency, plan.paymentCurrency, "PHP"),
        billingAddress: billingAddressForCheckout(billingAddress),
      });
    } catch (error) {
      result = {
        ok: false,
        status: 0,
        failureStage: "checkout/create",
        error: error.message || String(error),
        text: error.message || String(error),
      };
    }

    const normalized = normalizeCheckoutRunnerResult(result, { proxyUrl, proxyChain });
    context.emit?.({
      level: normalized.ok ? "success" : "error",
      stage: "checkout",
      message: normalized.message,
      meta: normalized.checkout,
    });
    return normalized;
  }
}

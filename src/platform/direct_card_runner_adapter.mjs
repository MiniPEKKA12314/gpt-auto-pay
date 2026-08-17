import { runDirectCardPayment } from "../../checkout_ph_dry_run.mjs";
import { RunnerAdapter } from "./runner_adapter.mjs";

const DEFAULT_EMAIL = "gpt-auto-pay@example.com";
const CHECKOUT_INPUT_PATTERN = /^(?:fresh|cs_(?:live|test)_[\w-]+|oaics_[\w-]+|https?:\/\/)/i;

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return "";
}

function firstCheckoutInput(...values) {
  for (const value of values) {
    const text = firstString(value);
    if (text && CHECKOUT_INPUT_PATTERN.test(text)) return text;
  }
  return "";
}

function boolOption(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function cloneDefined(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return value;
}

async function resolveOption(options, key, context) {
  const resolver = options[`${key}Resolver`];
  if (typeof resolver === "function") return await resolver(context);
  return options[key];
}

function compactResult(result = {}) {
  const postClick = result?.postClick && typeof result.postClick === "object"
    ? {
        status: result.postClick.status,
        message: result.postClick.message,
        evidence: result.postClick.evidence,
        rawError: result.postClick.rawError,
        verificationType: result.postClick.verificationType,
        source: result.postClick.source,
        accountVerification: result.postClick.accountVerification,
      }
    : undefined;
  return {
    ok: result?.ok,
    status: result?.status,
    mode: result?.mode,
    error: result?.error,
    filled: result?.filled,
    found: result?.found,
    postClick,
  };
}

function resultMessage(result, fallback) {
  return firstString(
    result?.postClick?.message,
    result?.postClick?.rawError,
    result?.postClick?.evidence,
    result?.message,
    result?.error,
    fallback,
  );
}

function failedResult(message, result, code = "DIRECT_CARD_FAILED") {
  return {
    ok: false,
    status: "failed",
    code,
    message,
    runner: compactResult(result),
  };
}

export function buildDirectCardInputFromContext(context = {}, options = {}) {
  const order = context.order ?? {};
  const plan = context.plan ?? {};
  const card = context.card ?? {};
  const billingAddress = context.billingAddress ?? {};
  const checkoutInput = firstCheckoutInput(
    options.checkoutInput,
    options.checkout_input,
    options.checkoutUrl,
    options.checkout_url,
    order.checkoutInput,
    order.checkout_input,
    order.checkoutUrl,
    order.checkout_url,
    order.sessionId,
    order.session_id,
    plan.checkoutInput,
    plan.checkout_input,
    plan.checkoutUrl,
    plan.checkout_url,
    plan.checkout_template_key,
  );
  const accessToken = firstString(
    options.accessToken,
    options.access_token,
    order.accessToken,
    order.access_token,
    plan.accessToken,
    plan.access_token,
  );
  const sessionToken = firstString(
    options.sessionToken,
    options.session_token,
    options.nextAuthSessionToken,
    order.sessionToken,
    order.session_token,
    order.nextAuthSessionToken,
    plan.sessionToken,
    plan.session_token,
  );

  return {
    number: firstString(options.number, card.number),
    expMonth: firstString(options.expMonth, options.exp_month, card.expMonth, card.exp_month),
    expYear: firstString(options.expYear, options.exp_year, card.expYear, card.exp_year),
    cvc: firstString(options.cvc, card.cvc),
    checkoutInput,
    accessToken,
    sessionToken,
    sessionCookieName: firstString(
      options.sessionCookieName,
      options.session_cookie_name,
      order.sessionCookieName,
      order.session_cookie_name,
      "__Secure-next-auth.session-token",
    ),
    paymentCountry: firstString(options.paymentCountry, options.payment_country, plan.payment_country, plan.paymentCountry, "PH").toUpperCase(),
    paymentCurrency: firstString(options.paymentCurrency, options.payment_currency, plan.payment_currency, plan.paymentCurrency, "PHP").toUpperCase(),
    targetPlanType: firstString(options.targetPlanType, options.target_plan_type, plan.plan_type, plan.planType).toLowerCase(),
    locatePaymentButton: boolOption(options.locatePaymentButton, true),
    clickPaymentButton: boolOption(options.clickPaymentButton, true),
    billing: {
      name: firstString(options.billingName, options.name, billingAddress.name),
      email: firstString(options.email, order.email, order.user_email, billingAddress.email, DEFAULT_EMAIL),
      address: {
        line1: firstString(options.line1, billingAddress.line1, billingAddress.address),
        line2: firstString(options.line2, billingAddress.line2),
        city: firstString(options.city, billingAddress.city),
        state: firstString(options.state, billingAddress.state),
        postal_code: firstString(options.postalCode, options.postal_code, billingAddress.postal_code, billingAddress.postalCode),
        country: firstString(options.billingCountry, options.country, billingAddress.country).toUpperCase(),
      },
    },
  };
}

export function normalizeDirectCardRunnerResult(result = {}) {
  if (!result || typeof result !== "object") {
    return failedResult("直卡 runner 没有返回有效结果", result, "DIRECT_CARD_EMPTY_RESULT");
  }

  const runnerStatus = String(result.status ?? "").toLowerCase();
  const postClickStatus = String(result.postClick?.status ?? "").toLowerCase();
  const successStatuses = new Set(["success", "succeeded", "subscribed", "paid", "completed"]);
  const failedStatuses = new Set([
    "failed",
    "error",
    "fill_incomplete",
    "page_load_failed",
    "declined",
    "payment_failed",
    "card_declined",
  ]);

  if (successStatuses.has(postClickStatus) || (!postClickStatus && successStatuses.has(runnerStatus))) {
    return {
      ok: true,
      status: "success",
      code: "DIRECT_CARD_SUCCEEDED",
      message: resultMessage(result, "订阅成功"),
      runner: compactResult(result),
    };
  }

  if (result.ok === false || failedStatuses.has(runnerStatus) || failedStatuses.has(postClickStatus)) {
    return failedResult(resultMessage(result, "直卡执行失败"), result);
  }

  if (postClickStatus === "authentication_required") {
    return failedResult(resultMessage(result, "需要额外验证，未确认订阅成功"), result, "DIRECT_CARD_AUTH_REQUIRED");
  }

  if (postClickStatus === "processing") {
    return failedResult(resultMessage(result, "付款仍在处理中，未确认订阅成功"), result, "DIRECT_CARD_PROCESSING");
  }

  if (result.ok === true && runnerStatus === "filled") {
    return failedResult("直卡已完成表单填写，但未确认订阅成功", result, "DIRECT_CARD_FILLED_ONLY");
  }

  return failedResult(resultMessage(result, "直卡结果未识别，未确认订阅成功"), result, "DIRECT_CARD_UNKNOWN_RESULT");
}

export class DirectCardRunnerAdapter extends RunnerAdapter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.runDirectCardPaymentImpl = options.runDirectCardPaymentImpl ?? runDirectCardPayment;
  }

  async execute(context = {}) {
    const runtimeOptions = {
      checkoutInput: await resolveOption(this.options, "checkoutInput", context),
      checkoutUrl: await resolveOption(this.options, "checkoutUrl", context),
      accessToken: await resolveOption(this.options, "accessToken", context),
      sessionToken: await resolveOption(this.options, "sessionToken", context),
      sessionCookieName: await resolveOption(this.options, "sessionCookieName", context),
      email: await resolveOption(this.options, "email", context),
      paymentCountry: await resolveOption(this.options, "paymentCountry", context),
      paymentCurrency: await resolveOption(this.options, "paymentCurrency", context),
      locatePaymentButton: this.options.locatePaymentButton,
      clickPaymentButton: this.options.clickPaymentButton,
    };
    const cardInput = buildDirectCardInputFromContext(context, {
      ...this.options,
      ...Object.fromEntries(Object.entries(runtimeOptions).filter(([, value]) => value !== undefined)),
    });

    const emit = typeof context.emit === "function" ? context.emit : () => {};
    emit({
      level: "info",
      stage: "direct_card",
      message: `直卡执行开始：${context.plan?.display_name ?? context.plan?.plan_type ?? "unknown"}，卡=${context.card?.masked_number ?? "****"}`,
    });

    const proxyUrl = cloneDefined(await resolveOption(this.options, "proxyUrl", context));
    const proxyChain = cloneDefined(await resolveOption(this.options, "proxyChain", context));
    const runnerResult = await this.runDirectCardPaymentImpl({
      card: cardInput,
      emit: (event = {}) => emit({
        level: event.level ?? "info",
        stage: event.stage ?? "direct_card",
        message: event.message ?? "",
        meta: event,
      }),
      proxyUrl,
      proxyChain,
      registerChildProcess: context.registerChildProcess ?? this.options.registerChildProcess,
      postClickTimeoutMs: this.options.postClickTimeoutMs ?? 60_000,
      postClickPollMs: this.options.postClickPollMs ?? 500,
      accountVerificationTimeoutMs: this.options.accountVerificationTimeoutMs ?? 75_000,
      accountVerificationPollMs: this.options.accountVerificationPollMs ?? 3_000,
    });

    const normalized = normalizeDirectCardRunnerResult(runnerResult);
    emit({
      level: normalized.ok ? "success" : "error",
      stage: "direct_card",
      message: normalized.message,
      meta: normalized.runner,
    });
    return normalized;
  }
}

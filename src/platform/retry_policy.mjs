function toInteger(value, fallback, min, max, field) {
  const n = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function textOf(result = {}) {
  return [
    result.code,
    result.status,
    result.message,
    result.error,
    result.runner?.code,
    result.runner?.status,
    result.runner?.error,
    result.runner?.postClick?.status,
    result.runner?.postClick?.message,
    result.runner?.postClick?.rawError,
    result.postClick?.status,
    result.postClick?.message,
    result.postClick?.rawError,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function normalizeRetryPolicy(plan = {}) {
  const checkoutMaxProxyAttempts = toInteger(
    plan.checkout_max_proxy_attempts ?? plan.checkoutMaxProxyAttempts,
    4,
    1,
    1000,
    "checkout_max_proxy_attempts",
  );
  const maxProxyAttemptsPerCard = toInteger(
    plan.max_proxy_attempts_per_card ?? plan.maxProxyAttemptsPerCard,
    4,
    1,
    1000,
    "max_proxy_attempts_per_card",
  );
  const remoteSource = ["vcc", "kimoox"].includes(String(plan.card_source ?? plan.cardSource ?? "").toLowerCase());
  const allowCardSwitch = remoteSource ? true : toBoolean(plan.allow_card_switch ?? plan.allowCardSwitch, false);
  const maxCardSwitches = toInteger(
    remoteSource ? Math.max(0, Number(plan.remote_max_cards ?? plan.remoteMaxCards ?? 1) - 1) : (plan.max_card_switches ?? plan.maxCardSwitches),
    0,
    0,
    1000,
    remoteSource ? "remote_max_cards" : "max_card_switches",
  );
  return {
    checkout_max_proxy_attempts: checkoutMaxProxyAttempts,
    max_proxy_attempts_per_card: maxProxyAttemptsPerCard,
    allow_card_switch: allowCardSwitch,
    max_card_switches: allowCardSwitch ? maxCardSwitches : 0,
    max_card_count: allowCardSwitch ? maxCardSwitches + 1 : 1,
  };
}

export function isCheckoutPhaseResult(result = {}) {
  const code = String(result?.code ?? result?.checkout?.code ?? "").toUpperCase();
  const phase = String(result?.phase ?? result?.failureStage ?? result?.failure_stage ?? "").toLowerCase();
  return phase === "checkout"
    || phase.startsWith("checkout/")
    || code.startsWith("CHECKOUT_");
}

export function buildRetryAttemptPlan(plan = {}) {
  const policy = normalizeRetryPolicy(plan);
  const attempts = [];
  for (let cardAttemptIndex = 0; cardAttemptIndex < policy.max_card_count; cardAttemptIndex += 1) {
    for (let proxyAttemptIndex = 0; proxyAttemptIndex < policy.max_proxy_attempts_per_card; proxyAttemptIndex += 1) {
      attempts.push({
        attempt_no: attempts.length + 1,
        card_attempt_index: cardAttemptIndex,
        proxy_attempt_index: proxyAttemptIndex,
        is_card_switch: cardAttemptIndex > 0 && proxyAttemptIndex === 0,
      });
    }
  }
  return attempts;
}

export function classifyAttemptResult(result = {}) {
  if (result?.ok === true || result?.status === "success") {
    return {
      ok: true,
      category: "success",
      retry_proxy: false,
      switch_card: false,
      terminal: true,
    };
  }

  const text = textOf(result);
  if (/kimoox_open_card_timeout|kimoox_open_card_failed/.test(text)) {
    return {
      ok: false,
      category: "card_provider_open_terminal",
      retry_proxy: false,
      switch_card: false,
      terminal: true,
    };
  }
  if (/missing x server|\$display|platform failed to initialize|chrome exited before devtools became available|no usable sandbox/.test(text)) {
    return {
      ok: false,
      category: "runtime_environment",
      retry_proxy: false,
      switch_card: false,
      terminal: true,
    };
  }

  if (/vcc_config_missing/.test(text)) {
    return {
      ok: false,
      category: "card_provider_config",
      retry_proxy: false,
      switch_card: false,
      terminal: true,
    };
  }

  if (/vcc_|kimoox_|card_balance_prep_failed|card balance|card_balance|card_recharge|balance_usd|recharge_id/.test(text)) {
    return {
      ok: false,
      category: "card_provider_or_balance",
      retry_proxy: false,
      switch_card: true,
      terminal: false,
    };
  }

  if (/proxy|socks|connect|tunnel|econnreset|timeout|timed out|ssl|packet length|403|429|captcha|human verification|verify you are human|card_input_frame_not_mounted|payment_targets_unavailable|page_load_failed|chrome-error/.test(text)) {
    return {
      ok: false,
      category: "proxy_or_page",
      retry_proxy: true,
      switch_card: false,
      terminal: false,
    };
  }

  if (/payment was not approved|not approved|declined|insufficient funds|incorrect cvc|expired card|do not honor|card_declined|payment_failed/.test(text)) {
    return {
      ok: false,
      category: "card_declined",
      retry_proxy: false,
      switch_card: true,
      terminal: false,
    };
  }

  if (/auth_required|authentication_required|3d secure|3ds|authenticate|one[- ]time passcode|otp|verification code|bank verification|bank app/.test(text)) {
    return {
      ok: false,
      category: "verification_required",
      retry_proxy: false,
      switch_card: true,
      terminal: false,
    };
  }

  return {
    ok: false,
    category: "unknown",
    retry_proxy: true,
    switch_card: true,
    terminal: false,
  };
}

export function decideNextRetry(result = {}, plan = {}, position = {}) {
  const policy = normalizeRetryPolicy(plan);
  const classification = classifyAttemptResult(result);
  const cardAttemptIndex = Number(position.card_attempt_index ?? position.cardAttemptIndex ?? 0);
  const proxyAttemptIndex = Number(position.proxy_attempt_index ?? position.proxyAttemptIndex ?? 0);

  if (classification.ok) {
    return {
      action: "complete",
      classification,
      next: null,
      exhausted: false,
    };
  }

  if (classification.retry_proxy && proxyAttemptIndex + 1 < policy.max_proxy_attempts_per_card) {
    return {
      action: "retry_proxy",
      classification,
      next: {
        card_attempt_index: cardAttemptIndex,
        proxy_attempt_index: proxyAttemptIndex + 1,
      },
      exhausted: false,
    };
  }

  if ((classification.switch_card || classification.retry_proxy) && cardAttemptIndex < policy.max_card_switches) {
    return {
      action: "switch_card",
      classification,
      next: {
        card_attempt_index: cardAttemptIndex + 1,
        proxy_attempt_index: 0,
      },
      exhausted: false,
    };
  }

  return {
    action: "stop",
    classification,
    next: null,
    exhausted: true,
  };
}

export function decideNextCheckoutRetry(result = {}, plan = {}, position = {}) {
  const policy = normalizeRetryPolicy(plan);
  const classification = classifyAttemptResult(result);
  const checkoutProxyAttemptIndex = Number(position.checkout_proxy_attempt_index ?? position.checkoutProxyAttemptIndex ?? 0);

  if (classification.ok) {
    return {
      action: "complete",
      classification,
      next: null,
      exhausted: false,
    };
  }

  if (checkoutProxyAttemptIndex + 1 < policy.checkout_max_proxy_attempts) {
    return {
      action: "retry_checkout_proxy",
      classification,
      next: {
        checkout_proxy_attempt_index: checkoutProxyAttemptIndex + 1,
      },
      exhausted: false,
    };
  }

  return {
    action: "stop",
    classification,
    next: null,
    exhausted: true,
  };
}

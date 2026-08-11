import assert from "node:assert/strict";
import test from "node:test";

import { CheckoutSessionAdapter, normalizeCheckoutRunnerResult } from "../../src/platform/checkout_runner_adapter.mjs";

test("checkout result normalizer extracts direct-card checkout input", () => {
  const normalized = normalizeCheckoutRunnerResult({
    ok: true,
    status: 200,
    directCardCheckoutInput: "oaics_demo",
    links: [{ kind: "chatgpt", url: "https://chatgpt.com/checkout/openai_llc/oaics_demo" }],
    planName: "chatgptplusplan",
    paymentCountry: "PH",
    paymentCurrency: "PHP",
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.checkoutInput, "oaics_demo");
  assert.equal(normalized.checkout.paymentCountry, "PH");
});

test("checkout adapter calls injected createCheckoutSession with plan, billing, and proxy", async () => {
  let observed = null;
  const adapter = new CheckoutSessionAdapter({
    async createCheckoutSessionImpl(options) {
      observed = options;
      return {
        ok: true,
        status: 200,
        directCardCheckoutInput: "oaics_adapter_demo",
        links: [],
        redacted: { checkout_session_id: "oaics_adapter_demo" },
        planName: options.planName,
        createPlanName: options.planName,
        paymentCountry: options.country,
        paymentCurrency: options.currency,
      };
    },
  });
  const events = [];
  const result = await adapter.execute({
    runtime: { accessToken: "access-token" },
    plan: {
      plan_type: "pro20x",
      checkout_template_key: "pro20x",
      payment_country: "SG",
      payment_currency: "SGD",
    },
    billingAddress: {
      name: "Test User",
      country: "US",
      state: "CA",
      city: "Los Angeles",
      line1: "1 Test Ave",
      postal_code: "90001",
    },
    checkoutProxyUrl: "socks5://u:p@example.com:1080",
    checkoutProxyChain: ["socks5://u:p@example.com:1080"],
    emit: (event) => events.push(event),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkoutInput, "oaics_adapter_demo");
  assert.equal(observed.accessToken, "access-token");
  assert.equal(observed.planName, "chatgptpro");
  assert.equal(observed.country, "SG");
  assert.equal(observed.currency, "SGD");
  assert.equal(observed.billingAddress.address.country, "US");
  assert.equal(observed.proxyUrl, "socks5://u:p@example.com:1080");
  assert.match(events.map((event) => event.message).join("\n"), /提链成功/);
});

test("checkout adapter fails clearly when access token is missing", async () => {
  const adapter = new CheckoutSessionAdapter({
    async createCheckoutSessionImpl() {
      throw new Error("should not run");
    },
  });
  const result = await adapter.execute({
    runtime: {},
    plan: { plan_type: "plus" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CHECKOUT_ACCESS_TOKEN_REQUIRED");
});

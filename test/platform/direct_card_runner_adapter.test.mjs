import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import {
  buildDirectCardInputFromContext,
  DirectCardRunnerAdapter,
  normalizeDirectCardRunnerResult,
} from "../../src/platform/direct_card_runner_adapter.mjs";
import { runPlatformOrder } from "../../src/platform/runner_adapter.mjs";

function createReadyOrder() {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  const cardGroupId = store.createCardGroup({ name: "direct-card-primary" }, 10);
  const cardId = store.createCard({
    card_group_id: cardGroupId,
    number: "4242424242424242",
    exp_month: "12",
    exp_year: "2030",
    cvc: "123",
    max_success_count: 10,
  }, 11);
  const billingGroupId = store.createBillingGroup({ name: "US direct-card" }, 12);
  const billingAddressId = store.createBillingAddress({
    billing_group_id: billingGroupId,
    name: "Test User",
    country: "US",
    state: "AK",
    city: "Fairbanks",
    line1: "130 Signers' Hall",
    postal_code: "99775",
  }, 13);
  store.upsertPlanConfig({
    plan_type: "plus",
    display_name: "Plus",
    billing_group_id: billingGroupId,
    payment_country: "PH",
    payment_currency: "PHP",
  }, 14);
  store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 15);
  store.createRedeemBatchWithCodes({
    name: "direct card runner batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-DIRECT-RUNNER-1",
  }, 16);
  const locked = store.lockCodeAndCreateOrder({ code: "PLUS-DIRECT-RUNNER-1", order_no: "ord_direct_runner" }, 17);
  return { store, cardId, billingAddressId, orderId: locked.order.id };
}

test("direct card input builder maps platform resources into legacy runner input", () => {
  const input = buildDirectCardInputFromContext({
    order: { order_no: "ord_1" },
    plan: {
      plan_type: "plus",
      payment_country: "PH",
      payment_currency: "PHP",
    },
    card: {
      number: "4242424242424242",
      exp_month: "12",
      exp_year: "2030",
      cvc: "123",
    },
    billingAddress: {
      name: "Test User",
      country: "US",
      state: "AK",
      city: "Fairbanks",
      line1: "130 Signers' Hall",
      postal_code: "99775",
    },
  }, {
    checkoutInput: "https://chatgpt.com/checkout/openai_llc/oaics_demo123",
    sessionToken: "session-token",
  });

  assert.equal(input.number, "4242424242424242");
  assert.equal(input.expMonth, "12");
  assert.equal(input.expYear, "2030");
  assert.equal(input.cvc, "123");
  assert.equal(input.checkoutInput, "https://chatgpt.com/checkout/openai_llc/oaics_demo123");
  assert.equal(input.sessionToken, "session-token");
  assert.equal(input.paymentCountry, "PH");
  assert.equal(input.paymentCurrency, "PHP");
  assert.equal(input.targetPlanType, "plus");
  assert.equal(input.clickPaymentButton, true);
  assert.equal(input.locatePaymentButton, true);
  assert.deepEqual(input.billing.address, {
    line1: "130 Signers' Hall",
    line2: "",
    city: "Fairbanks",
    state: "AK",
    postal_code: "99775",
    country: "US",
  });
});

test("direct card result normalizer does not treat filled-only as success", () => {
  const filledOnly = normalizeDirectCardRunnerResult({
    ok: true,
    status: "filled",
    filled: ["number", "expiry", "cvc"],
  });
  assert.equal(filledOnly.ok, false);
  assert.equal(filledOnly.status, "failed");
  assert.equal(filledOnly.code, "DIRECT_CARD_FILLED_ONLY");

  const success = normalizeDirectCardRunnerResult({
    ok: true,
    status: "filled",
    postClick: {
      status: "success",
      message: "已订阅",
    },
  });
  assert.equal(success.ok, true);
  assert.equal(success.status, "success");
  assert.equal(success.message, "已订阅");

  const declined = normalizeDirectCardRunnerResult({
    ok: false,
    status: "error",
    error: "Payment was not approved",
  });
  assert.equal(declined.ok, false);
  assert.match(declined.message, /Payment was not approved/);
});

test("direct card adapter calls injected runner with mapped card input", async () => {
  const events = [];
  let observed = null;
  const adapter = new DirectCardRunnerAdapter({
    checkoutInputResolver: () => "https://chatgpt.com/checkout/openai_llc/oaics_demo456",
    sessionTokenResolver: () => "session-token",
    proxyUrlResolver: () => "socks5://user:pass@example.com:1080",
    async runDirectCardPaymentImpl(options) {
      observed = options;
      options.emit({ level: "info", stage: "browser", message: "fake fill log" });
      return {
        ok: true,
        status: "filled",
        postClick: {
          status: "success",
          message: "订阅成功",
        },
      };
    },
  });

  const result = await adapter.execute({
    order: { order_no: "ord_2" },
    plan: {
      plan_type: "plus",
      display_name: "Plus",
      payment_country: "PH",
      payment_currency: "PHP",
    },
    card: {
      masked_number: "4242 **** **** 4242",
      number: "4242424242424242",
      exp_month: "12",
      exp_year: "2030",
      cvc: "123",
    },
    billingAddress: {
      name: "Test User",
      country: "US",
      state: "AK",
      city: "Fairbanks",
      line1: "130 Signers' Hall",
      postal_code: "99775",
    },
    emit: (event) => events.push(event),
  });

  assert.equal(result.ok, true);
  assert.equal(observed.proxyUrl, "socks5://user:pass@example.com:1080");
  assert.equal(observed.card.checkoutInput, "https://chatgpt.com/checkout/openai_llc/oaics_demo456");
  assert.equal(observed.card.sessionToken, "session-token");
  assert.equal(observed.card.targetPlanType, "plus");
  assert.equal(observed.postClickTimeoutMs, 60_000);
  assert.equal(observed.accountVerificationTimeoutMs, 75_000);
  assert.equal(observed.card.billing.address.country, "US");
  assert.match(events.map((event) => event.message).join("\n"), /fake fill log/);
  assert.match(events.map((event) => event.message).join("\n"), /订阅成功/);
});

test("direct card adapter integrates with platform order runner", async () => {
  const { store, cardId, billingAddressId, orderId } = createReadyOrder();
  try {
    let observedCard = null;
    const adapter = new DirectCardRunnerAdapter({
      checkoutInput: "https://chatgpt.com/checkout/openai_llc/oaics_platform_demo",
      sessionToken: "session-token",
      async runDirectCardPaymentImpl(options) {
        observedCard = options.card;
        return {
          ok: true,
          status: "filled",
          postClick: {
            status: "success",
            message: "已订阅",
          },
        };
      },
    });

    const result = await runPlatformOrder(store, orderId, adapter, { now: () => 100 });
    assert.equal(result.ok, true);
    assert.equal(result.order.status, "succeeded");
    assert.equal(result.redeemCode.status, "used");
    assert.equal(result.card.success_count, 1);
    assert.equal(result.card.id, cardId);
    assert.equal(result.billingAddress.id, billingAddressId);
    assert.equal(observedCard.number, "4242424242424242");
    assert.equal(observedCard.billing.address.postal_code, "99775");
  } finally {
    store.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { runPlatformOrderWithRetry } from "../../src/platform/runner_adapter.mjs";
import { createPlatformPaymentAdapterFactory } from "../../src/platform/order_processor.mjs";

test("VCC card source opens a new card per order, pays, then withdraws and cancels", async () => {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  try {
    const cardGroupId = store.createCardGroup({ name: "vcc temp" }, 10);
    const billingGroupId = store.createBillingGroup({ name: "billing" }, 11);
    store.createBillingAddress({
      billing_group_id: billingGroupId,
      name: "User",
      country: "US",
      state: "CA",
      city: "LA",
      line1: "1 Ave",
      postal_code: "90001",
    }, 12);
    store.upsertPlanConfig({
      plan_type: "plus",
      enabled: true,
      card_source: "vcc",
      billing_group_id: billingGroupId,
      vcc_target_balance_usd: "25.00",
      vcc_card_bin: "491090",
      remote_max_cards: 2,
      remote_success_withdraw: true,
      remote_success_final_action: "cancel",
      remote_failure_withdraw: true,
      remote_failure_final_action: "freeze",
      max_proxy_attempts_per_card: 1,
    }, 13);
    store.setPlanCardGroups("plus", [{ card_group_id: cardGroupId, priority: 1 }], 14);
    store.setCardProviderConfig("vcc", { user_serial: "u", secret_key: "s" }, 15);
    store.createRedeemBatchWithCodes({ name: "batch", plan_type: "plus", quantity: 1, codeFactory: () => "PLUS-VCC-ORDER" }, 16);
    const locked = store.lockCodeAndCreateOrder({ code: "PLUS-VCC-ORDER", order_no: "ord_vcc_per_order" }, 17);
    store.setOrderRuntimeSecrets(locked.order.id, { accessToken: "at", sessionToken: "st" }, 18);

    const actions = [];
    let paid = false;
    let withdrawn = false;
    const provider = {
      async openCard(input) {
        actions.push("open:" + input.cardBin + ":" + input.amount);
        return { id: "open-1", userBankCardId: "vc-1", number: "4242424242424242", expiryDate: "12/30", cvv: "123" };
      },
      async getOpenCardDetail() { return {}; },
      async listCards(input) {
        actions.push("balance:" + (input.cardId || input.userBankId || ""));
        return [{ provider_card_id: "vc-1", card_balance: withdrawn ? "0.00" : paid ? "7.00" : "25.00", masked_number: "4242****4242" }];
      },
      async rechargeCard() { actions.push("unexpected-recharge"); return {}; },
      async cashOutCard(input) { actions.push("cashout:" + input.amount); withdrawn = true; return { id: "cash-1" }; },
      async cancelCard(input) { actions.push("cancel:" + input.cardId); return { ok: true }; },
      async suspendCard() { actions.push("unexpected-freeze"); return {}; },
      async enableCard() { actions.push("unexpected-unfreeze"); return {}; },
    };
    let directCard = null;
    const factory = createPlatformPaymentAdapterFactory({
      checkoutAdapterFactory: () => ({
        async execute() { actions.push("checkout"); return { ok: true, status: "success", checkoutInput: "oaics_vcc" }; },
      }),
      directCardAdapterFactory: () => ({
        async execute(context) { directCard = context.card; actions.push("direct:" + context.card.provider_card_id); paid = true; return { ok: true, status: "success", message: "订阅成功" }; },
      }),
    });

    const result = await runPlatformOrderWithRetry(store, locked.order.id, factory, { now: () => 500, cardProviderFactory: () => provider });
    assert.equal(result.ok, true);
    assert.equal(result.order.status, "succeeded");
    assert.equal(directCard.provider, "vcc");
    assert.equal(directCard.provider_card_id, "vc-1");
    assert.equal(store.getCardById(directCard.id).deleted_at > 0, true);
    assert.deepEqual(actions, [
      "checkout",
      "open:491090:25.00",
      "balance:vc-1",
      "direct:vc-1",
      "balance:vc-1",
      "cashout:7.00",
      "balance:vc-1",
      "cancel:vc-1",
    ]);
  } finally {
    store.close();
  }
});

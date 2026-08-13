import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { kimooxWebhookSignature } from "../../src/platform/kimoox_webhook.mjs";
import { listenPlatformServer } from "../../src/platform/server.mjs";

test("Kimoox webhook URL defaults, validates, and accepts its custom host and path", async () => {
  const store = new PlatformStore(openPlatformDb(":memory:"));
  assert.equal(
    store.getCardProviderConfig("kimoox").webhook_url,
    "https://minipekka.ayuekp.store/api/webhooks/kimoox",
  );
  assert.throws(
    () => store.setCardProviderConfig("kimoox", { webhook_url: "not-a-url" }, 1),
    /Webhook/,
  );
  const secret = "custom-webhook-secret";
  store.setCardProviderConfig("kimoox", {
    base_url: "https://card.kimoox.com",
    api_key: "ak",
    api_secret: "sk",
    webhook_secret: secret,
    webhook_url: "https://hooks.example.test/custom-kimoox",
  }, 1);
  const app = await listenPlatformServer({ store });
  const payload = {
    eventId: "evt_custom_001",
    eventType: "CARD_OPERATION.RECHARGE_SUCCESS",
    eventCategory: "CARD_OPERATION",
    data: { requestNo: "CF001", cardId: "VC001" },
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = "1786630000000";
  const nonce = "nonce-custom";
  const signature = kimooxWebhookSignature({
    eventId: payload.eventId,
    eventType: payload.eventType,
    timestamp,
    nonce,
    rawBody,
    secret,
  });
  try {
    const response = await fetch(`${app.url}/custom-kimoox`, {
      method: "POST",
      headers: {
        "x-forwarded-host": "hooks.example.test",
        "content-type": "application/json",
        "x-vcc-webhook-id": payload.eventId,
        "x-vcc-webhook-event": payload.eventType,
        "x-vcc-webhook-timestamp": timestamp,
        "x-vcc-webhook-nonce": nonce,
        "x-vcc-webhook-signature": `v1=${signature}`,
      },
      body: rawBody,
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(store.listWebhookEvents({ provider: "kimoox" }).length, 1);
  } finally {
    await app.close();
    store.close();
  }
});

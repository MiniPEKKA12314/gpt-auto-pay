import assert from "node:assert/strict";
import test from "node:test";

import {
  createKimooxCardProvider,
  decryptKimooxSensitiveField,
  encryptKimooxSensitiveField,
  kimooxSign,
  normalizeKimooxCard,
} from "../../src/platform/card_provider_kimoox.mjs";

test("Kimoox signature uses method path timestamp nonce and SHA256 body", () => {
  const signed = kimooxSign({ method: "POST", path: "/openapi/v1/account/balance/query", timestamp: "1000", nonce: "abc", body: "{}", apiSecret: "secret" });
  assert.equal(signed.bodyHash, "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
  assert.match(signed.signatureBase, /^POST\n\/openapi\/v1\/account\/balance\/query\n1000\nabc\n44136/);
  assert.equal(signed.signature.length, 64);
});

test("Kimoox sensitive card fields decrypt with webhook secret", () => {
  const secret = "webhook-secret";
  const iv = Buffer.alloc(12, 1);
  const cipher = encryptKimooxSensitiveField("4242424242424242", secret, iv);
  assert.equal(decryptKimooxSensitiveField(cipher, secret), "4242424242424242");
});

test("Kimoox card rows normalize private info into importable card", () => {
  const secret = "webhook-secret";
  const row = { cardId: "VC1", cardNoMask: "424242****4242", cardStatus: "ACTIVE", balance: "12.34", remark: "main" };
  const privateInfo = {
    cardNumberCiphertext: encryptKimooxSensitiveField("4242424242424242", secret, Buffer.alloc(12, 2)),
    expiryDateCiphertext: encryptKimooxSensitiveField("09/30", secret, Buffer.alloc(12, 3)),
    cvvCiphertext: encryptKimooxSensitiveField("123", secret, Buffer.alloc(12, 4)),
  };
  const card = normalizeKimooxCard(row, privateInfo, secret);
  assert.equal(card.provider, "kimoox");
  assert.equal(card.provider_card_id, "VC1");
  assert.equal(card.number, "4242424242424242");
  assert.equal(card.exp_month, "09");
  assert.equal(card.exp_year, "2030");
  assert.equal(card.cvc, "123");
  assert.equal(card.card_balance, "12.34");
});

test("Kimoox provider signs requests and maps card operations", async () => {
  const calls = [];
  const secret = "webhook-secret";
  const provider = createKimooxCardProvider({
    base_url: "https://api.kimoox.test",
    api_key: "ak_1",
    api_secret: "sk_1",
    webhook_secret: secret,
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(String(options.body || "{}")) });
      assert.equal(options.headers["x-vcc-api-key"], "ak_1");
      assert.ok(options.headers["x-vcc-signature"]);
      if (url.endsWith("/openapi/v1/cards/query")) {
        return new Response(JSON.stringify({ code: 200, msg: "ok", data: { list: [{ cardId: "VC1", cardNoMask: "4242****4242", balance: "5.00", cardStatus: "ACTIVE" }] } }), { status: 200 });
      }
      if (url.endsWith("/openapi/v1/cards/private-info/query")) {
        return new Response(JSON.stringify({ code: 200, data: {
          cardId: "VC1",
          cardNumberCiphertext: encryptKimooxSensitiveField("4242424242424242", secret, Buffer.alloc(12, 5)),
          expiryDateCiphertext: encryptKimooxSensitiveField("10/31", secret, Buffer.alloc(12, 6)),
          cvvCiphertext: encryptKimooxSensitiveField("999", secret, Buffer.alloc(12, 7)),
        } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 200, data: { requestNo: calls.at(-1).body.requestNo || "REQ", status: "SUBMITTED" } }), { status: 200 });
    },
  });
  const cards = await provider.listCardsWithPrivateInfo({ cardId: "VC1" }, { timestamp: 1000, nonce: "n" });
  assert.equal(cards[0].cvc, "999");
  await provider.rechargeCard({ cardId: "VC1", amount: "20.00", requestNo: "CF1" });
  await provider.suspendCard({ cardId: "VC1", requestNo: "CS1" });
  assert.equal(calls[0].body.cardId, "VC1");
  assert.equal(calls[2].body.operationType, "RECHARGE");
  assert.equal(calls[3].body.operationType, "FREEZE");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  createVccCardProvider,
  normalizeVccCard,
  normalizeVccConfig,
  sanitizeVccConfig,
  vccSign,
} from "../../src/platform/card_provider_vcc.mjs";

test("VCC signature follows sorted URL-encoded MD5 uppercase rule", () => {
  assert.equal(vccSign({ b: "two words", a: "1", empty: "" }, "secret"), "1DAC774C9E6975F04D53F43E0FF6AA3A");
});

test("VCC card rows normalize expiry date and mask card number", () => {
  const card = normalizeVccCard({
    id: "card-1",
    organization: "VISA",
    state: "1",
    number: "5572710152044444",
    expiryDate: "10/25",
    cvv: "456",
    remark: "remote",
    cardBalance: "100",
  });
  assert.equal(card.provider_card_id, "card-1");
  assert.equal(card.exp_month, "10");
  assert.equal(card.exp_year, "2025");
  assert.equal(card.cvc, "456");
  assert.equal(card.masked_number, "5572 **** **** 4444");
});

test("VCC provider signs GET and POST requests and unwraps response content", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, options });
    if (url.includes("/bank_card/my_cards_page")) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("userSerial"), "user-1");
      assert.equal(parsed.searchParams.get("pageNumber"), "1");
      assert.ok(parsed.searchParams.get("sign"));
      return new Response(JSON.stringify({
        code: 0,
        msg: "成功",
        rows: [{ id: "remote-1", number: "4242424242421234", expiryDate: "12/30", cvv: "123" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/bank_card/open_card")) {
      assert.equal(options.method, "POST");
      assert.match(String(options.body), /cardBin=491090/);
      assert.match(String(options.body), /sign=/);
      return new Response(JSON.stringify({ code: 0, content: { id: "order-1", state: 1 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 0, content: { name: "demo", balance: "10" } }), { status: 200 });
  };

  const provider = createVccCardProvider({
    base_url: "http://api.vcc.center",
    user_serial: "user-1",
    secret_key: "secret",
  }, { fetchImpl });

  const user = await provider.getUserInfo({ nowMs: 1000 });
  assert.equal(user.balance, "10");
  const cards = await provider.listCards({ pageNumber: 1, pageSize: 50 }, { nowMs: 1000 });
  assert.equal(cards[0].masked_number, "4242 **** **** 1234");
  const opened = await provider.openCard({ cardBin: "491090", amount: "10" }, { nowMs: 1000 });
  assert.equal(opened.id, "order-1");
  assert.equal(seen.length, 3);
});

test("VCC provider surfaces API business errors", async () => {
  const provider = createVccCardProvider({
    user_serial: "user-1",
    secret_key: "secret",
  }, {
    fetchImpl: async () => new Response(JSON.stringify({ code: 40005, msg: "签名错误" }), { status: 200 }),
  });
  await assert.rejects(() => provider.getUserInfo(), /40005/);
});

test("VCC provider covers management endpoints for card state, cash out, and transactions", async () => {
  const calls = [];
  const provider = createVccCardProvider({
    user_serial: "user-1",
    secret_key: "secret",
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ code: 0, content: { id: "ok" } }), { status: 200 });
    },
  });

  await provider.cancelCard({ cardId: "card-1" }, { nowMs: 1000 });
  await provider.suspendCard({ cardId: "card-1" }, { nowMs: 1000 });
  await provider.enableCard({ cardNum: "4242424242421234" }, { nowMs: 1000 });
  await provider.cashOutCard({ bankCardId: "card-1", amount: "5" }, { nowMs: 1000 });
  await provider.getCashOutDetail({ id: "cash-1" }, { nowMs: 1000 });
  await provider.listConsumeOrders({ number: "4242424242421234", page: 2, pageSize: 10 }, { nowMs: 1000 });

  assert.equal(calls[0].options.method, "DELETE");
  assert.match(calls[0].url, /\/bank_card\/cancel/);
  assert.match(calls[0].url, /cardId=card-1/);
  assert.equal(calls[1].options.method, "PUT");
  assert.match(calls[1].url, /\/bank_card\/suspend/);
  assert.equal(calls[2].options.method, "PUT");
  assert.match(calls[2].url, /\/bank_card\/enable/);
  assert.match(calls[3].url, /\/bank_card\/card_cash_out/);
  assert.match(String(calls[3].options.body), /bankCardId=card-1/);
  assert.match(calls[4].url, /\/bank_card\/card_cash_out_detail/);
  assert.match(calls[5].url, /\/bank_card\/consume_order/);
  assert.match(calls[5].url, /page=2/);
});

test("VCC config sanitizer hides secret key", () => {
  const normalized = normalizeVccConfig({
    user_serial: "user-1",
    secret_key: "secret",
    timeout_ms: "2000",
  });
  const safe = sanitizeVccConfig(normalized);
  assert.equal(safe.secret_configured, true);
  assert.equal(Object.hasOwn(safe, "secret_key"), false);
  assert.equal(safe.timeout_ms, 2000);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoPaymentFields,
  extractLatestCheckoutRequest,
  inferProxyUrlFromHarEntry,
  isPrivateOrLabIp,
  parseArgs,
  redactCheckoutResult,
  resolveProxyUrl,
  resolveAccessToken,
  rewriteBillingDetails,
  sanitizeHeaders,
  shouldReexecForEnvProxy,
  shouldCheckDns,
} from "./checkout_ph_dry_run.mjs";

test("isPrivateOrLabIp accepts private IPv4 and IPv6 ranges only", () => {
  assert.equal(isPrivateOrLabIp("10.1.2.3"), true);
  assert.equal(isPrivateOrLabIp("172.20.1.1"), true);
  assert.equal(isPrivateOrLabIp("192.168.10.2"), true);
  assert.equal(isPrivateOrLabIp("127.0.0.1"), true);
  assert.equal(isPrivateOrLabIp("169.254.1.2"), true);
  assert.equal(isPrivateOrLabIp("::1"), true);
  assert.equal(isPrivateOrLabIp("fc00::1"), true);
  assert.equal(isPrivateOrLabIp("fe80::1"), true);

  assert.equal(isPrivateOrLabIp("8.8.8.8"), false);
  assert.equal(isPrivateOrLabIp("1.1.1.1"), false);
  assert.equal(isPrivateOrLabIp("2606:4700:4700::1111"), false);
});

test("DNS checks are opt-in by flag or environment variable", () => {
  assert.equal(shouldCheckDns(parseArgs([]), {}), false);
  assert.equal(shouldCheckDns(parseArgs(["--check-dns"]), {}), true);
  assert.equal(shouldCheckDns(parseArgs([]), { LAB_CHECK_DNS: "1" }), true);
  assert.equal(shouldCheckDns(parseArgs([]), { LAB_CHECK_DNS: "true" }), true);
  assert.equal(shouldCheckDns(parseArgs([]), { LAB_CHECK_DNS: "0" }), false);
});

test("parseArgs accepts manual proxy and no-proxy flags", () => {
  assert.deepEqual(parseArgs(["--proxy", "http://127.0.0.1:7890"]), {
    proxy: "http://127.0.0.1:7890",
  });
  assert.deepEqual(parseArgs(["--no-proxy"]), { noProxy: true });
});

test("proxy URL is inferred from HAR proxy metadata unless disabled", () => {
  const entry = { serverIPAddress: "127.0.0.1", connection: "7890" };

  assert.equal(inferProxyUrlFromHarEntry(entry), "http://127.0.0.1:7890");
  assert.equal(resolveProxyUrl({}, {}, entry), "http://127.0.0.1:7890");
  assert.equal(resolveProxyUrl({ proxy: "http://127.0.0.1:8888" }, {}, entry), "http://127.0.0.1:8888");
  assert.equal(resolveProxyUrl({}, { LAB_PROXY: "http://127.0.0.1:7897" }, entry), "http://127.0.0.1:7897");
  assert.equal(resolveProxyUrl({ noProxy: true }, { LAB_PROXY: "http://127.0.0.1:7897" }, entry), null);
});

test("script re-execs once to enable Node env proxy support", () => {
  assert.equal(
    shouldReexecForEnvProxy({}, {}, [], "http://127.0.0.1:7890"),
    true,
  );
  assert.equal(
    shouldReexecForEnvProxy({}, { LAB_PROXY_REEXEC: "1" }, [], "http://127.0.0.1:7890"),
    false,
  );
  assert.equal(
    shouldReexecForEnvProxy({}, {}, ["--use-env-proxy"], "http://127.0.0.1:7890"),
    false,
  );
  assert.equal(shouldReexecForEnvProxy({ noProxy: true }, {}, [], null), false);
});

test("resolveAccessToken prefers environment variable", async () => {
  const token = await resolveAccessToken(
    { LAB_ACCESS_TOKEN: "env-token" },
    async () => {
      throw new Error("prompt should not be called");
    },
  );

  assert.equal(token, "env-token");
});

test("resolveAccessToken prompts when environment variable is missing", async () => {
  const token = await resolveAccessToken({}, async () => "prompt-token");

  assert.equal(token, "prompt-token");
});

test("resolveAccessToken rejects empty prompted token", async () => {
  await assert.rejects(
    () => resolveAccessToken({}, async () => "   "),
    /access token is required/i,
  );
});

test("sanitizeHeaders removes unsafe browser/export headers and injects bearer token", () => {
  const headers = sanitizeHeaders(
    [
      { name: ":authority", value: "chatgpt.com" },
      { name: "cookie", value: "secret=1" },
      { name: "content-length", value: "12" },
      { name: "content-type", value: "application/json" },
      { name: "openai-sentinel-token", value: "sentinel-value" },
      { name: "authorization", value: "Bearer old" },
      { name: "x-openai-target-path", value: "/backend-api/payments/checkout" },
    ],
    "new-token",
  );

  assert.equal(headers.authorization, "Bearer new-token");
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["openai-sentinel-token"], "sentinel-value");
  assert.equal(headers["x-openai-target-path"], "/backend-api/payments/checkout");
  assert.equal("cookie" in headers, false);
  assert.equal("content-length" in headers, false);
  assert.equal(":authority" in headers, false);
});

test("rewriteBillingDetails changes only country and currency", () => {
  const body = JSON.stringify({
    entry_point: "all_plans_pricing_modal",
    plan_name: "chatgptplusplan",
    billing_details: { country: "JP", currency: "JPY" },
    checkout_ui_mode: "custom",
  });

  const rewritten = JSON.parse(rewriteBillingDetails(body, "PH", "PHP"));

  assert.equal(rewritten.billing_details.country, "PH");
  assert.equal(rewritten.billing_details.currency, "PHP");
  assert.equal(rewritten.entry_point, "all_plans_pricing_modal");
  assert.equal(rewritten.plan_name, "chatgptplusplan");
  assert.equal(rewritten.checkout_ui_mode, "custom");
});

test("assertNoPaymentFields rejects card and payment confirmation fields", () => {
  assert.doesNotThrow(() =>
    assertNoPaymentFields({
      billing_details: { country: "PH", currency: "PHP" },
      checkout_ui_mode: "custom",
    }),
  );

  assert.throws(() => assertNoPaymentFields({ card: { number: "4242" } }), /refusing/i);
  assert.throws(() => assertNoPaymentFields({ billing_details: { cvv: "123" } }), /refusing/i);
  assert.throws(() => assertNoPaymentFields({ payment_method_data: {} }), /refusing/i);
});

test("redactCheckoutResult keeps safe summary fields and redacts secrets", () => {
  const redacted = redactCheckoutResult({
    checkout_session_id: "cs_live_abcdef123456",
    client_secret: "cs_live_abcdef_secret_verysecret",
    customer_session_client_secret: "cuss_secret_value",
    publishable_key: "pk_live_123456789",
    payment_status: "unpaid",
    status: "open",
  });

  assert.deepEqual(redacted.keys, [
    "checkout_session_id",
    "client_secret",
    "customer_session_client_secret",
    "payment_status",
    "publishable_key",
    "status",
  ]);
  assert.match(redacted.summary.checkout_session_id, /^cs_live/);
  assert.equal(redacted.summary.client_secret, "<redacted>");
  assert.equal(redacted.summary.customer_session_client_secret, "<redacted>");
  assert.equal(redacted.summary.publishable_key, "<redacted>");
  assert.equal(redacted.summary.payment_status, "unpaid");
  assert.equal(redacted.summary.status, "open");
});

test("extractLatestCheckoutRequest returns the latest successful checkout entry", () => {
  const har = {
    log: {
      entries: [
        {
          request: {
            method: "POST",
            url: "https://chatgpt.com/backend-api/payments/checkout",
            headers: [],
            postData: { text: "{\"first\":true}" },
          },
          response: { status: 200 },
          startedDateTime: "2026-07-13T01:00:00.000Z",
        },
        {
          request: {
            method: "POST",
            url: "https://chatgpt.com/backend-api/payments/checkout",
            headers: [],
            postData: { text: "{\"second\":true}" },
          },
          response: { status: 200 },
          startedDateTime: "2026-07-13T02:00:00.000Z",
        },
      ],
    },
  };

  const entry = extractLatestCheckoutRequest(har);

  assert.equal(entry.request.postData.text, "{\"second\":true}");
});

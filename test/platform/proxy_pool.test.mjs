import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeProxyEntries,
  normalizeProxyGroup,
  normalizeProxyUrl,
  redactProxyUrl,
  selectProxyForAttempt,
} from "../../src/platform/proxy_pool.mjs";

test("proxy URLs accept only HTTPS and SOCKS5 with host and port", () => {
  assert.equal(normalizeProxyUrl("https://user:pass@example.com:8443"), "https://user:pass@example.com:8443");
  assert.equal(normalizeProxyUrl("socks5://user:pass@example.com:1080"), "socks5://user:pass@example.com:1080");
  assert.throws(() => normalizeProxyUrl("http://127.0.0.1:7890"), /https:\/\/ or socks5:\/\//);
  assert.throws(() => normalizeProxyUrl("socks5://example.com"), /host and port/);
});

test("proxy entries parse one-per-line lists and redact credentials", () => {
  const entries = normalizeProxyEntries(`
    # comment
    https://user:pass@example.com:8443
    socks5://foo:bar@example.net:1080
  `);

  assert.deepEqual(entries.map((entry) => entry.url), [
    "https://user:pass@example.com:8443",
    "socks5://foo:bar@example.net:1080",
  ]);
  assert.equal(redactProxyUrl(entries[0].url), "https://<user>:<pass>@example.com:8443");
  assert.match(entries[1].redacted_url, /example\.net:1080/);
});

test("proxy group normalization supports static lists", () => {
  const group = normalizeProxyGroup({
    name: "direct card US",
    kind: "direct_card",
    provider: "static",
    config: {
      proxies: [
        { url: "socks5://a:b@example.com:1080", priority: 20 },
        { url: "https://c:d@example.com:8443", priority: 10 },
      ],
    },
  });
  const config = JSON.parse(group.config_json);
  assert.equal(group.kind, "direct_card");
  assert.deepEqual(config.proxies.map((entry) => entry.priority), [10, 20]);
});

test("proxy selection rotates by attempt index", () => {
  const group = normalizeProxyGroup({
    name: "checkout proxies",
    kind: "checkout",
    provider: "static",
    config: {
      proxies: [
        "https://a:b@example.com:8443",
        "socks5://c:d@example.net:1080",
      ],
    },
  });

  assert.match(selectProxyForAttempt(group, { attemptIndex: 0 }).proxyUrl, /^https:/);
  assert.match(selectProxyForAttempt(group, { attemptIndex: 1 }).proxyUrl, /^socks5:/);
  assert.match(selectProxyForAttempt(group, { attemptIndex: 2 }).proxyUrl, /^https:/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIpwoApiUrl,
  buildIpwoCredentialProxyUrl,
  buildIpwoCredentialUsername,
  fetchIpwoProxies,
  normalizeIpwoConfig,
  normalizeIpwoProxyEntries,
  redactIpwoApiUrl,
} from "../../src/platform/proxy_provider_ipwo.mjs";
import { normalizeProxyGroup, selectProxyForAttemptAsync } from "../../src/platform/proxy_pool.mjs";

test("IPWO config builds API URL with runtime extraction parameters", () => {
  const built = buildIpwoApiUrl({
    api_url: "https://api.example.com/extract?token=secret",
    regions: "us,jp",
    protocol: "socks5",
    num: 2,
  });
  assert.match(built.url, /num=2/);
  assert.match(built.url, /regions=US%2CJP/);
  assert.match(built.url, /protocol=socks5/);
  assert.match(built.url, /return_type=json/);
  assert.match(built.redacted_url, /token=%3Credacted%3E/);
});

test("IPWO proxy entries normalize JSON and TXT responses", () => {
  assert.deepEqual(
    normalizeIpwoProxyEntries([{ ip: "1.2.3.4", port: 4567 }], "http").map((entry) => entry.url),
    ["http://1.2.3.4:4567"],
  );
  assert.deepEqual(
    normalizeIpwoProxyEntries("1.2.3.4:4567\n5.6.7.8:9999", "socks5").map((entry) => entry.url),
    ["socks5://1.2.3.4:4567", "socks5://5.6.7.8:9999"],
  );
});

test("IPWO credential mode builds username parameters from panel fields", () => {
  const config = normalizeIpwoConfig({
    host: "us.ipwo.net",
    port: 7878,
    username: "light121",
    password: "light121",
    protocol: "socks5",
    country: "ph",
    state: "California",
    city: "Los Angeles",
    session_mode: "sticky",
    sticky_minutes: 120,
  });
  assert.equal(config.mode, "credential");
  assert.equal(config.country, "PH");

  const username = buildIpwoCredentialUsername(config, { session: "abc123" });
  assert.equal(username.username, "light121_custom_zone_PH_st_California_city_LosAngeles_sid_abc123_time_120");

  const proxy = buildIpwoCredentialProxyUrl(config, { session: "abc123" });
  assert.equal(proxy.url, "socks5://light121_custom_zone_PH_st_California_city_LosAngeles_sid_abc123_time_120:light121@us.ipwo.net:7878");
  assert.equal(proxy.redacted_url, "socks5://<user>:<pass>@us.ipwo.net:7878");
  assert.equal(proxy.session, "abc123");
});

test("IPWO credential mode omits random location and sticky params for rotating IP", () => {
  const proxy = buildIpwoCredentialProxyUrl({
    host: "us.ipwo.net",
    port: 7878,
    username: "light121",
    password: "light121",
    protocol: "https",
    country: "Random",
    state: "Random",
    city: "Random",
    session_mode: "rotate",
  });
  assert.equal(proxy.url, "http://light121:light121@us.ipwo.net:7878");
  assert.equal(proxy.params.session_mode, "rotate");
  assert.equal(proxy.params.sticky_minutes, 0);
});

test("IPWO fetch parses success and reports whitelist failures", async () => {
  const successFetch = async () => new Response(JSON.stringify({
    code: 0,
    success: true,
    msg: "操作成功",
    request_ip: "127.0.0.1",
    data: [{ ip: "9.9.9.9", port: 10000 }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  const result = await fetchIpwoProxies({
    api_url: "https://api.example.com/extract?token=secret",
    protocol: "http",
    num: 1,
  }, { fetchImpl: successFetch });
  assert.equal(result.entries[0].url, "http://9.9.9.9:10000");
  assert.equal(result.request_ip, "127.0.0.1");

  const deniedFetch = async () => new Response("forbidden", { status: 403 });
  await assert.rejects(
    () => fetchIpwoProxies({ api_url: "https://api.example.com/extract", num: 1 }, { fetchImpl: deniedFetch }),
    /白名单/,
  );
});

test("proxy pool can select an IPWO dynamic proxy asynchronously", async () => {
  const group = normalizeProxyGroup({
    name: "ipwo checkout",
    kind: "checkout",
    provider: "ipwo",
    config: {
      api_url: "https://api.example.com/extract?token=secret",
      protocol: "socks5",
      num: 2,
    },
  });
  const fetchImpl = async () => new Response(JSON.stringify({
    code: 0,
    success: true,
    data: [
      { ip: "1.1.1.1", port: 1111 },
      { ip: "2.2.2.2", port: 2222 },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
  const selected = await selectProxyForAttemptAsync(group, { attemptIndex: 1, fetchImpl });
  assert.equal(selected.proxyUrl, "socks5://2.2.2.2:2222");
  assert.equal(selected.redactedProxyUrl, "socks5://2.2.2.2:2222");
  assert.equal(selected.api.count, 2);
});

test("proxy pool can select an IPWO credential proxy without API fetching", async () => {
  const group = normalizeProxyGroup({
    name: "ipwo checkout",
    kind: "checkout",
    provider: "ipwo",
    config: {
      host: "us.ipwo.net",
      port: 7878,
      username: "light121",
      password: "light121",
      protocol: "socks5",
      country: "US",
      session_mode: "sticky",
      sticky_minutes: 10,
    },
  });
  const selected = await selectProxyForAttemptAsync(group, { session: "fixed1" });
  assert.equal(selected.proxyUrl, "socks5://light121_custom_zone_US_sid_fixed1_time_10:light121@us.ipwo.net:7878");
  assert.equal(selected.redactedProxyUrl, "socks5://<user>:<pass>@us.ipwo.net:7878");
  assert.equal(selected.ipwo.session, "fixed1");
});

test("IPWO helpers validate protocols and redact secret query values", () => {
  assert.equal(normalizeIpwoConfig({ api_url: "https://x.test", protocol: "http" }).protocol, "http");
  assert.equal(normalizeIpwoConfig({ api_url: "https://x.test", protocol: "https" }).protocol, "http");
  assert.throws(() => normalizeIpwoConfig({ api_url: "https://x.test", protocol: "ftp" }), /http\/https or socks5/);
  assert.equal(
    redactIpwoApiUrl("https://api.example.com/extract?token=secret&regions=US"),
    "https://api.example.com/extract?token=%3Credacted%3E&regions=US",
  );
});

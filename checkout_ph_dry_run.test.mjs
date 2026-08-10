import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertNoPaymentFields,
  buildBrowserSessionCookies,
  buildChatgptShortlinkCardAutofillExpression,
  buildChatgptShortlinkPaymentButtonLocatorExpression,
  buildBillingAddressAutofillExpression,
  buildChromeLaunchArgs,
  buildCheckoutLinks,
  buildCheckoutUpdateBody,
  buildCheckoutUpdateHeaders,
  buildCtfPayCommand,
  buildCtfPayConfig,
  buildEmbeddedCheckoutEntry,
  buildLocalCheckoutPageData,
  CHECKOUT_PLAN_OPTIONS,
  decodeJwtPayload,
  describeCheckoutFailure,
  describeCheckoutTransportFailure,
  describeChromeLaunchFailure,
  describeChatgptShortlinkPageLoadFailure,
  diagnoseChatgptShortlinkPaymentTargets,
  extractLatestCheckoutRequest,
  formatCheckoutLinks,
  getLocalCheckoutUnavailableReason,
  getCheckoutPlanConfig,
  inferProxyUrlFromHarEntry,
  isCtfPayCheckoutInput,
  isChatgptCheckoutUrl,
  hasCompleteChatgptShortlinkFill,
  isLikelyChatgptCardContext,
  isLikelyChatgptCardTarget,
  isPrivateOrLabIp,
  luhnValid,
  maskCardNumber,
  normalizeSessionFile,
  normalizeCheckoutCountry,
  normalizeCheckoutCurrency,
  normalizeCheckoutPlanName,
  normalizeCheckoutTemplate,
  normalizeDirectCardTestInput,
  normalizeBillingAddress,
  normalizeUiSessionFile,
  resolveChainedProxyRoute,
  parseOutboundProxyUrlList,
  parseProxyUrlList,
  parseArgs,
  parseChromeDevToolsActivePortFile,
  ensureLoopbackNoProxy,
  pickDirectCardMode,
  pickCtfPayCheckoutInput,
  pickDirectCardCheckoutInput,
  pickCheckoutBrowserUrl,
  normalizeChatgptShortlinkCheckoutUrl,
  redactCheckoutResult,
  resolveProxyUrl,
  resolveProxySettings,
  resolveProxyTargets,
  resolveAccessToken,
  renderCheckoutToolHtml,
  renderLocalCheckoutHtml,
  startLocalHttpProxy,
  rewriteCheckoutTemplate,
  rewriteBillingDetails,
  sanitizeHeaders,
  SUPPORTED_PAYMENT_COUNTRY_CODES,
  SUPPORTED_PAYMENT_CURRENCY_CODES,
  summarizeAccessTokenIdentity,
  shouldReexecForEnvProxy,
  shouldUseNodeEnvProxy,
  shouldCheckDns,
  shouldBridgeBrowserProxy,
  waitForChromeDebugPort,
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
  assert.deepEqual(parseArgs(["--checkout-proxy", "http://127.0.0.1:7890", "--direct-card-proxy", "http://127.0.0.1:7891"]), {
    checkoutProxy: "http://127.0.0.1:7890",
    directCardProxy: "http://127.0.0.1:7891",
  });
  assert.deepEqual(parseArgs(["--local-proxy", "--local-proxy-port", "7890"]), {
    localProxy: true,
    localProxyPort: 7890,
  });
  assert.deepEqual(parseArgs(["--no-proxy"]), { noProxy: true });
  assert.deepEqual(parseArgs(["--serve-local-checkout", "--local-checkout-port", "8787"]), {
    serveLocalCheckout: true,
    localCheckoutPort: 8787,
  });
  assert.deepEqual(parseArgs(["--session-file", "session.json", "--launch-session-browser"]), {
    sessionFile: "session.json",
    launchSessionBrowser: true,
  });
  assert.deepEqual(parseArgs(["--prompt-session-json", "--launch-session-browser"]), {
    promptSessionJson: true,
    launchSessionBrowser: true,
  });
  assert.deepEqual(parseArgs(["--chrome-path", "C:\\Chrome\\chrome.exe", "--remote-debugging-port", "9222"]), {
    chromePath: "C:\\Chrome\\chrome.exe",
    remoteDebuggingPort: 9222,
  });
  assert.deepEqual(parseArgs(["--ui", "--ui-port", "8787"]), {
    ui: true,
    uiPort: 8787,
  });
});

test("parseChromeDevToolsActivePortFile parses Chrome debug endpoint metadata", () => {
  assert.deepEqual(parseChromeDevToolsActivePortFile("65088\n/devtools/browser/abc-123\n"), {
    port: 65088,
    websocketPath: "/devtools/browser/abc-123",
  });
  assert.throws(() => parseChromeDevToolsActivePortFile("0\n/devtools/browser/abc"), /Invalid Chrome DevTools active port/);
  assert.throws(() => parseChromeDevToolsActivePortFile("65088\n"), /missing websocket path/);
});

test("waitForChromeDebugPort uses DevToolsActivePort when Chrome chooses the port", async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-debug-test-"));
  const server = http.createServer((request, response) => {
    if (request.url === "/json/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ Browser: "Chrome/test" }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await fs.writeFile(path.join(userDataDir, "DevToolsActivePort"), `${port}\n/devtools/browser/test\n`, "utf8");

    assert.equal(await waitForChromeDebugPort(0, { userDataDir, timeoutMs: 3000 }), port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test("buildChromeLaunchArgs adds Linux sandbox flags only on Linux", () => {
  const linuxArgs = buildChromeLaunchArgs({
    remoteDebuggingPort: 9222,
    userDataDir: "/tmp/chrome-profile",
    platform: "linux",
  });
  assert.deepEqual(linuxArgs.slice(0, 3), [
    "--remote-debugging-port=9222",
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=/tmp/chrome-profile",
  ]);
  assert.equal(linuxArgs.includes("--no-sandbox"), true);
  assert.equal(linuxArgs.includes("--disable-setuid-sandbox"), true);
  assert.equal(linuxArgs.includes("--disable-dev-shm-usage"), true);
  assert.equal(linuxArgs.includes("--disable-gpu"), true);

  const windowsArgs = buildChromeLaunchArgs({
    remoteDebuggingPort: 9222,
    userDataDir: "C:\\Temp\\chrome-profile",
    platform: "win32",
  });
  assert.equal(windowsArgs.includes("--no-sandbox"), false);
  assert.equal(windowsArgs.includes("--disable-setuid-sandbox"), false);
});

test("describeChromeLaunchFailure explains Linux sandbox failures", () => {
  const message = describeChromeLaunchFailure("Chrome exited before DevTools became available", {
    chromeOutput: [
      "[FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:128] No usable sandbox!",
    ],
  });

  assert.match(message, /No usable sandbox/);
  assert.match(message, /结论：Chrome 在当前 Linux\/VPS 环境没有可用 sandbox/);
  assert.match(message, /--no-sandbox/);
});

test("proxy list parsing accepts HTTPS and SOCKS5 proxies", () => {
  assert.deepEqual(
    parseProxyUrlList("https://proxy.example:8443\nsocks5://user:pass@proxy.example:1080\nhttp://127.0.0.1:7890"),
    [
      "https://proxy.example:8443",
      "socks5://user:pass@proxy.example:1080",
      "http://127.0.0.1:7890",
    ],
  );
});

test("ChatGPT shortlink browser proxies use a local bridge", () => {
  assert.equal(shouldBridgeBrowserProxy(), false);
  assert.equal(
    shouldBridgeBrowserProxy({
      proxyUrl: "socks5://user:pass@proxy.example:1080",
    }),
    true,
  );
  assert.equal(
    shouldBridgeBrowserProxy({
      proxyChain: [
        "http://127.0.0.1:7890",
        "https://user:pass@proxy.example:8443",
      ],
    }),
    true,
  );
});

test("outbound proxy list parsing accepts only HTTPS and SOCKS5 proxies", () => {
  assert.deepEqual(
    parseOutboundProxyUrlList("https://proxy.example:8443\nsocks5://user:pass@proxy.example:1080"),
    [
      "https://proxy.example:8443",
      "socks5://user:pass@proxy.example:1080",
    ],
  );
  assert.throws(() => parseOutboundProxyUrlList("http://127.0.0.1:7890"), /Unsupported outbound proxy protocol/);
});

test("proxy URL is inferred from HAR proxy metadata unless disabled", () => {
  const entry = { serverIPAddress: "127.0.0.1", connection: "7890" };

  assert.equal(inferProxyUrlFromHarEntry(entry), "http://127.0.0.1:7890");
  assert.equal(resolveProxyUrl({}, {}, entry), "http://127.0.0.1:7890");
  assert.equal(resolveProxyUrl({ proxy: "http://127.0.0.1:8888" }, {}, entry), "http://127.0.0.1:8888");
  assert.equal(resolveProxyUrl({}, { LAB_PROXY: "http://127.0.0.1:7897" }, entry), "http://127.0.0.1:7897");
  assert.equal(resolveProxyUrl({ noProxy: true }, { LAB_PROXY: "http://127.0.0.1:7897" }, entry), null);
});

test("resolveProxyTargets splits checkout and direct-card proxies", () => {
  const entry = { serverIPAddress: "127.0.0.1", connection: "7890" };

  assert.deepEqual(resolveProxyTargets({}, {}, entry), {
    checkoutProxyUrl: "http://127.0.0.1:7890",
    directCardProxyUrl: "http://127.0.0.1:7890",
  });
  assert.deepEqual(resolveProxyTargets({
    checkoutProxy: "https://127.0.0.1:8888",
    directCardProxy: "socks5://127.0.0.1:9999",
  }, {}, entry), {
    checkoutProxyUrl: "https://127.0.0.1:8888",
    directCardProxyUrl: "socks5://127.0.0.1:9999",
  });
  assert.deepEqual(resolveProxyTargets({ noProxy: true }, { LAB_PROXY: "http://127.0.0.1:7897" }, entry), {
    checkoutProxyUrl: null,
    directCardProxyUrl: null,
  });
});

test("resolveProxySettings builds local listener and outbound proxy pools", () => {
  const settings = resolveProxySettings({
    localProxy: true,
    checkoutProxy: "https://checkout.example:8443\nsocks5://127.0.0.1:1081",
    directCardProxy: "socks5://127.0.0.1:1082",
  }, {}, null);

  assert.equal(settings.localProxy.enabled, true);
  assert.equal(settings.localProxy.host, "127.0.0.1");
  assert.equal(settings.localProxy.port, 7890);
  assert.equal(settings.localProxy.url, "http://127.0.0.1:7890");
  assert.deepEqual(settings.checkoutProxy.urls, [
    "https://checkout.example:8443",
    "socks5://127.0.0.1:1081",
  ]);
  assert.deepEqual(settings.directCardProxy.urls, ["socks5://127.0.0.1:1082"]);
  assert.equal(settings.checkoutProxyExplicit, true);
  assert.equal(settings.directCardProxyExplicit, true);
  assert.equal(settings.checkoutProxyUrl, "https://checkout.example:8443");
  assert.equal(settings.directCardProxyUrl, "socks5://127.0.0.1:1082");
});

test("resolveChainedProxyRoute uses local Clash as the first proxy hop", () => {
  const settings = resolveProxySettings({
    localProxy: true,
    checkoutProxy: "https://checkout.example:8443",
  }, {}, null);
  const route = resolveChainedProxyRoute(settings, settings.checkoutProxyUrl);

  assert.equal(route.usesLocalProxy, true);
  assert.equal(route.proxyUrl, "http://127.0.0.1:7890");
  assert.deepEqual(route.proxyChain, ["http://127.0.0.1:7890", "https://checkout.example:8443"]);
  assert.equal(route.localProxy.enabled, true);
  assert.equal(route.localProxy.upstreamProxyUrl, "https://checkout.example:8443");
});

test("local proxy chains through the configured upstream proxy", async () => {
  let upstreamConnectTarget = null;
  let targetPayload = "";

  const targetServer = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      targetPayload += chunk.toString("utf8");
      socket.end("pong");
    });
  });

  const upstreamProxyServer = http.createServer();
  upstreamProxyServer.on("connect", (request, clientSocket, head) => {
    upstreamConnectTarget = request.url;
    const [host, portText] = String(request.url).split(":");
    const upstreamSocket = net.connect(Number.parseInt(portText, 10), host);
    clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: test-upstream\r\n\r\n");
    if (head?.length) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
  const targetAddress = targetServer.address();
  const targetPort = typeof targetAddress === "object" && targetAddress ? targetAddress.port : 0;

  await new Promise((resolve) => upstreamProxyServer.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstreamProxyServer.address();
  const upstreamPort = typeof upstreamAddress === "object" && upstreamAddress ? upstreamAddress.port : 0;

  const localProxy = await startLocalHttpProxy({
    host: "127.0.0.1",
    port: 0,
    upstreamProxyUrl: `http://127.0.0.1:${upstreamPort}`,
  });

  try {
    const responseBody = await new Promise((resolve, reject) => {
      const socket = net.connect(localProxy.port, localProxy.host);
      let buffer = Buffer.alloc(0);
      let connected = false;

      const cleanup = (error = null) => {
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("end", onEnd);
        if (error) reject(error);
      };

      const onError = (error) => cleanup(error);
      const onEnd = () => cleanup(new Error("proxy tunnel ended early"));
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!connected) {
          const text = buffer.toString("latin1");
          if (!text.includes("\r\n\r\n")) return;
          assert.match(text, /200 Connection Established/);
          connected = true;
          buffer = Buffer.alloc(0);
          socket.write("ping");
          return;
        }
        cleanup();
        socket.end();
        resolve(buffer.toString("utf8"));
      };

      socket.on("error", onError);
      socket.on("end", onEnd);
      socket.on("data", onData);
      socket.on("connect", () => {
        socket.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`);
      });
    });

    assert.equal(upstreamConnectTarget, `127.0.0.1:${targetPort}`);
    assert.equal(targetPayload, "ping");
    assert.equal(responseBody, "pong");
  } finally {
    await new Promise((resolve) => localProxy.server.close(resolve));
    await new Promise((resolve) => upstreamProxyServer.close(resolve));
    await new Promise((resolve) => targetServer.close(resolve));
  }
});

test("local proxy bridge can route through local and outbound proxy hops", async () => {
  let localConnectTarget = null;
  let outboundConnectTarget = null;
  let targetPayload = "";

  const targetServer = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      targetPayload += chunk.toString("utf8");
      socket.end("pong");
    });
  });

  const makeHttpProxy = (onConnectTarget) => {
    const server = http.createServer();
    server.on("connect", (request, clientSocket, head) => {
      onConnectTarget(request.url);
      const [host, portText] = String(request.url).split(":");
      const upstreamSocket = net.connect(Number.parseInt(portText, 10), host);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: test-hop\r\n\r\n");
      if (head?.length) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    return server;
  };

  const localProxyServer = makeHttpProxy((target) => {
    localConnectTarget = target;
  });
  const outboundProxyServer = makeHttpProxy((target) => {
    outboundConnectTarget = target;
  });

  await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
  const targetAddress = targetServer.address();
  const targetPort = typeof targetAddress === "object" && targetAddress ? targetAddress.port : 0;

  await new Promise((resolve) => outboundProxyServer.listen(0, "127.0.0.1", resolve));
  const outboundAddress = outboundProxyServer.address();
  const outboundPort = typeof outboundAddress === "object" && outboundAddress ? outboundAddress.port : 0;

  await new Promise((resolve) => localProxyServer.listen(0, "127.0.0.1", resolve));
  const localAddress = localProxyServer.address();
  const localPort = typeof localAddress === "object" && localAddress ? localAddress.port : 0;

  const bridgeProxy = await startLocalHttpProxy({
    host: "127.0.0.1",
    port: 0,
    upstreamProxyChain: [
      `http://127.0.0.1:${localPort}`,
      `http://127.0.0.1:${outboundPort}`,
    ],
  });

  try {
    const responseBody = await new Promise((resolve, reject) => {
      const socket = net.connect(bridgeProxy.port, bridgeProxy.host);
      let buffer = Buffer.alloc(0);
      let connected = false;

      const cleanup = (error = null) => {
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("end", onEnd);
        if (error) reject(error);
      };

      const onError = (error) => cleanup(error);
      const onEnd = () => cleanup(new Error("proxy tunnel ended early"));
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!connected) {
          const text = buffer.toString("latin1");
          if (!text.includes("\r\n\r\n")) return;
          assert.match(text, /200 Connection Established/);
          connected = true;
          buffer = Buffer.alloc(0);
          socket.write("ping");
          return;
        }
        cleanup();
        socket.end();
        resolve(buffer.toString("utf8"));
      };

      socket.on("error", onError);
      socket.on("end", onEnd);
      socket.on("data", onData);
      socket.on("connect", () => {
        socket.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`);
      });
    });

    assert.equal(localConnectTarget, `127.0.0.1:${outboundPort}`);
    assert.equal(outboundConnectTarget, `127.0.0.1:${targetPort}`);
    assert.equal(targetPayload, "ping");
    assert.equal(responseBody, "pong");
  } finally {
    await new Promise((resolve) => bridgeProxy.server.close(resolve));
    await new Promise((resolve) => localProxyServer.close(resolve));
    await new Promise((resolve) => outboundProxyServer.close(resolve));
    await new Promise((resolve) => targetServer.close(resolve));
  }
});

test("embedded checkout entry contains the captured request template", () => {
  const entry = buildEmbeddedCheckoutEntry();
  const body = JSON.parse(entry.request.postData.text);
  const headerNames = entry.request.headers.map((header) => header.name);

  assert.equal(entry.request.method, "POST");
  assert.equal(entry.request.url, "https://chatgpt.com/backend-api/payments/checkout");
  assert.equal(entry.serverIPAddress, "127.0.0.1");
  assert.equal(entry.connection, "7890");
  assert.equal(body.entry_point, "all_plans_pricing_modal");
  assert.equal(body.plan_name, "chatgptplusplan");
  assert.equal(body.checkout_ui_mode, "custom");
  assert.equal(body.billing_details.country, "JP");
  assert.equal(body.billing_details.currency, "JPY");
  assert.equal(headerNames.includes("authorization"), false);
  assert.equal(headerNames.includes("openai-sentinel-token"), true);
  assert.doesNotThrow(() => assertNoPaymentFields(body));
});

test("checkout failure diagnostics explain expired proxy HTML blocks", () => {
  const message = describeCheckoutFailure({
    ok: false,
    status: 403,
    failureStage: "checkout/create",
    parsed: null,
    text: "<html><body><div class=\"container\"><span class=\"blocked-icon\"></span><p class=\"explanation\">blocked</p></div></body></html>",
  }, {
    proxyUrl: "socks5://customer-session:secret@proxy.ipipgo.com:31212",
  });

  assert.match(message, /checkout\/create 返回 403/);
  assert.match(message, /HTML 拒绝页/);
  assert.match(message, /结论：代理过期或代理会话已失效/);
});

test("checkout failure diagnostics keep business errors as business errors", () => {
  const message = describeCheckoutFailure({
    ok: false,
    status: 400,
    failureStage: "checkout/create",
    parsed: {
      error: {
        message: "Billing country must match request country.",
        param: "billing_details[country]",
      },
    },
    text: JSON.stringify({
      error: {
        message: "Billing country must match request country.",
        param: "billing_details[country]",
      },
    }),
  }, {
    proxyUrl: "socks5://customer-session:secret@proxy.ipipgo.com:31212",
  });

  assert.match(message, /Billing country must match request country/);
  assert.match(message, /param=billing_details\[country\]/);
  assert.doesNotMatch(message, /代理过期/);
});

test("checkout transport diagnostics explain proxy tunnel failures", () => {
  const message = describeCheckoutTransportFailure(new Error("Invalid HTTP response from proxy tunnel"), {
    stage: "checkout/create",
    proxyUrl: "socks5://customer-session:secret@proxy.ipipgo.com:31212",
  });

  assert.match(message, /Invalid HTTP response from proxy tunnel/);
  assert.match(message, /结论：代理过期或代理会话已失效/);
});

test("checkout template options normalize supported plans, countries, and currencies", () => {
  assert.deepEqual(
    CHECKOUT_PLAN_OPTIONS.map((option) => option.value),
    ["chatgptgoplan", "chatgptplusplan", "chatgptprolite", "chatgptpro"],
  );
  assert.equal(normalizeCheckoutPlanName("CHATGPTPLUSPLAN"), "chatgptplusplan");
  assert.equal(normalizeCheckoutPlanName("chatgptproplan"), "chatgptprolite");
  assert.equal(normalizeCheckoutPlanName("pro 5x"), "chatgptprolite");
  assert.equal(normalizeCheckoutPlanName("chatgptpro20xplan"), "chatgptpro");
  assert.equal(normalizeCheckoutPlanName("pro20x"), "chatgptpro");
  assert.deepEqual(getCheckoutPlanConfig("chatgptpro"), {
    value: "chatgptpro",
    createPlanName: "chatgptprolite",
    update: {
      planName: "chatgptpro",
      priceInterval: "month",
      seatQuantity: 1,
    },
  });
  assert.equal(normalizeCheckoutCountry("ph"), "PH");
  assert.equal(normalizeCheckoutCurrency("usd"), "USD");
  assert.equal(SUPPORTED_PAYMENT_COUNTRY_CODES.includes("PH"), true);
  assert.equal(SUPPORTED_PAYMENT_CURRENCY_CODES.includes("PHP"), true);
  assert.equal(SUPPORTED_PAYMENT_CURRENCY_CODES.includes("PKR"), true);
  assert.equal(SUPPORTED_PAYMENT_CURRENCY_CODES.includes("NGN"), true);
  assert.equal(SUPPORTED_PAYMENT_CURRENCY_CODES.includes("KZT"), true);
  assert.equal(SUPPORTED_PAYMENT_CURRENCY_CODES.includes("TZS"), true);
  assert.equal(SUPPORTED_PAYMENT_CURRENCY_CODES.includes("EGP"), true);
  assert.equal(SUPPORTED_PAYMENT_CURRENCY_CODES.includes("CNY"), false);
  assert.deepEqual(
    normalizeCheckoutTemplate({
      plan_name: "chatgptpro20xplan",
      payment_country: "JP",
      payment_currency: "JPY",
    }),
    {
      planName: "chatgptpro",
      paymentCountry: "JP",
      paymentCurrency: "JPY",
    },
  );
  assert.throws(() => normalizeCheckoutPlanName("chatgptunknownplan"), /Unsupported checkout plan/);
  assert.throws(() => normalizeCheckoutCountry("ZZ"), /Unsupported payment country/);
  assert.throws(() => normalizeCheckoutCurrency("XYZ"), /Unsupported payment currency/);
});

test("rewriteCheckoutTemplate updates plan and payment region without card fields", () => {
  const body = rewriteCheckoutTemplate(
    JSON.stringify({
      entry_point: "all_plans_pricing_modal",
      plan_name: "chatgptplusplan",
      billing_details: { country: "JP", currency: "JPY" },
      checkout_ui_mode: "custom",
    }),
    {
      planName: "chatgptpro",
      paymentCountry: "US",
      paymentCurrency: "USD",
      billingAddress: {
        name: "Ada Buyer",
        line1: "123 Billing St",
        city: "Seattle",
        postalCode: "98101",
        country: "US",
      },
    },
  );

  assert.equal(body.plan_name, "chatgptprolite");
  assert.equal(body.billing_details.country, "US");
  assert.equal(body.billing_details.currency, "USD");
  assert.equal(body.billing_details.name, "Ada Buyer");
  assert.deepEqual(body.billing_details.address, {
    line1: "123 Billing St",
    city: "Seattle",
    postal_code: "98101",
    country: "US",
  });
  assert.doesNotThrow(() => assertNoPaymentFields(body));
});

test("checkout Pro 20x builds the captured update request", () => {
  const checkoutSession = {
    checkout_session_id: "oaics_0574172973b24340a02ba8878217930a",
    processor_entity: "openai_llc",
  };
  const body = buildCheckoutUpdateBody(checkoutSession, "chatgptpro20xplan");
  assert.deepEqual(body, {
    checkout_session_id: "oaics_0574172973b24340a02ba8878217930a",
    processor_entity: "openai_llc",
    plan_name: "chatgptpro",
    price_interval: "month",
    seat_quantity: 1,
  });

  const headers = buildCheckoutUpdateHeaders(
    {
      "content-type": "application/json",
      "x-openai-target-path": "/backend-api/payments/checkout",
      "x-openai-target-route": "/backend-api/payments/checkout",
    },
    checkoutSession,
  );
  assert.equal(headers["x-openai-target-path"], "/backend-api/payments/checkout/update");
  assert.equal(headers["x-openai-target-route"], "/backend-api/payments/checkout/update");
  assert.equal(
    headers.referer,
    "https://chatgpt.com/checkout/openai_llc/oaics_0574172973b24340a02ba8878217930a",
  );
  assert.equal(buildCheckoutUpdateBody(checkoutSession, "chatgptprolite"), null);
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
  assert.equal(shouldReexecForEnvProxy({}, {}, [], "socks5://user:pass@proxy.example:1080"), false);
  assert.equal(shouldReexecForEnvProxy({ noProxy: true }, {}, [], null), false);
});

test("Node env proxy is used only when the matching proxy env is present", () => {
  assert.equal(shouldUseNodeEnvProxy("http://127.0.0.1:7890", {}, ["--use-env-proxy"]), false);
  assert.equal(
    shouldUseNodeEnvProxy(
      "http://127.0.0.1:7890",
      {
        LAB_PROXY_REEXEC: "1",
        HTTP_PROXY: "http://127.0.0.1:7890",
        HTTPS_PROXY: "http://127.0.0.1:7890",
      },
      ["--use-env-proxy"],
    ),
    true,
  );
  assert.equal(
    shouldUseNodeEnvProxy(
      "http://127.0.0.1:7890",
      {
        LAB_PROXY_REEXEC: "1",
        HTTP_PROXY: "http://127.0.0.1:8888",
      },
      ["--use-env-proxy"],
    ),
    false,
  );
});

test("ensureLoopbackNoProxy appends local hosts without removing existing entries", () => {
  const env = { NO_PROXY: "example.com,localhost" };
  assert.equal(ensureLoopbackNoProxy(env), "example.com,localhost,127.0.0.1,::1");
  assert.equal(env.NO_PROXY, "example.com,localhost,127.0.0.1,::1");
  assert.equal(env.no_proxy, "example.com,localhost,127.0.0.1,::1");
});

test("Node env proxy bypasses local addresses when NO_PROXY includes loopback", async () => {
  const targetHits = [];
  const proxyHits = [];

  const targetServer = http.createServer((request, response) => {
    targetHits.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("target-ok");
  });

  const proxyServer = http.createServer((request, response) => {
    proxyHits.push(`${request.method} ${request.url}`);
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end("proxy-bad-gateway");
  });

  await new Promise((resolve, reject) => {
    targetServer.once("error", reject);
    targetServer.listen(0, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => {
    proxyServer.once("error", reject);
    proxyServer.listen(0, "127.0.0.1", resolve);
  });

  try {
    const targetPort = targetServer.address().port;
    const proxyPort = proxyServer.address().port;
    const child = spawn(process.execPath, ["--use-env-proxy", "--input-type=module", "-e", `
      import http from 'node:http';
      const req = http.request({ host: '127.0.0.1', port: ${targetPort}, path: '/json/version', method: 'GET' }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          console.log(JSON.stringify({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
      });
      req.on('error', (error) => {
        console.log(JSON.stringify({ error: String(error) }));
      });
      req.end();
    `], {
      env: {
        ...process.env,
        HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
        HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
        NO_PROXY: "127.0.0.1,localhost,::1",
        no_proxy: "127.0.0.1,localhost,::1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", () => {});
    await new Promise((resolve) => child.once("exit", resolve));

    assert.deepEqual(targetHits, ["GET /json/version"]);
    assert.deepEqual(proxyHits, []);
    assert.match(output, /"statusCode":200/);
    assert.match(output, /"body":"target-ok"/);
  } finally {
    await new Promise((resolve) => targetServer.close(resolve));
    await new Promise((resolve) => proxyServer.close(resolve));
  }
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

test("rewriteBillingDetails can include non-card billing address fields", () => {
  const body = JSON.stringify({
    entry_point: "all_plans_pricing_modal",
    plan_name: "chatgptplusplan",
    billing_details: { country: "JP", currency: "JPY" },
    checkout_ui_mode: "custom",
  });

  const rewritten = JSON.parse(
    rewriteBillingDetails(body, "PH", "PHP", {
      name: "Ada Buyer",
      email: "ada@example.com",
      phone: "+639171234567",
      line1: "123 Billing St",
      city: "Makati",
      state: "Metro Manila",
      postalCode: "1229",
      country: "ph",
    }),
  );

  assert.equal(rewritten.billing_details.name, "Ada Buyer");
  assert.equal(rewritten.billing_details.email, "ada@example.com");
  assert.equal(rewritten.billing_details.phone, "+639171234567");
  assert.equal(rewritten.billing_details.country, "PH");
  assert.equal(rewritten.billing_details.currency, "PHP");
  assert.deepEqual(rewritten.billing_details.address, {
    line1: "123 Billing St",
    city: "Makati",
    state: "Metro Manila",
    postal_code: "1229",
    country: "PH",
  });
});

test("normalizeBillingAddress trims and maps common address field names", () => {
  assert.deepEqual(
    normalizeBillingAddress({
      fullName: " Ada Buyer ",
      address_line1: " 123 Billing St ",
      postcode: "1229",
      country_code: "ph",
      currency: "php",
    }),
    {
      name: "Ada Buyer",
      address: {
        line1: "123 Billing St",
        postal_code: "1229",
        country: "PH",
      },
      country: "PH",
      currency: "PHP",
    },
  );
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

test("buildCheckoutLinks creates the ChatGPT manual checkout URL from session response", () => {
  const links = buildCheckoutLinks({
    checkout_session_id: "cs_live_abcdef123456",
    processor_entity: "openai_llc",
    url: null,
  });

  assert.deepEqual(links, [
    {
      label: "chatgpt_checkout_url",
      url: "https://chatgpt.com/checkout/openai_llc/cs_live_abcdef123456",
    },
  ]);
});

test("pickDirectCardCheckoutInput prefers the generated ChatGPT checkout URL", () => {
  assert.equal(
    pickDirectCardCheckoutInput({
      checkout_session_id: "oaics_cccc11cf36b34a1eb974555f680218b4",
      processor_entity: "openai_llc",
    }),
    "https://chatgpt.com/checkout/openai_llc/oaics_cccc11cf36b34a1eb974555f680218b4",
  );
  assert.equal(
    pickDirectCardCheckoutInput({
      checkout_session_id: "cs_live_abcdef123456",
      processor_entity: "openai_llc",
    }),
    "https://chatgpt.com/checkout/openai_llc/cs_live_abcdef123456",
  );
  assert.equal(pickDirectCardCheckoutInput("oaics_cccc11cf36b34a1eb974555f680218b4"), "oaics_cccc11cf36b34a1eb974555f680218b4");
});

test("buildCheckoutLinks keeps direct hosted checkout URLs and de-duplicates them", () => {
  const links = buildCheckoutLinks({
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    checkout_url: "https://checkout.stripe.com/c/pay/cs_test_123",
    checkout_session_id: "cs_test_123",
    processor_entity: "openai_llc",
  });

  assert.deepEqual(links, [
    {
      label: "provider_url",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    },
    {
      label: "chatgpt_checkout_url",
      url: "https://chatgpt.com/checkout/openai_llc/cs_test_123",
    },
  ]);
});

test("formatCheckoutLinks prints a single copy-pasteable payment link", () => {
  assert.deepEqual(
    formatCheckoutLinks([
      {
        label: "chatgpt_checkout_url",
        url: "https://chatgpt.com/checkout/openai_llc/cs_live_abcdef123456",
      },
    ]),
    ["[checkout] manual payment link: https://chatgpt.com/checkout/openai_llc/cs_live_abcdef123456"],
  );
});

test("summarizeAccessTokenIdentity decodes and redacts token account identity", () => {
  const payload = {
    exp: 1784529813,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "e0dc4ec3-7d2f-4681-8c98-8bc4efedb756",
      chatgpt_account_user_id: "user-6ha7HprzzKXqtfl3k7Q9DOT8__e0dc4ec3-7d2f-4681-8c98-8bc4efedb756",
      chatgpt_user_id: "user-6ha7HprzzKXqtfl3k7Q9DOT8",
      chatgpt_plan_type: "plus",
    },
    "https://api.openai.com/profile": {
      email: "roy@example.com",
    },
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `eyJhbGciOiJub25lIn0.${encodedPayload}.signature`;

  assert.deepEqual(decodeJwtPayload(token), payload);
  assert.deepEqual(summarizeAccessTokenIdentity(token), {
    email: "ro***@ex***.com",
    account_id: "e0dc4ec3...b756",
    account_user_id: "user-6ha...b756",
    user_id: "user-6ha...DOT8",
    plan_type: "plus",
    expires_at: "2026-07-20T06:43:33.000Z",
  });
});

test("normalizeSessionFile reads access token and browser session token", () => {
  const normalized = normalizeSessionFile({
    accessToken: "access.jwt.value",
    sessionToken: "session-token-value",
    expires: "2026-10-13T06:55:38.534Z",
    user: { email: "roy@example.com" },
    account: { id: "account-id" },
  });

  assert.equal(normalized.accessToken, "access.jwt.value");
  assert.equal(normalized.sessionToken, "session-token-value");
  assert.equal(normalized.sessionCookieName, "__Secure-next-auth.session-token");
  assert.equal(normalized.expires, "2026-10-13T06:55:38.534Z");
  assert.deepEqual(normalized.user, { email: "roy@example.com" });
  assert.deepEqual(normalized.account, { id: "account-id" });
});

test("buildBrowserSessionCookies creates a ChatGPT session cookie", () => {
  const cookies = buildBrowserSessionCookies(
    normalizeSessionFile({
      accessToken: "access.jwt.value",
      sessionToken: "session-token-value",
      expires: "2026-10-13T06:55:38.534Z",
    }),
  );

  assert.deepEqual(cookies, [
    {
      name: "__Secure-next-auth.session-token",
      value: "session-token-value",
      url: "https://chatgpt.com/",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      expires: 1791874538,
    },
  ]);
});

test("buildBrowserSessionCookies strips Set-Cookie attributes from session token values", () => {
  const cookies = buildBrowserSessionCookies(
    normalizeSessionFile({
      accessToken: "access.jwt.value",
      sessionToken: "__Secure-next-auth.session-token=session-token-value; Path=/; Secure; HttpOnly",
    }),
  );

  assert.equal(cookies[0].value, "session-token-value");
  assert.equal(cookies[0].url, "https://chatgpt.com/");
});

test("normalizeUiSessionFile makes browser login optional", () => {
  assert.equal(normalizeUiSessionFile({ accessToken: "access.jwt.value" }), null);

  const normalized = normalizeUiSessionFile({
    accessToken: "access.jwt.value",
    useSessionLogin: true,
    sessionToken: "__Secure-next-auth.session-token=session-token-value; Path=/; Secure; HttpOnly",
  });

  assert.equal(normalized.accessToken, "access.jwt.value");
  assert.equal(normalized.sessionToken, "session-token-value");
  assert.equal(normalized.sessionCookieName, "__Secure-next-auth.session-token");
});

test("normalizeUiSessionFile requires session token when login state is enabled", () => {
  assert.throws(
    () => normalizeUiSessionFile({ accessToken: "access.jwt.value", useSessionLogin: true }),
    /Session Token/,
  );
});

test("buildBrowserSessionCookies chunks long session token values", () => {
  const token = "a".repeat(4307);
  const cookies = buildBrowserSessionCookies(
    normalizeSessionFile({
      accessToken: "access.jwt.value",
      sessionToken: token,
    }),
  );

  assert.equal(cookies.length, 2);
  assert.equal(cookies[0].name, "__Secure-next-auth.session-token.0");
  assert.equal(cookies[0].value.length, 3800);
  assert.equal(cookies[1].name, "__Secure-next-auth.session-token.1");
  assert.equal(cookies[1].value.length, 507);
  assert.equal(cookies.map((cookie) => cookie.value).join(""), token);
});

test("pickCheckoutBrowserUrl prefers the ChatGPT checkout route", () => {
  assert.equal(
    pickCheckoutBrowserUrl({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      checkout_session_id: "oaics_123",
      processor_entity: "openai_llc",
    }),
    "https://chatgpt.com/checkout/openai_llc/oaics_123",
  );
});

test("pickCtfPayCheckoutInput only accepts Stripe cs checkout sessions", () => {
  assert.equal(
    pickCtfPayCheckoutInput({
      checkout_session_id: "oaics_cccc11cf36b34a1eb974555f680218b4",
      processor_entity: "openai_llc",
    }),
    null,
  );
  assert.equal(
    pickCtfPayCheckoutInput({
      url: "https://checkout.stripe.com/c/pay/cs_live_abcdef123456",
      checkout_session_id: "oaics_cccc11cf36b34a1eb974555f680218b4",
    }),
    "https://checkout.stripe.com/c/pay/cs_live_abcdef123456",
  );
  assert.equal(
    pickCtfPayCheckoutInput({
      checkout_session_id: "cs_test_123456",
      processor_entity: "openai_llc",
    }),
    "cs_test_123456",
  );
});

test("buildLocalCheckoutPageData requires Stripe public fields", () => {
  assert.deepEqual(
    buildLocalCheckoutPageData({
      publishable_key: "pk_live_123",
      client_secret: "secret_456",
      checkout_session_id: "oaics_123",
      plan_name: "chatgptplusplan",
      status: "open",
      payment_status: "unpaid",
      billing_details: { country: "PH", currency: "PHP" },
    }),
    {
      publishableKey: "pk_live_123",
      clientSecret: "secret_456",
      checkoutSessionId: "oaics_123",
      planName: "chatgptplusplan",
      status: "open",
      paymentStatus: "unpaid",
      billingCountry: "PH",
      billingCurrency: "PHP",
    },
  );

  assert.throws(() => buildLocalCheckoutPageData({ client_secret: "secret_456" }), /publishable_key/);
  assert.throws(() => buildLocalCheckoutPageData({ publishable_key: "pk_live_123" }), /client_secret/);
});

test("buildLocalCheckoutPageData includes optional Stripe billing defaults", () => {
  const pageData = buildLocalCheckoutPageData(
    {
      publishable_key: "pk_live_123",
      client_secret: "secret_456",
      checkout_session_id: "oaics_123",
      plan_name: "chatgptplusplan",
      status: "open",
      payment_status: "unpaid",
      billing_details: { country: "PH", currency: "PHP" },
    },
    {
      name: "Ada Buyer",
      line1: "123 Billing St",
      postalCode: "1229",
      country: "PH",
      currency: "PHP",
    },
  );

  assert.deepEqual(pageData.billingDetails, {
    name: "Ada Buyer",
    address: {
      line1: "123 Billing St",
      postal_code: "1229",
      country: "PH",
    },
  });
});

test("getLocalCheckoutUnavailableReason explains non-Stripe checkout responses", () => {
  assert.equal(
    getLocalCheckoutUnavailableReason({
      checkout_provider: "open_ai",
      checkout_session_id: "oaics_5ed64e3fb7c94c21a2c3feb199c65081",
      publishable_key: {},
      client_secret: null,
    }),
    "local Stripe checkout unavailable for provider=open_ai session=oaics_5ed64e...<redacted>: publishable_key is object",
  );
});

test("renderLocalCheckoutHtml builds a local Stripe custom checkout page", () => {
  const html = renderLocalCheckoutHtml({
    publishableKey: "pk_live_123",
    clientSecret: "secret_456",
    checkoutSessionId: "oaics_123",
    planName: "chatgptplusplan",
    status: "open",
    paymentStatus: "unpaid",
    billingCountry: "PH",
    billingCurrency: "PHP",
    billingDetails: {
      name: "Ada Buyer",
      address: {
        line1: "123 Billing St",
        postal_code: "1229",
        country: "PH",
      },
    },
  });

  assert.match(html, /https:\/\/js\.stripe\.com\/v3\//);
  assert.match(html, /initCheckout/);
  assert.match(html, /createPaymentElement/);
  assert.match(html, /defaultValues/);
  assert.match(html, /billingDetails/);
  assert.match(html, /secret_456/);
});

test("renderCheckoutToolHtml builds the token driven frontend", () => {
  const html = renderCheckoutToolHtml({
    capturedAt: "2026-07-13T09:01:13.703Z",
    checkoutProxyUrl: "http://127.0.0.1:7890",
    directCardProxyUrl: "http://127.0.0.1:7891",
  });

  assert.match(html, /Access Token/);
  assert.match(html, /local-proxy-enabled/);
  assert.match(html, /local-proxy-port/);
  assert.match(html, /"localProxyEnabled":true/);
  assert.match(html, /"localProxyPort":7890/);
  assert.match(html, /"checkoutProxyEnabled":false/);
  assert.match(html, /"directCardProxyEnabled":false/);
  assert.match(html, /"checkoutProxy":""/);
  assert.match(html, /"directCardProxy":""/);
  assert.doesNotMatch(html, /local-proxy-upstream/);
  assert.match(html, /checkout-proxy-enabled/);
  assert.match(html, /direct-card-proxy-enabled/);
  assert.match(html, /提链代理/);
  assert.match(html, /直卡代理/);
  assert.match(html, /付款地区 PH \/ PHP/);
  assert.match(html, /CTF-pay 直连银行卡/);
  assert.match(html, /direct-card-checkout/);
  assert.match(html, /use-session-login/);
  assert.match(html, /session-token/);
  assert.match(html, /billing-line1/);
  assert.match(html, /billing-postal-code/);
  assert.match(html, /plan-name/);
  assert.match(html, /payment-country/);
  assert.match(html, /payment-currency/);
  assert.match(html, /chatgptprolite/);
  assert.match(html, /chatgptpro/);
  assert.match(html, /create-link/);
  assert.match(html, /open-payment/);
  assert.match(html, /run-direct-card-final/);
  assert.match(html, /locatePaymentButton/);
  assert.match(html, /\/api\/\" \+ mode/);
  assert.match(html, /event\.level === "error"/);
});

test("renderCheckoutToolHtml emits parseable inline browser scripts", () => {
  const html = renderCheckoutToolHtml({
    capturedAt: "2026-07-13T09:01:13.703Z",
    proxyUrl: "http://127.0.0.1:7890",
  });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 1);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});

test("direct card helpers build a CTF-pay card config and redact the number", () => {
  assert.equal(luhnValid("4242 4242 4242 4242"), true);
  assert.equal(luhnValid("4242 4242 4242 4241"), false);
  assert.equal(maskCardNumber("4242 4242 4242 4242"), "****4242");

  const input = normalizeDirectCardTestInput({
    checkoutInput: "https://chatgpt.com/checkout/openai_llc/cs_live_abc123",
    accessToken: "access.jwt.value",
    number: "4111111111111111",
    expMonth: "12",
    expYear: "2030",
    cvc: "123",
    billingAddress: {
      name: "Ada Buyer",
      email: "ada@example.com",
      line1: "123 Billing St",
      city: "Makati",
      postalCode: "1229",
      country: "US",
      currency: "USD",
    },
  });
  assert.equal(input.last4, "1111");
  assert.equal(input.checkoutInput, "https://chatgpt.com/checkout/openai_llc/cs_live_abc123");
  assert.equal(input.paymentCountry, "PH");
  assert.equal(input.paymentCurrency, "PHP");

  const built = buildCtfPayConfig(input, { proxyUrl: "http://127.0.0.1:7890" });
  assert.equal(built.maskedCard, "****1111");
  assert.equal(built.checkoutInput, input.checkoutInput);
  assert.deepEqual(built.paymentRegion, { country: "PH", currency: "PHP" });
  assert.equal(built.config.locale, "PH");
  assert.equal(built.config.proxy, "http://127.0.0.1:7890");
  assert.equal(built.config.cards[0].number, "4111111111111111");
  assert.equal(built.config.cards[0].cvc, "123");
  assert.equal(built.config.cards[0].name, "Ada Buyer");
  assert.equal(built.config.cards[0].address.country, "US");
  assert.equal(built.config.fresh_checkout.auth.access_token, "access.jwt.value");
  assert.equal(built.config.fresh_checkout.output_url_mode, "provider");
  assert.equal(built.config.fresh_checkout.plan.billing_country, "PH");
  assert.equal(built.config.fresh_checkout.plan.billing_currency, "PHP");
  assert.equal(built.config.fresh_checkout.plan.checkout_ui_mode, "hosted");
  assert.equal(built.config.fresh_checkout.plan.output_url_mode, "provider");
  assert.equal(Object.hasOwn(built.config, "paypal"), false);
});

test("CTF-pay command runs card.py without PayPal flags", () => {
  const scriptPath = process.platform === "win32"
    ? "D:\\repo\\CTF-pay\\card.py"
    : "/opt/repo/CTF-pay/card.py";
  const configPath = process.platform === "win32"
    ? "D:\\tmp\\ctfpay.json"
    : "/tmp/ctfpay.json";
  const command = buildCtfPayCommand({
    checkoutInput: "cs_live_abc123",
    configPath,
    scriptPath,
  });

  assert.equal(command.command, "py");
  assert.deepEqual(command.args, [
    "-3",
    scriptPath,
    "cs_live_abc123",
    "--config",
    configPath,
    "--json-result",
  ]);
  assert.equal(command.cwd, path.dirname(scriptPath));
  assert.equal(command.args.includes("--paypal"), false);
});

test("oaics checkout inputs route to ChatGPT shortlink browser fill", () => {
  const oaicsUrl = "https://chatgpt.com/checkout/openai_llc/oaics_cccc11cf36b34a1eb974555f680218b4";
  const chatgptCsUrl = "https://chatgpt.com/checkout/openai_llc/cs_live_a1UPcYlRIVIi3gbdPa70x28KtKUBYiur3leIatBVd5HBTVG9Oq29OCTodN";
  assert.equal(
    normalizeChatgptShortlinkCheckoutUrl("oaics_cccc11cf36b34a1eb974555f680218b4"),
    oaicsUrl,
  );
  assert.equal(normalizeChatgptShortlinkCheckoutUrl(chatgptCsUrl), chatgptCsUrl);
  assert.equal(isChatgptCheckoutUrl(chatgptCsUrl), true);
  assert.equal(isCtfPayCheckoutInput(chatgptCsUrl), false);
  assert.equal(
    pickDirectCardMode({
      checkoutInput: oaicsUrl,
      sessionToken: "session-token-value",
      number: "4242424242424242",
      expMonth: "12",
      expYear: "2030",
      cvc: "123",
    }),
    "chatgpt-shortlink-browser",
  );
  assert.equal(
    pickDirectCardMode({
      checkoutInput: chatgptCsUrl,
      sessionToken: "session-token-value",
      number: "4242424242424242",
      expMonth: "12",
      expYear: "2030",
      cvc: "123",
    }),
    "chatgpt-shortlink-browser",
  );
  assert.equal(isCtfPayCheckoutInput("https://checkout.stripe.com/c/pay/cs_live_abc123"), true);
  assert.equal(
    pickDirectCardMode({
      checkoutInput: "cs_live_abc123",
      number: "4242424242424242",
      expMonth: "12",
      expYear: "2030",
      cvc: "123",
    }),
    "ctf-pay-card",
  );
});

test("ChatGPT shortlink card autofill expression targets card fields", () => {
  const expression = buildChatgptShortlinkCardAutofillExpression({
    checkoutInput: "https://chatgpt.com/checkout/openai_llc/oaics_cccc11cf36b34a1eb974555f680218b4",
    sessionToken: "session-token-value",
    number: "4242424242424242",
    expMonth: "12",
    expYear: "2030",
    cvc: "123",
    billingAddress: { name: "Ada Buyer", email: "ada@example.com", country: "PH" },
  });

  assert.match(expression, /cc-number/);
  assert.match(expression, /cardnumber/);
  assert.match(expression, /cc-csc/);
  assert.match(expression, /exp-date/);
});

test("ChatGPT shortlink payment button locator highlights without submitting", () => {
  const expression = buildChatgptShortlinkPaymentButtonLocatorExpression();

  assert.match(expression, /const autoClick = false;/);
  assert.match(expression, /scrollIntoView/);
  assert.match(expression, /focus/);
  assert.match(expression, /data-checkout-final-payment-target/);
  assert.match(expression, /subscribe now/);
});

test("ChatGPT shortlink payment button locator can auto click when enabled", () => {
  const expression = buildChatgptShortlinkPaymentButtonLocatorExpression({ autoClick: true });

  assert.match(expression, /const autoClick = true;/);
  assert.match(expression, /scrollIntoView/);
  assert.match(expression, /\.click\s*\(/);
  assert.match(expression, /MouseEvent/);
  assert.match(expression, /clicked/);
});

test("ChatGPT shortlink fill waits for requested billing fields after card fields", () => {
  const cardInput = {
    checkoutInput: "oaics_cccc11cf36b34a1eb974555f680218b4",
    sessionToken: "session-token-value",
    number: "4242424242424242",
    expMonth: "12",
    expYear: "2030",
    cvc: "123",
    billingAddress: {
      name: "Ada Buyer",
      line1: "123 Billing St",
      city: "Makati",
      state: "Metro Manila",
      postalCode: "1229",
      country: "PH",
    },
  };
  const cardOnly = new Set(["number", "expiry", "cvc"]);
  const complete = new Set([
    "number",
    "expiry",
    "cvc",
    "name",
    "line1",
    "city",
    "state",
    "postal_code",
    "country",
  ]);

  assert.equal(hasCompleteChatgptShortlinkFill(cardOnly, cardInput), false);
  assert.equal(hasCompleteChatgptShortlinkFill(complete, cardInput), true);
});

test("ChatGPT shortlink browser fill ignores non-ChatGPT execution contexts", () => {
  assert.equal(isLikelyChatgptCardContext({ origin: "https://chatgpt.com" }), true);
  assert.equal(isLikelyChatgptCardContext({ origin: "https://js.stripe.com" }), true);
  assert.equal(isLikelyChatgptCardContext({ origin: "chrome-extension://abcdefghijklmnop" }), false);
  assert.equal(isLikelyChatgptCardContext({ origin: "https://newassets.hcaptcha.com" }), false);
});

test("ChatGPT shortlink browser fill selects Stripe payment iframe targets", () => {
  assert.equal(
    isLikelyChatgptCardTarget({
      type: "iframe",
      url: "https://js.stripe.com/v3/elements-inner-card.html#componentName=payment",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/stripe",
    }),
    true,
  );
  assert.equal(
    isLikelyChatgptCardTarget({
      type: "iframe",
      url: "https://chatgpt.com/backend-api/sentinel/frame.html?sv=20260423af3c",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/sentinel",
    }),
    false,
  );
  assert.equal(
    isLikelyChatgptCardTarget({
      type: "iframe",
      url: "https://newassets.hcaptcha.com/captcha/v1/frame.html",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/captcha",
    }),
    false,
  );
});

test("ChatGPT shortlink payment diagnostic identifies unmounted card fields", () => {
  const diagnostic = diagnoseChatgptShortlinkPaymentTargets([
    {
      type: "page",
      url: "https://chatgpt.com/checkout/openai_llc/oaics_demo",
    },
    {
      type: "iframe",
      url: "https://js.stripe.com/v3/elements-inner-accessory-target.html?componentName=payment",
    },
    {
      type: "iframe",
      url: "https://js.stripe.com/v3/elements-inner-accessory-target.html?componentName=expressCheckout",
    },
    {
      type: "iframe",
      url: "https://js.stripe.com/v3/hcaptcha-invisible.html",
    },
    {
      type: "iframe",
      url: "https://js.stripe.com/v3/elements-inner-loader-ui.html",
    },
  ], {
    lastFrame: "https://chatgpt.com/checkout/openai_llc/oaics_demo",
  });

  assert.equal(diagnostic.status, "card_input_frame_not_mounted");
  assert.equal(diagnostic.paymentElements, 1);
  assert.equal(diagnostic.cardInputFrames, 0);
  assert.equal(diagnostic.expressCheckoutFrames, 1);
  assert.equal(diagnostic.captchaFrames, 1);
  assert.equal(diagnostic.loaderFrames, 1);
  assert.match(diagnostic.message, /卡号\/有效期\/CVC 输入 iframe 尚未挂载/);
});

test("ChatGPT shortlink fill explains Chrome error pages", () => {
  const message = describeChatgptShortlinkPageLoadFailure("chrome-error://chromewebdata/", {
    proxyConfigured: true,
  });
  assert.match(message, /checkout 页面加载失败/);
  assert.match(message, /代理未能正常加载 checkout 页面/);
  assert.equal(
    describeChatgptShortlinkPageLoadFailure("https://chatgpt.com/checkout/openai_llc/oaics_demo"),
    "未能在 ChatGPT checkout 页面中完整写入卡号/有效期/CVC",
  );
});

test("buildBillingAddressAutofillExpression generates a browser fill script", () => {
  const expression = buildBillingAddressAutofillExpression({
    name: "Ada Buyer",
    line1: "123 Billing St",
    city: "Makati",
    postalCode: "1229",
    country: "PH",
  });

  assert.match(expression, /Ada Buyer/);
  assert.match(expression, /123 Billing St/);
  assert.match(expression, /postal_code/);
  assert.match(expression, /querySelectorAll/);
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

#!/usr/bin/env node
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import net from "node:net";
import process from "node:process";
import tls from "node:tls";
import zlib from "node:zlib";

const DEFAULT_HAR_PATH = "test/data_new.har";
const REQUIRED_DOMAINS = [
  "chatgpt.com",
  "auth.openai.com",
  "api.stripe.com",
  "js.stripe.com",
  "r.stripe.com",
  "sentinel.openai.com",
];

const ALLOWED_HEADER_NAMES = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "oai-client-build-number",
  "oai-client-version",
  "oai-device-id",
  "oai-language",
  "oai-session-id",
  "oai-telemetry",
  "oai-web-deployment-attestation",
  "openai-sentinel-token",
  "origin",
  "pragma",
  "priority",
  "referer",
  "user-agent",
  "x-oai-is-client-observation",
  "x-openai-target-path",
  "x-openai-target-route",
]);

const FORBIDDEN_PAYMENT_KEY = /^(card|cards|cvc|cvv|security_code|payment_method|payment_method_data|payment_method_id)$/i;

export function isPrivateOrLabIp(ip, extraCidrs = []) {
  if (isIpv4MappedIpv6(ip)) {
    return isPrivateOrLabIp(ip.slice("::ffff:".length), extraCidrs);
  }

  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;

    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return extraCidrs.some((cidr) => isIpv4InCidr(ip, cidr));
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    );
  }

  return false;
}

export function sanitizeHeaders(headers, accessToken) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("LAB_ACCESS_TOKEN is required");
  }

  const result = {};
  for (const header of headers ?? []) {
    const name = String(header.name ?? "").toLowerCase();
    if (!name || name.startsWith(":")) continue;
    if (!ALLOWED_HEADER_NAMES.has(name)) continue;
    result[name] = String(header.value ?? "");
  }

  result.authorization = `Bearer ${accessToken}`;
  if (!result["content-type"]) result["content-type"] = "application/json";
  return result;
}

export function rewriteBillingDetails(bodyText, country = "PH", currency = "PHP") {
  if (!bodyText) throw new Error("checkout request has no JSON body");

  const body = JSON.parse(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("checkout request body must be a JSON object");
  }

  assertNoPaymentFields(body);
  body.billing_details = {
    ...(body.billing_details && typeof body.billing_details === "object"
      ? body.billing_details
      : {}),
    country,
    currency,
  };
  assertNoPaymentFields(body);
  return JSON.stringify(body);
}

export function assertNoPaymentFields(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPaymentFields(item, path.concat(String(index))));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PAYMENT_KEY.test(key)) {
      throw new Error(`Refusing to submit payment/card field: ${path.concat(key).join(".")}`);
    }
    assertNoPaymentFields(nested, path.concat(key));
  }
}

export function extractLatestCheckoutRequest(har) {
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("HAR does not contain log.entries");

  let latest = null;
  for (const entry of entries) {
    const request = entry?.request;
    const response = entry?.response;
    if (!request?.url) continue;

    const url = new URL(request.url);
    const isCheckout =
      url.host === "chatgpt.com" &&
      url.pathname === "/backend-api/payments/checkout" &&
      request.method === "POST" &&
      response?.status >= 200 &&
      response?.status < 300;

    if (!isCheckout) continue;
    if (!latest) {
      latest = entry;
      continue;
    }

    const currentTime = Date.parse(entry.startedDateTime ?? "");
    const latestTime = Date.parse(latest.startedDateTime ?? "");
    if (Number.isNaN(currentTime) || Number.isNaN(latestTime) || currentTime >= latestTime) {
      latest = entry;
    }
  }

  if (!latest) throw new Error("No successful POST /backend-api/payments/checkout found in HAR");
  return latest;
}

export function redactCheckoutResult(data) {
  const keys = Object.keys(data ?? {}).sort();
  const summary = {};

  for (const key of keys) {
    const value = data[key];
    if (isSecretKey(key)) {
      summary[key] = "<redacted>";
    } else if (key === "checkout_session_id") {
      summary[key] = redactId(value);
    } else if (key === "billing_details" && value && typeof value === "object") {
      summary[key] = {
        country: value.country,
        currency: value.currency,
      };
    } else if (["status", "payment_status", "plan_name", "checkout_ui_mode", "checkout_provider"].includes(key)) {
      summary[key] = value;
    }
  }

  return { keys, summary };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (shouldCheckDns(args, process.env)) {
    const extraCidrs = parseCsv(process.env.LAB_ALLOWED_CIDRS);
    await assertDomainsResolveToLab(REQUIRED_DOMAINS, extraCidrs);
  } else {
    console.log("[dns] skipped by default; pass --check-dns or set LAB_CHECK_DNS=1 to enable");
  }

  const harPath = args.har ?? DEFAULT_HAR_PATH;
  const har = JSON.parse(await fs.readFile(harPath, "utf8"));
  const checkoutEntry = extractLatestCheckoutRequest(har);
  const checkoutUrl = new URL(checkoutEntry.request.url);
  if (checkoutUrl.origin !== "https://chatgpt.com") {
    throw new Error(`Refusing non-lab checkout origin: ${checkoutUrl.origin}`);
  }

  const proxyUrl = resolveProxyUrl(args, process.env, checkoutEntry);
  if (shouldReexecForEnvProxy(args, process.env, process.execArgv, proxyUrl)) {
    console.log(`[proxy] relaunching with Node --use-env-proxy for ${proxyUrl}`);
    const exitCode = await reexecWithEnvProxy(proxyUrl, argv);
    process.exitCode = exitCode;
    return;
  }

  const accessToken = await resolveAccessToken(process.env, promptForAccessToken);
  const body = rewriteBillingDetails(checkoutEntry.request.postData?.text, "PH", "PHP");
  const headers = sanitizeHeaders(checkoutEntry.request.headers, accessToken);

  console.log("[checkout] POST https://chatgpt.com/backend-api/payments/checkout");
  console.log("[checkout] billing_details.country=PH billing_details.currency=PHP");
  console.log("[checkout] no card/CVV/payment confirmation fields will be sent");
  if (proxyUrl) {
    console.log(`[proxy] ${proxyUrl}`);
  } else {
    console.log("[proxy] direct");
  }

  const response = await postCheckoutRequest("https://chatgpt.com/backend-api/payments/checkout", {
    headers,
    body,
    proxyUrl,
  });

  const text = await response.text();
  console.log(`[checkout] status=${response.status}`);

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.log(redactText(text).slice(0, 1000));
  }

  if (parsed) {
    console.log(JSON.stringify(redactCheckoutResult(parsed), null, 2));
  }

  if (!response.ok) {
    process.exitCode = 1;
  }
}

async function assertDomainsResolveToLab(domains, extraCidrs) {
  for (const domain of domains) {
    const ips = await resolveDomainIps(domain);
    if (ips.length === 0) {
      throw new Error(`DNS check failed: ${domain} resolved to no IPs`);
    }

    const publicIps = ips.filter((ip) => !isPrivateOrLabIp(ip, extraCidrs));
    if (publicIps.length > 0) {
      throw new Error(`DNS check failed: ${domain} resolved outside lab/private ranges: ${publicIps.join(", ")}`);
    }

    console.log(`[dns] ${domain} -> ${ips.join(", ")}`);
  }
}

async function resolveDomainIps(domain) {
  const results = [];
  for (const type of ["resolve4", "resolve6"]) {
    try {
      results.push(...(await dns[type](domain)));
    } catch (error) {
      if (!["ENODATA", "ENOTFOUND", "ENOTIMP"].includes(error?.code)) throw error;
    }
  }
  return [...new Set(results)];
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
    } else if (value === "--check-dns") {
      args.checkDns = true;
    } else if (value === "--proxy") {
      args.proxy = argv[index + 1];
      index += 1;
    } else if (value === "--no-proxy") {
      args.noProxy = true;
    } else if (value === "--har") {
      args.har = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

export function shouldCheckDns(args, env = process.env) {
  return Boolean(args?.checkDns || isTruthy(env?.LAB_CHECK_DNS));
}

export function inferProxyUrlFromHarEntry(entry) {
  const ip = entry?.serverIPAddress ?? entry?._serverIPAddress;
  const port = entry?.connection;
  if (ip === "127.0.0.1" && /^\d+$/.test(String(port ?? ""))) {
    return `http://127.0.0.1:${port}`;
  }
  return null;
}

export function resolveProxyUrl(args, env = process.env, checkoutEntry = null) {
  if (args?.noProxy) return null;
  if (args?.proxy) return normalizeProxyUrl(args.proxy);
  if (env?.LAB_PROXY) return normalizeProxyUrl(env.LAB_PROXY);
  if (env?.HTTPS_PROXY) return normalizeProxyUrl(env.HTTPS_PROXY);
  if (env?.HTTP_PROXY) return normalizeProxyUrl(env.HTTP_PROXY);
  return inferProxyUrlFromHarEntry(checkoutEntry);
}

export function shouldReexecForEnvProxy(args, env = process.env, execArgv = process.execArgv, proxyUrl = null) {
  return Boolean(
    proxyUrl &&
      !args?.noProxy &&
      !env?.LAB_PROXY_REEXEC &&
      !execArgv.includes("--use-env-proxy"),
  );
}

export async function resolveAccessToken(env = process.env, prompt = promptForAccessToken) {
  const envToken = String(env?.LAB_ACCESS_TOKEN ?? "").trim();
  if (envToken) return envToken;

  const promptedToken = String(await prompt()).trim();
  if (!promptedToken) {
    throw new Error("Access token is required");
  }
  return promptedToken;
}

function printHelp() {
  console.log(`Usage:
  node test\\checkout_ph_dry_run.mjs --har test\\data_new.har

Optional:
  $env:LAB_ACCESS_TOKEN = '<lab access token>'
  node test\\checkout_ph_dry_run.mjs --har test\\data_new.har --proxy http://127.0.0.1:7890
  node test\\checkout_ph_dry_run.mjs --har test\\data_new.har --no-proxy
  node test\\checkout_ph_dry_run.mjs --har test\\data_new.har --check-dns
  $env:LAB_PROXY = 'http://127.0.0.1:7890'
  $env:LAB_CHECK_DNS = '1'
  $env:LAB_ALLOWED_CIDRS = '100.64.0.0/10'

If LAB_ACCESS_TOKEN is not set, the script prompts for it after startup.
If the HAR shows a local proxy, the script auto-uses it unless --no-proxy is set.
DNS checks are skipped by default for lab speed. This script stops at checkout
session creation. It never submits card/CVV/payment confirmation data.`);
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function normalizeProxyUrl(value) {
  const proxy = new URL(String(value));
  if (proxy.protocol !== "http:") {
    throw new Error(`Only http:// proxies are supported: ${proxy.protocol}`);
  }
  return proxy.toString().replace(/\/$/, "");
}

async function postCheckoutRequest(url, { headers, body, proxyUrl }) {
  if (proxyUrl && !shouldUseNodeEnvProxy()) {
    return postJsonViaHttpProxy(url, { headers, body, proxyUrl });
  }

  return fetch(url, {
    method: "POST",
    headers,
    body,
    credentials: "omit",
    redirect: "manual",
  });
}

function shouldUseNodeEnvProxy() {
  return process.execArgv.includes("--use-env-proxy") || process.env.LAB_PROXY_REEXEC === "1";
}

function reexecWithEnvProxy(proxyUrl, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--use-env-proxy", process.argv[1], ...argv], {
      stdio: "inherit",
      env: {
        ...process.env,
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        LAB_PROXY_REEXEC: "1",
      },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function postJsonViaHttpProxy(targetUrl, { headers, body, proxyUrl }) {
  const target = new URL(targetUrl);
  const proxy = new URL(proxyUrl);
  if (target.protocol !== "https:") {
    throw new Error(`Proxy tunnel only supports HTTPS targets: ${target.protocol}`);
  }

  const rawResponse = await requestThroughHttpProxy(target, proxy, {
    method: "POST",
    headers,
    body,
  });
  const parsed = parseHttpResponse(rawResponse);
  return {
    status: parsed.status,
    ok: parsed.status >= 200 && parsed.status < 300,
    text: async () => parsed.bodyText,
  };
}

async function requestThroughHttpProxy(target, proxy, request) {
  const socket = await connectToProxy(proxy);

  try {
    await establishConnectTunnel(socket, target);
    const secureSocket = await connectTls(socket, target.hostname);
    return await sendHttp1Request(secureSocket, target, request);
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function connectToProxy(proxy) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port || 80), proxy.hostname);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function establishConnectTunnel(socket, target) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      cleanup();
      const header = buffer.subarray(0, headerEnd).toString("latin1");
      const statusLine = header.split("\r\n")[0] ?? "";
      if (!/^HTTP\/1\.[01] 2\d\d\b/.test(statusLine)) {
        reject(new Error(`Proxy CONNECT failed: ${statusLine}`));
        return;
      }
      resolve();
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.write(
      [
        `CONNECT ${target.hostname}:443 HTTP/1.1`,
        `Host: ${target.hostname}:443`,
        "Proxy-Connection: keep-alive",
        "",
        "",
      ].join("\r\n"),
    );
  });
}

function connectTls(socket, servername) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername,
      rejectUnauthorized: !isTruthy(process.env.LAB_INSECURE_TLS),
    });
    secureSocket.once("secureConnect", () => resolve(secureSocket));
    secureSocket.once("error", reject);
  });
}

function sendHttp1Request(socket, target, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const bodyBuffer = Buffer.from(body ?? "", "utf8");
    const requestHeaders = {
      ...headers,
      host: target.host,
      connection: "close",
      "content-length": String(bodyBuffer.length),
    };

    const onData = (chunk) => chunks.push(chunk);
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);

    const headerLines = [
      `${method} ${target.pathname}${target.search} HTTP/1.1`,
      ...Object.entries(requestHeaders)
        .filter(([name, value]) => value !== undefined && value !== null && !String(name).startsWith(":"))
        .map(([name, value]) => `${name}: ${String(value).replace(/\r|\n/g, "")}`),
      "",
      "",
    ];
    socket.write(headerLines.join("\r\n"));
    socket.end(bodyBuffer);
  });
}

function parseHttpResponse(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) throw new Error("Invalid HTTP response from proxy tunnel");

  const headerText = raw.subarray(0, headerEnd).toString("latin1");
  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const status = Number.parseInt(statusLine.split(/\s+/)[1], 10);
  if (Number.isNaN(status)) throw new Error(`Invalid HTTP status line: ${statusLine}`);

  const headers = new Map();
  for (const line of headerLines) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers.set(line.slice(0, index).toLowerCase(), line.slice(index + 1).trim());
  }

  let body = raw.subarray(headerEnd + 4);
  if (/chunked/i.test(headers.get("transfer-encoding") ?? "")) {
    body = decodeChunkedBody(body);
  }
  const encoding = (headers.get("content-encoding") ?? "").toLowerCase();
  if (encoding === "gzip") body = zlib.gunzipSync(body);
  if (encoding === "deflate") body = zlib.inflateSync(body);
  if (encoding === "br") body = zlib.brotliDecompressSync(body);

  return {
    status,
    headers,
    bodyText: body.toString("utf8"),
  };
}

function decodeChunkedBody(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const sizeText = buffer.subarray(offset, lineEnd).toString("latin1").split(";")[0];
    const size = Number.parseInt(sizeText, 16);
    if (!size) break;
    const start = lineEnd + 2;
    const end = start + size;
    chunks.push(buffer.subarray(start, end));
    offset = end + 2;
  }
  return Buffer.concat(chunks);
}

async function promptForAccessToken() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await rl.question("Paste lab access token: ");
  } finally {
    rl.close();
  }
}

function isSecretKey(key) {
  return /secret|publishable_key|client_secret|token|key/i.test(key);
}

function redactId(value) {
  if (typeof value !== "string") return value;
  if (value.length <= 12) return "<redacted>";
  return `${value.slice(0, 12)}...<redacted>`;
}

function redactText(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
    .replace(/cs_(live|test)_[A-Za-z0-9_-]+/g, "cs_$1_<redacted>")
    .replace(/pk_(live|test)_[A-Za-z0-9_-]+/g, "pk_$1_<redacted>")
    .replace(/secret_[A-Za-z0-9_-]+/g, "secret_<redacted>");
}

function isIpv4MappedIpv6(ip) {
  return typeof ip === "string" && ip.toLowerCase().startsWith("::ffff:");
}

function isIpv4InCidr(ip, cidr) {
  const [network, prefixText] = String(cidr).split("/");
  const prefix = Number.parseInt(prefixText, 10);
  if (net.isIP(ip) !== 4 || net.isIP(network) !== 4 || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

function ipv4ToInt(ip) {
  return ip
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[error] ${redactText(formatError(error))}`);
    process.exitCode = 1;
  });
}

function formatError(error) {
  const parts = [];
  let current = error;
  while (current) {
    const message = current?.message ?? String(current);
    const code = current?.code ? ` (${current.code})` : "";
    parts.push(`${message}${code}`);
    current = current?.cause;
  }
  return parts.join(" <- caused by: ");
}

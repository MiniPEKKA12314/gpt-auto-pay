import net from "node:net";
import tls from "node:tls";

import { redactProxyUrl } from "./proxy_pool.mjs";

const DEFAULT_TEST_URL = "https://api.ipify.org?format=json";
const DEFAULT_TIMEOUT_MS = 15000;

function timeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const n = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1000 || n > 120000) {
    throw new Error("timeout_ms must be an integer between 1000 and 120000");
  }
  return n;
}

function normalizeTestUrl(value = DEFAULT_TEST_URL) {
  const url = new URL(String(value || DEFAULT_TEST_URL));
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("proxy connectivity test url must start with https:// or http://");
  }
  return url;
}

function normalizeProxyUrlForConnectivity(value) {
  const proxy = new URL(String(value || ""));
  if (!["http:", "https:", "socks5:"].includes(proxy.protocol)) {
    throw new Error("proxy connectivity test supports http://, https://, and socks5:// only");
  }
  if (!proxy.hostname || !proxy.port) throw new Error("proxy url must include host and port");
  return proxy;
}

function getProxyPort(proxy) {
  if (proxy.port) return Number(proxy.port);
  if (proxy.protocol === "https:") return 443;
  if (proxy.protocol === "socks5:") return 1080;
  return 80;
}

function createTimeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
    },
  };
}

function connectSocket(host, port, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), host);
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(new Error("proxy connectivity test timed out"));
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function connectTls(socket, servername, signal) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername });
    const cleanup = () => {
      secureSocket.off("secureConnect", onSecure);
      secureSocket.off("error", onError);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const onSecure = () => {
      cleanup();
      resolve(secureSocket);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      cleanup();
      secureSocket.destroy();
      reject(new Error("proxy connectivity test timed out"));
    };
    secureSocket.once("secureConnect", onSecure);
    secureSocket.once("error", onError);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function readHttpHeader(socket, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      cleanup();
      resolve({
        header: buffer.subarray(0, headerEnd).toString("latin1"),
        bodyStart: buffer.subarray(headerEnd + 4),
      });
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("socket ended before HTTP response header"));
    };
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(new Error("proxy connectivity test timed out"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

async function establishHttpProxyTunnel(proxy, target, signal) {
  const targetPort = Number(target.port || 443);
  const socket = proxy.protocol === "https:"
    ? await connectTls(await connectSocket(proxy.hostname, getProxyPort(proxy), signal), proxy.hostname, signal)
    : await connectSocket(proxy.hostname, getProxyPort(proxy), signal);
  const authHeader = proxy.username
    ? [`Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`]
    : [];
  socket.write([
    `CONNECT ${target.hostname}:${targetPort} HTTP/1.1`,
    `Host: ${target.hostname}:${targetPort}`,
    "Proxy-Connection: keep-alive",
    ...authHeader,
    "",
    "",
  ].join("\r\n"));
  const response = await readHttpHeader(socket, signal);
  const statusLine = response.header.split("\r\n")[0] || "";
  if (!/^HTTP\/1\.[01] 2\d\d\b/.test(statusLine)) {
    socket.destroy();
    throw new Error(`Proxy CONNECT failed: ${statusLine}`);
  }
  return socket;
}

async function sendPlainHttpThroughHttpProxy(proxy, target, signal) {
  const socket = proxy.protocol === "https:"
    ? await connectTls(await connectSocket(proxy.hostname, getProxyPort(proxy), signal), proxy.hostname, signal)
    : await connectSocket(proxy.hostname, getProxyPort(proxy), signal);
  const authHeader = proxy.username
    ? [`Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`]
    : [];
  try {
    const requestUrl = target.toString();
    socket.write([
      `GET ${requestUrl} HTTP/1.1`,
      `Host: ${target.host}`,
      "Accept: application/json,text/plain,*/*",
      "Connection: close",
      ...authHeader,
      "",
      "",
    ].join("\r\n"));
    const responseBuffer = await readFullResponse(socket, signal);
    return parseHttpResponse(responseBuffer);
  } finally {
    socket.destroy();
  }
}

function createSocketReader(socket, signal) {
  let buffer = Buffer.alloc(0);
  const waiters = [];
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    flush();
  };
  const failAll = (error) => {
    while (waiters.length) waiters.shift().reject(error);
  };
  const onError = (error) => failAll(error);
  const onEnd = () => failAll(new Error("Socket ended during proxy handshake"));
  const onAbort = () => {
    socket.destroy();
    failAll(new Error("proxy connectivity test timed out"));
  };
  const flush = () => {
    while (waiters.length && buffer.length >= waiters[0].size) {
      const waiter = waiters.shift();
      const chunk = buffer.subarray(0, waiter.size);
      buffer = buffer.subarray(waiter.size);
      waiter.resolve(chunk);
    }
  };
  socket.on("data", onData);
  socket.once("error", onError);
  socket.once("end", onEnd);
  signal?.addEventListener?.("abort", onAbort, { once: true });
  return {
    read(size) {
      if (buffer.length >= size) {
        const chunk = buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        return Promise.resolve(chunk);
      }
      return new Promise((resolve, reject) => waiters.push({ size, resolve, reject }));
    },
    dispose() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      signal?.removeEventListener?.("abort", onAbort);
    },
  };
}

function socks5ConnectRequest(host, port) {
  const portBuffer = Buffer.alloc(2);
  portBuffer.writeUInt16BE(Number(port), 0);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x01]),
      Buffer.from(host.split(".").map((part) => Number.parseInt(part, 10))),
      portBuffer,
    ]);
  }
  const hostBuffer = Buffer.from(String(host), "utf8");
  if (hostBuffer.length > 255) throw new Error("SOCKS5 target host is too long");
  return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]), hostBuffer, portBuffer]);
}

async function establishSocks5Tunnel(proxy, target, signal) {
  const socket = await connectSocket(proxy.hostname, getProxyPort(proxy), signal);
  const reader = createSocketReader(socket, signal);
  try {
    const targetPort = Number(target.port || (target.protocol === "http:" ? 80 : 443));
    const username = decodeURIComponent(proxy.username || "");
    const password = decodeURIComponent(proxy.password || "");
    const authRequired = username.length > 0 || password.length > 0;
    socket.write(authRequired ? Buffer.from([0x05, 0x01, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await reader.read(2);
    if (greeting[0] !== 0x05) throw new Error("Invalid SOCKS5 greeting response");
    if (greeting[1] === 0x02) {
      const user = Buffer.from(username, "utf8");
      const pass = Buffer.from(password, "utf8");
      if (user.length > 255 || pass.length > 255) throw new Error("SOCKS5 username/password is too long");
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await reader.read(2);
      if (auth[1] !== 0x00) throw new Error("SOCKS5 authentication failed");
    } else if (greeting[1] !== 0x00) {
      throw new Error(`SOCKS5 proxy rejected authentication method: 0x${greeting[1].toString(16)}`);
    }
    socket.write(socks5ConnectRequest(target.hostname, targetPort));
    const header = await reader.read(4);
    if (header[0] !== 0x05) throw new Error("Invalid SOCKS5 connect response");
    if (header[1] !== 0x00) throw new Error(`SOCKS5 connect failed: 0x${header[1].toString(16)}`);
    const atyp = header[3];
    if (atyp === 0x01) await reader.read(6);
    else if (atyp === 0x04) await reader.read(18);
    else if (atyp === 0x03) {
      const length = (await reader.read(1))[0];
      await reader.read(length + 2);
    } else {
      throw new Error(`Invalid SOCKS5 address type: 0x${atyp.toString(16)}`);
    }
    reader.dispose();
    return socket;
  } catch (error) {
    reader.dispose();
    socket.destroy();
    throw error;
  }
}

function readFullResponse(socket, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      signal?.removeEventListener?.("abort", onAbort);
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
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(new Error("proxy connectivity test timed out"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function parseHttpResponse(buffer) {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) throw new Error("invalid HTTP response from proxy test target");
  const headerText = buffer.subarray(0, headerEnd).toString("latin1");
  const bodyText = buffer.subarray(headerEnd + 4).toString("utf8");
  const statusLine = headerText.split("\r\n")[0] || "";
  const status = Number(statusLine.match(/^HTTP\/1\.[01]\s+(\d+)/)?.[1] || 0);
  return { status, statusLine, bodyText };
}

async function fetchThroughProxy(proxyUrl, testUrl, signal) {
  const proxy = normalizeProxyUrlForConnectivity(proxyUrl);
  const target = normalizeTestUrl(testUrl);
  if (target.protocol === "http:") {
    if (proxy.protocol === "http:" || proxy.protocol === "https:") {
      return await sendPlainHttpThroughHttpProxy(proxy, target, signal);
    }
    const socket = await establishSocks5Tunnel(proxy, target, signal);
    try {
      const path = `${target.pathname || "/"}${target.search || ""}`;
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${target.host}`,
        "Accept: application/json,text/plain,*/*",
        "Connection: close",
        "",
        "",
      ].join("\r\n"));
      const responseBuffer = await readFullResponse(socket, signal);
      return parseHttpResponse(responseBuffer);
    } finally {
      socket.destroy();
    }
  }
  const tunnel = proxy.protocol === "socks5:"
    ? await establishSocks5Tunnel(proxy, target, signal)
    : await establishHttpProxyTunnel(proxy, target, signal);
  let secureSocket;
  try {
    secureSocket = await connectTls(tunnel, target.hostname, signal);
    const path = `${target.pathname || "/"}${target.search || ""}`;
    secureSocket.write([
      `GET ${path} HTTP/1.1`,
      `Host: ${target.hostname}`,
      "Accept: application/json,text/plain,*/*",
      "Connection: close",
      "",
      "",
    ].join("\r\n"));
    const responseBuffer = await readFullResponse(secureSocket, signal);
    return parseHttpResponse(responseBuffer);
  } finally {
    secureSocket?.destroy();
    tunnel.destroy();
  }
}

function extractIp(bodyText) {
  const text = String(bodyText || "").trim();
  try {
    const json = JSON.parse(text);
    return String(json.ip || json.origin || "").split(",")[0].trim();
  } catch {
    return String(text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || "").trim();
  }
}

export async function testProxyConnectivity(proxyUrl, options = {}) {
  const started = Date.now();
  const ms = timeoutMs(options.timeout_ms ?? options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const targetUrl = String(options.test_url ?? options.testUrl ?? DEFAULT_TEST_URL);
  const timeout = createTimeoutSignal(ms);
  try {
    const response = await fetchThroughProxy(proxyUrl, targetUrl, timeout.signal);
    const ip = extractIp(response.bodyText);
    const ok = response.status >= 200 && response.status < 300;
    return {
      ok,
      status: response.status,
      statusLine: response.statusLine,
      targetUrl,
      elapsedMs: Date.now() - started,
      ip,
      bodyPreview: response.bodyText.slice(0, 300),
      redactedProxyUrl: redactProxyUrl(proxyUrl),
      message: ok
        ? `代理连通性测试成功${ip ? `，出口 IP: ${ip}` : ""}`
        : `代理已连接到测试服务器，但测试服务器返回 HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      targetUrl,
      elapsedMs: Date.now() - started,
      error: error?.message || String(error),
      redactedProxyUrl: redactProxyUrl(proxyUrl),
      message: `代理连通性测试失败：${error?.message || error}`,
    };
  } finally {
    timeout.clear();
  }
}

export async function testDirectConnectivity(options = {}) {
  const targetUrl = String(options.test_url ?? options.testUrl ?? DEFAULT_TEST_URL);
  const ms = timeoutMs(options.timeout_ms ?? options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(targetUrl, { signal: controller.signal, headers: { accept: "application/json,text/plain,*/*" } });
    const text = await response.text();
    const ip = extractIp(text);
    return {
      ok: response.ok,
      status: response.status,
      targetUrl,
      elapsedMs: Date.now() - started,
      ip,
      bodyPreview: text.slice(0, 300),
      message: response.ok ? `直连测试成功${ip ? `，出口 IP: ${ip}` : ""}` : `直连测试返回 HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      targetUrl,
      elapsedMs: Date.now() - started,
      error: error?.message || String(error),
      message: `直连测试失败：${error?.message || error}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

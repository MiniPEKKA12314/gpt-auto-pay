import { randomBytes } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STICKY_MINUTES = 120;

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function toInteger(value, fallback, min, max, field) {
  const n = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function normalizeIpwoProtocol(value, fallback = "http") {
  const protocol = String(value ?? fallback).trim().toLowerCase();
  if (protocol === "https") return "http";
  if (protocol !== "http" && protocol !== "socks5") {
    throw new Error("IPWO protocol must be http/https or socks5");
  }
  return protocol;
}

function optionalText(value) {
  return String(value ?? "").trim();
}

function isRandomToken(value) {
  const text = optionalText(value);
  return !text || /^(random|rand|any|auto|\*|随机)$/i.test(text);
}

function normalizeIpwoToken(value, field, options = {}) {
  if (isRandomToken(value)) return "";
  const text = optionalText(value).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9-]+$/.test(text)) {
    throw new Error(`${field} can only include letters, digits, or hyphen`);
  }
  return options.uppercase ? text.toUpperCase() : text;
}

function normalizeSessionMode(value) {
  const text = String(value ?? "sticky").trim().toLowerCase();
  if (["sticky", "session", "fixed", "粘性", "粘性ip"].includes(text)) return "sticky";
  if (["rotate", "rotating", "dynamic", "轮换", "轮换ip"].includes(text)) return "rotate";
  throw new Error("ipwo session_mode must be sticky or rotate");
}

function normalizeSessionParam(value) {
  const text = String(value ?? "sid").trim().toLowerCase();
  if (text === "sid" || text === "session") return text;
  throw new Error("ipwo session_param must be sid or session");
}

function normalizeStateParam(value) {
  const text = String(value ?? "st").trim().toLowerCase();
  if (text === "st" || text === "state") return text;
  throw new Error("ipwo state_param must be st or state");
}

function normalizeIpwoSessionId(value) {
  const text = optionalText(value);
  if (!text) return randomBytes(6).toString("hex");
  if (!/^[A-Za-z0-9-]+$/.test(text)) {
    throw new Error("ipwo session id can only include letters, digits, or hyphen");
  }
  return text;
}

export function normalizeIpwoConfig(input = {}) {
  const rawApiUrl = input.api_url ?? input.apiUrl ?? input.url ?? input.endpoint;
  const hasCredentialFields = Boolean(input.host ?? input.hostname ?? input.proxy_host ?? input.proxyHost ?? input.port ?? input.username ?? input.user ?? input.account ?? input.password ?? input.pass);
  if (!hasCredentialFields && optionalText(rawApiUrl)) {
    const apiUrl = requiredText(rawApiUrl, "ipwo api_url");
    let parsed;
    try {
      parsed = new URL(apiUrl);
    } catch {
      throw new Error("ipwo api_url must be a valid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("ipwo api_url must start with http:// or https://");
    }

    return {
      mode: "api",
      api_url: apiUrl,
      regions: String(input.regions ?? input.region ?? "").trim().toUpperCase(),
      protocol: normalizeIpwoProtocol(input.protocol, "http"),
      num: toInteger(input.num ?? input.count, 1, 1, 1000, "ipwo num"),
      timeout_ms: toInteger(input.timeout_ms ?? input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000, "ipwo timeout_ms"),
      return_type: String(input.return_type ?? input.returnType ?? "json").trim().toLowerCase() === "txt" ? "txt" : "json",
    };
  }

  const host = requiredText(input.host ?? input.hostname ?? input.proxy_host ?? input.proxyHost, "ipwo host");
  const port = toInteger(input.port ?? input.proxy_port ?? input.proxyPort, undefined, 1, 65535, "ipwo port");
  const username = requiredText(input.username ?? input.user ?? input.account, "ipwo username");
  const password = requiredText(input.password ?? input.pass, "ipwo password");
  const sessionMode = normalizeSessionMode(input.session_mode ?? input.sessionMode ?? input.mode);

  return {
    mode: "credential",
    host,
    port,
    username,
    password,
    protocol: normalizeIpwoProtocol(input.protocol, "socks5"),
    country: normalizeIpwoToken(input.country ?? input.zone ?? input.region, "ipwo country", { uppercase: true }),
    state: normalizeIpwoToken(input.state ?? input.province, "ipwo state"),
    city: normalizeIpwoToken(input.city, "ipwo city"),
    session_mode: sessionMode,
    sticky_minutes: toInteger(input.sticky_minutes ?? input.stickyMinutes ?? input.time ?? input.time_minutes ?? input.timeMinutes, DEFAULT_STICKY_MINUTES, 1, 43_200, "ipwo sticky_minutes"),
    session_param: normalizeSessionParam(input.session_param ?? input.sessionParam),
    state_param: normalizeStateParam(input.state_param ?? input.stateParam),
  };
}

export function redactIpwoApiUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.username || url.password) {
      url.username = url.username ? "<user>" : "";
      url.password = url.password ? "<pass>" : "";
    }
    const safe = new URL(`${url.protocol}//${url.host}${url.pathname}`);
    for (const [key, paramValue] of url.searchParams.entries()) {
      if (["num", "regions", "protocol", "return_type", "lb", "sb"].includes(key)) {
        safe.searchParams.append(key, paramValue);
      } else {
        safe.searchParams.append(key, "<redacted>");
      }
    }
    return safe.toString();
  } catch {
    return text.replace(/([?&][^=]+)=([^&]+)/g, "$1=<redacted>");
  }
}

function redactProxyUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (parsed.username || parsed.password) {
      const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
      return `${parsed.protocol}//<user>:<pass>@${parsed.host}${path}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return text.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/, "//<user>:<pass>@");
  }
}

function encodeProxyCredential(value) {
  return encodeURIComponent(String(value ?? ""));
}

function bracketHostForUrl(host) {
  const cleanHost = requiredText(host, "ipwo host");
  return cleanHost.includes(":") && !cleanHost.startsWith("[") ? `[${cleanHost}]` : cleanHost;
}

export function buildIpwoCredentialUsername(config = {}, options = {}) {
  const normalized = normalizeIpwoConfig(config);
  if (normalized.mode !== "credential") {
    throw new Error("ipwo credential config is required");
  }
  const parts = [normalized.username];
  if (normalized.country) parts.push("custom", "zone", normalized.country);
  if (normalized.state) parts.push(normalized.state_param, normalized.state);
  if (normalized.city) parts.push("city", normalized.city);

  let session = "";
  if (normalized.session_mode === "sticky") {
    session = normalizeIpwoSessionId(options.session ?? options.session_id ?? options.sessionId);
    parts.push(normalized.session_param, session, "time", String(normalized.sticky_minutes));
  }

  return {
    username: parts.join("_"),
    session,
    params: {
      country: normalized.country,
      state: normalized.state,
      city: normalized.city,
      session_mode: normalized.session_mode,
      sticky_minutes: normalized.session_mode === "sticky" ? normalized.sticky_minutes : 0,
      session_param: normalized.session_mode === "sticky" ? normalized.session_param : "",
      state_param: normalized.state ? normalized.state_param : "",
    },
    config: normalized,
  };
}

export function buildIpwoCredentialProxyUrl(config = {}, options = {}) {
  const builtUsername = buildIpwoCredentialUsername(config, options);
  const normalized = builtUsername.config;
  const protocol = normalizeIpwoProtocol(options.protocol ?? normalized.protocol, normalized.protocol);
  const host = bracketHostForUrl(normalized.host);
  const url = `${protocol}://${encodeProxyCredential(builtUsername.username)}:${encodeProxyCredential(normalized.password)}@${host}:${normalized.port}`;
  return {
    url,
    redacted_url: redactProxyUrl(url),
    username: builtUsername.username,
    session: builtUsername.session,
    params: builtUsername.params,
    protocol,
    host: normalized.host,
    port: normalized.port,
  };
}

export function buildIpwoApiUrl(config = {}, overrides = {}) {
  const normalized = normalizeIpwoConfig({ ...config, ...overrides });
  if (normalized.mode !== "api") throw new Error("ipwo api config is required");
  const url = new URL(normalized.api_url);
  url.searchParams.set("num", String(normalized.num));
  if (normalized.regions) url.searchParams.set("regions", normalized.regions);
  url.searchParams.set("protocol", normalized.protocol);
  url.searchParams.set("return_type", normalized.return_type);
  return {
    url: url.toString(),
    redacted_url: redactIpwoApiUrl(url.toString()),
    config: normalized,
  };
}

function hostPortToProxyUrl(host, port, protocol) {
  const cleanHost = requiredText(host, "proxy ip");
  const numericPort = toInteger(port, undefined, 1, 65535, "proxy port");
  const bracketedHost = cleanHost.includes(":") && !cleanHost.startsWith("[") ? `[${cleanHost}]` : cleanHost;
  const scheme = normalizeIpwoProtocol(protocol, "http");
  return `${scheme}://${bracketedHost}:${numericPort}`;
}

function parseHostPortLine(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;
  const match = text.match(/^\[?([^\]\s:]+|\S+:\S+)\]?:([0-9]{1,5})$/);
  if (!match) return null;
  return { ip: match[1], port: Number(match[2]) };
}

export function normalizeIpwoProxyEntries(payload, protocol = "http") {
  const rawEntries = Array.isArray(payload)
    ? payload
    : String(payload ?? "")
        .split(/[\r\n|,\t]+/)
        .map((line) => line.trim())
        .filter(Boolean);

  return rawEntries.map((entry, index) => {
    const source = typeof entry === "string" ? parseHostPortLine(entry) : entry;
    if (!source || typeof source !== "object") throw new Error("IPWO proxy entry must include ip and port");
    const url = hostPortToProxyUrl(source.ip ?? source.host, source.port, protocol);
    return {
      url,
      redacted_url: redactProxyUrl(url),
      ip: String(source.ip ?? source.host ?? ""),
      port: Number(source.port),
      protocol: normalizeIpwoProtocol(protocol, "http"),
      priority: index,
      enabled: true,
      index,
    };
  });
}

async function readResponseBody(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  const text = await response.text();
  if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return { kind: "json", value: JSON.parse(text), text };
    } catch {
      return { kind: "text", value: text, text };
    }
  }
  return { kind: "text", value: text, text };
}

export async function fetchIpwoProxies(config = {}, options = {}) {
  const built = buildIpwoApiUrl(config, {
    num: options.num ?? config.num,
    regions: options.regions ?? config.regions,
    protocol: options.protocol ?? config.protocol,
    return_type: options.return_type ?? options.returnType ?? config.return_type ?? "json",
  });
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available");
  const controller = new AbortController();
  const timeoutMs = toInteger(options.timeout_ms ?? options.timeoutMs ?? built.config.timeout_ms, built.config.timeout_ms, 1_000, 120_000, "ipwo timeout_ms");
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(built.url, {
      method: "GET",
      headers: { accept: built.config.return_type === "json" ? "application/json,text/plain;q=0.8" : "text/plain,*/*;q=0.8" },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`IPWO API 请求超时（${timeoutMs}ms）`);
    throw new Error(`IPWO API 请求失败: ${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }

  const body = await readResponseBody(response);
  if (!response.ok) {
    const hint = response.status === 403 ? "；请检查服务器公网 IP 是否已加入 IPWO 白名单" : "";
    throw new Error(`IPWO API 返回 HTTP ${response.status}${hint}: ${String(body.text || "").slice(0, 300)}`);
  }

  if (body.kind === "json") {
    const json = body.value;
    if (json && json.success === false) {
      throw new Error(`IPWO API 获取失败: ${json.msg || json.message || "unknown error"}`);
    }
    const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    const entries = normalizeIpwoProxyEntries(data, built.config.protocol);
    return {
      ok: true,
      provider: "ipwo",
      request_ip: json?.request_ip ?? "",
      message: json?.msg ?? "",
      request_url: built.redacted_url,
      protocol: built.config.protocol,
      entries,
      raw: {
        code: json?.code,
        success: json?.success,
        msg: json?.msg,
        request_ip: json?.request_ip,
      },
    };
  }

  const entries = normalizeIpwoProxyEntries(body.value, built.config.protocol);
  return {
    ok: true,
    provider: "ipwo",
    request_ip: "",
    message: "",
    request_url: built.redacted_url,
    protocol: built.config.protocol,
    entries,
    raw: {},
  };
}

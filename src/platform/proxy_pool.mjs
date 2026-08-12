import { buildIpwoCredentialProxyUrl, fetchIpwoProxies, normalizeIpwoConfig } from "./proxy_provider_ipwo.mjs";

export const PROXY_GROUP_KINDS = Object.freeze(["checkout", "direct_card", "shared"]);
export const PROXY_PROVIDERS = Object.freeze(["static", "api", "ipwo"]);
export const SUPPORTED_PROXY_PROTOCOLS = Object.freeze(["https:", "socks5:"]);

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function toBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function toInteger(value, fallback, min, max, field) {
  const n = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return {};
    if (text.startsWith("{") || text.startsWith("[")) {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? { proxies: parsed } : parsed;
    }
    return { proxies: text };
  }
  if (Array.isArray(value)) return { proxies: value };
  if (typeof value === "object") return { ...value };
  return {};
}

export function normalizeProxyKind(value) {
  const kind = String(value ?? "").trim().toLowerCase();
  if (!PROXY_GROUP_KINDS.includes(kind)) throw new Error(`invalid proxy kind: ${String(value ?? "")}`);
  return kind;
}

export function normalizeProxyProvider(value) {
  const provider = String(value ?? "static").trim().toLowerCase();
  if (!PROXY_PROVIDERS.includes(provider)) throw new Error(`invalid proxy provider: ${String(value ?? "")}`);
  return provider;
}

export function normalizeProxyUrl(value) {
  const text = requiredText(value, "proxy url");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`invalid proxy url: ${text}`);
  }
  if (!SUPPORTED_PROXY_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error("proxy url must start with https:// or socks5://");
  }
  if (!parsed.hostname || !parsed.port) {
    throw new Error("proxy url must include host and port");
  }
  return text;
}

export function redactProxyUrl(value) {
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

export function normalizeProxyEntries(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

  return raw
    .map((entry, index) => {
      if (typeof entry === "string") {
        const url = normalizeProxyUrl(entry);
        return {
          url,
          redacted_url: redactProxyUrl(url),
          priority: 100,
          enabled: true,
          index,
        };
      }
      if (!entry || typeof entry !== "object") throw new Error("proxy entry must be a string or object");
      const url = normalizeProxyUrl(entry.url ?? entry.proxy ?? entry.proxy_url ?? entry.proxyUrl);
      return {
        url,
        redacted_url: redactProxyUrl(url),
        priority: toInteger(entry.priority, 100, 0, 1000000, "proxy priority"),
        enabled: toBoolean(entry.enabled, true),
        index,
        session: String(entry.session ?? ""),
        note: String(entry.note ?? ""),
      };
    })
    .sort((left, right) => left.priority - right.priority || left.index - right.index);
}

export function normalizeProxyGroup(input = {}) {
  const provider = normalizeProxyProvider(input.provider);
  const config = parseConfig(input.config ?? input.config_json ?? input.configJson ?? {});
  const normalizedConfig = provider === "static"
    ? {
        ...config,
        proxies: normalizeProxyEntries(config.proxies ?? config.proxy_list ?? config.proxyList ?? config.text ?? ""),
      }
    : provider === "ipwo"
      ? normalizeIpwoConfig(config)
    : config;

  return {
    name: requiredText(input.name, "name"),
    kind: normalizeProxyKind(input.kind ?? "shared"),
    provider,
    config_json: JSON.stringify(normalizedConfig),
    enabled: toBoolean(input.enabled, true),
    note: String(input.note ?? ""),
  };
}

export function selectProxyForAttempt(proxyGroup, options = {}) {
  if (!proxyGroup) {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      reason: "proxy_group_missing",
    };
  }
  const group = normalizeProxyGroup(proxyGroup);
  if (!group.enabled) {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      provider: group.provider,
      kind: group.kind,
      reason: "proxy_group_disabled",
    };
  }
  const config = parseConfig(group.config_json);
  if (group.provider !== "static") {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      provider: group.provider,
      kind: group.kind,
      reason: group.provider === "ipwo" ? "api_provider_requires_async" : "api_provider_not_connected",
      config,
    };
  }

  const entries = normalizeProxyEntries(config.proxies ?? []).filter((entry) => entry.enabled);
  if (entries.length === 0) {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      provider: group.provider,
      kind: group.kind,
      reason: "proxy_group_empty",
    };
  }
  const attemptIndex = toInteger(options.attemptIndex ?? options.attempt_index, 0, 0, Number.MAX_SAFE_INTEGER, "attemptIndex");
  const entry = entries[attemptIndex % entries.length];
  return {
    proxyUrl: entry.url,
    redactedProxyUrl: entry.redacted_url,
    provider: group.provider,
    kind: group.kind,
    reason: "",
    session: entry.session || "",
    entry,
  };
}

export async function selectProxyForAttemptAsync(proxyGroup, options = {}) {
  if (!proxyGroup) return selectProxyForAttempt(proxyGroup, options);
  const group = normalizeProxyGroup(proxyGroup);
  if (!group.enabled) return selectProxyForAttempt(group, options);
  if (group.provider !== "ipwo") return selectProxyForAttempt(group, options);

  const attemptIndex = toInteger(options.attemptIndex ?? options.attempt_index, 0, 0, Number.MAX_SAFE_INTEGER, "attemptIndex");
  const config = normalizeIpwoConfig(parseConfig(group.config_json));
  if (config.mode === "credential") {
    try {
      const built = buildIpwoCredentialProxyUrl(config, {
        session: options.session ?? options.session_id ?? options.sessionId,
      });
      return {
        proxyUrl: built.url,
        redactedProxyUrl: built.redacted_url,
        provider: group.provider,
        kind: group.kind,
        reason: "",
        session: built.session,
        entry: {
          url: built.url,
          redacted_url: built.redacted_url,
          protocol: built.protocol,
          host: built.host,
          port: built.port,
          enabled: true,
          priority: attemptIndex,
          index: attemptIndex,
        },
        ipwo: {
          mode: "credential",
          protocol: built.protocol,
          host: built.host,
          port: built.port,
          params: built.params,
          session: built.session,
        },
      };
    } catch (error) {
      return {
        proxyUrl: "",
        redactedProxyUrl: "",
        provider: group.provider,
        kind: group.kind,
        reason: "ipwo_config_invalid",
        error: error?.message || String(error),
      };
    }
  }
  try {
    const result = await fetchIpwoProxies(config, {
      fetchImpl: options.fetchImpl,
      num: options.num,
      regions: options.regions,
      protocol: options.protocol,
      timeout_ms: options.timeout_ms ?? options.timeoutMs,
    });
    const entries = (result.entries ?? []).filter((entry) => entry.enabled);
    if (entries.length === 0) {
      return {
        proxyUrl: "",
        redactedProxyUrl: "",
        provider: group.provider,
        kind: group.kind,
        reason: "ipwo_proxy_empty",
        api: result,
      };
    }
    const entry = entries[attemptIndex % entries.length];
    return {
      proxyUrl: entry.url,
      redactedProxyUrl: entry.redacted_url,
      provider: group.provider,
      kind: group.kind,
      reason: "",
      session: entry.session || "",
      entry,
      api: {
        provider: "ipwo",
        request_ip: result.request_ip,
        message: result.message,
        request_url: result.request_url,
        protocol: result.protocol,
        count: entries.length,
      },
    };
  } catch (error) {
    return {
      proxyUrl: "",
      redactedProxyUrl: "",
      provider: group.provider,
      kind: group.kind,
      reason: "ipwo_api_failed",
      error: error?.message || String(error),
      config: {
        ...config,
        api_url: config.api_url ? "<redacted>" : "",
      },
    };
  }
}

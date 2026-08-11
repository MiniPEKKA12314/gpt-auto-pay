import { createHash } from "node:crypto";

import { maskCardNumber } from "./crypto.mjs";

const DEFAULT_BASE_URL = "http://api.vcc.center";
const DEFAULT_TIMEOUT_MS = 15_000;

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

function isEmptySignValue(value) {
  return value === undefined || value === null || String(value) === "";
}

export function normalizeVccConfig(input = {}) {
  const baseUrl = String(input.base_url ?? input.baseUrl ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("VCC base_url must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("VCC base_url must start with http:// or https://");
  }
  return {
    provider: "vcc",
    base_url: parsed.toString().replace(/\/$/, ""),
    user_serial: requiredText(input.user_serial ?? input.userSerial, "VCC user_serial"),
    secret_key: requiredText(input.secret_key ?? input.secretKey, "VCC secret_key"),
    timeout_ms: toInteger(input.timeout_ms ?? input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000, "VCC timeout_ms"),
  };
}

export function sanitizeVccConfig(config = {}) {
  return {
    provider: "vcc",
    base_url: String(config.base_url ?? config.baseUrl ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL,
    user_serial: String(config.user_serial ?? config.userSerial ?? "").trim(),
    secret_configured: Boolean(config.secret_key ?? config.secretKey),
    timeout_ms: toInteger(config.timeout_ms ?? config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000, "VCC timeout_ms"),
  };
}

export function vccSign(params = {}, secretKey) {
  const keys = Object.keys(params)
    .filter((key) => key !== "sign" && !isEmptySignValue(params[key]))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const stringA = keys
    .map((key) => `${key}=${encodeURIComponent(String(params[key])).replace(/\+/g, "%20")}`)
    .join("&");
  return createHash("md5")
    .update(`${stringA}&key=${String(secretKey ?? "")}`)
    .digest("hex")
    .toUpperCase();
}

function normalizeExpiryDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})\s*[/\-]\s*(\d{2,4})$/);
  if (!match) return { exp_month: "", exp_year: "" };
  const expMonth = match[1].padStart(2, "0");
  const yearNumber = Number(match[2]);
  const expYear = match[2].length === 2 ? String(2000 + yearNumber) : String(yearNumber);
  return { exp_month: expMonth, exp_year: expYear };
}

export function normalizeVccCard(row = {}) {
  const number = String(row.number ?? row.cardNumber ?? "").replace(/\s+/g, "");
  const expiry = normalizeExpiryDate(row.expiryDate ?? row.expiry_date ?? row.expiry);
  return {
    provider: "vcc",
    provider_card_id: String(row.id ?? row.userBankCardId ?? ""),
    organization: String(row.organization ?? ""),
    state: String(row.state ?? ""),
    number,
    exp_month: expiry.exp_month,
    exp_year: expiry.exp_year,
    cvc: String(row.cvv ?? row.cvc ?? ""),
    remark: String(row.remark ?? ""),
    card_balance: String(row.cardBalance ?? row.card_balance ?? ""),
    create_time: String(row.createTime ?? row.create_time ?? ""),
    modify_time: String(row.modifyTime ?? row.modify_time ?? ""),
    masked_number: maskCardNumber(number),
  };
}

function contentFromResponse(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload.code !== undefined && Number(payload.code) !== 0) {
    throw new Error(`VCC API 返回错误 ${payload.code}: ${payload.msg || payload.message || "unknown error"}`);
  }
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload.content !== undefined) return payload.content;
  return payload;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`VCC API 返回不是 JSON: ${text.slice(0, 300)}`);
  }
}

export class VccCardProvider {
  constructor(config = {}, options = {}) {
    this.config = normalizeVccConfig(config);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw new Error("fetch is not available");
  }

  signedParams(params = {}, nowMs = Date.now()) {
    const merged = {
      ...params,
      userSerial: this.config.user_serial,
      timeStamp: String(nowMs),
    };
    return {
      ...merged,
      sign: vccSign(merged, this.config.secret_key),
    };
  }

  async request(method, path, params = {}, options = {}) {
    const signed = this.signedParams(params, options.nowMs ?? Date.now());
    const url = new URL(path, `${this.config.base_url}/`);
    const headers = { accept: "application/json" };
    const init = { method: method.toUpperCase(), headers };
    if (init.method === "GET" || init.method === "DELETE" || init.method === "PUT") {
      for (const [key, value] of Object.entries(signed)) {
        if (!isEmptySignValue(value)) url.searchParams.set(key, String(value));
      }
    } else {
      headers["content-type"] = "application/x-www-form-urlencoded; charset=utf-8";
      init.body = new URLSearchParams(Object.entries(signed).filter(([, value]) => !isEmptySignValue(value))).toString();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout_ms);
    try {
      const response = await this.fetchImpl(url.toString(), { ...init, signal: controller.signal });
      const json = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(`VCC API HTTP ${response.status}: ${json?.msg || json?.message || JSON.stringify(json).slice(0, 300)}`);
      }
      return json;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`VCC API 请求超时（${this.config.timeout_ms}ms）`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getUserInfo(options = {}) {
    return contentFromResponse(await this.request("GET", "/bank_card/user_info", {}, options));
  }

  async listCards(input = {}, options = {}) {
    const rows = contentFromResponse(await this.request("GET", "/bank_card/my_cards_page", {
      pageNumber: input.page_number ?? input.pageNumber ?? 1,
      pageSize: input.page_size ?? input.pageSize ?? 100,
      userBankId: input.user_bank_id ?? input.userBankId ?? "",
      userBankNum: input.user_bank_num ?? input.userBankNum ?? "",
      all: input.all ? "1" : "",
    }, options));
    return (Array.isArray(rows) ? rows : []).map(normalizeVccCard);
  }

  async listBins(options = {}) {
    const content = contentFromResponse(await this.request("GET", "/bank_card/enable_bin", {}, options));
    return Array.isArray(content) ? content : [];
  }

  async openCard(input = {}, options = {}) {
    return contentFromResponse(await this.request("POST", "/bank_card/open_card", {
      cardBin: input.card_bin ?? input.cardBin,
      amount: input.amount,
      eMail: input.email ?? input.eMail ?? "",
      remark: input.remark ?? "",
    }, options));
  }

  async getOpenCardDetail(input = {}, options = {}) {
    return contentFromResponse(await this.request("POST", "/bank_card/open_detail", {
      orderId: input.order_id ?? input.orderId,
    }, options));
  }

  async rechargeCard(input = {}, options = {}) {
    return contentFromResponse(await this.request("POST", "/bank_card/recharge", {
      bankCardId: input.bank_card_id ?? input.bankCardId ?? "",
      bankCardNum: input.bank_card_num ?? input.bankCardNum ?? "",
      amount: input.amount,
    }, options));
  }

  async getRechargeDetail(input = {}, options = {}) {
    return contentFromResponse(await this.request("POST", "/bank_card/recharge_detail", {
      rechargeId: input.recharge_id ?? input.rechargeId,
    }, options));
  }

  async cancelCard(input = {}, options = {}) {
    return contentFromResponse(await this.request("DELETE", "/bank_card/cancel", {
      cardId: input.card_id ?? input.cardId ?? "",
      cardNum: input.card_num ?? input.cardNum ?? "",
    }, options));
  }

  async suspendCard(input = {}, options = {}) {
    return contentFromResponse(await this.request("PUT", "/bank_card/suspend", {
      cardId: input.card_id ?? input.cardId ?? "",
      cardNum: input.card_num ?? input.cardNum ?? "",
    }, options));
  }

  async enableCard(input = {}, options = {}) {
    return contentFromResponse(await this.request("PUT", "/bank_card/enable", {
      cardId: input.card_id ?? input.cardId ?? "",
      cardNum: input.card_num ?? input.cardNum ?? "",
    }, options));
  }

  async cashOutCard(input = {}, options = {}) {
    return contentFromResponse(await this.request("POST", "/bank_card/card_cash_out", {
      bankCardId: input.bank_card_id ?? input.bankCardId ?? "",
      bankCardNum: input.bank_card_num ?? input.bankCardNum ?? "",
      amount: input.amount,
    }, options));
  }

  async getCashOutDetail(input = {}, options = {}) {
    return contentFromResponse(await this.request("GET", "/bank_card/card_cash_out_detail", {
      id: input.id ?? input.cash_out_id ?? input.cashOutId,
    }, options));
  }

  async listConsumeOrders(input = {}, options = {}) {
    return contentFromResponse(await this.request("GET", "/bank_card/consume_order", {
      number: input.number ?? input.card_number ?? input.cardNumber ?? "",
      page: input.page ?? 1,
      pageSize: input.page_size ?? input.pageSize ?? 100,
    }, options));
  }
}

export function createVccCardProvider(config = {}, options = {}) {
  return new VccCardProvider(config, options);
}

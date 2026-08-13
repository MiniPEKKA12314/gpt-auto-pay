import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from "node:crypto";

import { maskCardNumber } from "./crypto.mjs";

const DEFAULT_BASE_URL = "https://docs.kimoox.com";
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

function normalizeBaseUrl(value) {
  const baseUrl = String(value ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Kimoox base_url must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Kimoox base_url must start with http:// or https://");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeKimooxConfig(input = {}) {
  return {
    provider: "kimoox",
    base_url: normalizeBaseUrl(input.base_url ?? input.baseUrl),
    api_key: requiredText(input.api_key ?? input.apiKey, "Kimoox api_key"),
    api_secret: requiredText(input.api_secret ?? input.apiSecret, "Kimoox api_secret"),
    webhook_secret: String(input.webhook_secret ?? input.webhookSecret ?? "").trim(),
    timeout_ms: toInteger(input.timeout_ms ?? input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000, "Kimoox timeout_ms"),
  };
}

export function sanitizeKimooxConfig(config = {}) {
  return {
    provider: "kimoox",
    base_url: String(config.base_url ?? config.baseUrl ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL,
    api_key: String(config.api_key ?? config.apiKey ?? "").trim(),
    api_secret_configured: Boolean(config.api_secret ?? config.apiSecret ?? config.api_secret_configured),
    webhook_secret_configured: Boolean(config.webhook_secret ?? config.webhookSecret ?? config.webhook_secret_configured),
    timeout_ms: toInteger(config.timeout_ms ?? config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000, "Kimoox timeout_ms"),
  };
}

function hex(buffer) {
  return Buffer.from(buffer).toString("hex");
}

function sha256Hex(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function kimooxSign({ method = "POST", path = "/", timestamp = "", nonce = "", body = "", apiSecret = "" } = {}) {
  const bodyHash = sha256Hex(body || "");
  const signatureBase = [String(method).toUpperCase(), path, String(timestamp), String(nonce), bodyHash].join("\n");
  const signature = createHmac("sha256", String(apiSecret ?? "")).update(signatureBase).digest("hex");
  return { bodyHash, signatureBase, signature };
}

function base64urlToBuffer(value) {
  const text = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function bufferToBase64url(value) {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sensitiveKey(webhookSecret) {
  return createHmac("sha256", String(webhookSecret ?? "")).update("vcc-webhook-sensitive-v1").digest();
}

export function decryptKimooxSensitiveField(ciphertext, webhookSecret) {
  const text = String(ciphertext ?? "").trim();
  if (!text) return "";
  const payload = base64urlToBuffer(text);
  if (payload.length < 12 + 16 + 1) throw new Error("Kimoox sensitive ciphertext is too short");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const encrypted = payload.subarray(12, payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", sensitiveKey(webhookSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function encryptKimooxSensitiveField(value, webhookSecret, iv = randomBytes(12)) {
  const cipher = createCipheriv("aes-256-gcm", sensitiveKey(webhookSecret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value ?? ""), "utf8"), cipher.final()]);
  return bufferToBase64url(Buffer.concat([iv, encrypted, cipher.getAuthTag()]));
}

function normalizeExpiry(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})\s*[/\-]\s*(\d{2,4})$/);
  if (!match) return { exp_month: "", exp_year: "" };
  const month = match[1].padStart(2, "0");
  const yearRaw = match[2];
  const year = yearRaw.length === 2 ? String(2000 + Number(yearRaw)) : String(Number(yearRaw));
  return { exp_month: month, exp_year: year };
}

export function normalizeKimooxCard(row = {}, privateInfo = {}, webhookSecret = "") {
  const providerCardId = String(row.cardId ?? row.provider_card_id ?? row.providerCardId ?? privateInfo.cardId ?? "").trim();
  let number = String(row.number ?? row.cardNumber ?? "").replace(/\s+/g, "");
  let expiryDate = String(row.expiryDate ?? row.expiry_date ?? row.expiry ?? "").trim();
  let cvc = String(row.cvv ?? row.cvc ?? "").trim();
  if (privateInfo.cardNumberCiphertext) number = decryptKimooxSensitiveField(privateInfo.cardNumberCiphertext, webhookSecret).replace(/\s+/g, "");
  if (privateInfo.expiryDateCiphertext) expiryDate = decryptKimooxSensitiveField(privateInfo.expiryDateCiphertext, webhookSecret);
  if (privateInfo.cvvCiphertext) cvc = decryptKimooxSensitiveField(privateInfo.cvvCiphertext, webhookSecret);
  const expiry = normalizeExpiry(expiryDate);
  return {
    provider: "kimoox",
    provider_card_id: providerCardId,
    providerCardId: providerCardId,
    number,
    exp_month: expiry.exp_month,
    exp_year: expiry.exp_year,
    cvc,
    organization: String(row.cardOrg ?? row.organization ?? ""),
    state: String(row.cardStatus ?? row.status ?? row.state ?? ""),
    remark: String(row.remark ?? ""),
    card_balance: String(row.balance ?? row.cardBalance ?? row.card_balance ?? ""),
    create_time: String(row.createTime ?? row.create_time ?? ""),
    modify_time: String(row.updateTime ?? row.modifyTime ?? row.modify_time ?? ""),
    masked_number: String(row.cardNoMask ?? row.masked_number ?? row.maskedNumber ?? maskCardNumber(number)),
    raw: row,
  };
}

function payloadData(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const code = Number(payload.code ?? 200);
  if (code !== 200 && code !== 0) {
    throw new Error(`Kimoox API 返回错误 ${payload.code}: ${payload.msg || payload.message || "unknown error"}`);
  }
  return payload.data !== undefined ? payload.data : payload;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error(`Kimoox API 返回不是 JSON: ${text.slice(0, 300)}`);
  }
}

function requestNo(prefix = "KM") {
  return `${prefix}${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
}

export class KimooxCardProvider {
  constructor(config = {}, options = {}) {
    this.config = normalizeKimooxConfig(config);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw new Error("fetch is not available");
  }

  async request(path, body = {}, options = {}) {
    const method = "POST";
    const raw = JSON.stringify(body ?? {});
    const timestamp = String(options.timestamp ?? Date.now());
    const nonce = String(options.nonce ?? randomBytes(8).toString("hex"));
    const signed = kimooxSign({ method, path, timestamp, nonce, body: raw, apiSecret: this.config.api_secret });
    const headers = {
      "accept": "application/json",
      "content-type": "application/json",
      "x-vcc-api-key": this.config.api_key,
      "x-vcc-timestamp": timestamp,
      "x-vcc-nonce": nonce,
      "x-vcc-signature": signed.signature,
      "x-vcc-request-id": options.requestId ?? `gpt_${timestamp}`,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout_ms);
    try {
      const response = await this.fetchImpl(new URL(path, `${this.config.base_url}/`).toString(), {
        method,
        headers,
        body: raw,
        signal: controller.signal,
      });
      const json = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(`Kimoox API HTTP ${response.status}: ${json?.msg || json?.message || JSON.stringify(json).slice(0, 300)}`);
      }
      return json;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`Kimoox API 请求超时（${this.config.timeout_ms}ms）`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getUserInfo(options = {}) {
    return payloadData(await this.request("/openapi/v1/account/balance/query", {}, options));
  }

  async listBins(options = {}) {
    const data = payloadData(await this.request("/openapi/v1/card-bins/query", {}, options));
    return Array.isArray(data?.list) ? data.list : [];
  }

  async listCards(input = {}, options = {}) {
    const data = payloadData(await this.request("/openapi/v1/cards/query", {
      pageNum: input.page_num ?? input.pageNum ?? input.page_number ?? input.pageNumber ?? 1,
      pageSize: input.page_size ?? input.pageSize ?? 100,
      cardId: input.card_id ?? input.cardId ?? input.userBankId ?? "",
      cardType: input.card_type ?? input.cardType ?? "",
      cardStatus: input.card_status ?? input.cardStatus ?? "",
      cardNo: input.card_no ?? input.cardNo ?? input.userBankNum ?? "",
      last4: input.last4 ?? "",
      batchNo: input.batch_no ?? input.batchNo ?? "",
      remark: input.remark ?? "",
      beginTime: input.begin_time ?? input.beginTime ?? "",
      endTime: input.end_time ?? input.endTime ?? "",
    }, options));
    const rows = Array.isArray(data?.list) ? data.list : [];
    return rows.map((row) => normalizeKimooxCard(row));
  }

  async getPrivateInfo(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/cards/private-info/query", {
      cardId: input.card_id ?? input.cardId,
    }, options));
  }

  async listCardsWithPrivateInfo(input = {}, options = {}) {
    if (!this.config.webhook_secret) throw new Error("Kimoox Webhook Secret 未配置，无法解密卡号/有效期/CVV");
    const cards = await this.listCards(input, options);
    const result = [];
    for (const card of cards) {
      const privateInfo = await this.getPrivateInfo({ cardId: card.provider_card_id }, options);
      result.push(normalizeKimooxCard(card.raw ?? card, privateInfo, this.config.webhook_secret));
    }
    return result;
  }

  async openCard(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/cards/apply", {
      requestNo: input.request_no ?? input.requestNo ?? requestNo("KA"),
      cardType: input.card_type ?? input.cardType ?? "PREPAID",
      cardBinId: input.card_bin_id ?? input.cardBinId ?? input.cardBin,
      holderId: input.holder_id ?? input.holderId ?? "",
      cardCount: input.card_count ?? input.cardCount ?? 1,
      rechargeAmount: input.recharge_amount ?? input.rechargeAmount ?? input.amount,
      cardGroupId: input.card_group_id ?? input.cardGroupId ?? "",
      budgetId: input.budget_id ?? input.budgetId ?? "",
      remark: input.remark ?? "",
    }, options));
  }

  async getOpenCardDetail(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/cards/apply-status/query", {
      taskId: input.task_id ?? input.taskId ?? "",
      batchNo: input.batch_no ?? input.batchNo ?? "",
      requestNo: input.request_no ?? input.requestNo ?? "",
    }, options));
  }

  async rechargeCard(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/cards/funds/operate", {
      requestNo: input.request_no ?? input.requestNo ?? requestNo("CF"),
      operationType: "RECHARGE",
      cardId: input.card_id ?? input.cardId ?? input.bankCardId,
      amount: input.amount,
    }, options));
  }

  async getRechargeDetail(input = {}, options = {}) {
    const requestNoValue = input.request_no ?? input.requestNo ?? input.recharge_id ?? input.rechargeId ?? "";
    if (requestNoValue) {
      return payloadData(await this.request("/openapi/v1/account/transactions/query", {
        pageNum: 1,
        pageSize: 20,
        bizType: "CARD_RECHARGE_DEBIT",
        beginTime: input.begin_time ?? input.beginTime ?? "",
        endTime: input.end_time ?? input.endTime ?? "",
      }, options));
    }
    return { status: "SUCCESS", requestNo: requestNoValue };
  }

  async suspendCard(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/cards/status/operate", {
      requestNo: input.request_no ?? input.requestNo ?? requestNo("CS"),
      operationType: "FREEZE",
      cardId: input.card_id ?? input.cardId,
    }, options));
  }

  async enableCard(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/cards/status/operate", {
      requestNo: input.request_no ?? input.requestNo ?? requestNo("CS"),
      operationType: "UNFREEZE",
      cardId: input.card_id ?? input.cardId,
    }, options));
  }

  async cancelCard(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/cards/status/operate", {
      requestNo: input.request_no ?? input.requestNo ?? requestNo("CS"),
      operationType: "CANCEL",
      cardId: input.card_id ?? input.cardId,
    }, options));
  }

  async cashOutCard(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/cards/funds/operate", {
      requestNo: input.request_no ?? input.requestNo ?? requestNo("CF"),
      operationType: "WITHDRAW",
      cardId: input.card_id ?? input.cardId ?? input.bankCardId,
      amount: input.amount,
    }, options));
  }

  async listConsumeOrders(input = {}, options = {}) {
    return payloadData(await this.request("/openapi/v1/card-transactions/query", {
      pageNum: input.page_num ?? input.pageNum ?? input.page ?? 1,
      pageSize: input.page_size ?? input.pageSize ?? 100,
      cardNo: input.card_no ?? input.cardNo ?? input.number ?? "",
      last4: input.last4 ?? "",
      transactionType: input.transaction_type ?? input.transactionType ?? "",
      transactionStatus: input.transaction_status ?? input.transactionStatus ?? "",
      settlementStatus: input.settlement_status ?? input.settlementStatus ?? "",
      beginTime: input.begin_time ?? input.beginTime ?? "",
      endTime: input.end_time ?? input.endTime ?? "",
    }, options));
  }
}

export function createKimooxCardProvider(config = {}, options = {}) {
  return new KimooxCardProvider(config, options);
}

import { randomBytes } from "node:crypto";
import { normalizePlanType, RedeemStatus, nowSeconds } from "./constants.mjs";
import { hashValue } from "./crypto.mjs";

const PLAN_PREFIX = Object.freeze({
  go: "GO",
  plus: "PLUS",
  pro5x: "PRO5X",
  pro20x: "PRO20X",
});

function chunks(value, size) {
  const out = [];
  for (let i = 0; i < value.length; i += size) out.push(value.slice(i, i + size));
  return out;
}

export function normalizeRedeemCode(code) {
  return String(code ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function generateRedeemCode({ planType, entropy } = {}) {
  const plan = normalizePlanType(planType);
  const raw = Buffer.isBuffer(entropy) ? entropy : randomBytes(9);
  const token = chunks(raw.toString("hex").toUpperCase(), 4).join("-");
  return `${PLAN_PREFIX[plan]}-${token}`;
}

export function hashRedeemCode(code, pepper = "") {
  return hashValue(normalizeRedeemCode(code), pepper);
}

function assertStatus(record, expected, action) {
  if (record?.status !== expected) {
    throw new Error(`${action} requires status=${expected}`);
  }
}

export function lockRedeemCode(record, orderId, now = nowSeconds()) {
  assertStatus(record, RedeemStatus.UNUSED, "lockRedeemCode");
  if (!orderId) throw new Error("orderId is required");
  return {
    ...record,
    status: RedeemStatus.LOCKED,
    locked_order_id: orderId,
    locked_at: now,
  };
}

export function releaseRedeemCode(record, now = nowSeconds()) {
  if (![RedeemStatus.LOCKED, RedeemStatus.UNAVAILABLE].includes(record?.status)) {
    throw new Error("releaseRedeemCode requires status=locked or unavailable");
  }
  return {
    ...record,
    status: RedeemStatus.UNUSED,
    locked_order_id: 0,
    locked_at: 0,
    unavailable_at: 0,
    unavailable_reason: "",
    released_at: now,
  };
}

export function markRedeemCodeUsed(record, orderId, now = nowSeconds()) {
  if (![RedeemStatus.LOCKED, RedeemStatus.UNAVAILABLE].includes(record?.status)) {
    throw new Error("markRedeemCodeUsed requires status=locked or unavailable");
  }
  if (!orderId) throw new Error("orderId is required");
  return {
    ...record,
    status: RedeemStatus.USED,
    used_order_id: orderId,
    used_at: now,
  };
}

export function markRedeemCodeUnavailable(record, reason = "", now = nowSeconds()) {
  assertStatus(record, RedeemStatus.LOCKED, "markRedeemCodeUnavailable");
  return {
    ...record,
    status: RedeemStatus.UNAVAILABLE,
    unavailable_at: now,
    unavailable_reason: String(reason ?? "").slice(0, 500),
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportRedeemCodes(records, options = {}) {
  const format = String(options.format ?? "txt").toLowerCase();
  const filtered = (records ?? []).filter((record) => {
    if (options.status && record.status !== options.status) return false;
    if (options.planType && record.plan_type !== options.planType) return false;
    if (options.batchId && Number(record.batch_id) !== Number(options.batchId)) return false;
    return true;
  });

  if (format === "txt") {
    return filtered.map((record) => record.code_display).join("\n");
  }

  if (format === "json") {
    return JSON.stringify(filtered, null, 2);
  }

  if (format === "csv") {
    const headers = ["id", "code_display", "plan_type", "status", "batch_id"];
    const lines = [headers.join(",")];
    for (const record of filtered) {
      lines.push(headers.map((key) => csvEscape(record[key])).join(","));
    }
    return lines.join("\n");
  }

  throw new Error(`unsupported export format: ${format}`);
}

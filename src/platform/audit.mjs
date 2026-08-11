import { nowSeconds } from "./constants.mjs";

const SENSITIVE_KEY_PATTERN = /card|cvc|cvv|number|token|secret|password|cookie|authorization/i;

function redactValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return "[redacted]";
}

export function redactAuditPayload(value) {
  if (Array.isArray(value)) return value.map((item) => redactAuditPayload(item));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? redactValue(item) : redactAuditPayload(item);
  }
  return out;
}

export function createAuditLog(input = {}, now = nowSeconds()) {
  if (!input.admin_id && !input.adminId) throw new Error("admin_id is required");
  if (!input.action) throw new Error("action is required");
  if (!input.target_type && !input.targetType) throw new Error("target_type is required");
  return {
    admin_id: Number(input.admin_id ?? input.adminId),
    action: String(input.action),
    target_type: String(input.target_type ?? input.targetType),
    target_id: String(input.target_id ?? input.targetId ?? ""),
    ip: String(input.ip ?? ""),
    user_agent: String(input.user_agent ?? input.userAgent ?? ""),
    before_json: JSON.stringify(redactAuditPayload(input.before ?? {})),
    after_json: JSON.stringify(redactAuditPayload(input.after ?? {})),
    created_at: now,
  };
}

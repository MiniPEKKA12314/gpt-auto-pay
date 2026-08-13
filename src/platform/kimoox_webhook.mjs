import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function headerValue(headers, name) {
  const value = headers?.[String(name).toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value ?? "").trim();
}

function safeEqualHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function kimooxWebhookSignature({ eventId, eventType, timestamp, nonce, rawBody, secret }) {
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const signatureBase = [eventId, eventType, timestamp, nonce, bodyHash].join("\n");
  return createHmac("sha256", String(secret ?? "")).update(signatureBase).digest("hex");
}

export function verifyKimooxWebhook({ headers = {}, rawBody = Buffer.alloc(0), secret = "" } = {}) {
  if (!secret) return { ok: false, code: "WEBHOOK_SECRET_MISSING", message: "Kimoox Webhook Secret 未配置" };
  const eventId = headerValue(headers, "x-vcc-webhook-id");
  const eventType = headerValue(headers, "x-vcc-webhook-event");
  const timestamp = headerValue(headers, "x-vcc-webhook-timestamp");
  const nonce = headerValue(headers, "x-vcc-webhook-nonce");
  const signatureHeader = headerValue(headers, "x-vcc-webhook-signature");
  if (!eventId || !eventType || !timestamp || !nonce || !signatureHeader) {
    return { ok: false, code: "WEBHOOK_HEADERS_MISSING", message: "Kimoox Webhook 签名请求头不完整" };
  }
  const signatureMatch = signatureHeader.match(/^v1=([a-f0-9]{64})$/i);
  if (!signatureMatch) return { ok: false, code: "WEBHOOK_SIGNATURE_FORMAT", message: "Kimoox Webhook 签名格式错误" };
  const expected = kimooxWebhookSignature({ eventId, eventType, timestamp, nonce, rawBody, secret });
  if (!safeEqualHex(signatureMatch[1], expected)) {
    return { ok: false, code: "WEBHOOK_SIGNATURE_INVALID", message: "Kimoox Webhook 签名验证失败" };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    return { ok: false, code: "WEBHOOK_BAD_JSON", message: "Kimoox Webhook JSON 格式错误" };
  }
  if (String(payload.eventId ?? "") !== eventId || String(payload.eventType ?? "") !== eventType) {
    return { ok: false, code: "WEBHOOK_EVENT_MISMATCH", message: "Kimoox Webhook 请求头与正文事件不一致" };
  }
  return { ok: true, eventId, eventType, timestamp, nonce, payload };
}

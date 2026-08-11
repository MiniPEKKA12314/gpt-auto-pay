import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function toBuffer(value, encoding = "utf8") {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), encoding);
}

export function deriveAesKey(secret) {
  const value = String(secret ?? "");
  if (value.length < 16) {
    throw new Error("APP_SECRET_KEY must be at least 16 characters");
  }
  return createHash("sha256").update(value).digest();
}

export function encryptSecret(value, secret, options = {}) {
  const key = deriveAesKey(secret);
  const iv = options.iv ? toBuffer(options.iv) : randomBytes(12);
  if (iv.length !== 12) {
    throw new Error("AES-GCM iv must be 12 bytes");
  }
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value ?? ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptSecret(payload, secret) {
  const parts = String(payload ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("invalid encrypted payload");
  }
  const [, ivB64, tagB64, encryptedB64] = parts;
  const key = deriveAesKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskCardNumber(cardNumber) {
  const digits = String(cardNumber ?? "").replace(/\D+/g, "");
  if (!digits) return "**** **** **** ****";
  const first4 = digits.slice(0, 4).padEnd(4, "*");
  const last4 = digits.slice(-4).padStart(4, "*");
  return `${first4} **** **** ${last4}`;
}

export function hashValue(value, pepper = "") {
  return createHash("sha256")
    .update(String(value ?? "").trim().toUpperCase())
    .update(String(pepper ?? ""))
    .digest("hex");
}

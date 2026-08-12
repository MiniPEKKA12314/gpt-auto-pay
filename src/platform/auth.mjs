import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "scrypt:v1";
const SCRYPT_KEY_LENGTH = 64;

export const ADMIN_SESSION_COOKIE = "gpt_auto_pay_admin";

export function createSessionId() {
  return randomBytes(32).toString("base64url");
}

export function isPasswordHashConfigured(value) {
  return String(value ?? "").startsWith(`${HASH_PREFIX}:`);
}

export function assertStrongPassword(password) {
  const text = String(password ?? "");
  if (text.length < 12) {
    throw new Error("管理员密码至少需要 12 位");
  }
  if (!/[a-z]/.test(text) || !/[A-Z]/.test(text) || !/[0-9]/.test(text) || !/[^A-Za-z0-9]/.test(text)) {
    throw new Error("管理员密码需要同时包含大小写字母、数字和符号");
  }
  return text;
}

export function hashPassword(password) {
  const text = assertStrongPassword(password);
  const salt = randomBytes(16);
  const hash = scryptSync(text, salt, SCRYPT_KEY_LENGTH);
  return `${HASH_PREFIX}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function verifyPassword(password, encodedHash) {
  const text = String(password ?? "");
  const parts = String(encodedHash ?? "").split(":");
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}` !== HASH_PREFIX) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], "base64url");
    expected = Buffer.from(parts[3], "base64url");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = scryptSync(text, salt, SCRYPT_KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

export function parseCookies(req) {
  const header = String(req.headers?.cookie ?? "");
  const cookies = new Map();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

export function buildAdminSessionCookie(sessionId, options = {}) {
  const maxAge = Number(options.maxAgeSeconds ?? 12 * 60 * 60);
  const secure = options.secure ? "Secure" : "";
  const domain = String(options.domain ?? "").trim();
  const domainPart = domain ? `Domain=${domain}` : "";
  return [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    domainPart,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    secure,
  ].filter(Boolean).join("; ");
}

export function clearAdminSessionCookie(options = {}) {
  const domain = String(options.domain ?? "").trim();
  const domainPart = domain ? `; Domain=${domain}` : "";
  return `${ADMIN_SESSION_COOKIE}=; Path=/${domainPart}; HttpOnly; SameSite=Lax; Max-Age=0`;
}

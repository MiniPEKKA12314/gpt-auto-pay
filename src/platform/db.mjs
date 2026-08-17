import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { createSessionId, hashPassword, isPasswordHashConfigured, verifyPassword } from "./auth.mjs";
import { OrderStatus, QueueStatus, RedeemStatus, nowSeconds, normalizePlanType } from "./constants.mjs";
import { decryptSecret, encryptSecret, maskCardNumber } from "./crypto.mjs";
import { DEFAULT_PLAN_NAMES, normalizePlanCardGroups, normalizePlanConfig } from "./plans.mjs";
import { normalizeProxyGroup } from "./proxy_pool.mjs";
import { createQueueSettings } from "./queue.mjs";
import { exportRedeemCodes, hashRedeemCode, generateRedeemCode, normalizeRedeemCode } from "./redeem.mjs";

const schemaUrl = new URL("./schema.sql", import.meta.url);
const DEFAULT_KIMOOX_WEBHOOK_URL = "https://minipekka.ayuekp.store/api/webhooks/kimoox";

export class PlatformStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PlatformStoreError";
    this.code = code;
    this.details = details;
  }
}

export function openPlatformDb(path = ":memory:", options = {}) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (options.applySchema !== false) applyPlatformSchema(db);
  return db;
}

export function applyPlatformSchema(db) {
  db.exec(readFileSync(schemaUrl, "utf8"));
  ensurePlatformMigrations(db);
}

function tableColumnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function ensureColumn(db, table, column, definition) {
  if (tableColumnNames(db, table).has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensurePlatformMigrations(db) {
  ensureColumn(db, "plan_configs", "checkout_max_proxy_attempts", "INTEGER NOT NULL DEFAULT 4");
  ensureColumn(db, "plan_configs", "card_source", "TEXT NOT NULL DEFAULT 'local'");
  ensureColumn(db, "plan_configs", "vcc_target_balance_usd", "TEXT DEFAULT ''");
  ensureColumn(db, "plan_configs", "remote_balance_success_fallback", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "plan_configs", "lock_redeem_code_on_failure", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "plan_configs", "vcc_card_bin", "TEXT DEFAULT ''");
  ensureColumn(db, "plan_configs", "vcc_open_email", "TEXT DEFAULT ''");
  ensureColumn(db, "plan_configs", "remote_max_cards", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "plan_configs", "remote_success_withdraw", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "plan_configs", "remote_success_final_action", "TEXT NOT NULL DEFAULT 'cancel'");
  ensureColumn(db, "plan_configs", "remote_failure_withdraw", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "plan_configs", "remote_failure_final_action", "TEXT NOT NULL DEFAULT 'cancel'");
  ensureColumn(db, "plan_configs", "kimoox_issue_mode", "TEXT NOT NULL DEFAULT 'pool'");
  ensureColumn(db, "plan_configs", "kimoox_card_bin_id", "TEXT DEFAULT ''");
  ensureColumn(db, "plan_configs", "kimoox_card_type", "TEXT DEFAULT 'PREPAID'");
  ensureColumn(db, "plan_configs", "kimoox_holder_id", "TEXT DEFAULT ''");
  ensureColumn(db, "plan_configs", "kimoox_card_group_id", "TEXT DEFAULT ''");
  ensureColumn(db, "plan_configs", "kimoox_budget_id", "TEXT DEFAULT ''");
  ensureColumn(db, "plan_configs", "kimoox_reclaim_balance", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "plan_configs", "kimoox_cancel_after_order", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "orders", "lock_redeem_code_on_failure", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "cards", "provider", "TEXT DEFAULT ''");
  ensureColumn(db, "cards", "provider_card_id", "TEXT DEFAULT ''");
  ensureColumn(db, "cards", "auto_unfreeze_before_use", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "cards", "auto_freeze_after_success", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "cards", "auto_freeze_after_failure", "INTEGER NOT NULL DEFAULT 0");
}

function ensureDefaultAdmin(db, now = nowSeconds()) {
  db.prepare(`
    INSERT OR IGNORE INTO admin_users(
      id, username, password_hash, created_at, updated_at
    ) VALUES (1, 'admin', 'dev-admin-password-not-configured', ?, ?)
  `).run(now, now);
}

function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

function requiredText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function normalizeWebhookUrl(value, fallback = DEFAULT_KIMOOX_WEBHOOK_URL) {
  const text = String(value ?? fallback).trim() || fallback;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new PlatformStoreError("KIMOOX_WEBHOOK_URL_INVALID", "Kimoox Webhook 回调地址格式不正确");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === "/") {
    throw new PlatformStoreError("KIMOOX_WEBHOOK_URL_INVALID", "Kimoox Webhook 回调地址必须使用 http/https，并包含回调路径");
  }
  parsed.hash = "";
  return parsed.toString();
}

function boolInt(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on", "enabled"].includes(normalized) ? 1 : 0;
  }
  return value ? 1 : 0;
}

function runTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw error;
  }
}

function getRequired(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  if (!row) throw new PlatformStoreError("NOT_FOUND", "record not found");
  return row;
}

const GROUP_NAME_TABLES = Object.freeze({
  card_groups: "卡组",
  billing_groups: "账单组",
  proxy_groups: "代理组",
});

function moveDeletedGroupNameAside(db, table, name, now = nowSeconds()) {
  const label = GROUP_NAME_TABLES[table];
  if (!label) throw new Error(`unsupported group table: ${table}`);
  const active = db.prepare(`SELECT id FROM ${table} WHERE name = ? AND deleted_at = 0`).get(name);
  if (active) {
    throw new PlatformStoreError("GROUP_NAME_EXISTS", `${label}名称已存在，请换一个名称`, {
      table,
      name,
      id: active.id,
    });
  }
  const deletedRows = db.prepare(`SELECT id FROM ${table} WHERE name = ? AND deleted_at <> 0 ORDER BY id ASC`).all(name);
  for (const row of deletedRows) {
    let suffix = 0;
    let nextName = `${name} (已删除 #${row.id})`;
    while (db.prepare(`SELECT id FROM ${table} WHERE name = ? AND id <> ?`).get(nextName, row.id)) {
      suffix += 1;
      nextName = `${name} (已删除 #${row.id}-${suffix})`;
    }
    db.prepare(`UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ?`).run(nextName, now, row.id);
  }
}

function withParsedConfig(row) {
  if (!row) return row;
  try {
    return {
      ...row,
      config: JSON.parse(row.config_json || "{}"),
    };
  } catch {
    return {
      ...row,
      config: {},
    };
  }
}

function normalizeProviderName(value, supported) {
  const provider = String(value ?? "").trim().toLowerCase();
  if (!supported.includes(provider)) throw new Error(`unsupported provider: ${String(value ?? "")}`);
  return provider;
}

const REMOTE_CARD_PROVIDERS = ["vcc", "kimoox"];
const CARD_PROVIDERS = ["", ...REMOTE_CARD_PROVIDERS];

function cardProviderSettingKey(provider) {
  return `card_provider.${normalizeProviderName(provider, REMOTE_CARD_PROVIDERS)}`;
}

function toInteger(value, fallback, min, max, field) {
  const n = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function defaultCardProviderConfig(provider) {
  const name = normalizeProviderName(provider, REMOTE_CARD_PROVIDERS);
  if (name === "vcc") {
    return {
      provider: "vcc",
      base_url: "http://api.vcc.center",
      user_serial: "",
      secret_key_encrypted: "",
      timeout_ms: 15_000,
    };
  }
  if (name === "kimoox") {
    return {
      provider: "kimoox",
      base_url: "https://card.kimoox.com",
      api_key: "",
      api_secret_encrypted: "",
      webhook_secret_encrypted: "",
      timeout_ms: 15_000,
    };
  }
  return {};
}

function escapeSqlLike(value) {
  return String(value ?? "").replace(/[\\%_]/g, (char) => `\\${char}`);
}

function idList(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  return raw
    .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0);
}

function orderSuffix(now = nowSeconds()) {
  return `${Math.floor(now * 1000)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class PlatformStore {
  constructor(db, options = {}) {
    this.db = db;
    this.codePepper = String(options.codePepper ?? "");
    this.secretKey = String(options.secretKey ?? process.env.APP_SECRET_KEY ?? "local-development-secret");
    if (options.ensureDefaultAdmin !== false) ensureDefaultAdmin(this.db);
    const adminPassword = options.adminPassword ?? process.env.PLATFORM_ADMIN_PASSWORD ?? "";
    if (adminPassword) {
      const admin = this.getAdminByUsername("admin");
      if (!admin || !isPasswordHashConfigured(admin.password_hash) || options.resetAdminPassword) {
        this.setAdminPassword(1, adminPassword);
      }
    }
    if (options.ensureDefaultPlans !== false) this.ensureDefaultPlanConfigs();
  }

  close() {
    this.db.close();
  }

  getAdminByUsername(username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return null;
    return this.db.prepare("SELECT * FROM admin_users WHERE username = ?").get(normalized) ?? null;
  }

  getAdminById(adminId) {
    return this.db.prepare("SELECT * FROM admin_users WHERE id = ?").get(Number(adminId)) ?? null;
  }

  isAdminPasswordConfigured(adminId = 1) {
    const admin = this.getAdminById(adminId);
    return Boolean(admin && isPasswordHashConfigured(admin.password_hash));
  }

  setAdminPassword(adminId, password, now = nowSeconds()) {
    const encoded = hashPassword(password);
    const result = this.db.prepare(`
      UPDATE admin_users
         SET password_hash = ?, updated_at = ?
       WHERE id = ? AND disabled_at = 0
    `).run(encoded, now, Number(adminId));
    if (result.changes === 0) throw new PlatformStoreError("ADMIN_NOT_FOUND", "admin not found");
    return this.getAdminById(adminId);
  }

  verifyAdminLogin(username, password, now = nowSeconds()) {
    const admin = this.getAdminByUsername(username);
    if (!admin || admin.disabled_at) return null;
    if (!isPasswordHashConfigured(admin.password_hash)) {
      throw new PlatformStoreError("ADMIN_PASSWORD_NOT_CONFIGURED", "admin password is not configured");
    }
    if (!verifyPassword(password, admin.password_hash)) return null;
    this.db.prepare("UPDATE admin_users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now, now, admin.id);
    return this.getAdminById(admin.id);
  }

  createAdminSession(adminId, input = {}, now = nowSeconds()) {
    const admin = this.getAdminById(adminId);
    if (!admin || admin.disabled_at) throw new PlatformStoreError("ADMIN_NOT_FOUND", "admin not found");
    const ttlSeconds = Number(input.ttlSeconds ?? input.ttl_seconds ?? 12 * 60 * 60);
    const sessionId = createSessionId();
    this.db.prepare(`
      INSERT INTO admin_sessions(id, admin_id, created_at, expires_at, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      admin.id,
      now,
      now + Math.max(60, ttlSeconds),
      String(input.ip ?? ""),
      String(input.user_agent ?? input.userAgent ?? ""),
    );
    return {
      id: sessionId,
      admin_id: admin.id,
      expires_at: now + Math.max(60, ttlSeconds),
    };
  }

  getAdminSession(sessionId, now = nowSeconds()) {
    const id = String(sessionId ?? "").trim();
    if (!id) return null;
    const row = this.db.prepare(`
      SELECT s.*, u.username, u.disabled_at
      FROM admin_sessions s
      JOIN admin_users u ON u.id = s.admin_id
      WHERE s.id = ?
    `).get(id);
    if (!row) return null;
    if (row.disabled_at || row.expires_at <= now) {
      this.deleteAdminSession(id);
      return null;
    }
    return row;
  }

  deleteAdminSession(sessionId) {
    this.db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(String(sessionId ?? ""));
  }

  cleanupAdminSessions(now = nowSeconds()) {
    return this.db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now).changes;
  }

  createRedeemBatch(input = {}, now = nowSeconds()) {
    const planType = normalizePlanType(input.plan_type ?? input.planType);
    const quantity = Number(input.quantity ?? 0);
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("quantity must be a positive integer");
    const result = this.db.prepare(`
      INSERT INTO redeem_batches(
        name, plan_type, quantity, note, channel_enabled, channel,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requiredText(input.name, "name"),
      planType,
      quantity,
      String(input.note ?? ""),
      boolInt(input.channel_enabled ?? input.channelEnabled),
      String(input.channel ?? ""),
      Number(input.created_by ?? input.createdBy ?? 1),
      now,
    );
    return Number(result.lastInsertRowid);
  }

  ensureDefaultPlanConfigs(now = nowSeconds()) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO plan_configs(
        plan_type, display_name, enabled, payment_country, payment_currency,
        checkout_template_key, card_source, checkout_proxy_group_id, direct_card_proxy_group_id,
        billing_group_id, failure_message, checkout_max_proxy_attempts, max_proxy_attempts_per_card,
        vcc_target_balance_usd, remote_balance_success_fallback, lock_redeem_code_on_failure, vcc_card_bin, vcc_open_email, remote_max_cards,
        remote_success_withdraw, remote_success_final_action, remote_failure_withdraw, remote_failure_final_action,
        kimoox_issue_mode, kimoox_card_bin_id, kimoox_card_type,
        kimoox_holder_id, kimoox_card_group_id, kimoox_budget_id, kimoox_reclaim_balance,
        kimoox_cancel_after_order, allow_card_switch, max_card_switches, created_at, updated_at
      ) VALUES (?, ?, ?, '', '', '', 'local', 0, 0, 0, '', 4, 4, '', 0, 0, '', '', 1, 1, 'cancel', 1, 'cancel', 'pool', '', 'PREPAID', '', '', '', 1, 1, 0, 0, ?, ?)
    `);
    for (const [planType, displayName] of Object.entries(DEFAULT_PLAN_NAMES)) {
      insert.run(planType, displayName, 1, now, now);
    }
  }

  upsertPlanConfig(input = {}, now = nowSeconds()) {
    const config = normalizePlanConfig(input);
    this.db.prepare(`
      INSERT INTO plan_configs(
        plan_type, display_name, enabled, payment_country, payment_currency,
        checkout_template_key, card_source, checkout_proxy_group_id, direct_card_proxy_group_id,
        billing_group_id, failure_message, checkout_max_proxy_attempts, max_proxy_attempts_per_card,
        vcc_target_balance_usd, remote_balance_success_fallback, lock_redeem_code_on_failure, vcc_card_bin, vcc_open_email, remote_max_cards,
        remote_success_withdraw, remote_success_final_action, remote_failure_withdraw, remote_failure_final_action,
        kimoox_issue_mode, kimoox_card_bin_id, kimoox_card_type,
        kimoox_holder_id, kimoox_card_group_id, kimoox_budget_id, kimoox_reclaim_balance,
        kimoox_cancel_after_order, allow_card_switch, max_card_switches, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plan_type) DO UPDATE SET
        display_name = excluded.display_name,
        enabled = excluded.enabled,
        payment_country = excluded.payment_country,
        payment_currency = excluded.payment_currency,
        checkout_template_key = excluded.checkout_template_key,
        card_source = excluded.card_source,
        checkout_proxy_group_id = excluded.checkout_proxy_group_id,
        direct_card_proxy_group_id = excluded.direct_card_proxy_group_id,
        billing_group_id = excluded.billing_group_id,
        failure_message = excluded.failure_message,
        checkout_max_proxy_attempts = excluded.checkout_max_proxy_attempts,
        max_proxy_attempts_per_card = excluded.max_proxy_attempts_per_card,
        vcc_target_balance_usd = excluded.vcc_target_balance_usd,
        remote_balance_success_fallback = excluded.remote_balance_success_fallback,
        lock_redeem_code_on_failure = excluded.lock_redeem_code_on_failure,
        vcc_card_bin = excluded.vcc_card_bin,
        vcc_open_email = excluded.vcc_open_email,
        remote_max_cards = excluded.remote_max_cards,
        remote_success_withdraw = excluded.remote_success_withdraw,
        remote_success_final_action = excluded.remote_success_final_action,
        remote_failure_withdraw = excluded.remote_failure_withdraw,
        remote_failure_final_action = excluded.remote_failure_final_action,
        kimoox_issue_mode = excluded.kimoox_issue_mode,
        kimoox_card_bin_id = excluded.kimoox_card_bin_id,
        kimoox_card_type = excluded.kimoox_card_type,
        kimoox_holder_id = excluded.kimoox_holder_id,
        kimoox_card_group_id = excluded.kimoox_card_group_id,
        kimoox_budget_id = excluded.kimoox_budget_id,
        kimoox_reclaim_balance = excluded.kimoox_reclaim_balance,
        kimoox_cancel_after_order = excluded.kimoox_cancel_after_order,
        allow_card_switch = excluded.allow_card_switch,
        max_card_switches = excluded.max_card_switches,
        updated_at = excluded.updated_at
    `).run(
      config.plan_type,
      config.display_name,
      boolInt(config.enabled),
      config.payment_country,
      config.payment_currency,
      config.checkout_template_key,
      config.card_source,
      config.checkout_proxy_group_id,
      config.direct_card_proxy_group_id,
      config.billing_group_id,
      config.failure_message,
      config.checkout_max_proxy_attempts,
      config.max_proxy_attempts_per_card,
      config.vcc_target_balance_usd,
      boolInt(config.remote_balance_success_fallback),
      boolInt(config.lock_redeem_code_on_failure),
      config.vcc_card_bin,
      config.vcc_open_email,
      config.remote_max_cards,
      boolInt(config.remote_success_withdraw),
      config.remote_success_final_action,
      boolInt(config.remote_failure_withdraw),
      config.remote_failure_final_action,
      config.kimoox_issue_mode,
      config.kimoox_card_bin_id,
      config.kimoox_card_type,
      config.kimoox_holder_id,
      config.kimoox_card_group_id,
      config.kimoox_budget_id,
      boolInt(config.kimoox_reclaim_balance),
      boolInt(config.kimoox_cancel_after_order),
      boolInt(config.allow_card_switch),
      config.max_card_switches,
      now,
      now,
    );
    return this.getPlanConfig(config.plan_type, { includeCardGroups: true });
  }

  setPlanCardGroups(planType, groups = [], now = nowSeconds()) {
    const normalizedPlan = normalizePlanType(planType);
    const normalizedGroups = normalizePlanCardGroups(groups);
    return runTransaction(this.db, () => {
      this.db.prepare("DELETE FROM plan_card_groups WHERE plan_type = ?").run(normalizedPlan);
      const insert = this.db.prepare(`
        INSERT INTO plan_card_groups(plan_type, card_group_id, priority, created_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const group of normalizedGroups) {
        insert.run(normalizedPlan, group.card_group_id, group.priority, now);
      }
      return this.getPlanConfig(normalizedPlan, { includeCardGroups: true });
    });
  }

  getPlanConfig(planType, options = {}) {
    const normalizedPlan = normalizePlanType(planType);
    const row = this.db.prepare("SELECT * FROM plan_configs WHERE plan_type = ?").get(normalizedPlan);
    if (!row) throw new PlatformStoreError("PLAN_NOT_FOUND", "plan config not found", { plan_type: normalizedPlan });
    if (!options.includeCardGroups) return row;
    return {
      ...row,
      card_groups: this.db.prepare(`
        SELECT pcg.card_group_id, pcg.priority, cg.name
        FROM plan_card_groups pcg
        LEFT JOIN card_groups cg ON cg.id = pcg.card_group_id
        WHERE pcg.plan_type = ?
        ORDER BY pcg.priority ASC, pcg.card_group_id ASC
      `).all(normalizedPlan),
    };
  }

  listPlanConfigs(options = {}) {
    const rows = this.db.prepare("SELECT * FROM plan_configs ORDER BY plan_type ASC").all();
    if (!options.includeCardGroups) return rows;
    return rows.map((row) => this.getPlanConfig(row.plan_type, { includeCardGroups: true }));
  }

  createCardGroup(input = {}, now = nowSeconds()) {
    const name = requiredText(input.name, "name");
    const note = String(input.note ?? "");
    return runTransaction(this.db, () => {
      moveDeletedGroupNameAside(this.db, "card_groups", name, now);
      const result = this.db.prepare(`
        INSERT INTO card_groups(name, note, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(name, note, now, now);
      return Number(result.lastInsertRowid);
    });
  }

  listCardGroups() {
    const rows = this.db.prepare(`
      SELECT *
      FROM card_groups
      WHERE deleted_at = 0
      ORDER BY id ASC
    `).all();
    const countStmt = this.db.prepare(`
      SELECT status, COUNT(*) AS n
      FROM cards
      WHERE card_group_id = ? AND deleted_at = 0
      GROUP BY status
    `);
    return rows.map((row) => {
      const counts = Object.fromEntries(countStmt.all(row.id).map((item) => [item.status, item.n]));
      return {
        ...row,
        stats: {
          enabled: counts.enabled ?? 0,
          standby: counts.standby ?? 0,
          disabled: counts.disabled ?? 0,
          total: Object.values(counts).reduce((sum, n) => sum + Number(n), 0),
        },
      };
    });
  }

  updateCardGroup(groupId, input = {}, now = nowSeconds()) {
    const current = getRequired(this.db, "SELECT * FROM card_groups WHERE id = ?", Number(groupId));
    const nextName = input.name ? requiredText(input.name, "name") : current.name;
    const nextNote = input.note !== undefined ? String(input.note ?? "") : current.note;
    this.db.prepare(`
      UPDATE card_groups
         SET name = ?, note = ?, updated_at = ?
       WHERE id = ?
    `).run(nextName, nextNote, now, Number(groupId));
    return this.getCardGroupById(groupId);
  }

  getCardGroupById(groupId) {
    return getRequired(this.db, "SELECT * FROM card_groups WHERE id = ?", Number(groupId));
  }

  softDeleteCardGroup(groupId, adminId = 1, reason = "", now = nowSeconds()) {
    const id = Number(groupId);
    const by = Number(adminId);
    const deleteReason = String(reason ?? "").slice(0, 500);
    runTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE card_groups
           SET deleted_at = ?, deleted_by = ?, delete_reason = ?
         WHERE id = ? AND deleted_at = 0
      `).run(now, by, deleteReason, id);
      this.db.prepare(`
        UPDATE cards
           SET deleted_at = ?, deleted_by = ?, delete_reason = ?
         WHERE card_group_id = ? AND deleted_at = 0
      `).run(now, by, deleteReason, id);
    });
    return this.getCardGroupById(groupId);
  }

  restoreCardGroup(groupId) {
    this.db.prepare(`
      UPDATE card_groups
         SET deleted_at = 0, deleted_by = 0, delete_reason = ''
       WHERE id = ?
    `).run(Number(groupId));
    return this.getCardGroupById(groupId);
  }

  createCard(input = {}, now = nowSeconds()) {
    const cardGroupId = Number(input.card_group_id ?? input.cardGroupId);
    if (!cardGroupId) throw new Error("card_group_id is required");
    const number = requiredText(input.number, "number").replace(/\s+/g, "");
    const expMonth = requiredText(input.exp_month ?? input.expMonth, "exp_month");
    const expYear = requiredText(input.exp_year ?? input.expYear, "exp_year");
    const cvc = requiredText(input.cvc, "cvc");
    const result = this.db.prepare(`
      INSERT INTO cards(
        card_group_id, encrypted_number, encrypted_exp_month, encrypted_exp_year,
        encrypted_cvc, masked_number, priority, max_success_count, success_count,
        provider, provider_card_id, auto_unfreeze_before_use, auto_freeze_after_success,
        auto_freeze_after_failure, status, note, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cardGroupId,
      encryptSecret(number, this.secretKey),
      encryptSecret(expMonth, this.secretKey),
      encryptSecret(expYear, this.secretKey),
      encryptSecret(cvc, this.secretKey),
      maskCardNumber(number),
      Number(input.priority ?? 100),
      Number(input.max_success_count ?? input.maxSuccessCount ?? 1),
      Number(input.success_count ?? input.successCount ?? 0),
      normalizeProviderName(input.provider ?? "", CARD_PROVIDERS),
      String(input.provider_card_id ?? input.providerCardId ?? input.remote_card_id ?? input.remoteCardId ?? "").trim(),
      boolInt(input.auto_unfreeze_before_use ?? input.autoUnfreezeBeforeUse),
      boolInt(input.auto_freeze_after_success ?? input.autoFreezeAfterSuccess),
      boolInt(input.auto_freeze_after_failure ?? input.autoFreezeAfterFailure),
      String(input.status ?? "enabled"),
      String(input.note ?? ""),
      Number(input.last_used_at ?? input.lastUsedAt ?? 0),
      now,
      now,
    );
    return Number(result.lastInsertRowid);
  }

  getCardById(cardId, options = {}) {
    const row = getRequired(this.db, "SELECT * FROM cards WHERE id = ?", Number(cardId));
    if (!options.includeSecret) return row;
    return {
      ...row,
      number: decryptSecret(row.encrypted_number, this.secretKey),
      exp_month: decryptSecret(row.encrypted_exp_month, this.secretKey),
      exp_year: decryptSecret(row.encrypted_exp_year, this.secretKey),
      cvc: decryptSecret(row.encrypted_cvc, this.secretKey),
    };
  }

  listCards(filter = {}, options = {}) {
    const where = ["deleted_at = 0"];
    const params = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(String(filter.status));
    }
    if (filter.card_group_id || filter.cardGroupId) {
      where.push("card_group_id = ?");
      params.push(Number(filter.card_group_id ?? filter.cardGroupId));
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM cards
      WHERE ${where.join(" AND ")}
      ORDER BY priority ASC, last_used_at ASC, id ASC
    `).all(...params);
    if (!options.includeSecret) return rows;
    return rows.map((row) => ({
      ...row,
      number: decryptSecret(row.encrypted_number, this.secretKey),
      exp_month: decryptSecret(row.encrypted_exp_month, this.secretKey),
      exp_year: decryptSecret(row.encrypted_exp_year, this.secretKey),
      cvc: decryptSecret(row.encrypted_cvc, this.secretKey),
    }));
  }

  updateCard(cardId, input = {}, now = nowSeconds()) {
    const current = this.getCardById(cardId, { includeSecret: true });
    const nextGroupId = input.card_group_id ?? input.cardGroupId ?? current.card_group_id;
    const nextNumber = input.number !== undefined ? String(input.number ?? "").replace(/\s+/g, "") : current.number;
    const nextMonth = input.exp_month !== undefined || input.expMonth !== undefined ? requiredText(input.exp_month ?? input.expMonth, "exp_month") : current.exp_month;
    const nextYear = input.exp_year !== undefined || input.expYear !== undefined ? requiredText(input.exp_year ?? input.expYear, "exp_year") : current.exp_year;
    const nextCvc = input.cvc !== undefined ? requiredText(input.cvc, "cvc") : current.cvc;
    this.db.prepare(`
      UPDATE cards
         SET card_group_id = ?, encrypted_number = ?, encrypted_exp_month = ?,
             encrypted_exp_year = ?, encrypted_cvc = ?, masked_number = ?,
             priority = ?, max_success_count = ?, provider = ?, provider_card_id = ?,
             auto_unfreeze_before_use = ?, auto_freeze_after_success = ?, auto_freeze_after_failure = ?,
             status = ?, note = ?, updated_at = ?
       WHERE id = ?
    `).run(
      Number(nextGroupId),
      encryptSecret(nextNumber, this.secretKey),
      encryptSecret(nextMonth, this.secretKey),
      encryptSecret(nextYear, this.secretKey),
      encryptSecret(nextCvc, this.secretKey),
      maskCardNumber(nextNumber),
      Number(input.priority ?? current.priority),
      Number(input.max_success_count ?? input.maxSuccessCount ?? current.max_success_count),
      normalizeProviderName(input.provider ?? current.provider ?? "", CARD_PROVIDERS),
      String(input.provider_card_id ?? input.providerCardId ?? input.remote_card_id ?? input.remoteCardId ?? current.provider_card_id ?? "").trim(),
      boolInt(input.auto_unfreeze_before_use ?? input.autoUnfreezeBeforeUse ?? current.auto_unfreeze_before_use),
      boolInt(input.auto_freeze_after_success ?? input.autoFreezeAfterSuccess ?? current.auto_freeze_after_success),
      boolInt(input.auto_freeze_after_failure ?? input.autoFreezeAfterFailure ?? current.auto_freeze_after_failure),
      String(input.status ?? current.status),
      String(input.note ?? current.note),
      now,
      Number(cardId),
    );
    return this.getCardById(cardId);
  }

  disableCard(cardId, adminId = 1, now = nowSeconds()) {
    this.db.prepare(`
      UPDATE cards
         SET status = ?, updated_at = ?
       WHERE id = ? AND deleted_at = 0
    `).run("disabled", now, Number(cardId));
    return this.getCardById(cardId);
  }

  enableCard(cardId, adminId = 1, now = nowSeconds()) {
    this.db.prepare(`
      UPDATE cards
         SET status = ?, deleted_at = 0, deleted_by = 0, delete_reason = '', updated_at = ?
       WHERE id = ?
    `).run("enabled", now, Number(cardId));
    return this.getCardById(cardId);
  }

  softDeleteCard(cardId, adminId = 1, reason = "", now = nowSeconds()) {
    this.db.prepare(`
      UPDATE cards
         SET deleted_at = ?, deleted_by = ?, delete_reason = ?
       WHERE id = ? AND deleted_at = 0
    `).run(now, Number(adminId), String(reason ?? "").slice(0, 500), Number(cardId));
    return this.getCardById(cardId);
  }

  restoreCard(cardId) {
    return this.enableCard(cardId);
  }

  incrementCardSuccessCount(cardId, now = nowSeconds()) {
    this.db.prepare(`
      UPDATE cards
         SET success_count = success_count + 1,
             last_used_at = ?,
             updated_at = ?
       WHERE id = ?
    `).run(now, now, Number(cardId));
    return this.getCardById(cardId);
  }

  touchCardLastUsed(cardId, now = nowSeconds()) {
    this.db.prepare(`
      UPDATE cards
         SET last_used_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at = 0
    `).run(now, now, Number(cardId));
    return this.getCardById(cardId);
  }

  createBillingGroup(input = {}, now = nowSeconds()) {
    const name = requiredText(input.name, "name");
    const note = String(input.note ?? "");
    return runTransaction(this.db, () => {
      moveDeletedGroupNameAside(this.db, "billing_groups", name, now);
      const result = this.db.prepare(`
        INSERT INTO billing_groups(name, note, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(name, note, now, now);
      return Number(result.lastInsertRowid);
    });
  }

  listBillingGroups() {
    const rows = this.db.prepare(`
      SELECT *
      FROM billing_groups
      WHERE deleted_at = 0
      ORDER BY id ASC
    `).all();
    const countStmt = this.db.prepare(`
      SELECT status, COUNT(*) AS n
      FROM billing_addresses
      WHERE billing_group_id = ? AND deleted_at = 0
      GROUP BY status
    `);
    return rows.map((row) => {
      const counts = Object.fromEntries(countStmt.all(row.id).map((item) => [item.status, item.n]));
      return {
        ...row,
        stats: {
          enabled: counts.enabled ?? 0,
          disabled: counts.disabled ?? 0,
          total: Object.values(counts).reduce((sum, n) => sum + Number(n), 0),
        },
      };
    });
  }

  getBillingGroupById(groupId) {
    return getRequired(this.db, "SELECT * FROM billing_groups WHERE id = ?", Number(groupId));
  }

  updateBillingGroup(groupId, input = {}, now = nowSeconds()) {
    const current = this.getBillingGroupById(groupId);
    this.db.prepare(`
      UPDATE billing_groups
         SET name = ?, note = ?, updated_at = ?
       WHERE id = ?
    `).run(
      input.name ? requiredText(input.name, "name") : current.name,
      input.note !== undefined ? String(input.note ?? "") : current.note,
      now,
      Number(groupId),
    );
    return this.getBillingGroupById(groupId);
  }

  softDeleteBillingGroup(groupId, adminId = 1, reason = "", now = nowSeconds()) {
    const id = Number(groupId);
    const by = Number(adminId);
    const deleteReason = String(reason ?? "").slice(0, 500);
    runTransaction(this.db, () => {
      this.db.prepare(`
        UPDATE billing_groups
           SET deleted_at = ?, deleted_by = ?, delete_reason = ?
         WHERE id = ? AND deleted_at = 0
      `).run(now, by, deleteReason, id);
      this.db.prepare(`
        UPDATE billing_addresses
           SET deleted_at = ?, deleted_by = ?, delete_reason = ?
         WHERE billing_group_id = ? AND deleted_at = 0
      `).run(now, by, deleteReason, id);
    });
    return this.getBillingGroupById(groupId);
  }

  restoreBillingGroup(groupId) {
    this.db.prepare(`
      UPDATE billing_groups
         SET deleted_at = 0, deleted_by = 0, delete_reason = ''
       WHERE id = ?
    `).run(Number(groupId));
    return this.getBillingGroupById(groupId);
  }

  createBillingAddress(input = {}, now = nowSeconds()) {
    const groupId = Number(input.billing_group_id ?? input.billingGroupId);
    if (!groupId) throw new Error("billing_group_id is required");
    const result = this.db.prepare(`
      INSERT INTO billing_addresses(
        billing_group_id, name, country, state, city, line1, postal_code,
        priority, status, note, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      groupId,
      requiredText(input.name, "name"),
      requiredText(input.country, "country"),
      String(input.state ?? ""),
      requiredText(input.city, "city"),
      requiredText(input.line1 ?? input.address, "line1"),
      requiredText(input.postal_code ?? input.postalCode, "postal_code"),
      Number(input.priority ?? 100),
      String(input.status ?? "enabled"),
      String(input.note ?? ""),
      Number(input.last_used_at ?? input.lastUsedAt ?? 0),
      now,
      now,
    );
    return Number(result.lastInsertRowid);
  }

  listBillingAddresses(filter = {}) {
    const where = ["deleted_at = 0"];
    const params = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(String(filter.status));
    }
    if (filter.billing_group_id || filter.billingGroupId) {
      where.push("billing_group_id = ?");
      params.push(Number(filter.billing_group_id ?? filter.billingGroupId));
    }
    return this.db.prepare(`
      SELECT *
      FROM billing_addresses
      WHERE ${where.join(" AND ")}
      ORDER BY priority ASC, last_used_at ASC, id ASC
    `).all(...params);
  }

  getBillingAddressById(addressId) {
    return getRequired(this.db, "SELECT * FROM billing_addresses WHERE id = ?", Number(addressId));
  }

  updateBillingAddress(addressId, input = {}, now = nowSeconds()) {
    const current = this.getBillingAddressById(addressId);
    this.db.prepare(`
      UPDATE billing_addresses
         SET billing_group_id = ?, name = ?, country = ?, state = ?, city = ?,
             line1 = ?, postal_code = ?, priority = ?, status = ?, note = ?,
             updated_at = ?
       WHERE id = ?
    `).run(
      Number(input.billing_group_id ?? input.billingGroupId ?? current.billing_group_id),
      input.name ? requiredText(input.name, "name") : current.name,
      input.country ? requiredText(input.country, "country") : current.country,
      input.state !== undefined ? String(input.state ?? "") : current.state,
      input.city ? requiredText(input.city, "city") : current.city,
      input.line1 !== undefined || input.address !== undefined ? requiredText(input.line1 ?? input.address, "line1") : current.line1,
      input.postal_code !== undefined || input.postalCode !== undefined ? requiredText(input.postal_code ?? input.postalCode, "postal_code") : current.postal_code,
      Number(input.priority ?? current.priority),
      String(input.status ?? current.status),
      String(input.note ?? current.note),
      now,
      Number(addressId),
    );
    return this.getBillingAddressById(addressId);
  }

  disableBillingAddress(addressId, adminId = 1, now = nowSeconds()) {
    this.db.prepare(`
      UPDATE billing_addresses
         SET status = ?, updated_at = ?
       WHERE id = ? AND deleted_at = 0
    `).run("disabled", now, Number(addressId));
    return this.getBillingAddressById(addressId);
  }

  enableBillingAddress(addressId, adminId = 1, now = nowSeconds()) {
    this.db.prepare(`
      UPDATE billing_addresses
         SET status = ?, deleted_at = 0, deleted_by = 0, delete_reason = '', updated_at = ?
       WHERE id = ?
    `).run("enabled", now, Number(addressId));
    return this.getBillingAddressById(addressId);
  }

  softDeleteBillingAddress(addressId, adminId = 1, reason = "", now = nowSeconds()) {
    this.db.prepare(`
      UPDATE billing_addresses
         SET deleted_at = ?, deleted_by = ?, delete_reason = ?
       WHERE id = ? AND deleted_at = 0
    `).run(now, Number(adminId), String(reason ?? "").slice(0, 500), Number(addressId));
    return this.getBillingAddressById(addressId);
  }

  restoreBillingAddress(addressId) {
    return this.enableBillingAddress(addressId);
  }

  touchBillingAddressLastUsed(addressId, now = nowSeconds()) {
    this.db.prepare(`
      UPDATE billing_addresses
         SET last_used_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at = 0
    `).run(now, now, Number(addressId));
    return this.getBillingAddressById(addressId);
  }

  createProxyGroup(input = {}, now = nowSeconds()) {
    const group = normalizeProxyGroup(input);
    return runTransaction(this.db, () => {
      moveDeletedGroupNameAside(this.db, "proxy_groups", group.name, now);
      const result = this.db.prepare(`
        INSERT INTO proxy_groups(
          name, kind, provider, config_json, enabled, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        group.name,
        group.kind,
        group.provider,
        group.config_json,
        boolInt(group.enabled),
        group.note,
        now,
        now,
      );
      return Number(result.lastInsertRowid);
    });
  }

  listProxyGroups(filter = {}) {
    const where = ["deleted_at = 0"];
    const params = [];
    if (filter.kind) {
      where.push("kind = ?");
      params.push(String(filter.kind));
    }
    if (filter.provider) {
      where.push("provider = ?");
      params.push(String(filter.provider));
    }
    return this.db.prepare(`
      SELECT *
      FROM proxy_groups
      WHERE ${where.join(" AND ")}
      ORDER BY id ASC
    `).all(...params).map(withParsedConfig);
  }

  getProxyGroupById(groupId) {
    return withParsedConfig(getRequired(this.db, "SELECT * FROM proxy_groups WHERE id = ?", Number(groupId)));
  }

  updateProxyGroup(groupId, input = {}, now = nowSeconds()) {
    const current = this.getProxyGroupById(groupId);
    const hasConfig = input.config !== undefined || input.config_json !== undefined || input.configJson !== undefined;
    const group = normalizeProxyGroup({
      name: input.name ?? current.name,
      kind: input.kind ?? current.kind,
      provider: input.provider ?? current.provider,
      config: hasConfig ? (input.config ?? input.config_json ?? input.configJson) : current.config,
      enabled: input.enabled ?? Boolean(current.enabled),
      note: input.note ?? current.note,
    });
    this.db.prepare(`
      UPDATE proxy_groups
         SET name = ?, kind = ?, provider = ?, config_json = ?,
             enabled = ?, note = ?, updated_at = ?
       WHERE id = ?
    `).run(
      group.name,
      group.kind,
      group.provider,
      group.config_json,
      boolInt(group.enabled),
      group.note,
      now,
      Number(groupId),
    );
    return this.getProxyGroupById(groupId);
  }

  softDeleteProxyGroup(groupId, adminId = 1, reason = "", now = nowSeconds()) {
    this.db.prepare(`
      UPDATE proxy_groups
         SET deleted_at = ?, deleted_by = ?, delete_reason = ?
       WHERE id = ? AND deleted_at = 0
    `).run(now, Number(adminId), String(reason ?? "").slice(0, 500), Number(groupId));
    return this.getProxyGroupById(groupId);
  }

  restoreProxyGroup(groupId) {
    this.db.prepare(`
      UPDATE proxy_groups
         SET deleted_at = 0, deleted_by = 0, delete_reason = ''
       WHERE id = ?
    `).run(Number(groupId));
    return this.getProxyGroupById(groupId);
  }

  insertRedeemCode(input = {}, now = nowSeconds()) {
    const planType = normalizePlanType(input.plan_type ?? input.planType);
    const codeDisplay = normalizeRedeemCode(requiredText(input.code_display ?? input.codeDisplay, "code_display"));
    const result = this.db.prepare(`
      INSERT INTO redeem_codes(
        batch_id, code_hash, code_prefix, code_display,
        plan_type, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(input.batch_id ?? input.batchId),
      hashRedeemCode(codeDisplay, this.codePepper),
      codeDisplay.split("-")[0],
      codeDisplay,
      planType,
      input.status ?? RedeemStatus.UNUSED,
      now,
    );
    return Number(result.lastInsertRowid);
  }

  createRedeemBatchWithCodes(input = {}, now = nowSeconds()) {
    return runTransaction(this.db, () => {
      const batchId = this.createRedeemBatch(input, now);
      const planType = normalizePlanType(input.plan_type ?? input.planType);
      const quantity = Number(input.quantity ?? 0);
      const ids = [];
      for (let i = 0; i < quantity; i += 1) {
        const codeDisplay = input.codeFactory ? input.codeFactory(i) : generateRedeemCode({ planType });
        ids.push(this.insertRedeemCode({ batch_id: batchId, plan_type: planType, code_display: codeDisplay }, now));
      }
      return { batchId, codeIds: ids };
    });
  }

  getRedeemCodeByDisplay(codeDisplay) {
    const codeHash = hashRedeemCode(codeDisplay, this.codePepper);
    return this.db.prepare("SELECT * FROM redeem_codes WHERE code_hash = ?").get(codeHash) ?? null;
  }

  listRedeemCodes(filter = {}) {
    const where = ["deleted_at = 0"];
    const params = [];
    const ids = idList(filter.ids ?? filter.id_list ?? filter.idList);
    if (ids.length > 0) {
      where.push(`id IN (${ids.map(() => "?").join(", ")})`);
      params.push(...ids);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.plan_type || filter.planType) {
      where.push("plan_type = ?");
      params.push(normalizePlanType(filter.plan_type ?? filter.planType));
    }
    if (filter.batch_id || filter.batchId) {
      where.push("batch_id = ?");
      params.push(Number(filter.batch_id ?? filter.batchId));
    }
    if (filter.q || filter.query || filter.code) {
      const query = normalizeRedeemCode(filter.q ?? filter.query ?? filter.code);
      if (query) {
        where.push("code_display LIKE ? ESCAPE '\\'");
        params.push(`%${escapeSqlLike(query)}%`);
      }
    }
    const order = ids.length > 0
      ? `ORDER BY CASE id ${ids.map((id, index) => `WHEN ${id} THEN ${index}`).join(" ")} ELSE ${ids.length} END`
      : "ORDER BY id ASC";
    const limit = filter.limit || filter.page_size || filter.pageSize || filter.per_page || filter.perPage
      ? toInteger(filter.limit ?? filter.page_size ?? filter.pageSize ?? filter.per_page ?? filter.perPage, 50, 1, 1000, "limit")
      : 0;
    const offset = filter.offset !== undefined || filter.page
      ? Math.max(0, Number(filter.offset ?? (Math.max(1, Number(filter.page || 1)) - 1) * (limit || 50)))
      : 0;
    let sql = `
      SELECT * FROM redeem_codes
      WHERE ${where.join(" AND ")}
      ${order}
    `;
    if (limit > 0) {
      sql += " LIMIT ? OFFSET ?";
      params.push(limit, offset);
    }
    return this.db.prepare(sql).all(...params);
  }

  countRedeemCodes(filter = {}) {
    const where = ["deleted_at = 0"];
    const params = [];
    const ids = idList(filter.ids ?? filter.id_list ?? filter.idList);
    if (ids.length > 0) {
      where.push(`id IN (${ids.map(() => "?").join(", ")})`);
      params.push(...ids);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.plan_type || filter.planType) {
      where.push("plan_type = ?");
      params.push(normalizePlanType(filter.plan_type ?? filter.planType));
    }
    if (filter.batch_id || filter.batchId) {
      where.push("batch_id = ?");
      params.push(Number(filter.batch_id ?? filter.batchId));
    }
    if (filter.q || filter.query || filter.code) {
      const query = normalizeRedeemCode(filter.q ?? filter.query ?? filter.code);
      if (query) {
        where.push("code_display LIKE ? ESCAPE '\\'");
        params.push(`%${escapeSqlLike(query)}%`);
      }
    }
    return Number(this.db.prepare(`
      SELECT COUNT(*) AS n
      FROM redeem_codes
      WHERE ${where.join(" AND ")}
    `).get(...params).n ?? 0);
  }

  listRedeemCodesPage(filter = {}) {
    const page = toInteger(filter.page, 1, 1, 1000000, "page");
    const pageSize = toInteger(filter.page_size ?? filter.pageSize ?? filter.per_page ?? filter.perPage, 20, 1, 1000, "page_size");
    const total = this.countRedeemCodes(filter);
    const rows = this.listRedeemCodes({
      ...filter,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return {
      rows,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  listRedeemBatches() {
    const batches = this.db.prepare(`
      SELECT *
      FROM redeem_batches
      WHERE deleted_at = 0
      ORDER BY id DESC
    `).all();
    const countStmt = this.db.prepare(`
      SELECT status, COUNT(*) AS n
      FROM redeem_codes
      WHERE batch_id = ? AND deleted_at = 0
      GROUP BY status
    `);
    return batches.map((batch) => {
      const counts = Object.fromEntries(countStmt.all(batch.id).map((row) => [row.status, row.n]));
      return {
        ...batch,
        stats: {
          unused: counts.unused ?? 0,
          locked: counts.locked ?? 0,
          used: counts.used ?? 0,
          unavailable: counts.unavailable ?? 0,
          disabled: counts.disabled ?? 0,
          total: Object.values(counts).reduce((sum, n) => sum + Number(n), 0),
        },
      };
    });
  }

  exportRedeemCodes(filter = {}) {
    return exportRedeemCodes(this.listRedeemCodes(filter), {
      format: filter.format ?? "txt",
      status: filter.status,
      planType: filter.plan_type ?? filter.planType,
      batchId: filter.batch_id ?? filter.batchId,
    });
  }

  disableRedeemCode(codeId, adminId = 1, now = nowSeconds()) {
    this.db.prepare(`
      UPDATE redeem_codes
         SET status = ?, disabled_at = ?, disabled_by = ?
       WHERE id = ? AND deleted_at = 0
    `).run(RedeemStatus.DISABLED, now, Number(adminId), Number(codeId));
    return this.getRedeemCodeById(codeId);
  }

  softDeleteRedeemCode(codeId, adminId = 1, reason = "", now = nowSeconds()) {
    this.db.prepare(`
      UPDATE redeem_codes
         SET deleted_at = ?, deleted_by = ?, delete_reason = ?
       WHERE id = ? AND deleted_at = 0
    `).run(now, Number(adminId), String(reason ?? "").slice(0, 500), Number(codeId));
    return this.getRedeemCodeById(codeId);
  }

  restoreRedeemCode(codeId) {
    this.db.prepare(`
      UPDATE redeem_codes
         SET deleted_at = 0, deleted_by = 0, delete_reason = ''
       WHERE id = ?
    `).run(Number(codeId));
    return this.getRedeemCodeById(codeId);
  }

  restoreRedeemCodeStatus(codeId, adminId = 1, now = nowSeconds()) {
    const current = this.getRedeemCodeById(codeId);
    if (![RedeemStatus.DISABLED, RedeemStatus.UNAVAILABLE].includes(current.status)) {
      throw new PlatformStoreError("REDEEM_CODE_STATUS_NOT_RESTORABLE", "兑换码当前状态不能恢复", { status: current.status });
    }
    if (current.used_order_id || current.locked_order_id) {
      throw new PlatformStoreError("REDEEM_CODE_HAS_ORDER", "兑换码关联订单未处理，不能直接恢复", {
        used_order_id: current.used_order_id,
        locked_order_id: current.locked_order_id,
      });
    }
    this.db.prepare(`
      UPDATE redeem_codes
         SET status = ?, disabled_at = 0, disabled_by = 0,
             unavailable_at = 0, unavailable_reason = ''
       WHERE id = ? AND deleted_at = 0
    `).run(RedeemStatus.UNUSED, Number(codeId));
    return this.getRedeemCodeById(codeId);
  }

  lockCodeAndCreateOrder(input = {}, now = nowSeconds()) {
    const codeHash = hashRedeemCode(input.code, this.codePepper);
    return runTransaction(this.db, () => {
      const code = this.db.prepare("SELECT * FROM redeem_codes WHERE code_hash = ?").get(codeHash);
      if (!code) throw new PlatformStoreError("REDEEM_CODE_NOT_FOUND", "兑换码不存在");
      if (code.deleted_at) throw new PlatformStoreError("REDEEM_CODE_DELETED", "兑换码已删除");
      if (code.status !== RedeemStatus.UNUSED) {
        throw new PlatformStoreError("REDEEM_CODE_NOT_UNUSED", "兑换码不可用", { status: code.status });
      }
      const plan = this.getPlanConfig(code.plan_type);
      const lockRedeemCodeOnFailure = boolInt(plan.lock_redeem_code_on_failure);
      const orderNo = String(input.order_no ?? input.orderNo ?? `ord_${Math.floor(now * 1000)}`);
      const orderResult = this.db.prepare(`
        INSERT INTO orders(
          order_no, redeem_code_id, plan_type, status,
          lock_redeem_code_on_failure, user_ip, user_agent, queued_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderNo,
        code.id,
        code.plan_type,
        OrderStatus.QUEUED,
        lockRedeemCodeOnFailure,
        String(input.user_ip ?? input.userIp ?? ""),
        String(input.user_agent ?? input.userAgent ?? ""),
        now,
        now,
        now,
      );
      const orderId = Number(orderResult.lastInsertRowid);
      this.db.prepare(`
        UPDATE redeem_codes
           SET status = ?, locked_order_id = ?, locked_at = ?
         WHERE id = ? AND status = ?
      `).run(RedeemStatus.LOCKED, orderId, now, code.id, RedeemStatus.UNUSED);
      return {
        order: this.getOrderById(orderId),
        redeemCode: this.getRedeemCodeById(code.id),
      };
    });
  }

  createManualOrder(input = {}, now = nowSeconds()) {
    const planType = normalizePlanType(input.plan_type ?? input.planType);
    const plan = this.getPlanConfig(planType);
    const cardGroupId = Number(input.card_group_id ?? input.cardGroupId);
    const cardId = Number(input.card_id ?? input.cardId);
    const billingGroupId = Number(input.billing_group_id ?? input.billingGroupId);
    const billingAddressId = Number(input.billing_address_id ?? input.billingAddressId);
    const checkoutProxyGroupId = Number(input.checkout_proxy_group_id ?? input.checkoutProxyGroupId ?? 0);
    const directCardProxyGroupId = Number(input.direct_card_proxy_group_id ?? input.directCardProxyGroupId ?? 0);
    const accessToken = requiredText(input.access_token ?? input.accessToken, "access_token");
    const sessionToken = requiredText(input.session_token ?? input.sessionToken, "session_token");
    if (!cardGroupId) throw new PlatformStoreError("CARD_GROUP_REQUIRED", "card_group_id is required");
    if (!cardId) throw new PlatformStoreError("CARD_REQUIRED", "card_id is required");
    if (!billingGroupId) throw new PlatformStoreError("BILLING_GROUP_REQUIRED", "billing_group_id is required");
    if (!billingAddressId) throw new PlatformStoreError("BILLING_ADDRESS_REQUIRED", "billing_address_id is required");

    const card = this.getCardById(cardId);
    if (Number(card.card_group_id) !== cardGroupId) {
      throw new PlatformStoreError("CARD_GROUP_MISMATCH", "所选卡不属于所选卡组", { card_id: cardId, card_group_id: cardGroupId });
    }
    const billingAddress = this.getBillingAddressById(billingAddressId);
    if (Number(billingAddress.billing_group_id) !== billingGroupId) {
      throw new PlatformStoreError("BILLING_GROUP_MISMATCH", "所选账单地址不属于所选账单组", {
        billing_address_id: billingAddressId,
        billing_group_id: billingGroupId,
      });
    }
    if (checkoutProxyGroupId) this.getProxyGroupById(checkoutProxyGroupId);
    if (directCardProxyGroupId) this.getProxyGroupById(directCardProxyGroupId);

    const created = runTransaction(this.db, () => {
      const orderNo = String(input.order_no ?? input.orderNo ?? `manual_${orderSuffix(now)}`);
      const batchResult = this.db.prepare(`
        INSERT INTO redeem_batches(
          name, plan_type, quantity, note, channel_enabled, channel,
          created_by, created_at, deleted_at, deleted_by, delete_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `manual ${orderNo}`,
        planType,
        1,
        "internal manual order placeholder",
        0,
        "manual_internal",
        Number(input.created_by ?? input.createdBy ?? 1),
        now,
        now,
        Number(input.created_by ?? input.createdBy ?? 1),
        "manual_internal_hidden",
      );
      const batchId = Number(batchResult.lastInsertRowid);
      const codeDisplay = normalizeRedeemCode(`MANUAL-${planType}-${orderNo}`);
      const codeResult = this.db.prepare(`
        INSERT INTO redeem_codes(
          batch_id, code_hash, code_prefix, code_display, plan_type, status,
          created_at, deleted_at, deleted_by, delete_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batchId,
        hashRedeemCode(codeDisplay, this.codePepper),
        "MANUAL",
        codeDisplay,
        planType,
        RedeemStatus.UNUSED,
        now,
        now,
        Number(input.created_by ?? input.createdBy ?? 1),
        "manual_internal_hidden",
      );
      const codeId = Number(codeResult.lastInsertRowid);
      const orderResult = this.db.prepare(`
        INSERT INTO orders(
          order_no, redeem_code_id, plan_type, status,
          lock_redeem_code_on_failure, user_ip, user_agent, public_message, queued_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderNo,
        codeId,
        planType,
        OrderStatus.QUEUED,
        boolInt(plan.lock_redeem_code_on_failure),
        String(input.user_ip ?? input.userIp ?? ""),
        String(input.user_agent ?? input.userAgent ?? ""),
        "管理员手充订单已排队",
        now,
        now,
        now,
      );
      const orderId = Number(orderResult.lastInsertRowid);
      this.db.prepare(`
        UPDATE redeem_codes
           SET status = ?, locked_order_id = ?, locked_at = ?
         WHERE id = ?
      `).run(RedeemStatus.LOCKED, orderId, now, codeId);
      this.db.prepare(`
        INSERT INTO manual_order_options(
          order_id, card_group_id, card_id, billing_group_id, billing_address_id,
          checkout_proxy_group_id, direct_card_proxy_group_id, account_label, note,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId,
        cardGroupId,
        cardId,
        billingGroupId,
        billingAddressId,
        checkoutProxyGroupId,
        directCardProxyGroupId,
        String(input.account_label ?? input.accountLabel ?? ""),
        String(input.note ?? ""),
        now,
        now,
      );
      return {
        order: this.getOrderById(orderId),
        redeemCode: this.getRedeemCodeById(codeId),
        manualOptions: this.getManualOrderOptions(orderId),
      };
    });
    const runtime = this.setOrderRuntimeSecrets(created.order.id, {
      accessToken,
      sessionToken,
      sessionCookieName: input.session_cookie_name ?? input.sessionCookieName ?? "__Secure-next-auth.session-token",
      checkoutInput: input.checkout_input ?? input.checkoutInput ?? "",
    }, now);
    return {
      ...created,
      runtime: {
        order_id: runtime.order_id,
        has_access_token: runtime.has_access_token,
        has_session_token: runtime.has_session_token,
        checkout_input: runtime.checkout_input,
      },
    };
  }

  getManualOrderOptions(orderId) {
    return this.db.prepare("SELECT * FROM manual_order_options WHERE order_id = ?").get(Number(orderId)) ?? null;
  }

  getOrderById(orderId) {
    return getRequired(this.db, "SELECT * FROM orders WHERE id = ?", Number(orderId));
  }

  getOrderByNo(orderNo) {
    return this.db.prepare("SELECT * FROM orders WHERE order_no = ?").get(String(orderNo)) ?? null;
  }

  softDeleteOrder(orderId, adminId = 1, reason = "", now = nowSeconds()) {
    const order = this.getOrderById(orderId);
    if (Number(order.deleted_at || 0) > 0) return order;
    this.db.prepare(`
      UPDATE orders
         SET deleted_at = ?, deleted_by = ?, delete_reason = ?, updated_at = ?
       WHERE id = ? AND deleted_at = 0
    `).run(now, Number(adminId), String(reason ?? "").slice(0, 500), now, Number(orderId));
    return this.getOrderById(orderId);
  }

  getOrderForRedeemCodeDisplay(codeDisplay) {
    const code = this.getRedeemCodeByDisplay(codeDisplay);
    if (!code) return null;
    const orderId = Number(code.locked_order_id || code.used_order_id || 0);
    if (!orderId) return null;
    return this.getOrderById(orderId);
  }

  setOrderRuntimeSecrets(orderId, input = {}, now = nowSeconds()) {
    const order = this.getOrderById(orderId);
    const current = this.getOrderRuntimeSecrets(order.id, { includeSecret: true }) ?? {};
    const hasAccessToken = input.accessToken !== undefined || input.access_token !== undefined;
    const hasSessionToken = input.sessionToken !== undefined || input.session_token !== undefined;
    const accessToken = hasAccessToken ? String(input.accessToken ?? input.access_token ?? "") : current.accessToken ?? "";
    const sessionToken = hasSessionToken ? String(input.sessionToken ?? input.session_token ?? "") : current.sessionToken ?? "";
    const sessionCookieName = String(
      input.sessionCookieName ??
      input.session_cookie_name ??
      current.sessionCookieName ??
      "__Secure-next-auth.session-token",
    );
    const checkoutInput = String(input.checkoutInput ?? input.checkout_input ?? current.checkoutInput ?? "");

    this.db.prepare(`
      INSERT INTO order_runtime_secrets(
        order_id, encrypted_access_token, encrypted_session_token,
        session_cookie_name, checkout_input, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        encrypted_access_token = excluded.encrypted_access_token,
        encrypted_session_token = excluded.encrypted_session_token,
        session_cookie_name = excluded.session_cookie_name,
        checkout_input = excluded.checkout_input,
        updated_at = excluded.updated_at
    `).run(
      order.id,
      accessToken ? encryptSecret(accessToken, this.secretKey) : "",
      sessionToken ? encryptSecret(sessionToken, this.secretKey) : "",
      sessionCookieName,
      checkoutInput,
      now,
      now,
    );
    return this.getOrderRuntimeSecrets(order.id, { includeSecret: true });
  }

  setOrderRuntimeCheckoutInput(orderId, checkoutInput = "", now = nowSeconds()) {
    const current = this.getOrderRuntimeSecrets(orderId, { includeSecret: true }) ?? {};
    return this.setOrderRuntimeSecrets(orderId, {
      accessToken: current.accessToken ?? "",
      sessionToken: current.sessionToken ?? "",
      sessionCookieName: current.sessionCookieName ?? "__Secure-next-auth.session-token",
      checkoutInput,
    }, now);
  }

  getOrderRuntimeSecrets(orderId, options = {}) {
    const row = this.db.prepare("SELECT * FROM order_runtime_secrets WHERE order_id = ?").get(Number(orderId));
    if (!row) return null;
    const result = {
      order_id: row.order_id,
      sessionCookieName: row.session_cookie_name,
      session_cookie_name: row.session_cookie_name,
      checkoutInput: row.checkout_input,
      checkout_input: row.checkout_input,
      has_access_token: Boolean(row.encrypted_access_token),
      has_session_token: Boolean(row.encrypted_session_token),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (!options.includeSecret) return result;
    return {
      ...result,
      accessToken: row.encrypted_access_token ? decryptSecret(row.encrypted_access_token, this.secretKey) : "",
      access_token: row.encrypted_access_token ? decryptSecret(row.encrypted_access_token, this.secretKey) : "",
      sessionToken: row.encrypted_session_token ? decryptSecret(row.encrypted_session_token, this.secretKey) : "",
      session_token: row.encrypted_session_token ? decryptSecret(row.encrypted_session_token, this.secretKey) : "",
    };
  }

  createOrderAttempt(input = {}, now = nowSeconds()) {
    const result = this.db.prepare(`
      INSERT INTO order_attempts(
        order_id, attempt_no, card_id, billing_address_id,
        checkout_proxy, direct_card_proxy, checkout_proxy_session,
        direct_card_proxy_session, status, stage, error_code,
        error_message, started_at, finished_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(input.order_id ?? input.orderId),
      Number(input.attempt_no ?? input.attemptNo ?? 1),
      Number(input.card_id ?? input.cardId ?? 0),
      Number(input.billing_address_id ?? input.billingAddressId ?? 0),
      String(input.checkout_proxy ?? input.checkoutProxy ?? ""),
      String(input.direct_card_proxy ?? input.directCardProxy ?? ""),
      String(input.checkout_proxy_session ?? input.checkoutProxySession ?? ""),
      String(input.direct_card_proxy_session ?? input.directCardProxySession ?? ""),
      String(input.status ?? "running"),
      String(input.stage ?? ""),
      String(input.error_code ?? input.errorCode ?? ""),
      String(input.error_message ?? input.errorMessage ?? ""),
      Number(input.started_at ?? input.startedAt ?? now),
      Number(input.finished_at ?? input.finishedAt ?? 0),
      now,
    );
    return Number(result.lastInsertRowid);
  }

  updateOrderAttempt(attemptId, input = {}, now = nowSeconds()) {
    const current = getRequired(this.db, "SELECT * FROM order_attempts WHERE id = ?", Number(attemptId));
    this.db.prepare(`
      UPDATE order_attempts
         SET status = ?, stage = ?, error_code = ?, error_message = ?,
             finished_at = ?
       WHERE id = ?
    `).run(
      String(input.status ?? current.status),
      String(input.stage ?? current.stage),
      String(input.error_code ?? input.errorCode ?? current.error_code),
      String(input.error_message ?? input.errorMessage ?? current.error_message),
      Number(input.finished_at ?? input.finishedAt ?? now),
      Number(attemptId),
    );
    return getRequired(this.db, "SELECT * FROM order_attempts WHERE id = ?", Number(attemptId));
  }


  updateOrderAttemptResources(attemptId, input = {}, now = nowSeconds()) {
    const current = getRequired(this.db, "SELECT * FROM order_attempts WHERE id = ?", Number(attemptId));
    this.db.prepare(`
      UPDATE order_attempts
         SET card_id = ?, billing_address_id = ?
       WHERE id = ?
    `).run(
      Number(input.card_id ?? input.cardId ?? current.card_id ?? 0),
      Number(input.billing_address_id ?? input.billingAddressId ?? current.billing_address_id ?? 0),
      Number(attemptId),
    );
    return getRequired(this.db, "SELECT * FROM order_attempts WHERE id = ?", Number(attemptId));
  }

  setOrderAttemptProxies(attemptId, input = {}) {
    const current = getRequired(this.db, "SELECT * FROM order_attempts WHERE id = ?", Number(attemptId));
    this.db.prepare(`
      UPDATE order_attempts
         SET checkout_proxy = ?, direct_card_proxy = ?,
             checkout_proxy_session = ?, direct_card_proxy_session = ?
       WHERE id = ?
    `).run(
      String(input.checkout_proxy ?? input.checkoutProxy ?? current.checkout_proxy ?? ""),
      String(input.direct_card_proxy ?? input.directCardProxy ?? current.direct_card_proxy ?? ""),
      String(input.checkout_proxy_session ?? input.checkoutProxySession ?? current.checkout_proxy_session ?? ""),
      String(input.direct_card_proxy_session ?? input.directCardProxySession ?? current.direct_card_proxy_session ?? ""),
      Number(attemptId),
    );
    return getRequired(this.db, "SELECT * FROM order_attempts WHERE id = ?", Number(attemptId));
  }

  listOrderAttempts(orderId) {
    return this.db.prepare(`
      SELECT *
      FROM order_attempts
      WHERE order_id = ?
      ORDER BY attempt_no ASC, id ASC
    `).all(Number(orderId));
  }

  nextAttemptNo(orderId) {
    const row = this.db.prepare("SELECT COALESCE(MAX(attempt_no), 0) AS n FROM order_attempts WHERE order_id = ?").get(Number(orderId));
    return Number(row.n ?? 0) + 1;
  }

  addRunLog(input = {}, now = nowSeconds()) {
    const result = this.db.prepare(`
      INSERT INTO run_logs(order_id, attempt_id, level, stage, message, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(input.order_id ?? input.orderId),
      Number(input.attempt_id ?? input.attemptId ?? 0),
      String(input.level ?? "info"),
      String(input.stage ?? ""),
      String(input.message ?? ""),
      JSON.stringify(input.meta ?? input.meta_json ?? {}),
      now,
    );
    return Number(result.lastInsertRowid);
  }

  listRunLogs(orderId) {
    return this.db.prepare(`
      SELECT *
      FROM run_logs
      WHERE order_id = ? AND deleted_at = 0
      ORDER BY id ASC
    `).all(Number(orderId));
  }

  listRecentRunLogs(limit = 80) {
    const n = toInteger(limit, 80, 1, 500, "limit");
    return this.db.prepare(`
      SELECT
        rl.*,
        o.order_no,
        o.plan_type,
        o.status AS order_status,
        rc.code_display AS redeem_code
      FROM run_logs rl
      LEFT JOIN orders o ON o.id = rl.order_id
      LEFT JOIN redeem_codes rc ON rc.id = o.redeem_code_id
      WHERE rl.deleted_at = 0 AND (o.deleted_at = 0 OR o.deleted_at IS NULL)
      ORDER BY rl.id DESC
      LIMIT ?
    `).all(n).reverse();
  }

  getRedeemCodeById(codeId) {
    return getRequired(this.db, "SELECT * FROM redeem_codes WHERE id = ?", Number(codeId));
  }

  setSystemJson(key, value, adminId = 1, now = nowSeconds()) {
    this.db.prepare(`
      INSERT INTO system_settings(key, value_json, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(String(key), JSON.stringify(value ?? {}), now, Number(adminId));
    return value;
  }

  getSystemJson(key, fallback = null) {
    const row = this.db.prepare("SELECT value_json FROM system_settings WHERE key = ?").get(String(key));
    if (!row) return fallback;
    try {
      return JSON.parse(row.value_json);
    } catch {
      return fallback;
    }
  }

  getCardProviderConfig(provider = "vcc", options = {}) {
    const normalizedProvider = normalizeProviderName(provider, REMOTE_CARD_PROVIDERS);
    const raw = this.getSystemJson(cardProviderSettingKey(normalizedProvider), defaultCardProviderConfig(normalizedProvider));
    if (normalizedProvider === "kimoox") {
      const result = {
        provider: "kimoox",
        base_url: String(raw.base_url ?? "https://card.kimoox.com"),
        webhook_url: normalizeWebhookUrl(raw.webhook_url ?? DEFAULT_KIMOOX_WEBHOOK_URL),
        api_key: String(raw.api_key ?? ""),
        api_secret_configured: Boolean(raw.api_secret_encrypted),
        webhook_secret_configured: Boolean(raw.webhook_secret_encrypted),
        timeout_ms: toInteger(raw.timeout_ms, 15_000, 1_000, 120_000, "timeout_ms"),
        updated_at: Number(raw.updated_at ?? 0),
        updated_by: Number(raw.updated_by ?? 0),
      };
      if (options.includeSecret) {
        result.api_secret = raw.api_secret_encrypted ? decryptSecret(raw.api_secret_encrypted, this.secretKey) : "";
        result.webhook_secret = raw.webhook_secret_encrypted ? decryptSecret(raw.webhook_secret_encrypted, this.secretKey) : "";
      }
      return result;
    }
    const result = {
      provider: normalizedProvider,
      base_url: String(raw.base_url ?? "http://api.vcc.center"),
      user_serial: String(raw.user_serial ?? ""),
      secret_configured: Boolean(raw.secret_key_encrypted),
      timeout_ms: toInteger(raw.timeout_ms, 15_000, 1_000, 120_000, "timeout_ms"),
      updated_at: Number(raw.updated_at ?? 0),
      updated_by: Number(raw.updated_by ?? 0),
    };
    if (options.includeSecret) {
      result.secret_key = raw.secret_key_encrypted ? decryptSecret(raw.secret_key_encrypted, this.secretKey) : "";
    }
    return result;
  }

  setCardProviderConfig(provider = "vcc", input = {}, adminId = 1, now = nowSeconds()) {
    const normalizedProvider = normalizeProviderName(provider, REMOTE_CARD_PROVIDERS);
    const current = this.getSystemJson(cardProviderSettingKey(normalizedProvider), defaultCardProviderConfig(normalizedProvider));
    if (normalizedProvider === "kimoox") {
      const apiSecretInput = input.api_secret ?? input.apiSecret;
      const webhookSecretInput = input.webhook_secret ?? input.webhookSecret;
      const next = {
        provider: "kimoox",
        base_url: String(input.base_url ?? input.baseUrl ?? current.base_url ?? "https://card.kimoox.com").trim() || "https://card.kimoox.com",
        webhook_url: normalizeWebhookUrl(input.webhook_url ?? input.webhookUrl ?? current.webhook_url ?? DEFAULT_KIMOOX_WEBHOOK_URL),
        api_key: String(input.api_key ?? input.apiKey ?? current.api_key ?? "").trim(),
        api_secret_encrypted: apiSecretInput !== undefined && String(apiSecretInput ?? "").trim()
          ? encryptSecret(String(apiSecretInput).trim(), this.secretKey)
          : String(current.api_secret_encrypted ?? ""),
        webhook_secret_encrypted: webhookSecretInput !== undefined && String(webhookSecretInput ?? "").trim()
          ? encryptSecret(String(webhookSecretInput).trim(), this.secretKey)
          : String(current.webhook_secret_encrypted ?? ""),
        timeout_ms: toInteger(input.timeout_ms ?? input.timeoutMs ?? current.timeout_ms, 15_000, 1_000, 120_000, "timeout_ms"),
        updated_at: now,
        updated_by: Number(adminId),
      };
      this.setSystemJson(cardProviderSettingKey(normalizedProvider), next, adminId, now);
      return this.getCardProviderConfig(normalizedProvider);
    }
    const secretInput = input.secret_key ?? input.secretKey;
    const next = {
      provider: normalizedProvider,
      base_url: String(input.base_url ?? input.baseUrl ?? current.base_url ?? "http://api.vcc.center").trim() || "http://api.vcc.center",
      user_serial: String(input.user_serial ?? input.userSerial ?? current.user_serial ?? "").trim(),
      secret_key_encrypted: secretInput !== undefined && String(secretInput ?? "").trim()
        ? encryptSecret(String(secretInput).trim(), this.secretKey)
        : String(current.secret_key_encrypted ?? ""),
      timeout_ms: toInteger(input.timeout_ms ?? input.timeoutMs ?? current.timeout_ms, 15_000, 1_000, 120_000, "timeout_ms"),
      updated_at: now,
      updated_by: Number(adminId),
    };
    this.setSystemJson(cardProviderSettingKey(normalizedProvider), next, adminId, now);
    return this.getCardProviderConfig(normalizedProvider);
  }

  findCardByNumber(number, options = {}) {
    const normalized = String(number ?? "").replace(/\s+/g, "");
    if (!normalized) return null;
    const cards = this.listCards({}, { includeSecret: true });
    const found = cards.find((card) => card.number === normalized);
    if (!found) return null;
    return options.includeSecret ? found : this.getCardById(found.id);
  }

  importProviderCards(input = {}, now = nowSeconds()) {
    const provider = normalizeProviderName(input.provider ?? "vcc", REMOTE_CARD_PROVIDERS);
    const cardGroupId = Number(input.card_group_id ?? input.cardGroupId);
    if (!cardGroupId) throw new Error("card_group_id is required");
    const cards = Array.isArray(input.cards) ? input.cards : [];
    const imported = [];
    const skipped = [];
    for (const remote of cards) {
      const number = String(remote.number ?? "").replace(/\s+/g, "");
      const expMonth = String(remote.exp_month ?? remote.expMonth ?? "").trim();
      const expYear = String(remote.exp_year ?? remote.expYear ?? "").trim();
      const cvc = String(remote.cvc ?? "").trim();
      const remoteId = String(remote.provider_card_id ?? remote.providerCardId ?? remote.id ?? "");
      if (!number || !expMonth || !expYear || !cvc) {
        skipped.push({ provider_card_id: remoteId, masked_number: maskCardNumber(number), reason: "missing_card_fields" });
        continue;
      }
      const existing = this.findCardByNumber(number);
      if (existing) {
        skipped.push({ provider_card_id: remoteId, masked_number: existing.masked_number, card_id: existing.id, reason: "duplicate" });
        continue;
      }
      const id = this.createCard({
        card_group_id: cardGroupId,
        number,
        exp_month: expMonth,
        exp_year: expYear,
        cvc,
        priority: input.priority ?? remote.priority ?? 100,
        max_success_count: input.max_success_count ?? input.maxSuccessCount ?? 1,
        provider,
        provider_card_id: remoteId,
        auto_unfreeze_before_use: input.auto_unfreeze_before_use ?? input.autoUnfreezeBeforeUse ?? 0,
        auto_freeze_after_success: input.auto_freeze_after_success ?? input.autoFreezeAfterSuccess ?? 0,
        auto_freeze_after_failure: input.auto_freeze_after_failure ?? input.autoFreezeAfterFailure ?? 0,
        status: input.status ?? "enabled",
        note: String(input.note_prefix ?? input.notePrefix ?? provider).trim()
          ? `${String(input.note_prefix ?? input.notePrefix ?? provider).trim()} ${remoteId}`.trim()
          : remoteId,
      }, now);
      imported.push({
        id,
        provider,
        provider_card_id: remoteId,
        masked_number: this.getCardById(id).masked_number,
      });
    }
    return {
      provider,
      imported,
      skipped,
      imported_count: imported.length,
      skipped_count: skipped.length,
    };
  }

  getQueueSettings() {
    return createQueueSettings(this.getSystemJson("queue.settings", {
      status: QueueStatus.RUNNING,
      global_concurrency: 1,
      auto_pause_failure_count: 0,
      failure_count: 0,
    }));
  }

  setQueueSettings(input = {}, adminId = 1, now = nowSeconds()) {
    const current = this.getQueueSettings();
    const next = createQueueSettings({
      status: input.status ?? current.status,
      global_concurrency: input.global_concurrency ?? input.globalConcurrency ?? current.global_concurrency,
      auto_pause_failure_count: input.auto_pause_failure_count
        ?? input.autoPauseFailureCount
        ?? (input.pause_on_order_failure !== undefined || input.pauseOnOrderFailure !== undefined
          ? ((input.pause_on_order_failure ?? input.pauseOnOrderFailure) ? 1 : 0)
          : current.auto_pause_failure_count),
      failure_count: input.failure_count ?? input.failureCount ?? current.failure_count,
    });
    this.setSystemJson("queue.settings", next, adminId, now);
    return next;
  }

  pauseQueue(adminId = 1, now = nowSeconds()) {
    return this.setQueueSettings({ status: QueueStatus.PAUSED }, adminId, now);
  }

  resumeQueue(adminId = 1, now = nowSeconds()) {
    return this.setQueueSettings({ status: QueueStatus.RUNNING, failure_count: 0 }, adminId, now);
  }

  addQueueFailureCount(count = 1, adminId = 1, now = nowSeconds()) {
    const current = this.getQueueSettings();
    return this.setQueueSettings({ failure_count: current.failure_count + Math.max(0, Number(count) || 0) }, adminId, now);
  }

  orderCountsByStatus() {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS n
      FROM orders
      WHERE deleted_at = 0
      GROUP BY status
    `).all();
    return Object.fromEntries(rows.map((row) => [row.status, row.n]));
  }

  orderSuccessStats(now = nowSeconds()) {
    const today = new Date(Number(now) * 1000);
    today.setHours(0, 0, 0, 0);
    const todayStart = Math.floor(today.getTime() / 1000);
    const one = (sql, ...params) => Number(this.db.prepare(sql).get(...params)?.n ?? 0);
    return {
      history_success: one(
        "SELECT COUNT(*) AS n FROM orders WHERE status = ? AND deleted_at = 0",
        OrderStatus.SUCCEEDED,
      ),
      today_success: one(
        "SELECT COUNT(*) AS n FROM orders WHERE status = ? AND deleted_at = 0 AND finished_at >= ?",
        OrderStatus.SUCCEEDED,
        todayStart,
      ),
      today_failed: one(
        "SELECT COUNT(*) AS n FROM orders WHERE status = ? AND deleted_at = 0 AND finished_at >= ?",
        OrderStatus.FAILED,
        todayStart,
      ),
      today_start: todayStart,
    };
  }

  errorOrderStats(input = {}) {
    const to = Number(input.to ?? nowSeconds());
    const from = Number(input.from ?? (to - 86400));
    const row = this.db.prepare(`
      WITH problems AS (
        SELECT order_id, created_at
          FROM run_logs
         WHERE deleted_at = 0 AND LOWER(level) IN ('warn', 'error', 'fatal', 'failed', 'failure')
        UNION ALL
        SELECT order_id, CASE WHEN finished_at > 0 THEN finished_at ELSE created_at END
          FROM order_attempts
         WHERE error_code <> '' OR error_message <> ''
        UNION ALL
        SELECT id, CASE WHEN updated_at > 0 THEN updated_at ELSE created_at END
          FROM orders
         WHERE admin_error <> ''
      )
      SELECT COUNT(DISTINCT p.order_id) AS order_count, COUNT(*) AS entry_count
        FROM problems p
        JOIN orders o ON o.id = p.order_id
       WHERE o.deleted_at = 0 AND p.created_at >= ? AND p.created_at <= ?
    `).get(from, to);
    return {
      from,
      to,
      order_count: Number(row?.order_count ?? 0),
      entry_count: Number(row?.entry_count ?? 0),
    };
  }

  listErrorOrders(input = {}) {
    const to = Number(input.to ?? nowSeconds());
    const from = Number(input.from ?? (to - 86400));
    const limit = Math.max(1, Math.min(1000, Number(input.limit ?? 200)));
    return this.db.prepare(`
      WITH problems AS (
        SELECT order_id, created_at
          FROM run_logs
         WHERE deleted_at = 0 AND LOWER(level) IN ('warn', 'error', 'fatal', 'failed', 'failure')
        UNION ALL
        SELECT order_id, CASE WHEN finished_at > 0 THEN finished_at ELSE created_at END
          FROM order_attempts
         WHERE error_code <> '' OR error_message <> ''
        UNION ALL
        SELECT id, CASE WHEN updated_at > 0 THEN updated_at ELSE created_at END
          FROM orders
         WHERE admin_error <> ''
      )
      SELECT o.*, rc.code_display AS redeem_code,
             COUNT(*) AS problem_count, MAX(p.created_at) AS last_problem_at
        FROM problems p
        JOIN orders o ON o.id = p.order_id
        LEFT JOIN redeem_codes rc ON rc.id = o.redeem_code_id
       WHERE o.deleted_at = 0 AND p.created_at >= ? AND p.created_at <= ?
       GROUP BY o.id
       ORDER BY last_problem_at DESC, o.id DESC
       LIMIT ?
    `).all(from, to, limit);
  }

  listOrderProblemLogs(orderId, input = {}) {
    const to = Number(input.to ?? nowSeconds());
    const from = Number(input.from ?? 0);
    return this.db.prepare(`
      SELECT * FROM (
        SELECT 'run_log' AS source, id AS source_id, order_id, attempt_id,
               LOWER(level) AS level, stage, message, meta_json, created_at
          FROM run_logs
         WHERE order_id = ? AND deleted_at = 0
           AND LOWER(level) IN ('warn', 'error', 'fatal', 'failed', 'failure')
        UNION ALL
        SELECT 'attempt' AS source, id AS source_id, order_id, id AS attempt_id,
               'error' AS level, stage,
               TRIM(CASE WHEN error_code <> '' THEN error_code || ': ' ELSE '' END || error_message) AS message,
               '{}' AS meta_json,
               CASE WHEN finished_at > 0 THEN finished_at ELSE created_at END AS created_at
          FROM order_attempts
         WHERE order_id = ? AND (error_code <> '' OR error_message <> '')
        UNION ALL
        SELECT 'order' AS source, id AS source_id, id AS order_id, 0 AS attempt_id,
               'error' AS level, 'order' AS stage, admin_error AS message,
               '{}' AS meta_json,
               CASE WHEN updated_at > 0 THEN updated_at ELSE created_at END AS created_at
          FROM orders
         WHERE id = ? AND admin_error <> ''
      )
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC, source_id ASC
    `).all(Number(orderId), Number(orderId), Number(orderId), from, to);
  }

  queueSnapshot() {
    const settings = this.getQueueSettings();
    const counts = this.orderCountsByStatus();
    return {
      status: settings.status,
      concurrency: settings.global_concurrency,
      auto_pause_failure_count: settings.auto_pause_failure_count,
      failure_count: settings.failure_count,
      pause_on_order_failure: settings.pause_on_order_failure,
      queued: counts.queued ?? 0,
      running: counts.running ?? 0,
    };
  }

  listOrders(filter = {}) {
    const where = ["o.deleted_at = 0"];
    const params = [];
    if (filter.status) {
      where.push("o.status = ?");
      params.push(String(filter.status));
    }
    if (filter.plan_type || filter.planType) {
      where.push("o.plan_type = ?");
      params.push(normalizePlanType(filter.plan_type ?? filter.planType));
    }
    if (filter.q || filter.query || filter.order_no || filter.orderNo || filter.code) {
      const rawQuery = String(filter.q ?? filter.query ?? filter.order_no ?? filter.orderNo ?? filter.code ?? "").trim();
      if (rawQuery) {
        where.push("(o.order_no LIKE ? ESCAPE '\\' OR rc.code_display LIKE ? ESCAPE '\\')");
        const like = `%${escapeSqlLike(normalizeRedeemCode(rawQuery))}%`;
        params.push(like, like);
      }
    }
    const limit = filter.limit ? toInteger(filter.limit, 50, 1, 1000, "limit") : 0;
    const orderBy = filter.order === "queued"
      ? "ORDER BY o.queued_at ASC, o.id ASC"
      : "ORDER BY o.created_at DESC, o.id DESC";
    let sql = `
      SELECT o.*, rc.code_display AS redeem_code, rc.status AS redeem_code_status
      FROM orders o
      LEFT JOIN redeem_codes rc ON rc.id = o.redeem_code_id
      WHERE ${where.join(" AND ")}
      ${orderBy}
    `;
    if (limit > 0) {
      sql += " LIMIT ?";
      params.push(limit);
    }
    return this.db.prepare(sql).all(...params);
  }

  dispatchQueuedOrders(now = nowSeconds(), options = {}) {
    return runTransaction(this.db, () => {
      const settings = this.getQueueSettings();
      if (settings.status !== QueueStatus.RUNNING && options.ignorePaused !== true) return [];
      const running = this.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = ? AND deleted_at = 0").get(OrderStatus.RUNNING).n;
      const slots = Math.max(0, settings.global_concurrency - Number(running));
      if (slots <= 0) return [];
      const queued = this.db.prepare(`
        SELECT id
        FROM orders
        WHERE status = ? AND deleted_at = 0
        ORDER BY queued_at ASC, id ASC
        LIMIT ?
      `).all(OrderStatus.QUEUED, slots);
      for (const order of queued) {
        this.db.prepare(`
          UPDATE orders
             SET status = ?, started_at = CASE WHEN started_at = 0 THEN ? ELSE started_at END,
                 updated_at = ?
           WHERE id = ?
        `).run(OrderStatus.RUNNING, now, now, order.id);
      }
      return queued.map((order) => this.getOrderById(order.id));
    });
  }

  requeueOrder(orderId, now = nowSeconds()) {
    return runTransaction(this.db, () => {
      const order = this.getOrderById(orderId);
      if (order.status === OrderStatus.SUCCEEDED) {
        throw new PlatformStoreError("ORDER_ALREADY_SUCCEEDED", "Payment has already been confirmed; the order cannot be requeued");
      }
      const codeUpdate = this.db.prepare(`
        UPDATE redeem_codes
           SET status = ?, locked_order_id = ?, locked_at = ?,
               unavailable_at = 0, unavailable_reason = ''
         WHERE id = ?
           AND used_order_id = 0
           AND (
             locked_order_id = ?
             OR (locked_order_id = 0 AND status = ?)
           )
      `).run(RedeemStatus.LOCKED, order.id, now, order.redeem_code_id, order.id, RedeemStatus.UNUSED);
      if (Number(codeUpdate.changes) !== 1) {
        throw new PlatformStoreError(
          "REDEEM_CODE_OWNERSHIP_CONFLICT",
          "The redeem code is owned by another order and cannot be requeued",
        );
      }
      this.db.prepare(`
        UPDATE orders
           SET status = ?, queued_at = ?, updated_at = ?,
               public_message = '', admin_error = ''
         WHERE id = ?
      `).run(OrderStatus.QUEUED, now, now, order.id);
      return {
        order: this.getOrderById(order.id),
        redeemCode: this.getRedeemCodeById(order.redeem_code_id),
      };
    });
  }

  terminateOrder(orderId, reason = "terminated_by_admin", now = nowSeconds()) {
    return this.markOrderFailedAndReleaseCode(orderId, {
      public_message: "",
      admin_error: reason,
    }, now);
  }

  resolveInterruptedOrder(orderId, action, now = nowSeconds()) {
    const normalizedAction = String(action ?? "").trim();
    const current = this.getOrderById(orderId);
    if (current.status === OrderStatus.SUCCEEDED) {
      throw new PlatformStoreError("ORDER_ALREADY_SUCCEEDED", "Payment has already been confirmed; the order cannot be changed");
    }
    if (normalizedAction === "return" || normalizedAction === "return_code") {
      return this.markOrderFailedAndReleaseCode(orderId, {
        public_message: "",
        admin_error: "interrupted_returned_by_admin",
      }, now);
    }
    if (normalizedAction === "mark_success" || normalizedAction === "success") {
      return this.markOrderSucceeded(orderId, now);
    }
    if (normalizedAction === "requeue") {
      return this.requeueOrder(orderId, now);
    }
    if (normalizedAction === "discard") {
      return runTransaction(this.db, () => {
        const order = this.getOrderById(orderId);
        const codeUpdate = this.db.prepare(`
          UPDATE redeem_codes
             SET status = ?, locked_order_id = ?, locked_at = ?
           WHERE id = ?
             AND used_order_id = 0
             AND (locked_order_id = ? OR (locked_order_id = 0 AND status = ?))
        `).run(RedeemStatus.DISABLED, order.id, now, order.redeem_code_id, order.id, RedeemStatus.UNUSED);
        if (Number(codeUpdate.changes) !== 1) {
          throw new PlatformStoreError(
            "REDEEM_CODE_OWNERSHIP_CONFLICT",
            "The redeem code is owned by another order and cannot be discarded",
          );
        }
        this.db.prepare(`
          UPDATE orders
             SET status = ?, admin_error = ?, finished_at = CASE WHEN finished_at = 0 THEN ? ELSE finished_at END,
                 updated_at = ?
           WHERE id = ?
        `).run(OrderStatus.FAILED, "interrupted_discarded_by_admin", now, now, order.id);
        return {
          order: this.getOrderById(order.id),
          redeemCode: this.getRedeemCodeById(order.redeem_code_id),
        };
      });
    }
    throw new Error(`unsupported interrupted action: ${normalizedAction}`);
  }

  markOrderRunning(orderId, now = nowSeconds()) {
    const order = this.getOrderById(orderId);
    if (order.status === OrderStatus.SUCCEEDED) {
      throw new PlatformStoreError("ORDER_ALREADY_SUCCEEDED", "Payment has already been confirmed; the order cannot be started again");
    }
    this.db.prepare(`
      UPDATE orders
         SET status = ?, started_at = CASE WHEN started_at = 0 THEN ? ELSE started_at END,
             updated_at = ?
       WHERE id = ?
    `).run(OrderStatus.RUNNING, now, now, Number(orderId));
    return this.getOrderById(orderId);
  }

  markOrderSucceeded(orderId, now = nowSeconds()) {
    return runTransaction(this.db, () => {
      const order = this.getOrderById(orderId);
      if (order.status === OrderStatus.SUCCEEDED) {
        return {
          order,
          redeemCode: this.getRedeemCodeById(order.redeem_code_id),
        };
      }
      const codeUpdate = this.db.prepare(`
        UPDATE redeem_codes
           SET status = ?, used_order_id = ?, used_at = ?,
               locked_order_id = 0, locked_at = 0,
               unavailable_at = 0, unavailable_reason = ''
         WHERE id = ?
           AND (
             locked_order_id = ?
             OR used_order_id = ?
             OR (locked_order_id = 0 AND used_order_id = 0 AND status = ?)
           )
      `).run(RedeemStatus.USED, order.id, now, order.redeem_code_id, order.id, order.id, RedeemStatus.UNUSED);
      if (Number(codeUpdate.changes) !== 1) {
        throw new PlatformStoreError(
          "REDEEM_CODE_OWNERSHIP_CONFLICT",
          "The redeem code is owned by another order and cannot be marked used",
        );
      }
      this.db.prepare(`
        UPDATE orders
           SET status = ?, finished_at = CASE WHEN finished_at = 0 THEN ? ELSE finished_at END,
               updated_at = ?
         WHERE id = ?
      `).run(OrderStatus.SUCCEEDED, now, now, order.id);
      return {
        order: this.getOrderById(order.id),
        redeemCode: this.getRedeemCodeById(order.redeem_code_id),
      };
    });
  }

  markOrderFailedAndReleaseCode(orderId, fields = {}, now = nowSeconds()) {
    return runTransaction(this.db, () => {
      const order = this.getOrderById(orderId);
      if (order.status === OrderStatus.SUCCEEDED) {
        throw new PlatformStoreError("ORDER_ALREADY_SUCCEEDED", "Payment has already been confirmed; the order cannot be changed to failed");
      }
      const configuredPlan = this.getPlanConfig(order.plan_type);
      const hasExplicitLockSetting = Object.hasOwn(fields, "lock_redeem_code_on_failure") || Object.hasOwn(fields, "lockRedeemCodeOnFailure");
      const lockSetting = hasExplicitLockSetting
        ? (fields.lock_redeem_code_on_failure ?? fields.lockRedeemCodeOnFailure)
        : configuredPlan.lock_redeem_code_on_failure;
      const lockCode = boolInt(order.lock_redeem_code_on_failure) === 1 || boolInt(lockSetting) === 1;
      const codeStatus = lockCode ? RedeemStatus.UNAVAILABLE : RedeemStatus.UNUSED;
      const unavailableReason = String(fields.unavailable_reason ?? fields.unavailableReason ?? "充值失败后按套餐设置锁定兑换码");
      const codeUpdate = this.db.prepare(`
        UPDATE redeem_codes
           SET status = ?,
               locked_order_id = CASE WHEN ? THEN ? ELSE 0 END,
               locked_at = CASE WHEN ? THEN ? ELSE 0 END,
               unavailable_at = CASE WHEN ? THEN ? ELSE 0 END,
               unavailable_reason = CASE WHEN ? THEN ? ELSE '' END
         WHERE id = ?
           AND used_order_id = 0
           AND (
             locked_order_id = ?
             OR (locked_order_id = 0 AND status = ?)
           )
      `).run(
        codeStatus,
        lockCode ? 1 : 0,
        order.id,
        lockCode ? 1 : 0,
        now,
        lockCode ? 1 : 0,
        lockCode ? now : 0,
        lockCode ? 1 : 0,
        lockCode ? unavailableReason : "",
        order.redeem_code_id,
        order.id,
        RedeemStatus.UNUSED,
      );
      if (Number(codeUpdate.changes) !== 1) {
        throw new PlatformStoreError(
          "REDEEM_CODE_OWNERSHIP_CONFLICT",
          "The redeem code is owned by another order and cannot be released",
        );
      }
      this.db.prepare(`
        UPDATE orders
           SET status = ?, public_message = ?, admin_error = ?,
               finished_at = CASE WHEN finished_at = 0 THEN ? ELSE finished_at END,
               updated_at = ?
         WHERE id = ?
      `).run(
        OrderStatus.FAILED,
        String(fields.public_message ?? fields.publicMessage ?? ""),
        String(fields.admin_error ?? fields.adminError ?? ""),
        now,
        now,
        order.id,
      );
      return {
        order: this.getOrderById(order.id),
        redeemCode: this.getRedeemCodeById(order.redeem_code_id),
      };
    });
  }

  recoverRunningOrders(reason = "process_recovered", now = nowSeconds()) {
    return runTransaction(this.db, () => {
      const runningOrders = this.db.prepare("SELECT id, redeem_code_id FROM orders WHERE status = ?").all(OrderStatus.RUNNING);
      for (const order of runningOrders) {
        this.db.prepare(`
          UPDATE orders
             SET status = ?, admin_error = ?, updated_at = ?
           WHERE id = ?
        `).run(OrderStatus.INTERRUPTED_REVIEW, reason, now, order.id);
        this.db.prepare(`
          UPDATE redeem_codes
             SET status = ?, unavailable_at = ?, unavailable_reason = ?
           WHERE id = ? AND status = ?
        `).run(RedeemStatus.UNAVAILABLE, now, reason, order.redeem_code_id, RedeemStatus.LOCKED);
      }
      return runningOrders.length;
    });
  }

  dashboardSnapshot() {
    const countByStatus = (table) => {
      const rows = this.db.prepare(`
        SELECT status, COUNT(*) AS n
        FROM ${table}
        WHERE deleted_at = 0
        GROUP BY status
      `).all();
      return Object.fromEntries(rows.map((row) => [row.status, row.n]));
    };
    return {
      queue: this.queueSnapshot(),
      orders: countByStatus("orders"),
      order_stats: this.orderSuccessStats(),
      error_stats: this.errorOrderStats(),
      redeem_codes: countByStatus("redeem_codes"),
      cards: countByStatus("cards"),
      queued_orders: this.listOrders({ status: OrderStatus.QUEUED, order: "queued", limit: 20 }),
      recent_orders: this.listOrders({ limit: 8 }),
      recent_logs: this.listRecentRunLogs(80),
    };
  }

  insertWebhookEvent(input = {}, now = nowSeconds()) {
    const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO webhook_events(
        provider, event_id, event_type, event_category, event_time, merchant_id,
        request_no, provider_card_id, payload_json, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(input.provider ?? "kimoox"),
      String(input.event_id ?? input.eventId ?? payload.eventId ?? ""),
      String(input.event_type ?? input.eventType ?? payload.eventType ?? ""),
      String(payload.eventCategory ?? ""),
      String(payload.eventTime ?? ""),
      String(payload.merchantId ?? ""),
      String(data.requestNo ?? data.request_no ?? ""),
      String(data.cardId ?? data.providerCardId ?? ""),
      JSON.stringify(payload),
      Number(now),
    );
    const row = this.db.prepare("SELECT * FROM webhook_events WHERE provider = ? AND event_id = ?")
      .get(String(input.provider ?? "kimoox"), String(input.event_id ?? input.eventId ?? payload.eventId ?? ""));
    return { inserted: Number(result.changes) > 0, event: row };
  }

  listWebhookEvents(input = {}) {
    const provider = String(input.provider ?? "").trim();
    const requestNo = String(input.request_no ?? input.requestNo ?? "").trim();
    const providerCardId = String(input.provider_card_id ?? input.providerCardId ?? "").trim();
    const limit = Math.max(1, Math.min(1000, Number(input.limit ?? 100)));
    const where = [];
    const params = [];
    if (provider) {
      where.push("provider = ?");
      params.push(provider);
    }
    if (requestNo) {
      where.push("request_no = ?");
      params.push(requestNo);
    }
    if (providerCardId) {
      where.push("provider_card_id = ?");
      params.push(providerCardId);
    }
    params.push(limit);
    return this.db.prepare(`
      SELECT *
      FROM webhook_events
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
      LIMIT ?
    `).all(...params);
  }

  findOrderByExternalRequestNo(requestNo) {
    const value = String(requestNo ?? "").trim();
    if (!value) return null;
    const row = this.db.prepare(`
      SELECT o.*
        FROM run_logs rl
        JOIN orders o ON o.id = rl.order_id
       WHERE rl.deleted_at = 0 AND rl.meta_json LIKE ?
       ORDER BY rl.id DESC
       LIMIT 1
    `).get(`%${value}%`);
    if (row) return row;
    return this.db.prepare(`
      SELECT * FROM orders
       WHERE ? LIKE '%' || order_no || '%'
       ORDER BY id DESC LIMIT 1
    `).get(value) ?? null;
  }

  insertAuditLog(audit) {
    const result = this.db.prepare(`
      INSERT INTO audit_logs(
        admin_id, action, target_type, target_id, ip, user_agent,
        before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(audit.admin_id),
      String(audit.action),
      String(audit.target_type),
      String(audit.target_id ?? ""),
      String(audit.ip ?? ""),
      String(audit.user_agent ?? ""),
      String(audit.before_json ?? "{}"),
      String(audit.after_json ?? "{}"),
      Number(audit.created_at ?? nowSeconds()),
    );
    return Number(result.lastInsertRowid);
  }

  listAuditLogs() {
    return this.db.prepare("SELECT * FROM audit_logs ORDER BY id ASC").all();
  }
}

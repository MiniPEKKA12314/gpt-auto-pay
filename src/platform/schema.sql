PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  last_login_at REAL DEFAULT 0,
  disabled_at REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  created_at REAL NOT NULL,
  expires_at REAL NOT NULL,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  FOREIGN KEY(admin_id) REFERENCES admin_users(id)
);

CREATE TABLE IF NOT EXISTS redeem_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT DEFAULT '',
  channel_enabled INTEGER NOT NULL DEFAULT 0,
  channel TEXT DEFAULT '',
  created_by INTEGER NOT NULL,
  created_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  code_display TEXT NOT NULL,
  plan_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unused',
  locked_order_id INTEGER DEFAULT 0,
  locked_at REAL DEFAULT 0,
  used_order_id INTEGER DEFAULT 0,
  used_at REAL DEFAULT 0,
  unavailable_at REAL DEFAULT 0,
  unavailable_reason TEXT DEFAULT '',
  disabled_at REAL DEFAULT 0,
  disabled_by INTEGER DEFAULT 0,
  created_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(batch_id) REFERENCES redeem_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_redeem_codes_status ON redeem_codes(status);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_batch ON redeem_codes(batch_id);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_plan ON redeem_codes(plan_type);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_locked_order ON redeem_codes(locked_order_id);

CREATE TABLE IF NOT EXISTS plan_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  payment_country TEXT DEFAULT '',
  payment_currency TEXT DEFAULT '',
  checkout_template_key TEXT DEFAULT '',
  checkout_proxy_group_id INTEGER DEFAULT 0,
  direct_card_proxy_group_id INTEGER DEFAULT 0,
  billing_group_id INTEGER DEFAULT 0,
  failure_message TEXT DEFAULT '',
  checkout_max_proxy_attempts INTEGER NOT NULL DEFAULT 4,
  max_proxy_attempts_per_card INTEGER NOT NULL DEFAULT 4,
  allow_card_switch INTEGER NOT NULL DEFAULT 0,
  max_card_switches INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_card_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_type TEXT NOT NULL,
  card_group_id INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS card_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_groups_active_name
ON card_groups(name)
WHERE deleted_at = 0;

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_group_id INTEGER NOT NULL,
  encrypted_number TEXT NOT NULL,
  encrypted_exp_month TEXT NOT NULL,
  encrypted_exp_year TEXT NOT NULL,
  encrypted_cvc TEXT NOT NULL,
  masked_number TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  max_success_count INTEGER NOT NULL DEFAULT 1,
  success_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled',
  note TEXT DEFAULT '',
  last_used_at REAL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(card_group_id) REFERENCES card_groups(id)
);

CREATE INDEX IF NOT EXISTS idx_cards_group_status ON cards(card_group_id, status);
CREATE INDEX IF NOT EXISTS idx_cards_priority ON cards(priority, last_used_at);

CREATE TABLE IF NOT EXISTS billing_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_groups_active_name
ON billing_groups(name)
WHERE deleted_at = 0;

CREATE TABLE IF NOT EXISTS billing_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billing_group_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  state TEXT DEFAULT '',
  city TEXT NOT NULL,
  line1 TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'enabled',
  note TEXT DEFAULT '',
  last_used_at REAL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(billing_group_id) REFERENCES billing_groups(id)
);

CREATE TABLE IF NOT EXISTS proxy_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_groups_active_name
ON proxy_groups(name)
WHERE deleted_at = 0;

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  redeem_code_id INTEGER NOT NULL,
  plan_type TEXT NOT NULL,
  status TEXT NOT NULL,
  user_ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  public_message TEXT DEFAULT '',
  admin_error TEXT DEFAULT '',
  queued_at REAL DEFAULT 0,
  started_at REAL DEFAULT 0,
  finished_at REAL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(redeem_code_id) REFERENCES redeem_codes(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_status_queue ON orders(status, queued_at);

CREATE TABLE IF NOT EXISTS order_runtime_secrets (
  order_id INTEGER PRIMARY KEY,
  encrypted_access_token TEXT DEFAULT '',
  encrypted_session_token TEXT DEFAULT '',
  session_cookie_name TEXT DEFAULT '__Secure-next-auth.session-token',
  checkout_input TEXT DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS manual_order_options (
  order_id INTEGER PRIMARY KEY,
  card_group_id INTEGER NOT NULL DEFAULT 0,
  card_id INTEGER NOT NULL DEFAULT 0,
  billing_group_id INTEGER NOT NULL DEFAULT 0,
  billing_address_id INTEGER NOT NULL DEFAULT 0,
  checkout_proxy_group_id INTEGER NOT NULL DEFAULT 0,
  direct_card_proxy_group_id INTEGER NOT NULL DEFAULT 0,
  account_label TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(card_group_id) REFERENCES card_groups(id),
  FOREIGN KEY(card_id) REFERENCES cards(id),
  FOREIGN KEY(billing_group_id) REFERENCES billing_groups(id),
  FOREIGN KEY(billing_address_id) REFERENCES billing_addresses(id)
);

CREATE TABLE IF NOT EXISTS order_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL,
  card_id INTEGER DEFAULT 0,
  billing_address_id INTEGER DEFAULT 0,
  checkout_proxy TEXT DEFAULT '',
  direct_card_proxy TEXT DEFAULT '',
  checkout_proxy_session TEXT DEFAULT '',
  direct_card_proxy_session TEXT DEFAULT '',
  status TEXT NOT NULL,
  stage TEXT DEFAULT '',
  error_code TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  started_at REAL DEFAULT 0,
  finished_at REAL DEFAULT 0,
  created_at REAL NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  attempt_id INTEGER DEFAULT 0,
  level TEXT NOT NULL,
  stage TEXT DEFAULT '',
  message TEXT NOT NULL,
  meta_json TEXT DEFAULT '{}',
  created_at REAL NOT NULL,
  deleted_at REAL DEFAULT 0,
  deleted_by INTEGER DEFAULT 0,
  delete_reason TEXT DEFAULT '',
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  before_json TEXT DEFAULT '{}',
  after_json TEXT DEFAULT '{}',
  created_at REAL NOT NULL,
  FOREIGN KEY(admin_id) REFERENCES admin_users(id)
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at REAL NOT NULL,
  updated_by INTEGER DEFAULT 0
);

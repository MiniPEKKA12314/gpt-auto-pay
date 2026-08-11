import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("platform schema contains first-phase domain tables", async () => {
  const schema = await readFile(new URL("../../src/platform/schema.sql", import.meta.url), "utf8");
  for (const table of [
    "admin_users",
    "redeem_batches",
    "redeem_codes",
    "plan_configs",
    "cards",
    "billing_addresses",
    "orders",
    "manual_order_options",
    "order_attempts",
    "run_logs",
    "audit_logs",
    "system_settings",
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
});

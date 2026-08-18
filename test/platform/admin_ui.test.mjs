import assert from "node:assert/strict";
import test from "node:test";

import { renderAdminUi } from "../../src/platform/admin_ui.mjs";

test("admin overview renders a standard error metric with a separate details action", () => {
  const html = renderAdminUi();

  assert.match(html, /class="metric overview-error-card"/);
  assert.match(html, /<button id="errorCenterBtn" type="button">详情<\/button>/);
  assert.match(html, /id="metricErrorOrders" class="error-count"/);
  assert.doesNotMatch(html, /<button id="errorCenterBtn"[^>]*class="metric"/);
});

test("admin error detail output uses the dedicated red log style", () => {
  const html = renderAdminUi();

  assert.match(html, /<pre id="errorOrderLogsOutput" class="error-log-output"/);
  assert.match(html, /pre\.error-log-output\s*\{[\s\S]*?color:\s*#ff6b6b;/);
});

test("admin overview refresh tolerates temporarily missing responsive nodes", () => {
  const html = renderAdminUi();

  assert.match(html, /function setTextContent\(id, value\)/);
  assert.match(html, /function setInnerHtml\(id, value\)/);
  assert.match(html, /setTextContent\("metricErrorOrders"/);
  assert.match(html, /setInnerHtml\("queuedOrdersBody"/);
  assert.doesNotMatch(html, /\$\("metricErrorOrders"\)\.textContent\s*=/);
});

test("admin queue concurrency input has a visible label", () => {
  const html = renderAdminUi();

  assert.match(html, /<label style="margin:0">并发数 <input id="queueConcurrency"[^>]*aria-label="并发数"/);
});

test("admin realtime refresh does not reload an opened order detail", () => {
  const html = renderAdminUi();

  assert.doesNotMatch(html, /tab === "overview"[^\n]*showOrderDetails\(state\.openOrderDetailId/);
  assert.doesNotMatch(html, /tab === "orders"[^\n]*showOrderDetails\(state\.openOrderDetailId/);
});

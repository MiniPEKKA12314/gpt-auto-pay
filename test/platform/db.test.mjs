import assert from "node:assert/strict";
import test from "node:test";

import { OrderStatus, RedeemStatus } from "../../src/platform/constants.mjs";
import { openPlatformDb, PlatformStore, PlatformStoreError } from "../../src/platform/db.mjs";

function withStore(fn) {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

test("store creates redeem batches and codes in SQLite", () => withStore((store) => {
  const result = store.createRedeemBatchWithCodes({
    name: "plus batch",
    plan_type: "plus",
    quantity: 2,
    note: "local test",
    created_by: 1,
    codeFactory: (index) => `PLUS-LOCAL-${index}`,
  }, 10);

  assert.equal(result.codeIds.length, 2);
  assert.deepEqual(
    store.listRedeemCodes({ status: RedeemStatus.UNUSED }).map((row) => row.code_display),
    ["PLUS-LOCAL-0", "PLUS-LOCAL-1"],
  );
  assert.equal(store.getRedeemCodeByDisplay(" plus-local-0 ").plan_type, "plus");
}));

test("store locks a code and creates a queued order atomically", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "go batch",
    plan_type: "go",
    quantity: 1,
    codeFactory: () => "GO-LOCK-1",
  }, 20);

  const { order, redeemCode } = store.lockCodeAndCreateOrder({
    code: "GO-LOCK-1",
    order_no: "ord_lock_1",
    user_ip: "127.0.0.1",
  }, 30);

  assert.equal(order.status, OrderStatus.QUEUED);
  assert.equal(order.queued_at, 30);
  assert.equal(order.plan_type, "go");
  assert.equal(redeemCode.status, RedeemStatus.LOCKED);
  assert.equal(redeemCode.locked_order_id, order.id);

  assert.throws(
    () => store.lockCodeAndCreateOrder({ code: "GO-LOCK-1", order_no: "ord_lock_2" }, 31),
    (error) => error instanceof PlatformStoreError && error.code === "REDEEM_CODE_NOT_UNUSED",
  );
}));

test("store encrypts order runtime credentials for checkout and direct-card execution", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "runtime batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-RUNTIME-1",
  }, 32);
  const { order } = store.lockCodeAndCreateOrder({ code: "PLUS-RUNTIME-1", order_no: "ord_runtime" }, 33);
  const saved = store.setOrderRuntimeSecrets(order.id, {
    accessToken: "access-token-secret",
    sessionToken: "session-token-secret",
    sessionCookieName: "__Secure-next-auth.session-token",
    checkoutInput: "oaics_runtime_demo",
  }, 34);

  assert.equal(saved.accessToken, "access-token-secret");
  assert.equal(saved.sessionToken, "session-token-secret");
  assert.equal(saved.checkoutInput, "oaics_runtime_demo");

  const publicRuntime = store.getOrderRuntimeSecrets(order.id);
  assert.equal(publicRuntime.has_access_token, true);
  assert.equal(publicRuntime.has_session_token, true);
  assert.equal(Object.hasOwn(publicRuntime, "accessToken"), false);

  assert.equal(store.setOrderRuntimeCheckoutInput(order.id, "oaics_updated", 35).checkoutInput, "oaics_updated");
  assert.equal(store.getOrderRuntimeSecrets(order.id, { includeSecret: true }).accessToken, "access-token-secret");
}));

test("store releases redeem code on failed order and marks used on success", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "plus batch",
    plan_type: "plus",
    quantity: 2,
    codeFactory: (index) => `PLUS-FLOW-${index}`,
  }, 40);

  const first = store.lockCodeAndCreateOrder({ code: "PLUS-FLOW-0", order_no: "ord_fail" }, 41);
  const failed = store.markOrderFailedAndReleaseCode(first.order.id, {
    public_message: "failed",
    admin_error: "all proxies failed",
  }, 42);
  assert.equal(failed.order.status, OrderStatus.FAILED);
  assert.equal(failed.order.public_message, "failed");
  assert.equal(failed.redeemCode.status, RedeemStatus.UNUSED);
  assert.equal(failed.redeemCode.locked_order_id, 0);

  const second = store.lockCodeAndCreateOrder({ code: "PLUS-FLOW-1", order_no: "ord_success" }, 43);
  store.markOrderRunning(second.order.id, 44);
  const succeeded = store.markOrderSucceeded(second.order.id, 45);
  assert.equal(succeeded.order.status, OrderStatus.SUCCEEDED);
  assert.equal(succeeded.order.finished_at, 45);
  assert.equal(succeeded.redeemCode.status, RedeemStatus.USED);
  assert.equal(succeeded.redeemCode.used_order_id, second.order.id);
}));

test("store recovers running orders to interrupted review and unavailable codes", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "recovery batch",
    plan_type: "pro20x",
    quantity: 1,
    codeFactory: () => "PRO20X-RECOVER-1",
  }, 50);

  const locked = store.lockCodeAndCreateOrder({
    code: "PRO20X-RECOVER-1",
    order_no: "ord_recover",
  }, 51);
  store.markOrderRunning(locked.order.id, 52);

  assert.equal(store.recoverRunningOrders("boot_recovery", 53), 1);
  assert.equal(store.getOrderById(locked.order.id).status, OrderStatus.INTERRUPTED_REVIEW);
  assert.equal(store.getRedeemCodeById(locked.redeemCode.id).status, RedeemStatus.UNAVAILABLE);
  assert.equal(store.getRedeemCodeById(locked.redeemCode.id).unavailable_reason, "boot_recovery");
}));

test("store manages encrypted cards and masked card lists", () => withStore((store) => {
  const groupId = store.createCardGroup({ name: "primary cards", note: "local" }, 60);
  const cardId = store.createCard({
    card_group_id: groupId,
    number: "4242424242421234",
    exp_month: "12",
    exp_year: "2030",
    cvc: "123",
    priority: 5,
    max_success_count: 10,
    provider: "vcc",
    provider_card_id: "remote-card-1",
    auto_unfreeze_before_use: true,
    auto_freeze_after_success: true,
    auto_freeze_after_failure: true,
    note: "first card",
  }, 61);

  const listed = store.listCards({ card_group_id: groupId });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].masked_number, "4242 **** **** 1234");
  assert.equal(Object.hasOwn(listed[0], "number"), false);

  const detail = store.getCardById(cardId, { includeSecret: true });
  assert.equal(detail.number, "4242424242421234");
  assert.equal(detail.exp_month, "12");
  assert.equal(detail.exp_year, "2030");
  assert.equal(detail.cvc, "123");
  assert.equal(detail.provider, "vcc");
  assert.equal(detail.provider_card_id, "remote-card-1");
  assert.equal(detail.auto_unfreeze_before_use, 1);
  assert.equal(detail.auto_freeze_after_success, 1);
  assert.equal(detail.auto_freeze_after_failure, 1);

  const updatedPolicy = store.updateCard(cardId, { auto_freeze_after_failure: false, provider_card_id: "remote-card-2" });
  assert.equal(updatedPolicy.provider_card_id, "remote-card-2");
  assert.equal(updatedPolicy.auto_freeze_after_failure, 0);

  assert.equal(store.incrementCardSuccessCount(cardId, 62).success_count, 1);
  assert.equal(store.disableCard(cardId).status, "disabled");
  assert.equal(store.restoreCard(cardId).status, "enabled");
  assert.equal(store.disableCard(cardId).status, "disabled");
  assert.ok(store.softDeleteCard(cardId, 1, "local").deleted_at > 0);
  assert.equal(store.listCards({ card_group_id: groupId }).length, 0);
  const restoredCard = store.restoreCard(cardId);
  assert.equal(restoredCard.deleted_at, 0);
  assert.equal(restoredCard.status, "enabled");
  assert.ok(store.softDeleteCardGroup(groupId, 1, "group removed").deleted_at > 0);
  assert.equal(store.listCardGroups().length, 0);
  assert.equal(store.listCards({ card_group_id: groupId }).length, 0);
  assert.ok(store.getCardById(cardId).deleted_at > 0);
  const recreatedGroupId = store.createCardGroup({ name: "primary cards", note: "new" }, 63);
  assert.notEqual(recreatedGroupId, groupId);
  assert.equal(store.listCardGroups().find((group) => group.id === recreatedGroupId).name, "primary cards");
  assert.throws(
    () => store.createCardGroup({ name: "primary cards" }, 64),
    /卡组名称已存在/,
  );
}));

test("store manages billing groups and billing addresses", () => withStore((store) => {
  const groupId = store.createBillingGroup({ name: "US addresses" }, 70);
  const addressId = store.createBillingAddress({
    billing_group_id: groupId,
    name: "Test User",
    country: "US",
    state: "CA",
    city: "Los Angeles",
    line1: "1 Test Ave",
    postal_code: "90001",
    priority: 3,
  }, 71);

  assert.equal(store.listBillingGroups()[0].stats.enabled, 1);
  assert.equal(store.listBillingAddresses({ billing_group_id: groupId })[0].city, "Los Angeles");
  assert.equal(store.updateBillingAddress(addressId, { city: "San Diego" }).city, "San Diego");
  assert.equal(store.disableBillingAddress(addressId).status, "disabled");
  assert.equal(store.restoreBillingAddress(addressId).status, "enabled");
  assert.equal(store.disableBillingAddress(addressId).status, "disabled");
  assert.ok(store.softDeleteBillingAddress(addressId, 1, "local").deleted_at > 0);
  assert.equal(store.listBillingAddresses({ billing_group_id: groupId }).length, 0);
  const restoredAddress = store.restoreBillingAddress(addressId);
  assert.equal(restoredAddress.deleted_at, 0);
  assert.equal(restoredAddress.status, "enabled");
  assert.ok(store.softDeleteBillingGroup(groupId, 1, "group removed").deleted_at > 0);
  assert.equal(store.listBillingGroups().length, 0);
  assert.equal(store.listBillingAddresses({ billing_group_id: groupId }).length, 0);
  assert.ok(store.getBillingAddressById(addressId).deleted_at > 0);
  const recreatedGroupId = store.createBillingGroup({ name: "US addresses" }, 73);
  assert.notEqual(recreatedGroupId, groupId);
  assert.equal(store.listBillingGroups().find((group) => group.id === recreatedGroupId).name, "US addresses");
  assert.throws(
    () => store.createBillingGroup({ name: "US addresses" }, 74),
    /账单组名称已存在/,
  );
}));

test("store manages proxy groups and static proxy lists", () => withStore((store) => {
  const groupId = store.createProxyGroup({
    name: "direct card proxies",
    kind: "direct_card",
    provider: "static",
    config: {
      proxies: [
        "https://user:pass@example.com:8443",
        "socks5://foo:bar@example.net:1080",
      ],
    },
    note: "local",
  }, 75);

  const listed = store.listProxyGroups({ kind: "direct_card" });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].config.proxies.length, 2);
  assert.equal(listed[0].config.proxies[0].redacted_url, "https://<user>:<pass>@example.com:8443");

  const updated = store.updateProxyGroup(groupId, {
    enabled: false,
    config: {
      proxies: [{ url: "socks5://a:b@example.org:1080", priority: 1 }],
    },
  }, 76);
  assert.equal(updated.enabled, 0);
  assert.equal(updated.config.proxies[0].priority, 1);

  assert.ok(store.softDeleteProxyGroup(groupId, 1, "local").deleted_at > 0);
  assert.equal(store.listProxyGroups().length, 0);
  const recreatedGroupId = store.createProxyGroup({
    name: "direct card proxies",
    kind: "shared",
    provider: "static",
    config: { proxies: [] },
  }, 77);
  assert.notEqual(recreatedGroupId, groupId);
  assert.equal(store.listProxyGroups().find((group) => group.id === recreatedGroupId).name, "direct card proxies");
  assert.throws(
    () => store.createProxyGroup({
      name: "direct card proxies",
      kind: "shared",
      provider: "static",
      config: { proxies: [] },
    }, 78),
    /代理组名称已存在/,
  );
}));

test("store manages plan configs and plan card group priorities", () => withStore((store) => {
  assert.equal(store.listPlanConfigs().length, 4);
  const firstGroup = store.createCardGroup({ name: "first" }, 80);
  const secondGroup = store.createCardGroup({ name: "second" }, 80);

  const updated = store.upsertPlanConfig({
    plan_type: "plus",
    display_name: "Plus",
    payment_country: "PH",
    payment_currency: "PHP",
    billing_group_id: 7,
    checkout_max_proxy_attempts: 5,
    max_proxy_attempts_per_card: 6,
    allow_card_switch: true,
    max_card_switches: 2,
  }, 81);
  assert.equal(updated.payment_country, "PH");
  assert.equal(updated.payment_currency, "PHP");
  assert.equal(updated.billing_group_id, 7);
  assert.equal(updated.checkout_max_proxy_attempts, 5);
  assert.equal(updated.allow_card_switch, 1);
  assert.equal(updated.max_card_switches, 2);
  store.ensureDefaultPlanConfigs(81.5);
  const preserved = store.getPlanConfig("plus");
  assert.equal(preserved.payment_country, "PH");
  assert.equal(preserved.payment_currency, "PHP");
  assert.equal(preserved.billing_group_id, 7);
  assert.equal(preserved.checkout_max_proxy_attempts, 5);
  assert.equal(preserved.max_proxy_attempts_per_card, 6);
  assert.equal(preserved.allow_card_switch, 1);
  assert.equal(preserved.max_card_switches, 2);

  const plan = store.setPlanCardGroups("plus", [
    { card_group_id: firstGroup, priority: 20 },
    { card_group_id: secondGroup, priority: 10 },
  ], 82);
  assert.deepEqual(
    plan.card_groups.map((group) => [group.card_group_id, group.priority, group.name]),
    [[secondGroup, 10, "second"], [firstGroup, 20, "first"]],
  );
  assert.equal(store.getPlanConfig("plus", { includeCardGroups: true }).card_groups.length, 2);
}));

test("store controls queue settings, dispatch, termination, and interrupted resolution", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "queue batch",
    plan_type: "plus",
    quantity: 3,
    codeFactory: (index) => `PLUS-QUEUE-${index}`,
  }, 90);
  const first = store.lockCodeAndCreateOrder({ code: "PLUS-QUEUE-0", order_no: "ord_q0" }, 91);
  const second = store.lockCodeAndCreateOrder({ code: "PLUS-QUEUE-1", order_no: "ord_q1" }, 92);
  store.lockCodeAndCreateOrder({ code: "PLUS-QUEUE-2", order_no: "ord_q2" }, 93);

  assert.equal(store.setQueueSettings({ global_concurrency: 2 }, 1, 94).global_concurrency, 2);
  assert.equal(store.pauseQueue(1, 95).status, "paused");
  assert.equal(store.dispatchQueuedOrders(96).length, 0);
  assert.equal(store.resumeQueue(1, 97).status, "running");
  assert.deepEqual(store.dispatchQueuedOrders(98).map((order) => order.order_no), ["ord_q0", "ord_q1"]);
  assert.equal(store.queueSnapshot().running, 2);
  assert.equal(store.queueSnapshot().queued, 1);

  const terminated = store.terminateOrder(first.order.id, "admin stop", 99);
  assert.equal(terminated.order.status, "interrupted_review");
  assert.equal(terminated.redeemCode.status, "unavailable");

  store.recoverRunningOrders("boot", 100);
  assert.equal(store.getOrderById(second.order.id).status, "interrupted_review");
  const returned = store.resolveInterruptedOrder(second.order.id, "return_code", 101);
  assert.equal(returned.order.status, "failed");
  assert.equal(returned.redeemCode.status, "unused");
}));

test("failed order can keep its redeem code unavailable when the plan enables locking", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "locked failure batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-LOCK-FAILURE",
  }, 110);
  const locked = store.lockCodeAndCreateOrder({ code: "PLUS-LOCK-FAILURE", order_no: "ord_lock_failure" }, 111);
  const failed = store.markOrderFailedAndReleaseCode(locked.order.id, {
    admin_error: "payment uncertain",
    lock_redeem_code_on_failure: true,
  }, 112);
  assert.equal(failed.order.status, OrderStatus.FAILED);
  assert.equal(failed.redeemCode.status, RedeemStatus.UNAVAILABLE);
  assert.match(failed.redeemCode.unavailable_reason, /锁定兑换码/);
}));

test("failure locking applies to every failure route and succeeded orders are immutable", () => withStore((store) => {
  store.upsertPlanConfig({
    ...store.getPlanConfig("plus"),
    lock_redeem_code_on_failure: true,
  }, 120);
  store.createRedeemBatchWithCodes({
    name: "terminal order batch",
    plan_type: "plus",
    quantity: 2,
    codeFactory: (index) => `PLUS-TERMINAL-${index}`,
  }, 121);

  const failedOrder = store.lockCodeAndCreateOrder({ code: "PLUS-TERMINAL-0", order_no: "ord_terminal_failed" }, 122);
  assert.equal(failedOrder.order.lock_redeem_code_on_failure, 1);
  store.upsertPlanConfig({
    ...store.getPlanConfig("plus"),
    lock_redeem_code_on_failure: false,
  }, 122.5);
  const terminated = store.terminateOrder(failedOrder.order.id, "admin stop", 123);
  assert.equal(terminated.order.status, OrderStatus.FAILED);
  assert.equal(terminated.redeemCode.status, RedeemStatus.UNAVAILABLE);

  const successfulOrder = store.lockCodeAndCreateOrder({ code: "PLUS-TERMINAL-1", order_no: "ord_terminal_success" }, 124);
  const succeeded = store.markOrderSucceeded(successfulOrder.order.id, 125);
  assert.equal(succeeded.order.status, OrderStatus.SUCCEEDED);
  assert.equal(succeeded.redeemCode.status, RedeemStatus.USED);
  assert.throws(
    () => store.markOrderFailedAndReleaseCode(successfulOrder.order.id, { admin_error: "late cleanup failure" }, 126),
    /already been confirmed/,
  );
  assert.throws(
    () => store.requeueOrder(successfulOrder.order.id, 126),
    /already been confirmed/,
  );
}));

test("an old order cannot mutate a redeem code owned by a newer order", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "ownership batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-OWNERSHIP-1",
  }, 130);

  const oldOrder = store.lockCodeAndCreateOrder({ code: "PLUS-OWNERSHIP-1", order_no: "ord_old" }, 131);
  store.markOrderFailedAndReleaseCode(oldOrder.order.id, { admin_error: "first attempt failed" }, 132);
  const newOrder = store.lockCodeAndCreateOrder({ code: "PLUS-OWNERSHIP-1", order_no: "ord_new" }, 133);

  for (const mutate of [
    () => store.requeueOrder(oldOrder.order.id, 134),
    () => store.terminateOrder(oldOrder.order.id, "late terminate", 135),
    () => store.markOrderSucceeded(oldOrder.order.id, 136),
  ]) {
    assert.throws(
      mutate,
      (error) => error instanceof PlatformStoreError && error.code === "REDEEM_CODE_OWNERSHIP_CONFLICT",
    );
  }

  const code = store.getRedeemCodeByDisplay("PLUS-OWNERSHIP-1");
  assert.equal(code.status, RedeemStatus.LOCKED);
  assert.equal(code.locked_order_id, newOrder.order.id);
  assert.equal(store.getOrderById(newOrder.order.id).status, OrderStatus.QUEUED);
}));

test("failure-locked redeem codes retain their order lookup", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "query locked failure batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-QUERY-LOCKED",
  }, 140);
  const locked = store.lockCodeAndCreateOrder({ code: "PLUS-QUERY-LOCKED", order_no: "ord_query_locked" }, 141);
  const failed = store.markOrderFailedAndReleaseCode(locked.order.id, {
    admin_error: "uncertain payment",
    lock_redeem_code_on_failure: true,
  }, 142);

  assert.equal(failed.redeemCode.status, RedeemStatus.UNAVAILABLE);
  assert.equal(failed.redeemCode.locked_order_id, locked.order.id);
  assert.equal(store.getOrderForRedeemCodeDisplay("PLUS-QUERY-LOCKED").order_no, "ord_query_locked");
}));

test("error center groups warning and error records by order and time range", () => withStore((store) => {
  store.createRedeemBatchWithCodes({
    name: "error center batch",
    plan_type: "plus",
    quantity: 1,
    codeFactory: () => "PLUS-ERROR-CENTER",
  }, 150);
  const locked = store.lockCodeAndCreateOrder({ code: "PLUS-ERROR-CENTER", order_no: "ord_error_center" }, 151);
  store.addRunLog({ order_id: locked.order.id, level: "info", stage: "start", message: "normal" }, 152);
  store.addRunLog({ order_id: locked.order.id, level: "warn", stage: "proxy", message: "proxy slow" }, 153);
  store.addRunLog({ order_id: locked.order.id, level: "error", stage: "payment", message: "payment failed" }, 154);

  const stats = store.errorOrderStats({ from: 150, to: 160 });
  assert.equal(stats.order_count, 1);
  assert.equal(stats.entry_count, 2);
  assert.equal(store.listErrorOrders({ from: 150, to: 160 })[0].order_no, "ord_error_center");
  assert.deepEqual(
    store.listOrderProblemLogs(locked.order.id, { from: 150, to: 160 }).map((row) => row.message),
    ["proxy slow", "payment failed"],
  );
}));

test("touching selected cards and billing addresses completes equal-priority rotation", () => withStore((store) => {
  const cardGroupId = store.createCardGroup({ name: "rotation cards" }, 160);
  const firstCardId = store.createCard({
    card_group_id: cardGroupId,
    number: "4242424242424242",
    exp_month: "12",
    exp_year: "2030",
    cvc: "123",
    priority: 1,
  }, 161);
  const secondCardId = store.createCard({
    card_group_id: cardGroupId,
    number: "5555555555554444",
    exp_month: "12",
    exp_year: "2030",
    cvc: "123",
    priority: 1,
  }, 162);
  assert.equal(store.listCards({ card_group_id: cardGroupId })[0].id, firstCardId);
  store.touchCardLastUsed(firstCardId, 170);
  assert.equal(store.listCards({ card_group_id: cardGroupId })[0].id, secondCardId);

  const billingGroupId = store.createBillingGroup({ name: "rotation billing" }, 163);
  const firstAddressId = store.createBillingAddress({ billing_group_id: billingGroupId, name: "A", country: "US", city: "A", line1: "1 A", postal_code: "10001", priority: 1 }, 164);
  const secondAddressId = store.createBillingAddress({ billing_group_id: billingGroupId, name: "B", country: "US", city: "B", line1: "2 B", postal_code: "10002", priority: 1 }, 165);
  assert.equal(store.listBillingAddresses({ billing_group_id: billingGroupId })[0].id, firstAddressId);
  store.touchBillingAddressLastUsed(firstAddressId, 170);
  assert.equal(store.listBillingAddresses({ billing_group_id: billingGroupId })[0].id, secondAddressId);
}));

test("card and billing leases are exclusive and recoverable", () => withStore((store) => {
  const cardGroupId = store.createCardGroup({ name: "lease cards" }, 180);
  const cardId = store.createCard({
    card_group_id: cardGroupId,
    number: "4242424242424242",
    exp_month: "12",
    exp_year: "2030",
    cvc: "123",
  }, 181);
  const billingGroupId = store.createBillingGroup({ name: "lease billing" }, 182);
  const addressId = store.createBillingAddress({
    billing_group_id: billingGroupId,
    name: "Lease User",
    country: "US",
    city: "Austin",
    line1: "1 Lease Ave",
    postal_code: "78701",
  }, 183);

  assert.equal(store.acquireCardLease(cardId, 1001, 184), true);
  assert.equal(store.acquireCardLease(cardId, 1002, 185), false);
  assert.equal(store.acquireBillingAddressLease(addressId, 1001, 184), true);
  assert.equal(store.acquireBillingAddressLease(addressId, 1002, 185), false);
  assert.equal(store.listCards({ card_group_id: cardGroupId })[0].lease_order_id, 1001);
  assert.equal(store.listBillingAddresses({ billing_group_id: billingGroupId })[0].lease_order_id, 1001);

  store.releaseOrderResourceLeases(1001, 186);
  assert.equal(store.acquireCardLease(cardId, 1002, 187), true);
  assert.equal(store.acquireBillingAddressLease(addressId, 1002, 187), true);
}));

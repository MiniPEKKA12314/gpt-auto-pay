import assert from "node:assert/strict";
import test from "node:test";

import {
  exportRedeemCodes,
  generateRedeemCode,
  hashRedeemCode,
  lockRedeemCode,
  markRedeemCodeUnavailable,
  markRedeemCodeUsed,
  normalizeRedeemCode,
  releaseRedeemCode,
} from "../../src/platform/redeem.mjs";
import { RedeemStatus } from "../../src/platform/constants.mjs";

test("redeem codes use plan prefix and normalize input", () => {
  const code = generateRedeemCode({
    planType: "plus",
    entropy: Buffer.from("001122334455667788", "hex"),
  });
  assert.equal(code, "PLUS-0011-2233-4455-6677-88");
  assert.equal(normalizeRedeemCode(" plus-0011  "), "PLUS-0011");
  assert.equal(hashRedeemCode("plus-a"), hashRedeemCode(" PLUS-A "));
});

test("redeem code lifecycle locks, returns, and marks used", () => {
  const unused = {
    id: 1,
    status: RedeemStatus.UNUSED,
    code_display: "PLUS-ABCD",
    plan_type: "plus",
  };

  const locked = lockRedeemCode(unused, 101, 10);
  assert.equal(locked.status, RedeemStatus.LOCKED);
  assert.equal(locked.locked_order_id, 101);
  assert.equal(locked.locked_at, 10);
  assert.throws(() => lockRedeemCode(locked, 102), /requires status=unused/);

  const returned = releaseRedeemCode(locked, 20);
  assert.equal(returned.status, RedeemStatus.UNUSED);
  assert.equal(returned.locked_order_id, 0);
  assert.equal(returned.released_at, 20);

  const used = markRedeemCodeUsed(locked, 101, 30);
  assert.equal(used.status, RedeemStatus.USED);
  assert.equal(used.used_order_id, 101);
  assert.equal(used.used_at, 30);
});

test("locked redeem codes enter unavailable on runtime recovery", () => {
  const locked = {
    id: 1,
    status: RedeemStatus.LOCKED,
    locked_order_id: 101,
  };
  const unavailable = markRedeemCodeUnavailable(locked, "process_recovered", 40);
  assert.equal(unavailable.status, RedeemStatus.UNAVAILABLE);
  assert.equal(unavailable.unavailable_at, 40);
  assert.equal(unavailable.unavailable_reason, "process_recovered");
  assert.equal(releaseRedeemCode(unavailable).status, RedeemStatus.UNUSED);
  assert.equal(markRedeemCodeUsed(unavailable, 101).status, RedeemStatus.USED);
});

test("redeem export supports txt, csv, and json filters", () => {
  const records = [
    { id: 1, code_display: "PLUS-A", plan_type: "plus", status: "unused", batch_id: 7 },
    { id: 2, code_display: "GO-B", plan_type: "go", status: "used", batch_id: 7 },
    { id: 3, code_display: "PLUS-C", plan_type: "plus", status: "unused", batch_id: 8 },
  ];

  assert.equal(exportRedeemCodes(records, { format: "txt", status: "unused" }), "PLUS-A\nPLUS-C");
  assert.match(exportRedeemCodes(records, { format: "csv", planType: "go" }), /id,code_display,plan_type,status,batch_id\n2,GO-B,go,used,7/);
  assert.deepEqual(
    JSON.parse(exportRedeemCodes(records, { format: "json", batchId: 8 })).map((row) => row.id),
    [3],
  );
  assert.throws(() => exportRedeemCodes(records, { format: "xlsx" }), /unsupported export format/);
});

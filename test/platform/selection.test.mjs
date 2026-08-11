import assert from "node:assert/strict";
import test from "node:test";

import { CardStatus } from "../../src/platform/constants.mjs";
import { markSelected, selectBillingAddress, selectCard } from "../../src/platform/selection.mjs";

test("card selection uses plan group priority, card priority, and rotation", () => {
  const cards = [
    { id: 1, card_group_id: 1, status: "enabled", priority: 10, last_used_at: 50, success_count: 0, max_success_count: 10 },
    { id: 2, card_group_id: 1, status: "enabled", priority: 5, last_used_at: 100, success_count: 0, max_success_count: 10 },
    { id: 3, card_group_id: 2, status: "enabled", priority: 1, last_used_at: 0, success_count: 0, max_success_count: 10 },
  ];
  const groups = [
    { card_group_id: 1, priority: 20 },
    { card_group_id: 2, priority: 10 },
  ];
  assert.equal(selectCard(cards, groups).id, 3);

  const sameGroup = [{ card_group_id: 1, priority: 1 }];
  assert.equal(selectCard(cards, sameGroup).id, 2);

  const tied = [
    { id: 4, card_group_id: 1, status: "enabled", priority: 1, last_used_at: 20, success_count: 0, max_success_count: 10 },
    { id: 5, card_group_id: 1, status: "enabled", priority: 1, last_used_at: 10, success_count: 0, max_success_count: 10 },
  ];
  assert.equal(selectCard(tied, sameGroup).id, 5);
});

test("card selection skips standby, disabled, deleted, and exhausted cards", () => {
  const cards = [
    { id: 1, card_group_id: 1, status: CardStatus.STANDBY, priority: 1, success_count: 0, max_success_count: 10 },
    { id: 2, card_group_id: 1, status: CardStatus.DISABLED, priority: 1, success_count: 0, max_success_count: 10 },
    { id: 3, card_group_id: 1, status: CardStatus.ENABLED, priority: 1, success_count: 10, max_success_count: 10 },
    { id: 4, card_group_id: 1, status: CardStatus.ENABLED, priority: 2, success_count: 0, max_success_count: 10, deleted_at: 123 },
    { id: 5, card_group_id: 1, status: CardStatus.ENABLED, priority: 3, success_count: 0, max_success_count: 10 },
  ];
  assert.equal(selectCard(cards, [{ card_group_id: 1, priority: 1 }]).id, 5);
});

test("card selection can exclude already attempted cards", () => {
  const cards = [
    { id: 1, card_group_id: 1, status: CardStatus.ENABLED, priority: 1, last_used_at: 0, success_count: 0, max_success_count: 10 },
    { id: 2, card_group_id: 1, status: CardStatus.ENABLED, priority: 2, last_used_at: 0, success_count: 0, max_success_count: 10 },
    { id: 3, card_group_id: 1, status: CardStatus.ENABLED, priority: 3, last_used_at: 0, success_count: 0, max_success_count: 10 },
  ];
  assert.equal(selectCard(cards, [{ card_group_id: 1, priority: 1 }], { excludeCardIds: [1] }).id, 2);
  assert.equal(selectCard(cards, [{ card_group_id: 1, priority: 1 }], { excludeCardIds: [1, 2, 3] }), null);
});

test("billing address selection uses group priority and rotation", () => {
  const addresses = [
    { id: 1, billing_group_id: 1, status: "enabled", priority: 10, last_used_at: 1 },
    { id: 2, billing_group_id: 1, status: "enabled", priority: 5, last_used_at: 100 },
    { id: 3, billing_group_id: 1, status: "disabled", priority: 1, last_used_at: 0 },
    { id: 4, billing_group_id: 2, status: "enabled", priority: 1, last_used_at: 0 },
  ];
  assert.equal(selectBillingAddress(addresses, 1).id, 2);

  const tied = [
    { id: 5, billing_group_id: 1, status: "enabled", priority: 1, last_used_at: 20 },
    { id: 6, billing_group_id: 1, status: "enabled", priority: 1, last_used_at: 10 },
  ];
  assert.equal(selectBillingAddress(tied, 1).id, 6);
  assert.equal(selectBillingAddress(tied, 99), null);
});

test("markSelected returns a copy with updated rotation timestamp", () => {
  const selected = { id: 1, last_used_at: 0 };
  const updated = markSelected(selected, 123);
  assert.notEqual(updated, selected);
  assert.equal(updated.last_used_at, 123);
});

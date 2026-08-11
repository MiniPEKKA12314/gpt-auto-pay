import { BillingAddressStatus, CardStatus } from "./constants.mjs";

function numberOrDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isDeleted(record) {
  return Boolean(record?.deleted_at) || record?.status === "deleted";
}

function sortByPriorityThenRotation(left, right) {
  return numberOrDefault(left.priority, 100) - numberOrDefault(right.priority, 100) ||
    numberOrDefault(left.last_used_at, 0) - numberOrDefault(right.last_used_at, 0) ||
    numberOrDefault(left.id, 0) - numberOrDefault(right.id, 0);
}

function normalizePlanGroups(groups = []) {
  return groups
    .map((group) => ({
      card_group_id: Number(group.card_group_id ?? group.id),
      priority: numberOrDefault(group.priority, 100),
    }))
    .filter((group) => group.card_group_id > 0)
    .sort((left, right) => left.priority - right.priority || left.card_group_id - right.card_group_id);
}

export function selectCard(cards = [], planCardGroups = [], options = {}) {
  const excludedCardIds = new Set(
    [...(options.excludeCardIds ?? options.exclude_card_ids ?? [])]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );
  for (const group of normalizePlanGroups(planCardGroups)) {
    const eligible = cards
      .filter((card) => Number(card.card_group_id) === group.card_group_id)
      .filter((card) => !excludedCardIds.has(Number(card.id)))
      .filter((card) => card.status === CardStatus.ENABLED)
      .filter((card) => !isDeleted(card))
      .filter((card) => numberOrDefault(card.success_count, 0) < numberOrDefault(card.max_success_count, 1))
      .sort(sortByPriorityThenRotation);
    if (eligible.length > 0) return eligible[0];
  }
  return null;
}

export function selectBillingAddress(addresses = [], billingGroupId) {
  const groupId = Number(billingGroupId);
  if (!groupId) return null;
  const eligible = addresses
    .filter((address) => Number(address.billing_group_id) === groupId)
    .filter((address) => address.status === BillingAddressStatus.ENABLED)
    .filter((address) => !isDeleted(address))
    .sort(sortByPriorityThenRotation);
  return eligible[0] ?? null;
}

export function markSelected(record, now) {
  if (!record) return null;
  return {
    ...record,
    last_used_at: now,
  };
}

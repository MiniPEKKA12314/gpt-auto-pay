import { createVccCardProvider } from "./card_provider_vcc.mjs";
import { PlatformStoreError } from "./db.mjs";

function enabled(value) {
  return value === true || value === 1 || value === "1";
}

function targetFromCard(card = {}) {
  return {
    cardId: card.provider_card_id || card.providerCardId || "",
    cardNum: card.number || "",
  };
}

function hasRemoteTarget(card = {}) {
  return String(card.provider || "").toLowerCase() === "vcc"
    && Boolean(card.provider_card_id || card.providerCardId || card.number);
}

export function buildCardLifecyclePolicy(card = {}) {
  return {
    provider: String(card.provider || "").toLowerCase(),
    provider_card_id: String(card.provider_card_id || card.providerCardId || ""),
    unfreeze_before_use: enabled(card.auto_unfreeze_before_use ?? card.autoUnfreezeBeforeUse),
    freeze_after_success: enabled(card.auto_freeze_after_success ?? card.autoFreezeAfterSuccess),
    freeze_after_failure: enabled(card.auto_freeze_after_failure ?? card.autoFreezeAfterFailure),
  };
}

export function cardLifecycleEnabled(card = {}) {
  const policy = buildCardLifecyclePolicy(card);
  return policy.provider === "vcc"
    && (policy.unfreeze_before_use || policy.freeze_after_success || policy.freeze_after_failure);
}

export function createCardLifecycleProvider(store, options = {}) {
  const factory = options.cardProviderFactory;
  if (typeof factory === "function") return factory;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return (provider) => {
    if (String(provider).toLowerCase() !== "vcc") {
      throw new PlatformStoreError("CARD_PROVIDER_UNSUPPORTED", `unsupported card provider: ${provider}`);
    }
    const config = store.getCardProviderConfig("vcc", { includeSecret: true });
    if (!config.user_serial || !config.secret_key) {
      throw new PlatformStoreError("VCC_CONFIG_MISSING", "VCC 卡台配置不完整，请先填写 userSerial 和 secretKey");
    }
    return createVccCardProvider(config, { fetchImpl });
  };
}

export async function runCardLifecycleAction(action, context = {}) {
  const { store, card, emit = () => {}, now = () => Date.now() / 1000 } = context;
  if (!store || !card || !hasRemoteTarget(card)) return { skipped: true, reason: "no_remote_card" };
  const policy = buildCardLifecyclePolicy(card);
  const shouldRun = action === "unfreeze"
    ? policy.unfreeze_before_use
    : action === "freeze_success"
      ? policy.freeze_after_success
      : action === "freeze_failure"
        ? policy.freeze_after_failure
        : false;
  if (!shouldRun) return { skipped: true, reason: "policy_disabled" };

  const providerFactory = createCardLifecycleProvider(store, context);
  const provider = providerFactory(policy.provider);
  const target = targetFromCard(card);
  const stage = action === "unfreeze" ? "card_unfreeze" : "card_freeze";
  const verb = action === "unfreeze" ? "解冻" : "冻结";
  emit({
    level: "info",
    stage,
    message: `VCC 远端卡${verb}开始: ${card.masked_number || target.cardId || ""}`,
    meta: { provider: policy.provider, provider_card_id: policy.provider_card_id, action },
  });
  const data = action === "unfreeze"
    ? await provider.enableCard(target)
    : await provider.suspendCard(target);
  store.addRunLog({
    order_id: context.order?.id ?? context.order_id ?? context.orderId ?? 0,
    attempt_id: context.attemptId ?? context.attempt_id ?? 0,
    level: "success",
    stage,
    message: `VCC 远端卡${verb}完成`,
    meta: { provider: policy.provider, provider_card_id: policy.provider_card_id, action, result: data },
  }, now());
  return { ok: true, action, data };
}

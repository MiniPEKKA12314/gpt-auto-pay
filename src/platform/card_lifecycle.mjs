import { createKimooxCardProvider } from "./card_provider_kimoox.mjs";
import { createVccCardProvider } from "./card_provider_vcc.mjs";
import { PlatformStoreError } from "./db.mjs";

const DEFAULT_BALANCE_TIMEOUT_MS = 90_000;
const BALANCE_POLL_INTERVAL_MS = 3_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enabled(value) {
  return value === true || value === 1 || value === "1";
}

function targetFromCard(card = {}) {
  return {
    cardId: card.provider_card_id || card.providerCardId || "",
    cardNum: card.number || "",
  };
}

function cardProviderName(card = {}) {
  return String(card.provider || "").toLowerCase();
}

function cardProviderLabel(provider) {
  return provider === "kimoox" ? "Kimoox" : provider === "vcc" ? "VCC" : String(provider || "远程卡台").toUpperCase();
}

export function planCardSource(plan = {}) {
  const source = String(plan.card_source ?? plan.cardSource ?? "").trim().toLowerCase();
  if (["local", "vcc", "kimoox"].includes(source)) return source;
  if (String(plan.kimoox_issue_mode ?? plan.kimooxIssueMode ?? "").toLowerCase() === "per_order") return "kimoox";
  return "local";
}

function planUsesRemotePerOrder(plan = {}, provider = "") {
  const source = planCardSource(plan);
  return provider ? source === provider : ["vcc", "kimoox"].includes(source);
}

function hasRemoteTarget(card = {}) {
  const provider = cardProviderName(card);
  return ["vcc", "kimoox"].includes(provider)
    && Boolean(card.provider_card_id || card.providerCardId || card.number);
}

function displayCardTarget(card = {}, target = targetFromCard(card)) {
  return card.masked_number || target.cardId || (target.cardNum ? `${String(target.cardNum).slice(0, 4)}****${String(target.cardNum).slice(-4)}` : "");
}

function numericString(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

export function moneyToCents(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = numericString(value);
  if (!text) return null;
  const negative = text.startsWith("-");
  const raw = negative ? text.slice(1) : text;
  const [wholeRaw, fracRaw = ""] = raw.split(".");
  const whole = Number(wholeRaw || "0");
  if (!Number.isFinite(whole)) return null;
  const frac = Number((fracRaw + "00").slice(0, 2));
  if (!Number.isFinite(frac)) return null;
  const cents = whole * 100 + frac;
  return negative ? -cents : cents;
}

export function centsToUsd(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(n));
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function planTargetBalanceCents(plan = {}) {
  return moneyToCents(plan.vcc_target_balance_usd ?? plan.vccTargetBalanceUsd ?? "");
}

function extractRechargeId(value, seen = new Set()) {
  if (!value || typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  for (const key of ["id", "rechargeId", "recharge_id", "orderId", "order_id", "requestNo", "request_no", "taskId", "task_id"]) {
    const item = value[key];
    if (item !== undefined && item !== null && String(item).trim()) return String(item).trim();
  }
  for (const item of Object.values(value)) {
    const found = extractRechargeId(item, seen);
    if (found) return found;
  }
  return "";
}

function rechargeDetailState(detail = {}) {
  const raw = detail?.state ?? detail?.status ?? detail?.orderStatus ?? detail?.order_status ?? detail?.result;
  const text = String(raw ?? "").trim().toLowerCase();
  if (raw === 10 || text === "10" || ["success", "succeeded", "finish", "finished", "complete", "completed", "ok"].includes(text)) {
    return "success";
  }
  if (raw === -10 || text === "-10" || ["failed", "fail", "failure", "error", "cancel", "cancelled", "canceled"].includes(text)) {
    return "failed";
  }
  if (raw === 1 || text === "1" || ["pending", "processing", "process", "running", "submitted"].includes(text)) {
    return "pending";
  }
  return "unknown";
}

function publicRemoteCard(card = {}) {
  return {
    provider: card.provider ?? "",
    provider_card_id: card.provider_card_id ?? "",
    masked_number: card.masked_number ?? "",
    state: card.state ?? "",
    card_balance: card.card_balance ?? "",
    create_time: card.create_time ?? "",
    modify_time: card.modify_time ?? "",
  };
}

function selectMatchingRemoteCard(rows = [], card = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const target = targetFromCard(card);
  const targetId = String(target.cardId || "");
  const targetNum = String(target.cardNum || "").replace(/\D+/g, "");
  if (targetId) {
    const byId = rows.find((row) => String(row.provider_card_id ?? row.providerCardId ?? "") === targetId);
    return byId ?? null;
  }
  if (targetNum) {
    const byNum = rows.find((row) => String(row.number ?? "").replace(/\D+/g, "") === targetNum);
    return byNum ?? null;
  }
  return rows.length === 1 ? rows[0] : null;
}

async function queryRemoteBalanceWithProvider(provider, card) {
  const target = targetFromCard(card);
  const providerName = cardProviderName(card);
  const label = cardProviderLabel(providerName);
  const input = {
    pageNumber: 1,
    pageSize: 10,
    all: true,
  };
  if (target.cardId) {
    input.userBankId = target.cardId;
    input.cardId = target.cardId;
  }
  if (target.cardNum) {
    input.userBankNum = target.cardNum;
    input.cardNo = target.cardNum;
  }
  const rows = await provider.listCards(input);
  const remoteCard = selectMatchingRemoteCard(rows, card);
  if (!remoteCard) {
    throw new PlatformStoreError(`${providerName.toUpperCase()}_CARD_NOT_FOUND`, `${label} 卡台未返回这张卡，无法查询余额`);
  }
  const balanceCents = moneyToCents(remoteCard.card_balance);
  if (balanceCents === null) {
    throw new PlatformStoreError(`${providerName.toUpperCase()}_BALANCE_MISSING`, `${label} 卡台未返回卡内余额`);
  }
  return {
    ok: true,
    target,
    balance_cents: balanceCents,
    balance_usd: centsToUsd(balanceCents),
    remote_card: publicRemoteCard(remoteCard),
  };
}

function operationRequestNo(prefix = "KO", order = {}, card = {}) {
  const raw = `${prefix}_${order.order_no || order.id || "order"}_${card.provider_card_id || card.id || Date.now()}_${Date.now()}`;
  let text = raw.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64);
  if (!/^[A-Za-z]/.test(text)) text = `${prefix}_${text}`.slice(0, 64);
  return text.length >= 8 ? text : `${prefix}_${Date.now()}`.slice(0, 64);
}

function extractCashOutLimitCents(error) {
  const text = String(error?.message || error || "");
  const match = text.match(/最多可转出\s*([0-9]+(?:\.\d+)?)/i)
    || text.match(/(?:maximum|max|limit)[^0-9]*([0-9]+(?:\.\d+)?)/i);
  return match ? moneyToCents(match[1]) : null;
}

async function submitCashOutWithLimitRetry(provider, target, balanceCents, order, card, emit, source) {
  let amountCents = source === "kimoox"
    ? Math.max(0, Number(balanceCents) - 1)
    : Math.max(0, Number(balanceCents));
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (amountCents <= 0) return { skipped: true, amount: "0.00", attempts: attempt };
    const amount = centsToUsd(amountCents);
    const requestNo = operationRequestNo(attempt === 0 ? "CW" : "CWR", order, card);
    try {
      const cashOut = await provider.cashOutCard({ cardId: target.cardId, amount, requestNo });
      emit({
        level: "info",
        stage: "kimoox_cleanup",
        message: `${cardProviderLabel(source)} 剩余余额转出请求已提交: ${amount} USD requestNo=${requestNo}${attempt ? `（按卡台返回上限重试）` : ""}`,
        meta: { amount, requestNo, attempt: attempt + 1, result: cashOut },
      });
      return { cashOut, amount, requestNo, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      const limitCents = extractCashOutLimitCents(error);
      if (attempt === 0 && Number.isInteger(limitCents) && limitCents > 0 && limitCents < amountCents) {
        amountCents = limitCents;
        emit({
          level: "warn",
          stage: "kimoox_cleanup",
          message: `${cardProviderLabel(source)} 转出金额超过卡台可用余额，按卡台返回上限 ${centsToUsd(limitCents)} USD 重试`,
          meta: { requested_amount: amount, retry_amount: centsToUsd(limitCents), error: error.message || String(error) },
        });
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("余额转出失败");
}

function remoteCardState(card = {}) {
  return String(card.state ?? card.cardStatus ?? card.status ?? card.card_status ?? "").trim().toUpperCase();
}

function isCancelConfirmedState(state) {
  return ["CANCELLED", "CANCELED", "CANCEL_SUCCESS", "CANCELLED_SUCCESS", "CLOSED", "DESTROYED", "DELETED"].includes(String(state || "").toUpperCase());
}

function operationTimeoutMs(context = {}, plan = {}) {
  const raw = context.kimooxOperationTimeoutMs ?? context.kimoox_operation_timeout_ms ?? plan.kimoox_operation_timeout_ms ?? DEFAULT_BALANCE_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1_000 ? Math.min(n, 300_000) : DEFAULT_BALANCE_TIMEOUT_MS;
}

async function waitForKimooxBalanceAtMost(provider, card, maxCents, emit, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_BALANCE_TIMEOUT_MS);
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  let lastLogAt = 0;
  let lastBalance = "";
  let lastBalanceResult = null;
  while (Date.now() < deadline) {
    try {
      const balance = await queryRemoteBalanceWithProvider(provider, card);
      lastBalanceResult = balance;
      if (balance.balance_cents <= maxCents) {
        emit({
          level: "success",
          stage: "kimoox_cleanup",
          message: `Kimoox 余额转出确认完成: 当前余额 ${balance.balance_usd} USD`,
          meta: { requestNo: options.requestNo, amount: options.amount, balance },
        });
        return { ok: true, confirmed: true, balance };
      }
      const nowMs = Date.now();
      if (balance.balance_usd !== lastBalance || nowMs - lastLogAt >= 15_000) {
        emit({
          level: "info",
          stage: "kimoox_cleanup",
          message: `Kimoox 余额转出确认中: 当前余额 ${balance.balance_usd} USD，等待转出完成`,
          meta: { requestNo: options.requestNo, amount: options.amount, balance },
        });
        lastBalance = balance.balance_usd;
        lastLogAt = nowMs;
      }
    } catch (error) {
      const nowMs = Date.now();
      if (nowMs - lastLogAt >= 15_000) {
        emit({ level: "warn", stage: "kimoox_cleanup", message: `Kimoox 余额转出确认暂未成功: ${error.message || error}`, meta: { requestNo: options.requestNo } });
        lastLogAt = nowMs;
      }
    }
    await sleep(Math.min(BALANCE_POLL_INTERVAL_MS, Math.max(250, deadline - Date.now())));
  }
  throw new PlatformStoreError("KIMOOX_WITHDRAW_CONFIRM_TIMEOUT", `Kimoox 余额转出 ${Math.round(timeoutMs / 1000)} 秒内未确认完成`, {
    requestNo: options.requestNo,
    amount: options.amount,
    lastBalance: lastBalanceResult,
  });
}

async function waitForKimooxCancelConfirmed(provider, card, emit, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_BALANCE_TIMEOUT_MS);
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  let lastLogAt = 0;
  let lastState = "";
  let notFoundCount = 0;
  let lastRemoteCard = null;
  while (Date.now() < deadline) {
    try {
      const target = targetFromCard(card);
      const rows = await provider.listCards({ cardId: target.cardId, userBankId: target.cardId, pageNum: 1, pageSize: 10 });
      const remoteCard = selectMatchingRemoteCard(rows, card);
      if (!remoteCard) {
        notFoundCount += 1;
        if (notFoundCount >= 2) {
          emit({
            level: "success",
            stage: "kimoox_cleanup",
            message: "Kimoox 销卡确认完成: 卡台查询已不再返回该卡",
            meta: { requestNo: options.requestNo, cardId: target.cardId, notFoundCount },
          });
          return { ok: true, confirmed: true, state: "NOT_RETURNED", remote_card: null };
        }
      } else {
        notFoundCount = 0;
        lastRemoteCard = remoteCard;
        const state = remoteCardState(remoteCard);
        if (isCancelConfirmedState(state)) {
          emit({
            level: "success",
            stage: "kimoox_cleanup",
            message: `Kimoox 销卡确认完成: 状态=${state || "已销卡"}`,
            meta: { requestNo: options.requestNo, card: publicRemoteCard(remoteCard) },
          });
          return { ok: true, confirmed: true, state, remote_card: publicRemoteCard(remoteCard) };
        }
        const nowMs = Date.now();
        if (state !== lastState || nowMs - lastLogAt >= 15_000) {
          emit({
            level: "info",
            stage: "kimoox_cleanup",
            message: `Kimoox 销卡确认中: 当前状态=${state || "未知"}`,
            meta: { requestNo: options.requestNo, card: publicRemoteCard(remoteCard) },
          });
          lastState = state;
          lastLogAt = nowMs;
        }
      }
    } catch (error) {
      const nowMs = Date.now();
      if (nowMs - lastLogAt >= 15_000) {
        emit({ level: "warn", stage: "kimoox_cleanup", message: `Kimoox 销卡确认暂未成功: ${error.message || error}`, meta: { requestNo: options.requestNo } });
        lastLogAt = nowMs;
      }
    }
    await sleep(Math.min(BALANCE_POLL_INTERVAL_MS, Math.max(250, deadline - Date.now())));
  }
  throw new PlatformStoreError("KIMOOX_CANCEL_CONFIRM_TIMEOUT", `Kimoox 销卡 ${Math.round(timeoutMs / 1000)} 秒内未确认完成`, {
    requestNo: options.requestNo,
    lastState,
    lastCard: lastRemoteCard ? publicRemoteCard(lastRemoteCard) : null,
  });
}


function perOrderRequestNo(order = {}, attemptId = 0) {
  const raw = `KA_${order.order_no || order.id || Date.now()}_${attemptId || Date.now()}`;
  let text = raw.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 64);
  if (!/^[A-Za-z]/.test(text)) text = `KA_${text}`.slice(0, 64);
  if (!/[A-Za-z]/.test(text)) text = `KA_${text}`.slice(0, 64);
  if (!/\d/.test(text)) text = `${text}_1`.slice(0, 64);
  return text.length >= 8 ? text : `${text}_${Date.now()}`.slice(0, 64);
}

function firstPlanCardGroupId(plan = {}) {
  const groups = Array.isArray(plan.card_groups) ? plan.card_groups : [];
  const first = groups.find((group) => Number(group.card_group_id ?? group.id) > 0);
  return Number(first?.card_group_id ?? first?.id ?? 0);
}

function perOrderCardGroupId(plan = {}, providerName = "") {
  if (providerName === "kimoox") {
    const remoteGroup = Number(plan.kimoox_local_card_group_id ?? plan.kimooxLocalCardGroupId ?? 0);
    if (remoteGroup > 0) return remoteGroup;
  }
  if (providerName === "vcc") {
    const remoteGroup = Number(plan.vcc_local_card_group_id ?? plan.vccLocalCardGroupId ?? 0);
    if (remoteGroup > 0) return remoteGroup;
  }
  return firstPlanCardGroupId(plan);
}

function successApplyStatus(detail = {}) {
  const values = [detail.applyStatus, detail.apply_status, detail.taskStatus, detail.task_status, detail.status]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .filter(Boolean);
  return values.some((value) => ["SUCCESS", "PARTIAL_SUCCESS", "SUCCEEDED", "COMPLETED", "DONE"].includes(value))
    || Number(detail.successCount ?? detail.success_count ?? 0) > 0;
}

function failedApplyStatus(detail = {}) {
  const values = [detail.applyStatus, detail.apply_status, detail.taskStatus, detail.task_status, detail.status]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .filter(Boolean);
  return values.some((value) => ["FAILED", "FAIL", "CANCELED", "CANCELLED", "ERROR"].includes(value))
    && Number(detail.successCount ?? detail.success_count ?? 0) <= 0;
}

function extractApplyIds(value = {}, seen = new Set()) {
  const out = { taskId: "", batchNo: "", cardIds: [] };
  const visit = (item) => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    for (const [key, raw] of Object.entries(item)) {
      const lower = key.toLowerCase();
      const text = raw === undefined || raw === null || typeof raw === "object" ? "" : String(raw).trim();
      if (text) {
        if (!out.taskId && ["taskid", "task_id"].includes(lower)) out.taskId = text;
        if (!out.batchNo && ["batchno", "batch_no"].includes(lower)) out.batchNo = text;
        if (["cardid", "card_id"].includes(lower)) out.cardIds.push(text);
      }
      if (raw && typeof raw === "object") visit(raw);
    }
  };
  visit(value);
  out.cardIds = [...new Set(out.cardIds.filter(Boolean))];
  return out;
}

function kimooxWebhookState(row = null) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(String(row.payload_json || "{}"));
  } catch {
    payload = {};
  }
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const text = [
    row.event_type,
    payload.eventType,
    data.status,
    data.state,
    data.result,
    data.operationStatus,
    data.applyStatus,
    data.taskStatus,
  ].filter(Boolean).join(" ").toUpperCase();
  return {
    row,
    payload,
    data,
    failed: /FAILED|FAILURE|REJECTED|DECLINED|ERROR|CANCELED|CANCELLED/.test(text),
    succeeded: /SUCCESS|SUCCEEDED|COMPLETED|FINISHED|APPROVED/.test(text),
    statusText: text || "WEBHOOK_RECEIVED",
  };
}

async function waitForKimooxAppliedCard(provider, applyResult, plan, emit, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_BALANCE_TIMEOUT_MS);
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  const ids = extractApplyIds(applyResult);
  const requestNo = String(options.requestNo ?? applyResult?.requestNo ?? applyResult?.request_no ?? "").trim();
  let detail = applyResult;
  let lastStatus = "";
  let lastWebhookId = 0;
  let webhookSucceeded = false;

  while (Date.now() < deadline) {
    const webhookRow = options.store?.listWebhookEvents?.({
      provider: "kimoox",
      request_no: requestNo,
      limit: 1,
    })?.[0];
    const webhook = kimooxWebhookState(webhookRow);
    if (webhook && Number(webhook.row.id) !== lastWebhookId) {
      lastWebhookId = Number(webhook.row.id);
      const webhookIds = extractApplyIds({ row: webhook.row, payload: webhook.payload, data: webhook.data });
      ids.taskId ||= webhookIds.taskId;
      ids.batchNo ||= webhookIds.batchNo;
      ids.cardIds.push(...webhookIds.cardIds);
      ids.cardIds = [...new Set(ids.cardIds.filter(Boolean))];
      webhookSucceeded ||= webhook.succeeded;
      emit({
        level: webhook.failed ? "error" : webhook.succeeded ? "success" : "info",
        stage: "kimoox_webhook",
        message: `收到 Kimoox 开卡回调: ${webhook.statusText}`,
        meta: { event_id: webhook.row.event_id, request_no: requestNo, payload: webhook.payload },
      });
      if (webhook.failed) {
        throw new PlatformStoreError("KIMOOX_OPEN_CARD_FAILED", `Kimoox 开卡回调失败: ${webhook.statusText}`, {
          webhook: webhook.payload,
          applyResult,
        });
      }
    }
    const query = {
      taskId: ids.taskId,
      batchNo: ids.batchNo,
      requestNo,
    };
    try {
      detail = await provider.getOpenCardDetail(query);
      const nextIds = extractApplyIds(detail);
      ids.taskId ||= nextIds.taskId;
      ids.batchNo ||= nextIds.batchNo;
      ids.cardIds.push(...nextIds.cardIds);
      ids.cardIds = [...new Set(ids.cardIds.filter(Boolean))];
    } catch (error) {
      emit({ level: "warn", stage: "kimoox_open_card", message: `Kimoox 开卡状态查询暂未成功: ${error.message || error}` });
    }

    const statusText = [detail?.applyStatus, detail?.taskStatus, detail?.status, detail?.applyStatusText, detail?.taskStatusText].filter(Boolean).join("/") || "unknown";
    if (statusText !== lastStatus) {
      emit({
        level: failedApplyStatus(detail) ? "error" : successApplyStatus(detail) ? "success" : "info",
        stage: "kimoox_open_card",
        message: `Kimoox 开卡任务状态: ${statusText}`,
        meta: { detail },
      });
      lastStatus = statusText;
    }

    if (failedApplyStatus(detail)) {
      throw new PlatformStoreError("KIMOOX_OPEN_CARD_FAILED", `Kimoox 开卡失败: ${statusText}`, { detail });
    }

    const cardQueries = [];
    if (ids.batchNo) cardQueries.push({ batchNo: ids.batchNo, pageNum: 1, pageSize: 5 });
    for (const cardId of ids.cardIds) cardQueries.push({ cardId, pageNum: 1, pageSize: 1 });
    if ((successApplyStatus(detail) || webhookSucceeded) && cardQueries.length === 0) cardQueries.push({ pageNum: 1, pageSize: 5, remark: requestNo });

    for (const query of cardQueries) {
      try {
        const rows = await provider.listCardsWithPrivateInfo(query);
        const card = query.cardId
          ? rows.find((row) => String(row.provider_card_id || "") === String(query.cardId))
          : rows.find((row) => row.number && row.exp_month && row.exp_year && row.cvc && row.provider_card_id);
        if (card?.number && card?.provider_card_id) {
          return { card, detail, ids };
        }
      } catch (error) {
        emit({ level: "warn", stage: "kimoox_open_card", message: `Kimoox 查询新卡三要素暂未成功: ${error.message || error}` });
      }
    }

    await sleep(Math.min(BALANCE_POLL_INTERVAL_MS, Math.max(250, deadline - Date.now())));
  }

  throw new PlatformStoreError("KIMOOX_OPEN_CARD_TIMEOUT", `Kimoox 开卡 ${Math.round(timeoutMs / 1000)} 秒内未拿到可用卡号`, { applyResult, detail });
}

export function planUsesKimooxPerOrder(plan = {}) {
  return planCardSource(plan) === "kimoox" || String(plan.kimoox_issue_mode ?? plan.kimooxIssueMode ?? "pool").toLowerCase() === "per_order";
}

export function planUsesVccPerOrder(plan = {}) {
  return planCardSource(plan) === "vcc";
}

export async function prepareVccPerOrderCard(context = {}) {
  const { store, order = {}, plan = {}, emit = () => {}, now = () => Date.now() / 1000 } = context;
  if (!store) throw new PlatformStoreError("VCC_STORE_MISSING", "store is required");
  if (!planUsesVccPerOrder(plan)) return { skipped: true, reason: "vcc_per_order_disabled" };
  const localCardGroupId = perOrderCardGroupId(plan, "vcc");
  if (!localCardGroupId) throw new PlatformStoreError("VCC_LOCAL_CARD_GROUP_REQUIRED", "VCC 每单开卡需要在套餐里选择一个本地卡组，用于临时保存新卡");
  const targetCents = planTargetBalanceCents(plan);
  if (targetCents === null || targetCents <= 0) throw new PlatformStoreError("VCC_TARGET_BALANCE_REQUIRED", "VCC 每单开卡需要在套餐里设置远程卡目标余额（USD）");
  const cardBin = String(plan.vcc_card_bin ?? plan.vccCardBin ?? "").trim();
  if (!cardBin) throw new PlatformStoreError("VCC_CARD_BIN_REQUIRED", "VCC 每单开卡需要在套餐里选择或填写开卡 BIN");

  const existingCardId = Number(context.retryRuntime?.vccPerOrderCardId ?? context.retry_runtime?.vccPerOrderCardId ?? 0);
  if (existingCardId > 0) {
    try {
      const existing = store.getCardById(existingCardId, { includeSecret: true });
      if (!existing.deleted_at && cardProviderName(existing) === "vcc" && existing.provider_card_id) {
        emit({ level: "info", stage: "vcc_open_card", message: `复用本订单已开的 VCC 卡: ${existing.masked_number} / ${existing.provider_card_id}`, meta: { local_card_id: existing.id, provider_card_id: existing.provider_card_id } });
        return { ok: true, reused: true, card: existing, local_card_id: existing.id, provider_card_id: existing.provider_card_id };
      }
    } catch {}
  }

  const provider = createCardLifecycleProvider(store, context)("vcc");
  const amount = centsToUsd(targetCents);
  const requestNo = operationRequestNo("VO", order, { provider_card_id: context.attemptId ?? Date.now() });
  const payload = { cardBin, amount, email: plan.vcc_open_email ?? plan.vccOpenEmail ?? "", remark: `order ${order.order_no || order.id || ""}`.trim().slice(0, 40) };
  emit({ level: "info", stage: "vcc_open_card", message: `VCC 每单开卡开始: BIN=${cardBin} 金额=${amount} USD`, meta: { requestNo, payload: { ...payload, email: payload.email ? "provided" : "" } } });
  const opened = await provider.openCard(payload);
  emit({ level: "info", stage: "vcc_open_card", message: "VCC 开卡请求已提交", meta: { result: opened } });

  let remote = normalizeOpenedRemoteCard(opened, "vcc");
  const openId = extractRechargeId(opened);
  const timeoutMs = Number(context.vccOpenTimeoutMs ?? DEFAULT_BALANCE_TIMEOUT_MS);
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  while ((!remote.number || !remote.provider_card_id) && Date.now() < deadline) {
    try {
      if (openId && typeof provider.getOpenCardDetail === "function") {
        const detail = await provider.getOpenCardDetail({ orderId: openId, order_id: openId });
        emit({ level: "info", stage: "vcc_open_card", message: `VCC 开卡详情已返回: ${openId}`, meta: { detail } });
        remote = normalizeOpenedRemoteCard(detail, "vcc");
      }
      if ((!remote.number || !remote.provider_card_id) && typeof provider.listCards === "function") {
        const rows = await provider.listCards({ pageNumber: 1, pageSize: 10, all: true });
        const candidate = rows.find((row) => row.number && row.exp_month && row.exp_year && row.cvc && row.provider_card_id) || rows[0];
        if (candidate) remote = normalizeOpenedRemoteCard(candidate, "vcc");
      }
    } catch (error) {
      emit({ level: "warn", stage: "vcc_open_card", message: `VCC 查询新卡暂未成功: ${error.message || error}` });
    }
    if (remote.number && remote.provider_card_id) break;
    await sleep(Math.min(BALANCE_POLL_INTERVAL_MS, Math.max(250, deadline - Date.now())));
  }
  if (!remote.number || !remote.provider_card_id) throw new PlatformStoreError("VCC_OPEN_CARD_TIMEOUT", `VCC 开卡 ${Math.round(timeoutMs / 1000)} 秒内未拿到可用卡号`, { opened, remote });

  const cardId = store.createCard({
    card_group_id: localCardGroupId,
    number: remote.number, exp_month: remote.exp_month, exp_year: remote.exp_year, cvc: remote.cvc,
    priority: 0, max_success_count: 1, provider: "vcc", provider_card_id: remote.provider_card_id,
    auto_unfreeze_before_use: 0, auto_freeze_after_success: 0, auto_freeze_after_failure: 0, status: "enabled",
    note: `vcc-per-order ${order.order_no || order.id || ""} ${requestNo}`.trim(),
  }, now());
  if (context.attemptId && typeof store.updateOrderAttemptResources === "function") store.updateOrderAttemptResources(context.attemptId, { card_id: cardId }, now());
  const card = store.getCardById(cardId, { includeSecret: true });
  if (context.retryRuntime && typeof context.retryRuntime === "object") {
    context.retryRuntime.vccPerOrderCardId = cardId;
    context.retryRuntime.vccProviderCardId = remote.provider_card_id;
    context.retryRuntime.vccOpenOrderId = openId;
  }
  emit({ level: "success", stage: "vcc_open_card", message: `VCC 新卡已入本地临时卡池: ${card.masked_number} / ${remote.provider_card_id}`, meta: { local_card_id: cardId, provider_card_id: remote.provider_card_id, open_id: openId } });
  return { ok: true, card, local_card_id: cardId, provider_card_id: remote.provider_card_id, openResult: opened };
}

function normalizeOpenedRemoteCard(value = {}, providerName = "") {
  const card = normalizeRemoteCardDeep(value);
  return {
    provider: providerName,
    provider_card_id: String(card.provider_card_id || card.providerCardId || card.cardId || card.userBankCardId || card.bankCardId || card.id || ""),
    number: String(card.number || card.cardNumber || card.cardNo || card.userBankNum || "").replace(/\s+/g, ""),
    exp_month: String(card.exp_month || card.expMonth || card.expiry?.exp_month || "").padStart(2, "0"),
    exp_year: String(card.exp_year || card.expYear || card.expiry?.exp_year || ""),
    cvc: String(card.cvc || card.cvv || ""),
    masked_number: card.masked_number || card.maskedNumber || "",
  };
}

function normalizeRemoteCardDeep(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return {};
  seen.add(value);
  const expiryText = String(value.expiryDate ?? value.expiry_date ?? value.expiry ?? "").trim();
  const expiryMatch = expiryText.match(/^(\d{1,2})\s*[/\-]\s*(\d{2,4})$/);
  const direct = {
    provider_card_id: value.provider_card_id ?? value.providerCardId ?? value.cardId ?? value.userBankCardId ?? value.bankCardId ?? value.id,
    number: value.number ?? value.cardNumber ?? value.cardNo ?? value.userBankNum,
    exp_month: value.exp_month ?? value.expMonth ?? (expiryMatch ? expiryMatch[1].padStart(2, "0") : ""),
    exp_year: value.exp_year ?? value.expYear ?? (expiryMatch ? (expiryMatch[2].length === 2 ? String(2000 + Number(expiryMatch[2])) : expiryMatch[2]) : ""),
    cvc: value.cvc ?? value.cvv,
    masked_number: value.masked_number ?? value.maskedNumber,
  };
  if (direct.number || direct.provider_card_id) return direct;
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) {
      for (const row of item) {
        const found = normalizeRemoteCardDeep(row, seen);
        if (found.number || found.provider_card_id) return found;
      }
    } else if (item && typeof item === "object") {
      const found = normalizeRemoteCardDeep(item, seen);
      if (found.number || found.provider_card_id) return found;
    }
  }
  return {};
}

export async function prepareKimooxPerOrderCard(context = {}) {
  const { store, order = {}, plan = {}, emit = () => {}, now = () => Date.now() / 1000 } = context;
  if (!store) throw new PlatformStoreError("KIMOOX_STORE_MISSING", "store is required");
  if (!planUsesKimooxPerOrder(plan)) return { skipped: true, reason: "kimoox_per_order_disabled" };

  const localCardGroupId = perOrderCardGroupId(plan, "kimoox");
  if (!localCardGroupId) {
    throw new PlatformStoreError("KIMOOX_LOCAL_CARD_GROUP_REQUIRED", "Kimoox 按订单开卡需要在套餐里选择一个本地卡组，用于临时保存新卡");
  }
  const targetCents = planTargetBalanceCents(plan);
  if (targetCents === null || targetCents <= 0) {
    throw new PlatformStoreError("KIMOOX_TARGET_BALANCE_REQUIRED", "Kimoox 按订单开卡需要在套餐里设置远程卡目标余额（USD）");
  }
  const cardBinId = String(plan.kimoox_card_bin_id ?? plan.kimooxCardBinId ?? "").trim();
  if (!cardBinId) {
    throw new PlatformStoreError("KIMOOX_CARD_BIN_REQUIRED", "Kimoox 按订单开卡需要在套餐里选择或填写 BIN ID");
  }

  const existingCardId = Number(context.retryRuntime?.kimooxPerOrderCardId ?? context.retry_runtime?.kimooxPerOrderCardId ?? 0);
  if (existingCardId > 0) {
    try {
      const existing = store.getCardById(existingCardId, { includeSecret: true });
      if (!existing.deleted_at && cardProviderName(existing) === "kimoox" && existing.provider_card_id) {
        emit({
          level: "info",
          stage: "kimoox_open_card",
          message: `????????? Kimoox ???: ${existing.masked_number} / ${existing.provider_card_id}`,
          meta: { local_card_id: existing.id, provider_card_id: existing.provider_card_id },
        });
        return { ok: true, reused: true, card: existing, local_card_id: existing.id, provider_card_id: existing.provider_card_id };
      }
    } catch {
    }
  }

  const providerFactory = createCardLifecycleProvider(store, context);
  const provider = providerFactory("kimoox");
  const requestNo = perOrderRequestNo(order, context.attemptId ?? context.attempt_id ?? 0);
  const amount = centsToUsd(targetCents);
  const cardType = String(plan.kimoox_card_type ?? plan.kimooxCardType ?? "PREPAID").trim() || "PREPAID";
  const openPayload = {
    requestNo,
    cardType,
    cardBinId,
    holderId: plan.kimoox_holder_id ?? plan.kimooxHolderId ?? "",
    cardCount: 1,
    remark: `order ${order.order_no || order.id || ""}`.trim().slice(0, 40),
  };
  if (cardType.toUpperCase() === "PREPAID") openPayload.rechargeAmount = amount;
  if (plan.kimoox_card_group_id) openPayload.cardGroupId = plan.kimoox_card_group_id;
  if (plan.kimoox_budget_id) openPayload.budgetId = plan.kimoox_budget_id;

  emit({
    level: "info",
    stage: "kimoox_open_card",
    message: `Kimoox 按订单开卡开始: BIN=${cardBinId} 金额=${amount} USD requestNo=${requestNo}`,
    meta: { requestNo, cardType, cardBinId, target_balance_usd: amount },
  });
  if (context.retryRuntime && typeof context.retryRuntime === "object") {
    context.retryRuntime.kimooxRequestNo = requestNo;
    context.retryRuntime.kimooxOpenSubmitted = true;
  }
  if (context.attemptId && typeof store.updateOrderAttemptProviderOperation === "function") {
    store.updateOrderAttemptProviderOperation(context.attemptId, {
      provider_open_submitted: 1,
      provider_request_no: requestNo,
    });
  }
  const applyResult = await provider.openCard(openPayload);
  if (context.retryRuntime && typeof context.retryRuntime === "object") {
    const applyIds = extractApplyIds(applyResult);
    context.retryRuntime.kimooxRequestNo = requestNo;
    context.retryRuntime.kimooxApplyTaskId = applyIds.taskId;
    context.retryRuntime.kimooxApplyBatchNo = applyIds.batchNo;
    context.retryRuntime.kimooxOpenSubmitted = true;
    if (context.attemptId && typeof store.updateOrderAttemptProviderOperation === "function") {
      store.updateOrderAttemptProviderOperation(context.attemptId, {
        provider_open_submitted: 1,
        provider_request_no: requestNo,
        provider_task_id: applyIds.taskId,
        provider_batch_no: applyIds.batchNo,
      });
    }
  }
  emit({ level: "info", stage: "kimoox_open_card", message: "Kimoox 开卡申请已提交", meta: { requestNo, result: applyResult } });
  const applied = await waitForKimooxAppliedCard(provider, applyResult, plan, emit, {
    requestNo,
    timeoutMs: context.kimooxOpenTimeoutMs ?? DEFAULT_BALANCE_TIMEOUT_MS,
    store,
  });

  const remote = applied.card;
  const cardId = store.createCard({
    card_group_id: localCardGroupId,
    number: remote.number,
    exp_month: remote.exp_month,
    exp_year: remote.exp_year,
    cvc: remote.cvc,
    priority: 0,
    max_success_count: 1,
    provider: "kimoox",
    provider_card_id: remote.provider_card_id,
    auto_unfreeze_before_use: 0,
    auto_freeze_after_success: 0,
    auto_freeze_after_failure: 0,
    status: "enabled",
    note: `kimoox-per-order ${order.order_no || order.id || ""} ${requestNo}`.trim(),
  }, now());
  if (context.attemptId && typeof store.updateOrderAttemptResources === "function") {
    store.updateOrderAttemptResources(context.attemptId, { card_id: cardId }, now());
  }
  const card = store.getCardById(cardId, { includeSecret: true });
  if (context.retryRuntime && typeof context.retryRuntime === "object") {
    context.retryRuntime.kimooxPerOrderCardId = cardId;
    context.retryRuntime.kimooxProviderCardId = remote.provider_card_id;
    context.retryRuntime.kimooxRequestNo = requestNo;
  }
  if (context.attemptId && typeof store.updateOrderAttemptProviderOperation === "function") {
    store.updateOrderAttemptProviderOperation(context.attemptId, {
      provider_open_submitted: 1,
      provider_request_no: requestNo,
      provider_card_id: remote.provider_card_id,
    });
  }
  emit({
    level: "success",
    stage: "kimoox_open_card",
    message: `Kimoox 新卡已入本地临时卡池: ${card.masked_number} / ${remote.provider_card_id}`,
    meta: { local_card_id: cardId, provider_card_id: remote.provider_card_id, requestNo, detail: applied.detail },
  });
  return { ok: true, card, local_card_id: cardId, provider_card_id: remote.provider_card_id, requestNo, applyResult, detail: applied.detail };
}

export async function cleanupKimooxPerOrderCard(context = {}) {
  const { store, card, plan = {}, emit = () => {}, now = () => Date.now() / 1000 } = context;
  const source = planCardSource(plan);
  if (!store || !card || !["vcc", "kimoox"].includes(cardProviderName(card)) || !planUsesRemotePerOrder(plan, cardProviderName(card))) return { skipped: true, reason: "not_remote_per_order_card" };
  const providerFactory = createCardLifecycleProvider(store, context);
  const provider = providerFactory(cardProviderName(card));
  const target = targetFromCard(card);
  const display = displayCardTarget(card, target);
  const timeoutMs = operationTimeoutMs(context, plan);
  const result = {
    ok: true,
    provider_card_id: target.cardId,
    balance: null,
    cash_out: null,
    cash_out_confirm: null,
    cancel: null,
    cancel_confirm: null,
    local_deleted: false,
    errors: [],
  };

  emit({ level: "info", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 订单临时卡收尾开始: ${display}` });
  let withdrawConfirmed = true;
  const successLike = context.success === true || context.orderSucceeded === true || context.directResult?.ok === true || context.directResult?.status === "success";
  const withdrawEnabled = successLike
    ? enabled(plan.remote_success_withdraw ?? plan.remoteSuccessWithdraw ?? plan.kimoox_reclaim_balance ?? plan.kimooxReclaimBalance ?? true)
    : enabled(plan.remote_failure_withdraw ?? plan.remoteFailureWithdraw ?? plan.kimoox_reclaim_balance ?? plan.kimooxReclaimBalance ?? true);
  const finalAction = successLike
    ? String(plan.remote_success_final_action ?? plan.remoteSuccessFinalAction ?? (enabled(plan.kimoox_cancel_after_order ?? plan.kimooxCancelAfterOrder ?? true) ? "cancel" : "keep")).toLowerCase()
    : String(plan.remote_failure_final_action ?? plan.remoteFailureFinalAction ?? (enabled(plan.kimoox_cancel_after_order ?? plan.kimooxCancelAfterOrder ?? true) ? "cancel" : "keep")).toLowerCase();

  if (withdrawEnabled) {
    try {
      const balance = await queryRemoteBalanceWithProvider(provider, card);
      result.balance = balance;
      if (balance.balance_cents > 0) {
        const cashOut = await submitCashOutWithLimitRetry(provider, target, balance.balance_cents, context.order ?? {}, card, emit, source);
        if (!cashOut.skipped) {
          result.cash_out = cashOut.cashOut;
          result.cash_out_amount = cashOut.amount;
          result.cash_out_attempts = cashOut.attempts;
          const expectedRemainingCents = Math.max(0, balance.balance_cents - Number(moneyToCents(cashOut.amount) || 0));
          result.cash_out_confirm = await waitForKimooxBalanceAtMost(provider, card, expectedRemainingCents, emit, { timeoutMs, requestNo: cashOut.requestNo, amount: cashOut.amount });
        }
      } else {
        emit({ level: "success", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 卡余额为 0，余额转出确认完成`, meta: balance });
      }
    } catch (error) {
      withdrawConfirmed = false;
      result.ok = false;
      result.errors.push(error.message || String(error));
      emit({ level: "error", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 剩余余额转出未确认完成: ${error.message || error}` });
    }
  }

  if (finalAction === "keep") {
    emit({ level: "warn", stage: "kimoox_cleanup", message: "远程临时卡按套餐配置保留，未冻结/销卡；请管理员后续核对" });
    return result;
  }
  if (finalAction === "freeze") {
    try {
      const requestNo = operationRequestNo("CFZ", context.order ?? {}, card);
      result.freeze = await provider.suspendCard({ cardId: target.cardId, requestNo });
      emit({ level: "success", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 临时卡冻结完成 requestNo=${requestNo}`, meta: { requestNo, result: result.freeze } });
    } catch (error) {
      result.ok = false;
      result.errors.push(error.message || String(error));
      emit({ level: "error", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 临时卡冻结失败: ${error.message || error}` });
    }
    return result;
  }

  if (finalAction === "cancel") {
    if (!withdrawConfirmed) {
      emit({ level: "warn", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 余额转出未确认完成，已跳过自动销卡；远程卡和本地卡记录保留，需管理员核对` });
      return result;
    }
    try {
      const requestNo = operationRequestNo("CC", context.order ?? {}, card);
      result.cancel = await provider.cancelCard({ cardId: target.cardId, requestNo });
      emit({ level: "info", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 销卡请求已提交 requestNo=${requestNo}`, meta: { requestNo, result: result.cancel } });
      result.cancel_confirm = source === "kimoox" ? await waitForKimooxCancelConfirmed(provider, card, emit, { timeoutMs, requestNo }) : { ok: true, confirmed: true, provider: source };
      if (card.id) {
        store.softDeleteCard(card.id, 1, `${source}_per_order_cleaned`, now());
        result.local_deleted = true;
        emit({ level: "success", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 销卡请求完成，本地临时卡记录已软删除`, meta: { requestNo, confirm: result.cancel_confirm } });
      }
    } catch (error) {
      result.ok = false;
      result.errors.push(error.message || String(error));
      emit({ level: "error", stage: "kimoox_cleanup", message: `${cardProviderLabel(source)} 销卡未确认完成: ${error.message || error}` });
    }
  }
  return result;
}

export function buildCardLifecyclePolicy(card = {}) {
  return {
    provider: cardProviderName(card),
    provider_card_id: String(card.provider_card_id || card.providerCardId || ""),
    unfreeze_before_use: enabled(card.auto_unfreeze_before_use ?? card.autoUnfreezeBeforeUse),
    freeze_after_success: enabled(card.auto_freeze_after_success ?? card.autoFreezeAfterSuccess),
    freeze_after_failure: enabled(card.auto_freeze_after_failure ?? card.autoFreezeAfterFailure),
  };
}

export function cardLifecycleEnabled(card = {}) {
  const policy = buildCardLifecyclePolicy(card);
  return ["vcc", "kimoox"].includes(policy.provider)
    && (policy.unfreeze_before_use || policy.freeze_after_success || policy.freeze_after_failure);
}

export function createCardLifecycleProvider(store, options = {}) {
  const factory = options.cardProviderFactory;
  if (typeof factory === "function") return factory;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return (provider) => {
    const name = String(provider || "").toLowerCase();
    if (name === "vcc") {
      const config = store.getCardProviderConfig("vcc", { includeSecret: true });
      if (!config.user_serial || !config.secret_key) {
        throw new PlatformStoreError("VCC_CONFIG_MISSING", "VCC 卡台配置不完整，请先填写 userSerial 和 secretKey");
      }
      return createVccCardProvider(config, { fetchImpl });
    }
    if (name === "kimoox") {
      const config = store.getCardProviderConfig("kimoox", { includeSecret: true });
      if (!config.api_key || !config.api_secret) {
        throw new PlatformStoreError("KIMOOX_CONFIG_MISSING", "Kimoox 卡台配置不完整，请先填写 API Key 和 API Secret");
      }
      return createKimooxCardProvider(config, { fetchImpl });
    }
    throw new PlatformStoreError("CARD_PROVIDER_UNSUPPORTED", `unsupported card provider: ${provider}`);
  };
}

export async function queryVccStoredCardBalance(context = {}) {
  const { store, card } = context;
  if (!store || !card || !hasRemoteTarget(card)) return { skipped: true, reason: "no_remote_card" };
  const providerFactory = createCardLifecycleProvider(store, context);
  const provider = providerFactory(cardProviderName(card));
  return await queryRemoteBalanceWithProvider(provider, card);
}

export async function ensureVccCardBalanceBeforeDirectCard(context = {}) {
  const { store, card, plan, emit = () => {} } = context;
  if (!store || !card || !hasRemoteTarget(card)) return { skipped: true, reason: "not_vcc_card" };
  const targetCents = planTargetBalanceCents(plan);
  if (targetCents === null || targetCents <= 0) return { skipped: true, reason: "target_balance_not_configured" };

  const providerName = cardProviderName(card);
  const label = cardProviderLabel(providerName);
  const providerFactory = createCardLifecycleProvider(store, context);
  const provider = providerFactory(providerName);
  const target = targetFromCard(card);
  const timeoutMs = Number(context.vccBalanceTimeoutMs ?? DEFAULT_BALANCE_TIMEOUT_MS);
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  const display = displayCardTarget(card, target);

  emit({
    level: "info",
    stage: "card_balance",
    message: `${label} 卡余额检查开始: ${display}; 目标余额 ${centsToUsd(targetCents)} USD`,
    meta: { provider: providerName, provider_card_id: target.cardId, target_balance_usd: centsToUsd(targetCents) },
  });

  let balance = await queryRemoteBalanceWithProvider(provider, card);
  if (balance.balance_cents >= targetCents) {
    emit({
      level: "success",
      stage: "card_balance",
      message: `${label} 卡余额充足: 当前 ${balance.balance_usd} USD，目标 ${centsToUsd(targetCents)} USD`,
      meta: balance,
    });
    return { ok: true, recharged: false, balance };
  }

  const diffCents = targetCents - balance.balance_cents;
  const rechargeAmount = centsToUsd(diffCents);
  emit({
    level: "warn",
    stage: "card_recharge",
    message: `${label} 卡余额不足: 当前 ${balance.balance_usd} USD，目标 ${centsToUsd(targetCents)} USD，准备充值差额 ${rechargeAmount} USD`,
    meta: { before: balance, recharge_amount_usd: rechargeAmount },
  });

  const rechargeResult = await provider.rechargeCard({
    bankCardId: target.cardId,
    bankCardNum: target.cardNum,
    amount: rechargeAmount,
  });
  const rechargeId = extractRechargeId(rechargeResult);
  if (!rechargeId) {
    throw new PlatformStoreError("VCC_RECHARGE_ID_MISSING", "VCC 充值接口未返回充值单 ID，无法确认充值详情");
  }
  emit({
    level: "info",
    stage: "card_recharge",
    message: `${label} 充值请求已提交: ${rechargeAmount} USD; 充值单 ${rechargeId}`,
    meta: { recharge_id: rechargeId, recharge_amount_usd: rechargeAmount, result: rechargeResult },
  });

  let detail = rechargeResult;
  if (providerName === "kimoox") {
    emit({
      level: "info",
      stage: "card_recharge",
      message: "Kimoox 资金操作接口已提交；该接口最终状态以 Webhook 为准，当前改用余额轮询确认是否到账",
      meta: { recharge_id: rechargeId, result: rechargeResult },
    });
  } else {
    let lastState = "";
    while (Date.now() < deadline) {
      detail = await provider.getRechargeDetail({ rechargeId });
      const state = rechargeDetailState(detail);
      if (state !== lastState) {
        emit({
          level: state === "failed" ? "error" : state === "success" ? "success" : "info",
          stage: "card_recharge",
          message: state === "success"
            ? `${label} 充值详情确认成功: ${rechargeId}`
            : state === "failed"
              ? `${label} 充值详情确认失败: ${rechargeId}`
              : `${label} 充值处理中: ${rechargeId}`,
          meta: { recharge_id: rechargeId, state, detail },
        });
        lastState = state;
      }
      if (state === "success") break;
      if (state === "failed") {
        throw new PlatformStoreError(`${providerName.toUpperCase()}_RECHARGE_FAILED`, `${label} 充值失败: ${detail?.remark || detail?.message || rechargeId}`, { detail });
      }
      await sleep(Math.min(BALANCE_POLL_INTERVAL_MS, Math.max(250, deadline - Date.now())));
    }

    if (rechargeDetailState(detail) !== "success") {
      throw new PlatformStoreError(`${providerName.toUpperCase()}_RECHARGE_TIMEOUT`, `${label} 充值详情 ${Math.round(timeoutMs / 1000)} 秒内未确认成功`, { recharge_id: rechargeId, detail });
    }
  }

  while (Date.now() < deadline) {
    balance = await queryRemoteBalanceWithProvider(provider, card);
    if (balance.balance_cents >= targetCents) {
      emit({
        level: "success",
        stage: "card_balance",
        message: `${label} 余额已达标: 当前 ${balance.balance_usd} USD，目标 ${centsToUsd(targetCents)} USD，可以开始直卡`,
        meta: { recharge_id: rechargeId, balance },
      });
      return { ok: true, recharged: true, recharge_id: rechargeId, recharge_amount_usd: rechargeAmount, balance, detail };
    }
    await sleep(Math.min(BALANCE_POLL_INTERVAL_MS, Math.max(250, deadline - Date.now())));
  }

  throw new PlatformStoreError(
    `${providerName.toUpperCase()}_BALANCE_TIMEOUT`,
    `${label} 充值已提交，但卡余额 ${Math.round(timeoutMs / 1000)} 秒内仍未达到 ${centsToUsd(targetCents)} USD`,
    { recharge_id: rechargeId, balance },
  );
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
  const label = cardProviderLabel(policy.provider);
  const target = targetFromCard(card);
  const stage = action === "unfreeze" ? "card_unfreeze" : "card_freeze";
  const verb = action === "unfreeze" ? "解冻" : "冻结";
  emit({
    level: "info",
    stage,
    message: `${label} 远程卡${verb}开始: ${card.masked_number || target.cardId || ""}`,
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
    message: `${label} 远程卡${verb}完成`,
    meta: { provider: policy.provider, provider_card_id: policy.provider_card_id, action, result: data },
  }, now());
  return { ok: true, action, data };
}

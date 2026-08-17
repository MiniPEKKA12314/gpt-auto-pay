import { nowSeconds } from "./constants.mjs";
import { reconcileKimooxOrphanOperation, runPlatformOrderWithRetry } from "./runner_adapter.mjs";

function defaultNow() {
  return nowSeconds();
}

function failingAdapter(error) {
  return {
    async execute() {
      throw error;
    },
  };
}

function pauseQueueAfterFailureIfEnabled(store, result = {}, now = defaultNow()) {
  const settings = store.getQueueSettings();
  const failedResults = Array.isArray(result.results) ? result.results.filter((row) => row.ok !== true) : [];
  if (!failedResults.length) return null;
  const failureCount = store.addQueueFailureCount(failedResults.length, 1, now);
  const threshold = Number(settings.auto_pause_failure_count || 0);
  if (threshold <= 0 || failureCount.failure_count < threshold) return null;
  const failed = failedResults[failedResults.length - 1];
  const after = store.pauseQueue(1, now);
  store.addRunLog({
    order_id: failed.order_id,
    attempt_id: 0,
    level: "error",
    stage: "queue_pause",
    message: `累计失败 ${failureCount.failure_count} 单，已达到阈值 ${threshold}，队列自动暂停，等待管理员处理后再恢复。`,
    meta: { order_no: failed.order_no, result: failed.result, failure_count: failureCount.failure_count, threshold },
  }, now);
  return after;
}

async function reconcilePendingProviderOperations(store, options = {}) {
  if (typeof store.listPendingProviderOperations !== "function") return [];
  const results = [];
  for (const attempt of store.listPendingProviderOperations("kimoox")) {
    try {
      const result = await reconcileKimooxOrphanOperation(store, attempt, options);
      results.push({ attempt_id: attempt.id, order_no: attempt.order_no, result });
      store.addRunLog({
        order_id: attempt.order_id,
        attempt_id: attempt.id,
        level: result?.ok === false ? "error" : "info",
        stage: "kimoox_recovery",
        message: result?.ok === false
          ? `Kimoox 重启恢复未完成: ${(result.errors || []).join("; ")}`
          : "Kimoox 重启恢复检查已完成",
        meta: result,
      }, options.now ? options.now() : defaultNow());
    } catch (error) {
      const result = { ok: false, errors: [error.message || String(error)] };
      results.push({ attempt_id: attempt.id, order_no: attempt.order_no, result });
      store.addRunLog({ order_id: attempt.order_id, attempt_id: attempt.id, level: "error", stage: "kimoox_recovery", message: `Kimoox 重启恢复失败: ${result.errors[0]}`, meta: result }, options.now ? options.now() : defaultNow());
    }
  }
  return results;
}

export async function runQueueOnce(store, adapterFactory, options = {}) {
  if (!store) throw new Error("store is required");
  if (typeof adapterFactory !== "function") throw new Error("adapterFactory is required");
  const now = options.now ?? defaultNow;
  const started = store.dispatchQueuedOrders(now(), { ignorePaused: options.ignorePaused === true });
  const results = await Promise.all(started.map(async (order) => {
    try {
      const result = await runPlatformOrderWithRetry(store, order.id, async (context) => {
        try {
          return await adapterFactory({
            store,
            order: context.order,
            plan: context.plan,
            card: context.card,
            billingAddress: context.billingAddress,
            attemptNo: context.attemptNo,
            attemptId: context.attemptId,
            retry: context.retry,
            signal: options.signal,
          });
        } catch (error) {
          return failingAdapter(error);
        }
      }, {
        now,
        signal: options.signal,
        fetchImpl: options.fetchImpl,
        cardProviderFactory: options.cardProviderFactory,
      });
      return {
        order_id: order.id,
        order_no: order.order_no,
        ok: result.ok === true,
        result,
      };
    } catch (error) {
      store.addRunLog({
        order_id: order.id,
        attempt_id: 0,
        level: "error",
        stage: "queue_worker",
        message: error.message || String(error),
        meta: { code: error.code || "QUEUE_ORDER_EXCEPTION" },
      }, now());
      let failedOrder = store.getOrderById(order.id);
      if (failedOrder.status !== "succeeded") {
        try {
          failedOrder = store.markOrderFailedAndReleaseCode(order.id, {
            admin_error: error.message || String(error),
          }, now()).order;
        } catch {
          failedOrder = store.getOrderById(order.id);
        }
      }
      if (typeof store.releaseOrderResourceLeases === "function") store.releaseOrderResourceLeases(order.id, now());
      return {
        order_id: order.id,
        order_no: order.order_no,
        ok: false,
        result: { ok: false, order: failedOrder, error: error.message || String(error) },
      };
    }
  }));

  const paused = pauseQueueAfterFailureIfEnabled(store, { results }, now());
  return {
    started,
    results,
    paused_on_failure: Boolean(paused),
    queue: store.queueSnapshot(),
  };
}

export function recoverWorkerRuntime(store, reason = "worker_recovered", now = defaultNow()) {
  if (!store) throw new Error("store is required");
  return {
    recovered: store.recoverRunningOrders(reason, now),
  };
}

export class PlatformQueueWorker {
  constructor(options = {}) {
    if (!options.store) throw new Error("store is required");
    if (typeof options.adapterFactory !== "function") throw new Error("adapterFactory is required");
    this.store = options.store;
    this.adapterFactory = options.adapterFactory;
    this.intervalMs = Number(options.intervalMs ?? 1000);
    this.now = options.now ?? defaultNow;
    this.signal = options.signal;
    this.fetchImpl = options.fetchImpl;
    this.cardProviderFactory = options.cardProviderFactory;
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
    this.timer = null;
    this.running = false;
    this.started = false;
    this.recoverRunningOnStart = options.recoverRunningOnStart === true;
  }

  start() {
    if (this.started) return this;
    this.started = true;
    if (this.recoverRunningOnStart) {
      const recovered = recoverWorkerRuntime(this.store, "worker_start_recovery", this.now());
      this.logger({ type: "recovery", ...recovered });
    }
    void reconcilePendingProviderOperations(this.store, {
      now: this.now,
      fetchImpl: this.fetchImpl,
      cardProviderFactory: this.cardProviderFactory,
    }).then((operations) => {
      if (operations.length) this.logger({ type: "kimoox_recovery", operations });
    }).catch((error) => this.logger({ type: "kimoox_recovery_error", error: error.message || String(error) }));
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, Math.max(100, this.intervalMs));
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    return this;
  }

  async tick() {
    if (this.running) return { skipped: true, reason: "worker_busy" };
    this.running = true;
    try {
      const result = await runQueueOnce(this.store, this.adapterFactory, {
        now: this.now,
        signal: this.signal,
        fetchImpl: this.fetchImpl,
        cardProviderFactory: this.cardProviderFactory,
      });
      if (result.started.length > 0 || result.results.length > 0) {
        this.logger({ type: "tick", ...result });
      }
      return result;
    } catch (error) {
      this.logger({ type: "error", error });
      throw error;
    } finally {
      this.running = false;
    }
  }
}

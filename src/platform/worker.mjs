import { nowSeconds } from "./constants.mjs";
import { runPlatformOrderWithRetry } from "./runner_adapter.mjs";

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
  if (!settings.pause_on_order_failure) return null;
  const failed = Array.isArray(result.results) ? result.results.find((row) => row.ok !== true) : null;
  if (!failed) return null;
  const after = store.pauseQueue(1, now);
  store.addRunLog({
    order_id: failed.order_id,
    attempt_id: 0,
    level: "error",
    stage: "queue_pause",
    message: "订单在当前重试策略内已失败，队列已按设置自动暂停，等待管理员处理后再恢复。",
    meta: { order_no: failed.order_no, result: failed.result },
  }, now);
  return after;
}

export async function runQueueOnce(store, adapterFactory, options = {}) {
  if (!store) throw new Error("store is required");
  if (typeof adapterFactory !== "function") throw new Error("adapterFactory is required");
  const now = options.now ?? defaultNow;
  const started = store.dispatchQueuedOrders(now(), { ignorePaused: options.ignorePaused === true });
  const results = [];

  for (const order of started) {
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
    results.push({
      order_id: order.id,
      order_no: order.order_no,
      ok: result.ok === true,
      result,
    });
  }

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

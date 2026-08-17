import { nowSeconds } from "./constants.mjs";
import { reconcileKimooxOrphanOperation, runPlatformOrderWithRetry } from "./runner_adapter.mjs";
import { spawn } from "node:child_process";

function defaultNow() {
  return nowSeconds();
}

export class OrderExecutionRegistry {
  constructor() {
    this.active = new Map();
  }

  begin(orderId) {
    const controller = new AbortController();
    const children = new Set();
    const execution = {
      orderId: Number(orderId),
      controller,
      signal: controller.signal,
      registerChildProcess: (child) => {
        if (!child || typeof child.once !== "function") return null;
        children.add(child);
        const remove = () => children.delete(child);
        child.once("exit", remove);
        child.once("error", remove);
        return child;
      },
      abort: (reason = "terminated_by_admin") => {
        if (!controller.signal.aborted) controller.abort(reason);
        for (const child of children) {
          try {
            if (process.platform === "win32" && child.pid) {
              const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
              killer.unref?.();
            } else if (child.pid) {
              process.kill(-child.pid, "SIGTERM");
            } else {
              child.kill?.("SIGTERM");
            }
          } catch {
            try { child.kill?.("SIGTERM"); } catch { }
          }
        }
      },
    };
    this.active.set(Number(orderId), execution);
    return execution;
  }

  get(orderId) {
    return this.active.get(Number(orderId)) ?? null;
  }

  abort(orderId, reason = "terminated_by_admin") {
    const execution = this.get(orderId);
    execution?.abort(reason);
    return Boolean(execution);
  }

  end(orderId, execution) {
    if (this.active.get(Number(orderId)) === execution) this.active.delete(Number(orderId));
  }

  abortAll(reason = "worker_stopped") {
    for (const execution of this.active.values()) execution.abort(reason);
  }
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
    const execution = options.executionRegistry?.begin(order.id);
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
            signal: context.signal,
            registerChildProcess: context.registerChildProcess,
          });
        } catch (error) {
          return failingAdapter(error);
        }
      }, {
        now,
        signal: execution?.signal ?? options.signal,
        registerChildProcess: execution?.registerChildProcess,
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
      if (!["succeeded", "interrupted_review"].includes(failedOrder.status)) {
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
    } finally {
      options.executionRegistry?.end(order.id, execution);
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
    this.executionRegistry = options.executionRegistry ?? new OrderExecutionRegistry();
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
    this.executionRegistry.abortAll("worker_stopped");
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
        executionRegistry: this.executionRegistry,
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

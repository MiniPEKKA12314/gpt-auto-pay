import type { RowData } from "@/api/admin";
import { compactJson, formatTime } from "@/utils/format";

export type OrderLogEntry = RowData & {
  id: string;
  created_at: number;
  stage: string;
  message: string;
  level: string;
};

function safeObject(value: unknown): RowData {
  if (!value) return {};
  if (typeof value === "object") return value as RowData;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function compactOrderMeta(value: unknown, stage: string) {
  const json = safeObject(value);
  if (!Object.keys(json).length) return "";
  const isProxy = stage.toLowerCase().includes("proxy") || stage.includes("代理");
  if (isProxy) {
    const parts = [
      json.redactedProxyUrl ? `代理=${json.redactedProxyUrl}` : "",
      json.provider ? `来源=${json.provider}` : "",
      json.kind ? `用途=${json.kind === "checkout" ? "提链" : json.kind === "direct_card" ? "直卡" : json.kind}` : "",
      json.ipwo?.session ? `session=${json.ipwo.session}` : "",
      json.reason ? `原因=${json.reason}` : "",
      json.error ? `错误=${json.error}` : ""
    ].filter(Boolean);
    return parts.length ? ` ${parts.join(" / ")}` : "";
  }
  const summary: RowData = {};
  for (const key of ["code", "status", "ok", "action", "category", "message", "error", "reason"]) {
    if (json[key] !== undefined && json[key] !== null && json[key] !== "") summary[key] = json[key];
  }
  if (json.retry?.policy) {
    summary.retry = {
      attempt_no: json.retry.attempt_no,
      checkout_proxy_attempt_index: json.retry.checkout_proxy_attempt_index,
      proxy_attempt_index: json.retry.proxy_attempt_index,
      card_attempt_index: json.retry.card_attempt_index
    };
  }
  return Object.keys(summary).length ? ` ${compactJson(summary)}` : "";
}

export function buildOrderProcessLogs(detail: RowData): OrderLogEntry[] {
  const order = detail.order || {};
  const attempts = Array.isArray(detail.attempts) ? detail.attempts : [];
  const logs = Array.isArray(detail.logs) ? detail.logs : [];
  const runtime = detail.runtime || {};
  const entries: OrderLogEntry[] = [];
  let sequence = 0;
  const append = (createdAt: unknown, stage: string, message: string, level = "info") => {
    entries.push({
      id: `order-log-${sequence++}`,
      created_at: Number(createdAt || order.created_at || 0),
      stage,
      message,
      level
    });
  };

  if (order.id || order.order_no) {
    append(order.created_at, "订单", `订单号: ${order.order_no || "-"}; 套餐: ${order.plan_type || "-"}; 状态: ${order.status || "-"}`, order.status);
  }
  if (order.public_message) append(order.updated_at || order.created_at, "公开提示", String(order.public_message));
  if (order.admin_error) append(order.updated_at || order.finished_at || order.created_at, "错误", String(order.admin_error), "error");

  const runtimeBits = [];
  if (runtime.has_access_token) runtimeBits.push("Access Token 已保存");
  if (runtime.has_session_token) runtimeBits.push("Session Token 已保存");
  if (runtime.checkout_input) runtimeBits.push(`checkout_input=${runtime.checkout_input}`);
  if (runtimeBits.length) append(runtime.updated_at || order.updated_at || order.created_at, "运行资料", runtimeBits.join("; "));

  for (const attempt of attempts) {
    const title = `尝试 #${attempt.attempt_no || attempt.id}`;
    append(attempt.started_at || attempt.created_at, title, `状态: ${attempt.status || "-"}; 阶段: ${attempt.stage || "-"}`, attempt.status);
    if (attempt.checkout_proxy || attempt.direct_card_proxy) {
      append(attempt.started_at || attempt.created_at, "代理", `提链代理: ${attempt.checkout_proxy || "无"}; 直卡代理: ${attempt.direct_card_proxy || "无"}`);
    }
    if (attempt.error_code || attempt.error_message) {
      append(attempt.finished_at || attempt.started_at, "错误", `${attempt.error_code ? `${attempt.error_code}: ` : ""}${attempt.error_message || ""}`, "error");
    }
  }

  if (logs.length) {
    for (const log of logs) {
      const stage = String(log.stage || log.level || "日志");
      append(log.created_at, stage, `${log.message || ""}${compactOrderMeta(log.meta_json, stage)}`, log.level);
    }
  } else {
    append(order.updated_at || order.created_at, "日志", "暂无运行日志");
  }

  if (order.status === "succeeded") append(order.finished_at || order.updated_at, "结果", "订阅成功，订单已完成", "success");
  if (order.status === "failed") append(order.finished_at || order.updated_at, "结果", `订单失败${order.admin_error ? `: ${order.admin_error}` : ""}`, "error");
  return entries;
}

export function orderProcessLogText(detail: RowData) {
  return buildOrderProcessLogs(detail)
    .map(log => `● [${formatTime(log.created_at)}] [${log.stage}] ${log.message}`)
    .join("\n");
}

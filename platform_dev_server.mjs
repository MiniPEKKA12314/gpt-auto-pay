import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { openPlatformDb, PlatformStore } from "./src/platform/db.mjs";
import { listenPlatformServer } from "./src/platform/server.mjs";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8877);
const dbPath = resolve(process.env.PLATFORM_DB_PATH || "output/platform-dev.db");
const adminToken = process.env.PLATFORM_ADMIN_TOKEN || "dev-admin-token";
const adminPassword = process.env.PLATFORM_ADMIN_PASSWORD || "Admin-Change-2026!";
const autoQueueWorker = process.env.PLATFORM_AUTO_WORKER !== "0";
const queueWorkerIntervalMs = Number(process.env.PLATFORM_QUEUE_INTERVAL_MS || 1000);
const publicHosts = process.env.PLATFORM_PUBLIC_HOSTS || "redeem.ayuekp.store";
const adminHosts = process.env.PLATFORM_ADMIN_HOSTS || "minipekka.ayuekp.store,127.0.0.1,localhost";

mkdirSync(dirname(dbPath), { recursive: true });

const db = openPlatformDb(dbPath);
const store = new PlatformStore(db, { adminPassword });
const app = await listenPlatformServer({
  store,
  host,
  port,
  adminToken,
  publicHosts,
  adminHosts,
  autoQueueWorker,
  queueWorkerIntervalMs,
  recoverRunningOnStart: true,
  queueWorkerLogger(event) {
    if (event?.type === "tick") {
      console.log(`[queue] processed ${event.results.length} order(s)`);
    } else if (event?.type === "recovery") {
      console.log(`[queue] recovered ${event.recovered} running order(s)`);
    } else if (event?.type === "error") {
      console.log(`[queue] error: ${event.error?.message || event.error}`);
    }
  },
});

console.log(`gpt-auto-pay platform API listening at ${app.url}`);
console.log(`database: ${dbPath}`);
console.log(`admin token: ${adminToken ? "<configured>" : "<empty>"}`);
console.log("admin login: admin / <configured password>");
console.log(`auto queue worker: ${autoQueueWorker ? `enabled (${queueWorkerIntervalMs}ms)` : "disabled"}`);
console.log("");
console.log("examples:");
console.log(`  curl ${app.url}/health`);
console.log(`  curl -H "x-admin-token: <admin-token>" ${app.url}/api/admin/dashboard`);

async function shutdown() {
  await app.close();
  store.close();
}

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});

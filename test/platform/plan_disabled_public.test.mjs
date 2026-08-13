import assert from "node:assert/strict";
import test from "node:test";

import { openPlatformDb, PlatformStore } from "../../src/platform/db.mjs";
import { listenPlatformServer } from "../../src/platform/server.mjs";

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json();
  return { response, body };
}

test("public redeem rejects disabled plan before locking code", async () => {
  const db = openPlatformDb(":memory:");
  const store = new PlatformStore(db, { secretKey: "local-development-secret" });
  store.upsertPlanConfig({ ...store.getPlanConfig("plus"), enabled: false }, 10);
  store.createRedeemBatchWithCodes({ name: "disabled", plan_type: "plus", quantity: 1, codeFactory: () => "PLUS-DISABLED-PLAN" }, 11);
  const app = await listenPlatformServer({ store, autoQueueWorker: false });
  try {
    const result = await jsonFetch(`${app.url}/api/public/redeem`, {
      method: "POST",
      body: JSON.stringify({ code: "PLUS-DISABLED-PLAN", accessToken: "at", sessionToken: "st" }),
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.code, "PLAN_DISABLED");
    assert.equal(store.getRedeemCodeByDisplay("PLUS-DISABLED-PLAN").status, "unused");
  } finally {
    await app.close();
    store.close();
  }
});

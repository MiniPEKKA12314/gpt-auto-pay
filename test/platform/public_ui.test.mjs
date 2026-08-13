import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { renderPublicUi } from "../../src/platform/public_ui.mjs";

function loadPublicScript() {
  const html = renderPublicUi();
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: "",
        textContent: "",
        innerHTML: "",
        className: "",
        disabled: false,
        classList: { toggle() {} },
        addEventListener() {},
      });
    }
    return elements.get(id);
  }
  const sandbox = {
    document: { getElementById: element },
    window: {
      atob(value) { return Buffer.from(value, "base64").toString("binary"); },
      setInterval() { return 1; },
      clearInterval() {},
      setTimeout(fn) { fn(); return 1; },
      clearTimeout() {},
    },
    localStorage: {
      getItem() { return ""; },
      setItem() {},
      removeItem() {},
    },
    fetch() {
      throw new Error("fetch not expected in public UI parser test");
    },
    console,
    Set,
    JSON,
    String,
    Array,
    Object,
    Number,
    Math,
    decodeURIComponent,
    encodeURIComponent,
    Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return sandbox;
}

test("public UI extracts tokens from ChatGPT auth session JSON", () => {
  const sandbox = loadPublicScript();
  const input = JSON.stringify({
    user: { email: "user@example.test" },
    accessToken: jwtWithPlan("free"),
    sessionToken: "session-token-secret",
  });
  const parsed = vm.runInContext(`parseCredential(${JSON.stringify(input)})`, sandbox);
  assert.equal(parsed.accountPlan.plan, "free");
  assert.equal(parsed.sessionToken, "session-token-secret");
});

test("public UI repairs a session JSON missing the last brace", () => {
  const sandbox = loadPublicScript();
  const input = JSON.stringify({ accessToken: jwtWithPlan("free"), sessionToken: "session-token-secret" }).slice(0, -1);
  const parsed = vm.runInContext(`parseCredential(${JSON.stringify(input)})`, sandbox);
  assert.equal(parsed.accountPlan.plan, "free");
  assert.equal(parsed.sessionToken, "session-token-secret");
  assert.match(parsed.warning, /自动补齐/);
});

test("public UI reports missing required auth session fields", () => {
  const sandbox = loadPublicScript();
  const input = JSON.stringify({ accessToken: jwtWithPlan("free") });
  assert.throws(
    () => vm.runInContext(`parseCredential(${JSON.stringify(input)})`, sandbox),
    /没有识别到 Session Token/,
  );
});

function jwtWithPlan(plan) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_plan_type: plan } })}.signature`;
}

test("public UI accepts only free account access tokens", () => {
  const sandbox = loadPublicScript();
  const freeInput = JSON.stringify({ accessToken: jwtWithPlan("free"), sessionToken: "session" });
  const free = vm.runInContext(`parseCredential(${JSON.stringify(freeInput)})`, sandbox);
  assert.equal(free.accountPlan.plan, "free");

  for (const plan of ["plus", "pro", "go", "team", "business"]) {
    const paidInput = JSON.stringify({ accessToken: jwtWithPlan(plan), sessionToken: "session" });
    assert.throws(
      () => vm.runInContext(`parseCredential(${JSON.stringify(paidInput)})`, sandbox),
      new RegExp(`已生效套餐 ${plan}`),
    );
  }
});

test("public UI rejects access tokens without a recognizable plan", () => {
  const sandbox = loadPublicScript();
  const token = `${Buffer.from("{}").toString("base64url")}.${Buffer.from("{}").toString("base64url")}.signature`;
  const input = JSON.stringify({ accessToken: token, sessionToken: "session" });
  assert.throws(
    () => vm.runInContext(`parseCredential(${JSON.stringify(input)})`, sandbox),
    /无法从 Access Token 识别账号套餐/,
  );
});

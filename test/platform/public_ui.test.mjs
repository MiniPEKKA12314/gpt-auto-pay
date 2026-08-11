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
    accessToken: "access-token-secret",
    sessionToken: "session-token-secret",
  });
  const parsed = vm.runInContext(`parseCredential(${JSON.stringify(input)})`, sandbox);
  assert.equal(parsed.accessToken, "access-token-secret");
  assert.equal(parsed.sessionToken, "session-token-secret");
});

test("public UI repairs a session JSON missing the last brace", () => {
  const sandbox = loadPublicScript();
  const input = '{"accessToken":"access-token-secret","sessionToken":"session-token-secret"';
  const parsed = vm.runInContext(`parseCredential(${JSON.stringify(input)})`, sandbox);
  assert.equal(parsed.accessToken, "access-token-secret");
  assert.equal(parsed.sessionToken, "session-token-secret");
  assert.match(parsed.warning, /自动补齐/);
});

test("public UI reports missing required auth session fields", () => {
  const sandbox = loadPublicScript();
  const input = JSON.stringify({ accessToken: "access-token-secret" });
  assert.throws(
    () => vm.runInContext(`parseCredential(${JSON.stringify(input)})`, sandbox),
    /没有识别到 Session Token/,
  );
});

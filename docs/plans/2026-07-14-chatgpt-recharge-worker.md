# ChatGPT Recharge Worker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a long-lived Node.js worker that accepts an order ID and ChatGPT access token over JSONL stdin, pays a configured subscription through Stripe Checkout, pauses for admin-supplied 3DS OTP, verifies the subscription, disables renewal, and emits machine-readable stage events.

**Architecture:** Keep ChatGPT API work in a small HTTP client and use Playwright only for Stripe Elements and 3DS. A deterministic order state machine coordinates card-pool locks, idempotent recovery, subscription polling, and a pluggable cancellation adapter. Secrets remain in memory or the local payment configuration and never enter stdout/stderr.

**Tech Stack:** Node.js 24 ESM, built-in `node:test`, Playwright, Undici `ProxyAgent`, JSON Lines, HAR fixtures.

---

Repository note: `D:\w\test` was not a Git repository when this plan was written. Before executing commit steps, place the files in the intended repository or initialize version control explicitly.

### Task 1: Establish the Node project and protocol module

**Files:**
- Create: `package.json`
- Create: `src/protocol.mjs`
- Create: `test/protocol.test.mjs`

**Step 1: Write the failing protocol tests**

Test that `parseCommand` accepts `start`, `3ds_code`, and `cancel`; rejects malformed JSON and mismatched fields; and that `serializeEvent` always emits one redacted JSON line.

```js
test("parseCommand accepts a start command", () => {
  assert.deepEqual(parseCommand('{"type":"start","order_id":"o1","access_token":"at"}'), {
    type: "start",
    order_id: "o1",
    access_token: "at",
  });
});

test("serializeEvent omits secrets", () => {
  const line = serializeEvent({
    event: "STARTED",
    order_id: "o1",
    access_token: "secret-token",
  });
  assert.doesNotMatch(line, /secret-token/);
  assert.equal(JSON.parse(line).event, "STARTED");
});
```

**Step 2: Run the test and verify failure**

Run: `node --test test/protocol.test.mjs`

Expected: FAIL because `src/protocol.mjs` does not exist.

**Step 3: Implement the minimal protocol**

Export:

```js
export function parseCommand(line) { /* strict JSON object validation */ }
export function createEvent(event, orderId, fields = {}) { /* timestamp + fields */ }
export function serializeEvent(event) { /* secret-key filtering + JSON.stringify */ }
```

Reject blank `order_id`, blank access tokens, unsupported command types, and a `3ds_code` without `code`.

**Step 4: Run the test and verify pass**

Run: `node --test test/protocol.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json src/protocol.mjs test/protocol.test.mjs
git commit -m "feat: add recharge worker JSONL protocol"
```

### Task 2: Parse and validate payment configuration

**Files:**
- Create: `src/config.mjs`
- Create: `payment.example.json`
- Create: `.gitignore`
- Create: `test/config.test.mjs`

**Step 1: Write failing configuration tests**

Cover a valid PH/PHP configuration, duplicate card IDs, missing card fields, non-HTTP proxy URLs, invalid concurrency, and a country/currency mismatch.

```js
test("loadPaymentConfig returns a normalized card pool", async () => {
  const config = validatePaymentConfig(validFixture);
  assert.equal(config.country, "PH");
  assert.equal(config.currency, "PHP");
  assert.equal(config.proxy, "http://127.0.0.1:7890");
  assert.equal(config.cards[0].max_concurrency, 1);
});
```

**Step 2: Verify failure**

Run: `node --test test/config.test.mjs`

Expected: FAIL because the config module is missing.

**Step 3: Implement configuration validation**

Export `loadPaymentConfig(path)` and `validatePaymentConfig(value)`. Keep card values as strings, assign defaults for timeouts, freeze the returned top-level object, and never include raw field values in validation errors.

Add these ignore entries:

```gitignore
payment.json
runtime/
playwright-report/
test-results/
```

**Step 4: Verify pass**

Run: `node --test test/config.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/config.mjs payment.example.json .gitignore test/config.test.mjs
git commit -m "feat: validate recharge payment configuration"
```

### Task 3: Implement the order state machine

**Files:**
- Create: `src/order_state.mjs`
- Create: `test/order_state.test.mjs`

**Step 1: Write failing transition tests**

Test the happy path, 3DS loop, card decline, unknown payment status, subscription pending, paid cancellation pending, and rejection of illegal transitions.

```js
test("success requires renewal to be disabled", () => {
  const order = createOrderState("o1");
  for (const event of [
    "TOKEN_VALIDATED", "CHECKOUT_CREATED", "PAYMENT_SUBMITTED",
    "STRIPE_PAYMENT_SUCCEEDED", "SUBSCRIPTION_UPDATED",
    "CANCELLATION_REQUESTED", "RENEWAL_DISABLED", "SUCCESS",
  ]) transition(order, event);
  assert.equal(order.status, "SUCCESS");
});
```

**Step 2: Verify failure**

Run: `node --test test/order_state.test.mjs`

Expected: FAIL because the state module is missing.

**Step 3: Implement explicit transitions**

Use an adjacency map rather than scattered conditionals. Export `createOrderState`, `transition`, `isPaidState`, `isTerminalState`, and `nextRecoveryAction`. `nextRecoveryAction` must return `reconcile_payment` for ambiguous paid stages and `cancel_renewal` for `PAID_CANCELLATION_PENDING`.

**Step 4: Verify pass**

Run: `node --test test/order_state.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/order_state.mjs test/order_state.test.mjs
git commit -m "feat: add idempotent recharge order state machine"
```

### Task 4: Add cross-process card-pool locking

**Files:**
- Create: `src/card_pool.mjs`
- Create: `test/card_pool.test.mjs`

**Step 1: Write failing lock tests**

Use temporary directories. Verify that `acquireCard` selects enabled cards, honors `max_concurrency`, prevents two processes from taking the same slot, skips cooldown cards, and releases locks in `finally`.

**Step 2: Verify failure**

Run: `node --test test/card_pool.test.mjs`

Expected: FAIL because `src/card_pool.mjs` is missing.

**Step 3: Implement file locks**

Use atomic `fs.open(path, "wx")` lock creation under `runtime/card-locks/<card-id>/<slot>.lock`. Store only order ID, PID, and timestamp. Export:

```js
export async function acquireCard(cards, runtimeDir, orderId) { /* returns lease */ }
export async function releaseCard(lease) { /* idempotent unlink */ }
export async function markCardCooldown(runtimeDir, cardId, until, reasonCode) { /* no secrets */ }
```

**Step 4: Verify pass**

Run: `node --test test/card_pool.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/card_pool.mjs test/card_pool.test.mjs
git commit -m "feat: add cross-process payment card leases"
```

### Task 5: Extract the ChatGPT checkout client

**Files:**
- Create: `src/http_client.mjs`
- Create: `src/chatgpt_client.mjs`
- Modify: `checkout_ph_dry_run.mjs`
- Create: `test/chatgpt_client.test.mjs`

**Step 1: Write failing HTTP fixture tests**

Start a local HTTP fixture and verify authorization injection, header allowlisting, PH/PHP request rewriting, checkout response parsing, proxy dispatcher construction, response redaction, and non-2xx error mapping.

**Step 2: Verify failure**

Run: `node --test test/chatgpt_client.test.mjs`

Expected: FAIL because the client modules are missing.

**Step 3: Implement the HTTP and checkout clients**

Use Undici `ProxyAgent` when a proxy is configured. Reuse or move the tested helpers from `checkout_ph_dry_run.mjs` without changing its CLI behavior. Export a dependency-injected class:

```js
export class ChatGptClient {
  constructor({ baseUrl = "https://chatgpt.com", proxyUrl, fetchImpl }) {}
  async validateToken(accessToken) {}
  async createCheckout({ accessToken, plan, country, currency, harTemplate }) {}
  async getAccountState(accessToken) {}
}
```

Return a normalized checkout object containing only the checkout URL/session ID and browser-required public fields. Keep client secrets in a private internal object.

**Step 4: Run old and new tests**

Run: `node --test checkout_ph_dry_run.test.mjs test/chatgpt_client.test.mjs`

Expected: all tests PASS.

**Step 5: Commit**

```bash
git add src/http_client.mjs src/chatgpt_client.mjs checkout_ph_dry_run.mjs test/chatgpt_client.test.mjs
git commit -m "feat: add reusable ChatGPT checkout client"
```

### Task 6: Parse subscription and renewal state

**Files:**
- Create: `src/subscription.mjs`
- Create: `test/subscription.test.mjs`
- Create: `test/fixtures/account-active-renewing.json`
- Create: `test/fixtures/account-active-cancelled.json`

**Step 1: Write failing parser and polling tests**

Cover default and named accounts, active target plan, pending synchronization, `will_renew: false`, non-empty `cancels_at`, and timeout behavior with a fake clock.

```js
test("renewal is disabled only when both signals agree", () => {
  const state = parseAccountState(cancelledFixture, "chatgptplusplan");
  assert.equal(state.subscription_active, true);
  assert.equal(state.renewal_disabled, true);
});
```

**Step 2: Verify failure**

Run: `node --test test/subscription.test.mjs`

Expected: FAIL because the subscription module is missing.

**Step 3: Implement parsers and poller**

Export `parseAccountState(payload, plan)` and `pollAccountState({ getState, predicate, timeoutMs, intervalMs, signal })`. Treat `will_renew === false` plus a populated cancellation timestamp as the renewal-disabled condition.

**Step 4: Verify pass**

Run: `node --test test/subscription.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/subscription.mjs test/subscription.test.mjs test/fixtures/account-*.json
git commit -m "feat: verify subscription and renewal state"
```

### Task 7: Build a local Stripe and 3DS browser fixture

**Files:**
- Create: `test/fixtures/stripe-checkout.html`
- Create: `test/fixtures/three-ds.html`
- Create: `test/fixture_server.mjs`
- Create: `test/stripe_browser.test.mjs`

**Step 1: Create fixture behavior and failing browser tests**

The checkout fixture must expose separate card-number, expiry, CVC, billing, submit, decline, success, and 3DS iframe states. The 3DS fixture must reject one OTP and accept a configured OTP.

**Step 2: Install dependencies and verify failure**

Run: `npm install`

Run: `npx playwright install chromium`

Run: `node --test test/stripe_browser.test.mjs`

Expected: FAIL because the browser executor is missing.

**Step 3: Keep the fixture deterministic**

Use query parameters such as `?result=success`, `?result=decline`, and `?result=3ds`; never make network requests to Stripe or ChatGPT from this fixture.

**Step 4: Commit the fixture**

```bash
git add package-lock.json test/fixtures/stripe-checkout.html test/fixtures/three-ds.html test/fixture_server.mjs test/stripe_browser.test.mjs
git commit -m "test: add deterministic Stripe and 3DS fixtures"
```

### Task 8: Implement Playwright Stripe and 3DS execution

**Files:**
- Create: `src/stripe_browser.mjs`
- Create: `src/three_ds.mjs`
- Modify: `test/stripe_browser.test.mjs`

**Step 1: Complete failing behavior tests**

Verify proxy launch options, card field filling, billing filling, success detection, decline code extraction, challenge-frame detection, `WAITING_3DS`, rejected OTP, accepted OTP, and AbortSignal cancellation.

**Step 2: Verify failure**

Run: `node --test test/stripe_browser.test.mjs`

Expected: FAIL because the executor modules are missing.

**Step 3: Implement browser executor**

Export:

```js
export class StripeBrowserExecutor {
  async openCheckout({ url, proxyUrl, card, billing, signal }) {}
  async submitPayment() {}
  async inspectStatus() {}
  async close() {}
}

export class ThreeDsController {
  async detect(page) {}
  async submitCode(code) {}
}
```

Use prioritized locator lists for Stripe iframes and inputs. Log locator names and stage codes only. Never attach tracing, video, screenshots, or DOM dumps in production mode because they can contain card or OTP data.

**Step 4: Verify pass**

Run: `node --test test/stripe_browser.test.mjs`

Expected: PASS for success, decline, and 3DS cases.

**Step 5: Commit**

```bash
git add src/stripe_browser.mjs src/three_ds.mjs test/stripe_browser.test.mjs
git commit -m "feat: automate Stripe checkout and 3DS OTP"
```

### Task 9: Add the cancellation adapter boundary

**Files:**
- Create: `src/cancellation.mjs`
- Create: `test/cancellation.test.mjs`
- Create: `test/fixtures/cancellation-pending.json`
- Create: `test/fixtures/cancellation-disabled.json`

**Step 1: Write failing adapter tests**

Test request success, retryable errors, already-disabled renewal, and the pending state returned when no live HAR adapter is configured.

**Step 2: Verify failure**

Run: `node --test test/cancellation.test.mjs`

Expected: FAIL because the cancellation module is missing.

**Step 3: Implement the boundary and fixture adapter**

```js
export class CancellationAdapter {
  async requestCancellation(context) {
    return { status: "pending", code: "CANCELLATION_ADAPTER_PENDING" };
  }
}

export class FixtureCancellationAdapter extends CancellationAdapter {
  constructor(sequence) { super(); this.sequence = sequence; }
  async requestCancellation() { return this.sequence.shift(); }
}
```

Keep the real HTTP adapter as a separate future class populated from the cancellation HAR. The worker protocol and state machine must already handle both pending and completed results.

**Step 4: Verify pass**

Run: `node --test test/cancellation.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/cancellation.mjs test/cancellation.test.mjs test/fixtures/cancellation-*.json
git commit -m "feat: add renewal cancellation adapter boundary"
```

### Task 10: Assemble the long-lived recharge worker

**Files:**
- Create: `recharge_worker.mjs`
- Create: `src/recharge_service.mjs`
- Create: `test/recharge_service.test.mjs`

**Step 1: Write failing orchestration tests**

Inject fake ChatGPT, browser, card pool, cancellation, clock, stdin, stdout, and stderr dependencies. Cover:

- happy path through `SUCCESS`;
- 3DS wait, rejected code, second code, and resume;
- card decline before charge;
- payment timeout reconciliation;
- paid subscription with cancellation pending;
- cancellation command and cleanup;
- card lease release on every path.

**Step 2: Verify failure**

Run: `node --test test/recharge_service.test.mjs`

Expected: FAIL because the service is missing.

**Step 3: Implement dependency-injected orchestration**

`runRechargeOrder(deps, startCommand)` must emit each state transition exactly once. `recharge_worker.mjs` reads lines with `readline/promises`, routes commands by order ID, writes serialized events to stdout, and sets exit code only after a terminal event or explicit cancellation.

The process must stay alive in `WAITING_3DS`, ignore mismatched order IDs, accept repeated OTP commands, and release browser/card resources in `finally`.

**Step 4: Verify pass**

Run: `node --test test/recharge_service.test.mjs`

Expected: PASS for all injected scenarios.

**Step 5: Commit**

```bash
git add recharge_worker.mjs src/recharge_service.mjs test/recharge_service.test.mjs
git commit -m "feat: orchestrate self-service recharge worker"
```

### Task 11: Add real subprocess protocol tests

**Files:**
- Create: `test/recharge_worker.integration.test.mjs`
- Create: `test/fixtures/payment.fixture.json`

**Step 1: Write the subprocess test**

Spawn `node recharge_worker.mjs --fixture-mode`, write a `start` command, assert ordered JSONL events, wait for `WAITING_3DS`, write a `3ds_code` command, and assert the final fixture result. Add malformed input and cancellation cases.

**Step 2: Run and verify failure**

Run: `node --test test/recharge_worker.integration.test.mjs`

Expected: FAIL until fixture-mode dependency wiring is implemented.

**Step 3: Add fixture-mode wiring**

Fixture mode must require an explicit CLI flag and local fixture URL. It must never be selected from user-controlled stdin and must never read `payment.json`.

**Step 4: Run complete suite**

Run: `npm test`

Expected: existing 13 dry-run tests and all new tests PASS.

**Step 5: Commit**

```bash
git add test/recharge_worker.integration.test.mjs test/fixtures/payment.fixture.json recharge_worker.mjs package.json
git commit -m "test: verify recharge worker subprocess protocol"
```

### Task 12: Document operation and verify the deliverable

**Files:**
- Create: `README.md`
- Modify: `payment.example.json`

**Step 1: Document exact invocation**

Include dependency installation, Chromium installation, `payment.json` creation, proxy prerequisite, JSONL command/event examples, 3DS admin flow, event meanings, process exit behavior, card-lock cleanup, and cancellation-adapter status.

**Step 2: Document secret-handling requirements**

State that the caller sends access tokens and OTP through stdin, parses stdout as JSONL, treats stderr as sensitive operational diagnostics, restricts filesystem access to `payment.json`, and does not persist stdin payloads.

**Step 3: Run formatting/syntax checks**

Run: `node --check recharge_worker.mjs`

Run: `Get-ChildItem src -Filter *.mjs | ForEach-Object { node --check $_.FullName }`

Expected: every command exits 0.

**Step 4: Run all tests from a clean process**

Run: `npm test`

Expected: all tests PASS with no access token, card number, CVC, OTP, Cookie, or client secret in output.

**Step 5: Review the diff and commit**

```bash
git status --short
git diff --check
git add README.md payment.example.json
git commit -m "docs: add recharge worker operations guide"
```

### Task 13: Integrate the future cancellation HAR

**Files:**
- Create: `src/chatgpt_cancellation_adapter.mjs`
- Create: `test/chatgpt_cancellation_adapter.test.mjs`
- Add fixture: `test/fixtures/cancel_subscription.har`

**Step 1: Add a redacted HAR fixture**

Retain only the cancellation request/response fields needed by the adapter. Replace access tokens, cookies, account IDs, subscription IDs, checkout IDs, and client secrets with placeholders.

**Step 2: Write failing extraction and request tests**

Verify method, path, allowed headers, body rewriting, bearer-token injection, already-cancelled response handling, retryable response handling, and redacted errors.

**Step 3: Implement the real adapter**

Implement `ChatGptCancellationAdapter extends CancellationAdapter`. Use the injected HTTP client and access token, then call `getAccountState` to verify both `will_renew === false` and a populated cancellation timestamp.

**Step 4: Run focused and full tests**

Run: `node --test test/chatgpt_cancellation_adapter.test.mjs test/cancellation.test.mjs test/recharge_service.test.mjs`

Run: `npm test`

Expected: all tests PASS and the fixture happy path reaches `RENEWAL_DISABLED` followed by `SUCCESS`.

**Step 5: Commit**

```bash
git add src/chatgpt_cancellation_adapter.mjs test/chatgpt_cancellation_adapter.test.mjs test/fixtures/cancel_subscription.har
git commit -m "feat: disable ChatGPT subscription renewal"
```

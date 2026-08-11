import assert from "node:assert/strict";
import test from "node:test";

import { decryptSecret, deriveAesKey, encryptSecret, maskCardNumber } from "../../src/platform/crypto.mjs";

test("card secrets encrypt and decrypt with APP_SECRET_KEY", () => {
  const key = "local-development-secret";
  const encrypted = encryptSecret("4242424242424242", key, { iv: Buffer.alloc(12, 1) });
  assert.doesNotMatch(encrypted, /424242/);
  assert.equal(decryptSecret(encrypted, key), "4242424242424242");
  assert.throws(() => decryptSecret(encrypted, "another-local-development-secret"), /Unsupported state|authenticate/i);
});

test("APP_SECRET_KEY is validated before deriving AES key", () => {
  assert.equal(deriveAesKey("local-development-secret").length, 32);
  assert.throws(() => deriveAesKey("short"), /at least 16/);
});

test("card number masking keeps the first and last four digits", () => {
  assert.equal(maskCardNumber("4242 4242 4242 1234"), "4242 **** **** 1234");
  assert.equal(maskCardNumber("123"), "123* **** **** *123");
  assert.equal(maskCardNumber(""), "**** **** **** ****");
});

#!/usr/bin/env node
import dns from "node:dns/promises";
import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import net from "node:net";
import process from "node:process";
import tls from "node:tls";
import zlib from "node:zlib";

const CHECKOUT_ENDPOINT = "https://chatgpt.com/backend-api/payments/checkout";
const CHECKOUT_UPDATE_ENDPOINT = "https://chatgpt.com/backend-api/payments/checkout/update";
const EMBEDDED_CHECKOUT_CAPTURED_AT = "2026-07-13T09:01:13.703Z";
const EMBEDDED_CHECKOUT_PROXY_HOST = "127.0.0.1";
const EMBEDDED_CHECKOUT_PROXY_PORT = "7890";
const DEFAULT_UI_PORT = 8787;
const DEFAULT_PLAN_NAME = "chatgptplusplan";
const DEFAULT_PAYMENT_COUNTRY = "PH";
const DEFAULT_PAYMENT_CURRENCY = "PHP";
export const CHECKOUT_PLAN_OPTIONS = Object.freeze([
  { value: "chatgptgoplan", label: "Go" },
  { value: "chatgptplusplan", label: "Plus" },
  { value: "chatgptprolite", label: "Pro 5x" },
  { value: "chatgptpro", label: "Pro 20x" },
]);
export const SUPPORTED_PAYMENT_COUNTRY_CODES = Object.freeze(
  "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CO KM CG CD CR CI HR CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PS PA PG PY PE PH PL PT QA RO RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR ES LK SD SR SE CH TW TJ TZ TH TL TG TO TT TN TR TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW AS AW AX BM BQ BV CC CK CW CX EH FK FO GF GG GI GL GP GU IM JE KY MQ MS NC NF NU PF PM PN PR RE SH SJ SX TC TK UM VG VI WF YT HK MO"
    .split(" "),
);
export const SUPPORTED_PAYMENT_CURRENCY_CODES = Object.freeze(
  "AED AUD BRL CAD CHF CLP COP CZK DKK EGP EUR GBP HUF IDR ILS INR JPY KZT KRW MXN MYR NGN NOK NZD PEN PHP PKR PLN QAR RON SAR SEK SGD THB TWD TZS USD VND ZAR"
    .split(" "),
);
const DEFAULT_CHECKOUT_BODY = Object.freeze({
  entry_point: "all_plans_pricing_modal",
  plan_name: DEFAULT_PLAN_NAME,
  billing_details: {
    country: "JP",
    currency: "JPY",
  },
  checkout_ui_mode: "custom",
});
const STRIPE_CHECKOUT_SESSION_ID_RE = /cs_(?:live|test)_[A-Za-z0-9]+/;
const CHATGPT_CHECKOUT_SESSION_ID_RE = /oaics_[A-Za-z0-9]+/;
const CHATGPT_CHECKOUT_URL_RE = /^https:\/\/chatgpt\.com\/checkout\/[^/]+\/(?:oaics_|cs_(?:live|test)_)[A-Za-z0-9]+/i;
const CHECKOUT_PLAN_CONFIGS = Object.freeze({
  chatgptgoplan: Object.freeze({
    value: "chatgptgoplan",
    createPlanName: "chatgptgoplan",
  }),
  chatgptplusplan: Object.freeze({
    value: "chatgptplusplan",
    createPlanName: "chatgptplusplan",
  }),
  chatgptprolite: Object.freeze({
    value: "chatgptprolite",
    createPlanName: "chatgptprolite",
  }),
  chatgptpro: Object.freeze({
    value: "chatgptpro",
    createPlanName: "chatgptprolite",
    update: Object.freeze({
      planName: "chatgptpro",
      priceInterval: "month",
      seatQuantity: 1,
    }),
  }),
});
const CHECKOUT_PLAN_ALIASES = new Map([
  ["go", "chatgptgoplan"],
  ["chatgptgo", "chatgptgoplan"],
  ["chatgptgoplan", "chatgptgoplan"],
  ["plus", "chatgptplusplan"],
  ["chatgptplus", "chatgptplusplan"],
  ["chatgptplusplan", "chatgptplusplan"],
  ["pro5x", "chatgptprolite"],
  ["prolite", "chatgptprolite"],
  ["chatgptprolite", "chatgptprolite"],
  ["chatgptproliteplan", "chatgptprolite"],
  ["chatgptpro5xplan", "chatgptprolite"],
  ["chatgptproplan", "chatgptprolite"],
  ["pro", "chatgptpro"],
  ["pro20x", "chatgptpro"],
  ["chatgptpro", "chatgptpro"],
  ["chatgptpro20xplan", "chatgptpro"],
]);

export function normalizeCheckoutPlanName(value = DEFAULT_PLAN_NAME) {
  const rawPlanName = String(value ?? DEFAULT_PLAN_NAME).trim().toLowerCase().replace(/\s+/g, "");
  const planName = CHECKOUT_PLAN_ALIASES.get(rawPlanName) ?? rawPlanName;
  if (!CHECKOUT_PLAN_OPTIONS.some((option) => option.value === planName)) {
    throw new Error(`Unsupported checkout plan: ${value}`);
  }
  return planName;
}

export function getCheckoutPlanConfig(value = DEFAULT_PLAN_NAME) {
  return CHECKOUT_PLAN_CONFIGS[normalizeCheckoutPlanName(value)];
}

export function normalizeCheckoutCountry(value = DEFAULT_PAYMENT_COUNTRY) {
  const country = String(value ?? DEFAULT_PAYMENT_COUNTRY).trim().toUpperCase();
  if (!SUPPORTED_PAYMENT_COUNTRY_CODES.includes(country)) {
    throw new Error(`Unsupported payment country: ${value}`);
  }
  return country;
}

export function normalizeCheckoutCurrency(value = DEFAULT_PAYMENT_CURRENCY) {
  const currency = String(value ?? DEFAULT_PAYMENT_CURRENCY).trim().toUpperCase();
  if (!SUPPORTED_PAYMENT_CURRENCY_CODES.includes(currency)) {
    throw new Error(`Unsupported payment currency: ${value}`);
  }
  return currency;
}

export function normalizeCheckoutTemplate(value = {}) {
  return Object.freeze({
    planName: normalizeCheckoutPlanName(value.planName ?? value.plan_name),
    paymentCountry: normalizeCheckoutCountry(value.paymentCountry ?? value.payment_country ?? value.country),
    paymentCurrency: normalizeCheckoutCurrency(value.paymentCurrency ?? value.payment_currency ?? value.currency),
  });
}

// BEGIN EMBEDDED HAR HEADERS
const DEFAULT_CHECKOUT_HEADER_ENTRIES = Object.freeze([
  ["accept", "*/*"],
  ["accept-language", "zh-CN,zh;q=0.9"],
  ["cache-control", "no-cache"],
  ["content-type", "application/json"],
  ["oai-client-build-number", "8160987"],
  ["oai-client-version", "prod-de97061a1c9aff3931a7342defd6241031cd316a"],
  ["oai-device-id", "3eb9ec89-966f-4542-af2f-c12078e698ec"],
  ["oai-language", "zh-CN"],
  ["oai-session-id", "14433444-e6d5-484c-8b70-25a82d4733ca"],
  ["oai-telemetry", "[1,178.70000004768372,10,67,10,2,0,180]"],
  ["oai-web-deployment-attestation", "eyJ2ZXJzaW9uIjoxLCJ0cmFjayI6InN0YWJsZSIsImRlcGxveUlkIjoiZGU5NzA2MWExYzlhZmYzOTMxYTczNDJkZWZkNjI0MTAzMWNkMzE2YSIsInN1YmplY3QiOiIycW1tVXFDZTdwYmxGSlczSnI3amhyanEzeGdmMU9CT19zZHMyZVhnQmM4IiwiaXNzdWVkQXQiOjE3ODM5MzMyNTEsImV4cGlyZXNBdCI6MTc4MzkzNjg1MX0.GgjIFjkswzhhpvvRxVxwflnX4yx6RXxXIEekLXYpyIg"],
  ["openai-sentinel-token", "{\"p\":\"gAAAAABWzI2NjgsIk1vbiBKdWwgMTMgMjAyNiAxNzowMToxMyBHTVQrMDgwMCAoR01UKzA4OjAwKSIsNDM5NTYzMDU5MiwzMCwiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE1MC4wLjAuMCBTYWZhcmkvNTM3LjM2IiwiaHR0cHM6Ly9jaGF0Z3B0LmNvbS9iYWNrZW5kLWFwaS9zZW50aW5lbC9zZGsuanMiLCJwcm9kLWRlOTcwNjFhMWM5YWZmMzkzMWE3MzQyZGVmZDYyNDEwMzFjZDMxNmEiLCJ6aC1DTiIsInpoLUNOLHpoIiwxMCwiY29ubmVjdGlvbuKIkltvYmplY3QgTmV0d29ya0luZm9ybWF0aW9uXSIsIl9fcmVhY3RDb250YWluZXIkbGsyOXk3ZThnNSIsIl9fb2FpX3NvX3N4MCIsMzAyMjYuMzk5OTk5OTc2MTU4LCJiMzdkM2QyMy1lZjQxLTQyZmItYTQ0Ni1jOTdmYTUzMDhiMDEiLCIiLDI4LDE3ODM5MzMyNDMyNzkuNSwwLDAsMCwwLDAsMCwwXQ==~S\",\"t\":\"QhEYAB8IBwwLE3phHmtwaHZkcEkNcW9gWn17SXRzemJjVxMVERoDHwkBDAsTeHJvcHB4cm9wcHhyb3BweHJvcHB4cm9wExURGQEfCgIMCwEXBBkCBQALGQAFAQsdCAIOBAITBQwdHQQTAxFtVnQEEQITBwodGQATAxFgZXxMfXpSDBsfDAUHFwEdEwsbdBxVaWhlfAlgb0tLYEZ0Z0xnc19lH0lQfGZgUmRSXHxgZE1Qdl1jfWd4QX1oW2hmZ2gGa2kACGR9d1lfa2hSfn5mYFJkUkN3aQANZ21ne2FQa39YYV8XVGZVQ2tnZ05mbAB7YVBrf1hhXxdUZlVDa2dnTmEMHRMNBQAJBRsJDGVmSWlKZARsZXoBDBsfDAcFFwAXEwsbYkZ3YWsCbGBpCl93Z2QIUWpwQnh3SXxmcWFgaGNsCndpaX9kfABrY2d8dGR6cm99eU5Lf2MAUVJ/XwBsax5SfHpEb35wQVhKdABRdXoAWV1ReElUfERde3lOS31pXW9QdnlnbGB7VXZ8RF19c056emZnQVJ9Z11/dFlaaXtEa2d0b193Z2QIUWpwQnh3SXxmcWFge2ZVaXtpaQhkdlpnY3RZWlJ7ZlkMExURHwcfCgoMCxNuX2R/Zm9ieWNdCGZ/SWB/YUJwdlpmYFJiCUdXUAAAdXgAZHhhf2tWeHtKWWtoWHlnWQxle1YAbmd/eFJ9X01SZ0FEYHNjYHJmcHdodVlaUnhlaH9zb2FIZ1pJZ2xWRn9ye3tXb1hocmR8WHtmAV1wfGdre2VWAGJudWx2Z3sGY2B0TXdmcAhbZ1lrBGpmaGRiCkNGYF1Ja3ZgQWB0eXB4X2tWB3JrBk1wAUlgbGdJaHt8RnZhYmh4eXhmfnJJAVBtZ15ydUZGe24Cb1Bnf1dNZwFOdGxwCVprQllXbwJ0enl/W2BnWndwZmdramFWBGBqZmBVeVJ9TWR0TVV8ZEEBa2hrYG8CXmRkfGV/aXR4Vnx0QW5rbEZ5bGVna1RsdWJiZ2sFT2RZcWBoAXJsVHwecnFlHGtJYFd2XVlYcnhzc2pmb3Nmb3FlaHRNZnYCVVpRHmN3bGtedWR/aU1ndE1VSAFJdXJCBGBscVZhYGx1ZXl0f3R2AEl7UkIEUm51XnBSCHFPZnRRanZnZxZnHnt3WAN0cFJ8ZnljXQhmf0lgf2FCcHZaZmBSYglHV1AAAHV4AGR4YX9rVnh7SllraFh4aXQAamZdWX1rRXhUb2VkVWNuYWBpXAhidnRdamEfa1d/ZVZhZnsGd2AADHBmWkF+Z2t7YmoCXlRjb1t5aWZRYnl3Z25gQH9gbwIffWBBAndzc2B7e1Z3bnVZZHVhZWR6cAh6YXkACGZ7dEVoYUYIYG1mSlJmf31jYwFdVnYBXlxreGN3bWVecGdSenhTdABge11rfmJrZFVvX2R5eX9lf2dGc1Z7d3BaZx53c2pbVmFkVXl5Y1p7dXdaBFhkQntrWF90VWBVW3lpZwlXdl1ZWHJ4c3NqZm9zZFVxZFVdY3F5dEVua3Zzd39lVmFmewZ3YAAMcGZdZ2pre2cHbwJWa2kLdX9pZHtmeGZBWGBCY2VudmhfY29he2B2CFZ8d1VxckV7d252SlVmf2p2YHRNcH9dc1piaQRoYWEeV3NeVGJzYwFxbWBefXJCBGBscVZhYGx1ZXl0c2J/WgBTZx9rZF1lVmFnYWV3YwFKV3tdWWhhQmBUbXZsfWBBRH5mAQF0S2Rde2VrRQdgZmRQZwgDZWZzVVRteQABVklaVGFyYHpkXmVNZHMJUGxdAXtgbEZ3fURdV3l4X09yWWBQbWdFaHRCY2lhdUp8c15ifnl0d1Z4Z0lfa3wAYm9lXn1pCWZ7ZHR/d38ASV9nHmdkYWEbVWd/eWJnXVZXf1oAamRFe2hhWx9VY29xTGkBTUZ5dwFde1loeHpEe1dwaFhlcEZzVnt3cFpnHndzaltWf2lVCnZnWgh1dlpFD2Jme1RvA0p9YmxlXWAACGZ2Z2dBZx8IV2F2aAVwewJ5ZFpaVnt0XX1rfARnYXVoU2dUeU1jAElqdgAEeHJCBGBscVZhYGx1ZXl3SWJ8Z0l7ZEIEd1p1H0VpVQpgZ11jdXR0XXhgHwBVXAJkcGkIYWJrY05Xdl1ZWHJ4c3NqZm9zaW9xZWMCCGp4XVV+a0Bzd21maHlkCWFgZlp/VWZna2phVgRgamZgVXlVeXxkXUlfeWdJXGBWBHRqX3RSeXhXfGRZVQZ/ZEVzZWZBQWp2SnhpaHl9c3kBekppa1d1SQwMGx8MAwcXARYTCxtiRndmfERde3lOS2d0RnR2aEZwX3BJcFV4VHd/cEFEbXNgVnZpSQFtZ0JBemtlRVNya0RqeUYBcGlWYHNwSV5oenJveHNrRG95Y01RfQBZbmZ7Unx6RG9heWtASnQBCFB2WXx1d0leV3FEZ3pwewNpc2BScWZgZHp3SWhyfANgYGd8aWh0RnRxZnMJcXBvUlN6Ymdwc2tQb3BwAXFmSQFtZB9JUGtlG2R0a2JkcGANV2hWeHpwSWBQeGJjenNBA2lzc2xhf11jYWd8dGR4ZlkMExURHQAfCAIMCxN6RF0MExURHQQfCwEMCxN9RBMMExURGQUfDwIMCxNgW2hBaVUGS2kBSmFLd1Vocmx8VX4BfHlpTnpidGBwcG9JZHp7Q0YMGx8MBR8ABwwLE2xmSlBgbHpqeXB/YHlnWXFge3d3fwJsc2l7B09gAEFqe11zXWB/DAwbTg==\",\"c\":\"gAAAAABqVKlfesnibCOG4-5Q4jDQl6yQNOwO1izOMFkLdlXKi8Q4q8-SNbUeYJEpM2pBVisHogdUF9DEFIneSb2JsuPMahZrGWWJv58YK6iIRGbDebRfoQiLYjtf_uitFSf6n8E_UUrk5-oJ4l9q_qHFxAelvM--2UG69XUkGX-WbADlaOOxL-E_pUqcwlmp8AedFYHSDgQYez27morBCo-wGm8YHyGSggdemZ36fhLON2iRCmsQBcoYsBmmLBoZqjArVdKaeuz_Ui4nPweGxZd3CbUygl1t4JxQz5YbR05AQU-_dIF261Go1NOEjScBBQ_KTPtiu-3k1Em0qb0A4G9mVqCj8cO_EALFlQL73VoobSCXlKdDJTGVWBlzC4333ld0XlVEf8teV_G5dRlHO_c2iqHo0uuon0b8ESinZi1g0BWfMfEe9FHh3VNhfXb2DwWqmeGJkHCAOW4p7INx5dgJQxvxI5q-EBXbjjW69Q9FV6OVM1Wuh92N23yyRjDrh1dJSS7-krAWRgVQb72NQpE7SurVsTgkEhMMaKlnEQUIKJT24UmGHcBb0jqnBrbebm9sbrRc9AK6U60YXEJUAHHpqPjRIqMXw6luWrE7KC094TZQ8YzRjWoxXK3q0AN7jp4_yKTTx--Zbtsn-tB7S29x41lVXtzKe2ur519swvAyqGnNaOeuYK_cGz_4ih1w7NRMs1nAEtnqM0zQLRB2XyaBPD7y1t2c6Vtctu3aIafg6M2P6j3HeFUXQrY3iGA-a_Go321hN95G3dreo6z1ma7LKqd2p4gYxrzLfBOamFhbF0n2Eb-NiViIneSZ23Y5kd-VXObFJGe8tRr5xDMogXEEDLKTuKuoqKp1L5I909junGH58UE3atajMuJzy-4oAW0gqUKknjI9AJt3XKAQtYAB1UJN1TRnQIibsULts0OPorf4oKtdkxT9Ny7VEclhQrD60IluZOv8m0IL61pGYfDrrVV4lV0GJ74cvQqCR0LSl_vMXlwvXMI6Ou2NHDgtAs55AM_cLFj9SfvUZYB8Fbb27TI1cfslMUAbrypqiJ-fntp1ghMTEeZ9ILWMHuD2GD2hQUDfq7Dn6hiseDqA-GSBPR-oncCIQH-xcUV04IpRhruymz48oMnE2kdyVmvRWiWcfq6uNmj-88injiURHn4V8zxE3aU8FDoH4XiII3G6Hw1WDY9YhuDm6yFT2_8sIT5aiD5iISsAnsVt69kh0q--8zAkYaF8pcyyKFgRyeBrUM0Ka7-MGWHyYiBYcYv5OU5GsKjniipDN4L8RHYWX7RqDVvYFXkIqUxGlAvUTe7bKTCsu5yeD7qg1NMyWvn0jLCnuScnIpVx3z9ZvDx1g9hhBGqrOC6-jYQC8FJJhtFxJQFPttx7JYM5yJVwAgDNmNzbrBg8bJqNDb5ojFyNzAckL8mAJdCTOrCADSo5XgNi_kvyxiCE-B5GHfDdk71qKZLtaAfqjCWRv5W2HlNXOANnIsCWGrOj1zohBXgfxk35aztZr2x5J6Hxz405HKOx92MqoDbsKjdSZCH62gFdDjHVVfWKE9-yt5HwriZm-zoiiX45Y82yQnOptKKRRuChm9Xmt8nX3Rv7g_OIGejvlFLtJGTRYHGcz1F76RkEPwCoIdJfhTUzyHLB4cm36UWE0eS2oRVxEGkxoV5Vk8i1VZWlaueX27gcr0cxpTiAk7wobsooCqsQFY9ky_PQz9dpIOfOwJd1PUE3OCCpMHULrRvAMRhGfgktLRiaWoEAaXvyiZ4DFA3oIvrA2FWeXK1aqtnyGJG9yYL5TIMw-KtYDH-vymWkOtM2TzntgsRIO9rplEN1bs1m3esp2IibOlqh6S5h6afQioVhHGypH2AK_EyDvXeRKmcgvg9UkATlNZzoG9ZQNKW3-rg=\",\"id\":\"3eb9ec89-966f-4542-af2f-c12078e698ec\",\"flow\":\"chatgpt_checkout\"}"],
  ["origin", "https://chatgpt.com"],
  ["pragma", "no-cache"],
  ["priority", "u=1, i"],
  ["referer", "https://chatgpt.com/"],
  ["user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"],
  ["x-oai-is-client-observation", "v1.r.p.pQhRaomg6lCJ1Bsb"],
  ["x-openai-target-path", "/backend-api/payments/checkout"],
  ["x-openai-target-route", "/backend-api/payments/checkout"],
]);
// END EMBEDDED HAR HEADERS
const REQUIRED_DOMAINS = [
  "chatgpt.com",
  "auth.openai.com",
  "api.stripe.com",
  "js.stripe.com",
  "r.stripe.com",
  "sentinel.openai.com",
];

const ALLOWED_HEADER_NAMES = new Set([
  "accept",
  "accept-language",
  "cache-control",
  "content-type",
  "oai-client-build-number",
  "oai-client-version",
  "oai-device-id",
  "oai-language",
  "oai-session-id",
  "oai-telemetry",
  "oai-web-deployment-attestation",
  "openai-sentinel-token",
  "origin",
  "pragma",
  "priority",
  "referer",
  "user-agent",
  "x-oai-is-client-observation",
  "x-openai-target-path",
  "x-openai-target-route",
]);

const FORBIDDEN_PAYMENT_KEY = /^(card|cards|cvc|cvv|security_code|payment_method|payment_method_data|payment_method_id)$/i;
const COOKIE_VALUE_CHUNK_SIZE = 3800;

export function isPrivateOrLabIp(ip, extraCidrs = []) {
  if (isIpv4MappedIpv6(ip)) {
    return isPrivateOrLabIp(ip.slice("::ffff:".length), extraCidrs);
  }

  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;

    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return extraCidrs.some((cidr) => isIpv4InCidr(ip, cidr));
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:")
    );
  }

  return false;
}

export function sanitizeHeaders(headers, accessToken) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("LAB_ACCESS_TOKEN is required");
  }

  const result = {};
  for (const header of headers ?? []) {
    const name = String(header.name ?? "").toLowerCase();
    if (!name || name.startsWith(":")) continue;
    if (!ALLOWED_HEADER_NAMES.has(name)) continue;
    result[name] = String(header.value ?? "");
  }

  result.authorization = `Bearer ${accessToken}`;
  if (!result["content-type"]) result["content-type"] = "application/json";
  return result;
}

export function rewriteCheckoutTemplate(bodyText, {
  planName = DEFAULT_PLAN_NAME,
  paymentCountry = DEFAULT_PAYMENT_COUNTRY,
  paymentCurrency = DEFAULT_PAYMENT_CURRENCY,
  billingAddress = {},
} = {}) {
  if (!bodyText) throw new Error("checkout request has no JSON body");

  const body = JSON.parse(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("checkout request body must be a JSON object");
  }

  assertNoPaymentFields(body);
  const template = normalizeCheckoutTemplate({
    planName,
    paymentCountry,
    paymentCurrency,
  });
  const planConfig = getCheckoutPlanConfig(template.planName);
  const normalizedBillingAddress = normalizeBillingAddress({
    ...billingAddress,
    country: firstString(billingAddress?.country, template.paymentCountry),
    currency: firstString(billingAddress?.currency, template.paymentCurrency),
  });
  body.plan_name = planConfig.createPlanName;
  body.billing_details = {
    ...(body.billing_details && typeof body.billing_details === "object"
      ? body.billing_details
      : {}),
    ...normalizedBillingAddress,
    country: template.paymentCountry,
    currency: template.paymentCurrency,
  };
  assertNoPaymentFields(body);
  return body;
}

export function rewriteBillingDetails(bodyText, country = DEFAULT_PAYMENT_COUNTRY, currency = DEFAULT_PAYMENT_CURRENCY, billingAddress = {}) {
  return JSON.stringify(
    rewriteCheckoutTemplate(bodyText, {
      paymentCountry: country,
      paymentCurrency: currency,
      billingAddress,
    }),
  );
}

export function normalizeBillingAddress(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const addressSource =
    source.address && typeof source.address === "object" && !Array.isArray(source.address)
      ? source.address
      : {};

  const address = {};
  setClean(address, "line1", firstString(source.line1, source.addressLine1, source.address_line1, addressSource.line1));
  setClean(address, "line2", firstString(source.line2, source.addressLine2, source.address_line2, addressSource.line2));
  setClean(address, "city", firstString(source.city, source.locality, addressSource.city));
  setClean(address, "state", firstString(source.state, source.region, source.province, addressSource.state));
  setClean(
    address,
    "postal_code",
    firstString(source.postalCode, source.postal_code, source.zip, source.postcode, addressSource.postal_code),
  );
  const country = firstString(source.country, source.countryCode, source.country_code, addressSource.country);
  if (country) address.country = country.toUpperCase();

  const result = {};
  setClean(result, "name", firstString(source.name, source.fullName, source.full_name, source.cardholderName));
  setClean(result, "email", firstString(source.email));
  setClean(result, "phone", firstString(source.phone, source.phoneNumber, source.phone_number));
  if (Object.keys(address).length > 0) result.address = address;
  if (country) result.country = country.toUpperCase();
  const currency = firstString(source.currency);
  if (currency) result.currency = currency.toUpperCase();
  return result;
}

function setClean(target, key, value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text) target[key] = text.slice(0, 256);
}

function toStripeBillingDetails(value = {}) {
  const billing = normalizeBillingAddress(value);
  const result = {};
  setClean(result, "name", billing.name);
  setClean(result, "email", billing.email);
  setClean(result, "phone", billing.phone);
  if (billing.address) result.address = billing.address;
  return result;
}

export function assertNoPaymentFields(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPaymentFields(item, path.concat(String(index))));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PAYMENT_KEY.test(key)) {
      throw new Error(`Refusing to submit payment/card field: ${path.concat(key).join(".")}`);
    }
    assertNoPaymentFields(nested, path.concat(key));
  }
}

export function buildEmbeddedCheckoutEntry() {
  return {
    startedDateTime: EMBEDDED_CHECKOUT_CAPTURED_AT,
    serverIPAddress: EMBEDDED_CHECKOUT_PROXY_HOST,
    connection: EMBEDDED_CHECKOUT_PROXY_PORT,
    request: {
      method: "POST",
      url: CHECKOUT_ENDPOINT,
      headers: DEFAULT_CHECKOUT_HEADER_ENTRIES.map(([name, value]) => ({
        name,
        value,
      })),
      postData: {
        mimeType: "application/json",
        text: JSON.stringify(DEFAULT_CHECKOUT_BODY),
      },
    },
    response: {
      status: 200,
    },
  };
}

export async function loadCheckoutEntry(args = {}) {
  if (args?.har) {
    const har = JSON.parse(await fs.readFile(args.har, "utf8"));
    return extractLatestCheckoutRequest(har);
  }

  return buildEmbeddedCheckoutEntry();
}

export function extractLatestCheckoutRequest(har) {
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("HAR does not contain log.entries");

  let latest = null;
  for (const entry of entries) {
    const request = entry?.request;
    const response = entry?.response;
    if (!request?.url) continue;

    const url = new URL(request.url);
    const isCheckout =
      url.host === "chatgpt.com" &&
      url.pathname === "/backend-api/payments/checkout" &&
      request.method === "POST" &&
      response?.status >= 200 &&
      response?.status < 300;

    if (!isCheckout) continue;
    if (!latest) {
      latest = entry;
      continue;
    }

    const currentTime = Date.parse(entry.startedDateTime ?? "");
    const latestTime = Date.parse(latest.startedDateTime ?? "");
    if (Number.isNaN(currentTime) || Number.isNaN(latestTime) || currentTime >= latestTime) {
      latest = entry;
    }
  }

  if (!latest) throw new Error("No successful POST /backend-api/payments/checkout found in HAR");
  return latest;
}

export function redactCheckoutResult(data) {
  const keys = Object.keys(data ?? {}).sort();
  const summary = {};

  for (const key of keys) {
    const value = data[key];
    if (isSecretKey(key)) {
      summary[key] = "<redacted>";
    } else if (key === "checkout_session_id") {
      summary[key] = redactId(value);
    } else if (key === "billing_details" && value && typeof value === "object") {
      summary[key] = {
        country: value.country,
        currency: value.currency,
      };
    } else if (["status", "payment_status", "plan_name", "checkout_ui_mode", "checkout_provider"].includes(key)) {
      summary[key] = value;
    }
  }

  return { keys, summary };
}

export function buildCheckoutLinks(data, baseUrl = "https://chatgpt.com") {
  const links = [];
  const seen = new Set();

  const push = (label, url) => {
    if (typeof url !== "string" || !url) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!["https:", "http:"].includes(parsed.protocol)) return;
    const normalized = parsed.toString();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    links.push({ label, url: normalized });
  };

  push("provider_url", data?.url);
  push("checkout_url", data?.checkout_url);
  push("hosted_url", data?.hosted_url);
  push("hosted_checkout_url", data?.hosted_checkout_url);

  if (typeof data?.checkout_session_id === "string" && data.checkout_session_id) {
    const entity =
      typeof data?.processor_entity === "string" && data.processor_entity
        ? data.processor_entity
        : "openai_llc";
    const origin = new URL(baseUrl).origin;
    push(
      "chatgpt_checkout_url",
      `${origin}/checkout/${encodeURIComponent(entity)}/${encodeURIComponent(data.checkout_session_id)}`,
    );
  }

  return links;
}

export function isCtfPayCheckoutInput(value) {
  const raw = String(value ?? "").trim();
  if (isChatgptCheckoutUrl(raw)) return false;
  return STRIPE_CHECKOUT_SESSION_ID_RE.test(raw);
}

function isCtfPayFreshInput(value) {
  return ["", "fresh", "auto", "new", "generate", "checkout:auto"].includes(String(value ?? "").trim().toLowerCase());
}

export function isChatgptShortlinkCheckoutInput(value) {
  const raw = String(value ?? "").trim();
  return CHATGPT_CHECKOUT_SESSION_ID_RE.test(raw) || isChatgptCheckoutUrl(raw);
}

export function isChatgptCheckoutUrl(value) {
  const raw = String(value ?? "").trim();
  return CHATGPT_CHECKOUT_URL_RE.test(raw);
}

export function normalizeChatgptShortlinkCheckoutUrl(value) {
  const raw = String(value ?? "").trim();
  if (isChatgptCheckoutUrl(raw)) return raw;
  const match = raw.match(CHATGPT_CHECKOUT_SESSION_ID_RE);
  if (!match) throw new Error("ChatGPT 短链需要 oaics_* checkout session");
  if (/^https:\/\/chatgpt\.com\/checkout\//i.test(raw)) return raw;
  return `https://chatgpt.com/checkout/openai_llc/${match[0]}`;
}

export function pickCtfPayCheckoutInput(data, baseUrl = "https://chatgpt.com") {
  if (!data) return null;
  if (typeof data === "string") return isCtfPayCheckoutInput(data) ? data : null;

  const directSessionId = firstString(data.checkout_session_id, data.session_id);
  if (isCtfPayCheckoutInput(directSessionId)) return directSessionId;

  const links = Array.isArray(data) ? data : buildCheckoutLinks(data, baseUrl);
  const match = links.find((link) => isCtfPayCheckoutInput(link?.url));
  return match?.url ?? null;
}

export function pickDirectCardCheckoutInput(data, baseUrl = "https://chatgpt.com") {
  if (!data) return null;
  if (typeof data === "string") {
    return isCtfPayCheckoutInput(data) || isChatgptShortlinkCheckoutInput(data) ? data : null;
  }

  const links = Array.isArray(data) ? data : buildCheckoutLinks(data, baseUrl);
  const preferred = [
    links.find((link) => link?.label === "chatgpt_checkout_url"),
    links.find((link) => isChatgptShortlinkCheckoutInput(link?.url)),
    links.find((link) => isCtfPayCheckoutInput(link?.url)),
  ].find(Boolean);
  return preferred?.url ?? null;
}

export function formatCheckoutLinks(links) {
  if (!Array.isArray(links) || links.length === 0) {
    return ["[checkout] no checkout URL found in response"];
  }

  if (links.length === 1) {
    return [`[checkout] manual payment link: ${links[0].url}`];
  }

  return [
    "[checkout] manual payment links:",
    ...links.map((link) => `  - ${link.label}: ${link.url}`),
  ];
}

export function decodeJwtPayload(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) throw new Error("Access token is not a JWT");

  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

export function summarizeAccessTokenIdentity(token) {
  const payload = decodeJwtPayload(token);
  const auth = payload?.["https://api.openai.com/auth"] ?? {};
  const profile = payload?.["https://api.openai.com/profile"] ?? {};

  return {
    email: redactEmail(profile.email),
    account_id: redactMiddle(auth.chatgpt_account_id),
    account_user_id: redactMiddle(auth.chatgpt_account_user_id),
    user_id: redactMiddle(auth.chatgpt_user_id ?? auth.user_id ?? payload.sub),
    plan_type: auth.chatgpt_plan_type,
    expires_at: typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : undefined,
  };
}

export async function loadSessionFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return normalizeSessionFile(JSON.parse(raw));
}

export function normalizeSessionFile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("session file must contain a JSON object");
  }

  const accessToken = firstString(
    value.accessToken,
    value.access_token,
    value.lab_access_token,
    value.LAB_ACCESS_TOKEN,
  );
  const sessionToken = firstString(
    value.sessionToken,
    value.session_token,
    value.nextAuthSessionToken,
    value["__Secure-next-auth.session-token"],
  );
  const sessionCookieName = firstString(
    value.sessionCookieName,
    value.session_cookie_name,
    "__Secure-next-auth.session-token",
  );
  const cookies = Array.isArray(value.cookies) ? value.cookies.map(normalizeCookieFromFile) : [];

  if (!accessToken) throw new Error("session file is missing accessToken");
  if (!sessionToken && cookies.length === 0) {
    throw new Error("session file is missing sessionToken or cookies[]");
  }

  return {
    accessToken,
    sessionToken: sessionToken ? extractCookieValue(sessionToken) : null,
    sessionCookieName,
    cookies,
    expires: firstString(value.expires, value.sessionExpires, value.session_expires),
    user: value.user && typeof value.user === "object" ? value.user : null,
    account: value.account && typeof value.account === "object" ? value.account : null,
  };
}

function normalizeCookieFromFile(cookie) {
  if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) {
    throw new Error("cookies[] entries must be objects");
  }
  const name = firstString(cookie.name);
  const value = extractCookieValue(firstString(cookie.value));
  if (!name || !value) throw new Error("cookies[] entries require name and value");
  return {
    name,
    value,
    domain: firstString(cookie.domain, ".chatgpt.com"),
    path: firstString(cookie.path, "/"),
    secure: cookie.secure !== false,
    httpOnly: cookie.httpOnly !== false,
    sameSite: normalizeSameSite(cookie.sameSite),
    expires: normalizeCookieExpires(cookie.expires ?? cookie.expirationDate),
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeSameSite(value) {
  const normalized = String(value ?? "Lax").toLowerCase();
  if (normalized === "strict") return "Strict";
  if (normalized === "none" || normalized === "no_restriction") return "None";
  return "Lax";
}

function normalizeCookieExpires(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
}

function extractCookieValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const firstPart = text.split(";")[0].trim();
  const equalIndex = firstPart.indexOf("=");
  if (equalIndex !== -1) {
    return firstPart.slice(equalIndex + 1).trim();
  }

  return firstPart;
}

export function buildLocalCheckoutPageData(data, billingAddress = {}) {
  if (!data || typeof data !== "object") {
    throw new Error("checkout response must be a JSON object");
  }
  const unavailableReason = getLocalCheckoutUnavailableReason(data);
  if (unavailableReason) {
    throw new Error(unavailableReason);
  }

  const pageData = {
    publishableKey: data.publishable_key,
    clientSecret: data.client_secret,
    checkoutSessionId: data.checkout_session_id,
    planName: data.plan_name,
    status: data.status,
    paymentStatus: data.payment_status,
    billingCountry: data.billing_details?.country,
    billingCurrency: data.billing_details?.currency,
  };
  const stripeBillingDetails = toStripeBillingDetails(billingAddress);
  if (Object.keys(stripeBillingDetails).length > 0) {
    pageData.billingDetails = stripeBillingDetails;
  }
  return pageData;
}

export function getLocalCheckoutUnavailableReason(data) {
  if (!data || typeof data !== "object") {
    return "checkout response must be a JSON object";
  }

  const provider = typeof data.checkout_provider === "string" ? data.checkout_provider : "unknown";
  const sessionId = typeof data.checkout_session_id === "string" ? data.checkout_session_id : "unknown";
  const publishableKeyType = describeValueType(data.publishable_key);
  const clientSecretType = describeValueType(data.client_secret);

  if (typeof data.publishable_key !== "string" || !data.publishable_key) {
    return `local Stripe checkout unavailable for provider=${provider} session=${redactId(sessionId)}: publishable_key is ${publishableKeyType}`;
  }

  if (typeof data.client_secret !== "string" || !data.client_secret) {
    return `local Stripe checkout unavailable for provider=${provider} session=${redactId(sessionId)}: client_secret is ${clientSecretType}`;
  }

  return null;
}

export function renderLocalCheckoutHtml(pageData) {
  const dataJson = JSON.stringify(pageData).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT 付款</title>
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f7f5;
      color: #101010;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px;
    }
    main {
      width: min(920px, 100%);
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) 320px;
      gap: 28px;
      align-items: start;
    }
    section, aside {
      background: #fff;
      border: 1px solid #dfdfdc;
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.06);
    }
    h1 {
      font-size: 24px;
      line-height: 1.2;
      margin: 0 0 20px;
      letter-spacing: 0;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px 14px;
      margin: 0;
      font-size: 14px;
    }
    dt {
      color: #666;
    }
    dd {
      margin: 0;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    #payment-element {
      min-height: 260px;
      margin: 16px 0 22px;
    }
    button {
      width: 100%;
      height: 52px;
      border: 0;
      border-radius: 7px;
      background: #101010;
      color: #fff;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .status {
      min-height: 22px;
      margin-top: 14px;
      font-size: 14px;
      color: #4b5563;
      overflow-wrap: anywhere;
    }
    .error {
      color: #b42318;
    }
    @media (max-width: 760px) {
      body {
        padding: 16px;
        place-items: start center;
      }
      main {
        grid-template-columns: 1fr;
      }
      section, aside {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>ChatGPT Plus 付款</h1>
      <form id="payment-form">
        <div id="payment-element"></div>
        <button id="submit" type="submit">订阅</button>
        <div id="status" class="status">正在加载 Stripe 付款表单...</div>
      </form>
    </section>
    <aside>
      <h1>订单信息</h1>
      <dl>
        <dt>套餐</dt><dd id="plan"></dd>
        <dt>国家</dt><dd id="country"></dd>
        <dt>币种</dt><dd id="currency"></dd>
        <dt>状态</dt><dd id="state"></dd>
        <dt>会话</dt><dd id="session"></dd>
      </dl>
    </aside>
  </main>
  <script>
    const checkoutData = ${dataJson};
    const statusNode = document.querySelector("#status");
    const submitButton = document.querySelector("#submit");

    document.querySelector("#plan").textContent = checkoutData.planName || "chatgptplusplan";
    document.querySelector("#country").textContent = checkoutData.billingCountry || "PH";
    document.querySelector("#currency").textContent = checkoutData.billingCurrency || "PHP";
    document.querySelector("#state").textContent = [checkoutData.status, checkoutData.paymentStatus].filter(Boolean).join(" / ");
    document.querySelector("#session").textContent = checkoutData.checkoutSessionId || "";

    function setStatus(message, isError = false) {
      statusNode.textContent = message;
      statusNode.classList.toggle("error", isError);
    }

    async function confirmCheckout(checkout) {
      if (typeof checkout.confirm === "function") {
        return await checkout.confirm();
      }

      if (typeof checkout.loadActions === "function") {
        const loaded = await checkout.loadActions();
        if (loaded?.type === "error") return { error: loaded.error };
        const actions = loaded?.actions;
        if (actions && typeof actions.confirm === "function") {
          return await actions.confirm();
        }
      }

      throw new Error("当前 Stripe.js 没有可用的确认接口");
    }

    async function boot() {
      if (!window.Stripe) {
        throw new Error("Stripe.js 加载失败");
      }

      const stripe = window.Stripe(checkoutData.publishableKey);
      if (!stripe || typeof stripe.initCheckout !== "function") {
        throw new Error("当前 Stripe.js 不支持 initCheckout");
      }

      const checkoutOptions = {
        clientSecret: checkoutData.clientSecret,
        elementsOptions: {
          appearance: {
            theme: "stripe",
            variables: {
              borderRadius: "7px",
              colorPrimary: "#101010",
              fontFamily: "Inter, system-ui, sans-serif"
            }
          }
        }
      };
      if (checkoutData.billingDetails) {
        checkoutOptions.elementsOptions.defaultValues = {
          billingDetails: checkoutData.billingDetails
        };
      }
      const checkout = await stripe.initCheckout(checkoutOptions);

      const paymentElement = checkout.createPaymentElement();
      paymentElement.mount("#payment-element");
      setStatus("输入付款信息后点击订阅。");

      document.querySelector("#payment-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        submitButton.disabled = true;
        setStatus("正在提交付款...");
        try {
          const result = await confirmCheckout(checkout);
          if (result?.error) {
            setStatus(result.error.message || "付款提交失败", true);
            submitButton.disabled = false;
            return;
          }
          setStatus("付款流程已提交，请按页面提示完成后续步骤。");
        } catch (error) {
          setStatus(error?.message || String(error), true);
          submitButton.disabled = false;
        }
      });
    }

    boot().catch((error) => {
      setStatus(error?.message || String(error), true);
      submitButton.disabled = true;
    });
  </script>
</body>
</html>`;
}

async function serveLocalCheckoutPage(data, { port = 0, billingAddress = {} } = {}) {
  const pageData = buildLocalCheckoutPageData(data, billingAddress);
  const html = renderLocalCheckoutHtml(pageData);

  const server = http.createServer((request, response) => {
    if (request.url === "/" || request.url === "/checkout") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(html);
      return;
    }

    if (request.url === "/health") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const address = server.address();
  const localUrl = `http://127.0.0.1:${address.port}/`;
  console.log(`[local-checkout] open: ${localUrl}`);
  console.log("[local-checkout] keep this process running until payment is complete; press Ctrl+C to stop");

  await new Promise((resolve) => {
    const close = () => server.close(resolve);
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

const CTF_PAY_SCRIPT_CANDIDATES = Object.freeze([
  path.join(process.cwd(), "_repo_extract", "Gpt-Agreement-Payment-main", "CTF-pay", "card.py"),
  path.join(process.cwd(), "card-related", "CTF-pay", "card.py"),
]);

export function luhnValid(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 12) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function maskCardNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `****${digits.slice(-4)}` : "****";
}

export function normalizeDirectCardInput(value = {}) {
  const number = String(value.number ?? "").replace(/\D/g, "");
  const cvc = String(value.cvc ?? "").replace(/\D/g, "");
  const expMonth = Number.parseInt(String(value.expMonth ?? value.exp_month ?? ""), 10);
  const expYearRaw = Number.parseInt(String(value.expYear ?? value.exp_year ?? ""), 10);
  const expYear = expYearRaw < 100 ? 2000 + expYearRaw : expYearRaw;
  const checkoutInput = firstString(value.checkoutInput, value.checkout_input, value.checkoutUrl, value.checkout_url);
  const accessToken = firstString(value.accessToken, value.access_token);
  const sessionToken = firstString(value.sessionToken, value.session_token, value.nextAuthSessionToken);
  const sessionCookieName = firstString(value.sessionCookieName, value.session_cookie_name, "__Secure-next-auth.session-token");
  const paymentCountry = firstString(value.paymentCountry, value.payment_country, "PH").toUpperCase();
  const paymentCurrency = firstString(value.paymentCurrency, value.payment_currency, "PHP").toUpperCase();

  if (!luhnValid(number)) throw new Error("卡号未通过 Luhn 校验");
  if (!/^\d{3,4}$/.test(cvc)) throw new Error("CVC 必须是 3 或 4 位数字");
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) {
    throw new Error("有效期月份必须在 1 到 12 之间");
  }
  if (!Number.isInteger(expYear) || expYear < new Date().getFullYear()) {
    throw new Error("有效期年份已过期");
  }
  if (!checkoutInput && !accessToken) {
    throw new Error("请填写 checkout URL / session_id，或填写 Access Token 让 CTF-pay 生成 fresh checkout");
  }

  return Object.freeze({
    number,
    last4: number.slice(-4),
    cvc,
    expMonth,
    expYear,
    checkoutInput: checkoutInput || "fresh",
    accessToken,
    sessionToken,
    sessionCookieName,
    paymentCountry,
    paymentCurrency,
    billing: normalizeBillingAddress(value.billing ?? value.billingAddress ?? {}),
  });
}

export const normalizeDirectCardTestInput = normalizeDirectCardInput;

export function buildCtfPayConfig(cardInput, { proxyUrl = null } = {}) {
  const input = normalizeDirectCardInput(cardInput);
  const billing = input.billing;
  const address = billing.address ?? {};
  const paymentCountry = firstString(input.paymentCountry, "PH").toUpperCase();
  const paymentCurrency = firstString(input.paymentCurrency, "PHP").toUpperCase();
  const billingCountry = firstString(address.country, billing.country, paymentCountry).toUpperCase();
  const cardName = firstString(billing.name, "CTF PAY USER");
  const cardEmail = firstString(billing.email, "ctfpay@example.com");
  const cardAddress = {
    line1: firstString(address.line1, "1 Test Street"),
    line2: firstString(address.line2),
    city: firstString(address.city, "Makati"),
    state: firstString(address.state, "Metro Manila"),
    postal_code: firstString(address.postal_code, "1229"),
    country: billingCountry,
  };

  const config = {
    randomize_identity: false,
    locale: paymentCountry,
    pre_solve_passive_captcha: false,
    captcha: {
      api_url: "",
      api_key: "",
    },
    behavior: {
      pasted_fields: "number",
    },
    cards: [
      {
        name: cardName,
        email: cardEmail,
        number: input.number,
        cvc: input.cvc,
        exp_month: input.expMonth,
        exp_year: input.expYear,
        address: cardAddress,
      },
    ],
  };

  if (proxyUrl) {
    config.proxy = proxyUrl;
  }

  if (input.accessToken) {
    config.fresh_checkout = {
      enabled: true,
      output_url_mode: "provider",
      request_style: "modern",
      auth: {
        mode: "access_token",
        access_token: input.accessToken,
      },
      plan: {
        entry_point: "all_plans_pricing_modal",
        plan_name: "chatgptplusplan",
        checkout_ui_mode: "hosted",
        output_url_mode: "provider",
        billing_country: paymentCountry,
        billing_currency: paymentCurrency,
      },
    };
  }

  return Object.freeze({
    checkoutInput: input.checkoutInput,
    maskedCard: maskCardNumber(input.number),
    paymentRegion: {
      country: paymentCountry,
      currency: paymentCurrency,
    },
    billingAddress: cardAddress,
    config,
  });
}

function formatDirectCardBillingAddress(address = {}) {
  return [
    address.country,
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postal_code,
  ].filter(Boolean).join(", ") || "未填写";
}

export function resolveCtfPayScript(candidates = CTF_PAY_SCRIPT_CANDIDATES) {
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return path.resolve(candidate);
  }
  throw new Error(`未找到 CTF-pay/card.py；已尝试: ${candidates.join(", ")}`);
}

export function buildCtfPayCommand({ checkoutInput, configPath, scriptPath = resolveCtfPayScript() } = {}) {
  if (!checkoutInput) throw new Error("checkoutInput is required");
  if (!configPath) throw new Error("configPath is required");
  return Object.freeze({
    command: "py",
    args: [
      "-3",
      scriptPath,
      checkoutInput,
      "--config",
      configPath,
      "--json-result",
    ],
    cwd: path.dirname(scriptPath),
  });
}

function redactCtfPayOutput(text, input) {
  let safe = redactText(text);
  const replacements = [
    input?.number,
    String(input?.number ?? "").replace(/(\d{4})(?=\d)/g, "$1 ").trim(),
    input?.cvc,
    input?.accessToken,
  ].filter((value) => typeof value === "string" && value.length >= 3);
  for (const value of replacements) {
    safe = safe.replaceAll(value, value === input?.cvc ? "***" : "<redacted>");
  }
  return safe;
}

function emitCtfPayLines({ emit, stage, text, input, buffer = "" }) {
  const combined = buffer + redactCtfPayOutput(text, input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = combined.split("\n");
  const remainder = parts.pop() ?? "";
  for (const line of parts) {
    if (!line) continue;
    emit({
      type: "log",
      time: new Date().toISOString(),
      stage,
      message: line,
    });
  }
  return remainder;
}

async function prepareSingleProxyUrl({ proxyUrl = null, proxyChain = [] } = {}) {
  const chain = normalizeProxyChain(Array.isArray(proxyChain) && proxyChain.length ? proxyChain : [proxyUrl]);
  if (chain.length <= 1) {
    return {
      proxyUrl: chain[0] ?? null,
      proxyChain: chain,
      bridge: null,
    };
  }

  const bridge = await startLocalHttpProxy({
    host: "127.0.0.1",
    port: 0,
    upstreamProxyChain: chain,
  });
  return {
    proxyUrl: bridge.url,
    proxyChain: chain,
    bridge,
  };
}

async function closeProxyBridge(bridge) {
  if (!bridge?.server) return;
  await new Promise((resolve) => bridge.server.close(resolve));
}

export async function runCtfPayCard({ card, emit = () => {}, spawnImpl = spawn, proxyUrl = null } = {}) {
  const input = normalizeDirectCardInput(card);
  if (!isCtfPayCheckoutInput(input.checkoutInput) && !isCtfPayFreshInput(input.checkoutInput)) {
    throw new Error("CTF-pay 需要 Stripe Checkout session: cs_live_... / cs_test_...；当前输入不是 Stripe cs_*");
  }
  const preparedProxy = await prepareSingleProxyUrl({
    proxyUrl: firstString(proxyUrl, card?.directCardProxyUrl, card?.proxyUrl),
    proxyChain: card?.proxyChain ?? [],
  });
  const resolvedProxyUrl = preparedProxy.proxyUrl;
  const built = buildCtfPayConfig(card, { proxyUrl: resolvedProxyUrl });
  const tempDir = path.join(os.tmpdir(), "checkout-ui-ctfpay");
  await fs.mkdir(tempDir, { recursive: true });
  const configPath = path.join(tempDir, `ctfpay-${randomUUID()}.json`);
  await fs.writeFile(configPath, JSON.stringify(built.config, null, 2), { encoding: "utf8", mode: 0o600 });
  const command = buildCtfPayCommand({ checkoutInput: built.checkoutInput, configPath });

  emit({
    type: "log",
    time: new Date().toISOString(),
    stage: "ctfpay",
    message: `启动 CTF-pay 直卡链路: ${command.command} ${command.args.map((arg) => arg === configPath ? "<temp-config>" : arg).join(" ")}`,
  });
  emit({
    type: "log",
    time: new Date().toISOString(),
    stage: "ctfpay",
    message: `checkout 输入: ${built.checkoutInput}; card=${built.maskedCard}`,
  });
  emit({
    type: "log",
    time: new Date().toISOString(),
    stage: "ctfpay",
    message: `付款地区: ${built.paymentRegion.country}/${built.paymentRegion.currency}; 账单地址: ${formatDirectCardBillingAddress(built.billingAddress)}`,
  });

  emit({
    type: "log",
    time: new Date().toISOString(),
    stage: "ctfpay",
    message: `代理: ${resolvedProxyUrl || "direct"}`,
  });

  if (preparedProxy.bridge) {
    emit({
      type: "log",
      time: new Date().toISOString(),
      stage: "ctfpay",
      message: `proxy chain: ${formatProxyChain(preparedProxy.proxyChain)} via ${preparedProxy.bridge.url}`,
    });
  }

  return await new Promise((resolve) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    const childEnv = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    };
    if (resolvedProxyUrl) {
      childEnv.HTTP_PROXY = resolvedProxyUrl;
      childEnv.HTTPS_PROXY = resolvedProxyUrl;
      childEnv.ALL_PROXY = resolvedProxyUrl;
      childEnv.LAB_PROXY = resolvedProxyUrl;
    }
    const child = spawnImpl(command.command, command.args, {
      cwd: command.cwd,
      windowsHide: true,
      env: childEnv,
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      await closeProxyBridge(preparedProxy.bridge);
      try {
        await fs.unlink(configPath);
      } catch {
      }
      emit({ type: "done", result });
      resolve(result);
    };

    child.stdout?.on("data", (chunk) => {
      stdoutBuffer = emitCtfPayLines({
        emit,
        stage: "stdout",
        text: chunk.toString("utf8"),
        input,
        buffer: stdoutBuffer,
      });
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuffer = emitCtfPayLines({
        emit,
        stage: "stderr",
        text: chunk.toString("utf8"),
        input,
        buffer: stderrBuffer,
      });
    });
    child.on("error", (error) => {
      void finish({
        ok: false,
        status: "spawn_error",
        error: redactCtfPayOutput(formatError(error), input),
      });
    });
    child.on("close", (code, signal) => {
      if (stdoutBuffer) {
        emit({ type: "log", time: new Date().toISOString(), stage: "stdout", message: stdoutBuffer });
      }
      if (stderrBuffer) {
        emit({ type: "log", time: new Date().toISOString(), stage: "stderr", message: stderrBuffer });
      }
      void finish({
        ok: code === 0,
        status: code === 0 ? "completed" : "failed",
        exitCode: code,
        signal,
        card: built.maskedCard,
      });
    });
  });
}

export function buildChatgptShortlinkCardAutofillExpression(cardInput) {
  const input = normalizeDirectCardInput(cardInput);
  const billingDetails = toStripeBillingDetails(input.billing);
  const expMonth = String(input.expMonth).padStart(2, "0");
  const expYear4 = String(input.expYear);
  const expYear2 = expYear4.slice(-2);
  const payloadJson = JSON.stringify({
    number: input.number,
    cvc: input.cvc,
    expMonth,
    expYear4,
    expYear2,
    expSlash: `${expMonth} / ${expYear2}`,
    expCompact: `${expMonth}${expYear2}`,
    billing: billingDetails,
  }).replace(/</g, "\\u003c");

  return `(() => {
  const data = ${payloadJson};
  const billing = data.billing || {};
  const address = billing.address || {};
  const values = {
    number: data.number,
    expiry: data.expSlash,
    expMonth: data.expMonth,
    expYear: data.expYear4,
    cvc: data.cvc,
    name: billing.name,
    email: billing.email,
    phone: billing.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postal_code: address.postal_code,
    country: address.country
  };
  const aliases = {
    number: ["cc-number", "cardnumber", "card number", "card-number", "card[number]", "credit card number", "debit card number"],
    expiry: ["cc-exp", "exp-date", "expiration", "expiry", "expires", "card expiry", "card expiration"],
    expMonth: ["cc-exp-month", "exp_month", "exp-month", "expiration month"],
    expYear: ["cc-exp-year", "exp_year", "exp-year", "expiration year"],
    cvc: ["cc-csc", "cvc", "cvv", "security code", "card[cvc]", "verification"],
    name: ["name", "full name", "cardholder", "billing name"],
    email: ["email", "e-mail"],
    phone: ["phone", "tel", "telephone"],
    line1: ["address-line1", "address line 1", "address1", "line1", "street", "street address", "billing address"],
    line2: ["address-line2", "address line 2", "address2", "line2", "apt", "suite", "unit"],
    city: ["address-level2", "city", "locality", "town"],
    state: ["address-level1", "state", "province", "region", "administrative"],
    postal_code: ["postal-code", "postal", "postcode", "zip"],
    country: ["country", "country_code", "country code"]
  };

  function allFields(root, seen = new Set()) {
    const fields = [];
    if (!root || seen.has(root)) return fields;
    seen.add(root);
    try {
      fields.push(...root.querySelectorAll("input, select, textarea"));
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) fields.push(...allFields(element.shadowRoot, seen));
      }
    } catch {}
    return fields;
  }

  function isUsable(element) {
    if (!element || element.disabled || element.readOnly) return false;
    const type = String(element.type || "").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button") return false;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textFor(element) {
    const labels = [];
    try {
      if (element.labels) {
        for (const label of element.labels) labels.push(label.textContent || "");
      }
    } catch {}
    return [
      element.name,
      element.id,
      element.autocomplete,
      element.placeholder,
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("title"),
      ...labels
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function matches(element, role) {
    const text = textFor(element);
    if (aliases[role].some((alias) => text.includes(alias))) return true;
    if (role === "number" && /1234|4242/.test(text) && /numeric|decimal/.test(String(element.inputMode || ""))) return true;
    if (role === "cvc" && /^[0-9]{3,4}$/.test(String(element.placeholder || ""))) return true;
    return false;
  }

  function setNativeValue(element, value) {
    if (!value || !isUsable(element)) return false;
    const tag = element.tagName.toLowerCase();
    element.scrollIntoView({ block: "center", inline: "center" });
    element.focus({ preventScroll: true });
    if (tag === "select") {
      const wanted = String(value).toLowerCase();
      for (const option of element.options) {
        if (
          String(option.value).toLowerCase() === wanted ||
          String(option.textContent || "").toLowerCase() === wanted ||
          String(option.textContent || "").toLowerCase().includes(wanted)
        ) {
          element.value = option.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    const prototype = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    const setValue = (next) => {
      if (descriptor && descriptor.set) descriptor.set.call(element, String(next));
      else element.value = String(next);
    };
    try { element.select(); } catch {}
    setValue("");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    try { document.execCommand("insertText", false, String(value)); } catch {}
    const normalizedCurrent = String(element.value || "").replace(/\\D/g, "");
    const normalizedWanted = String(value || "").replace(/\\D/g, "");
    if (normalizedWanted && !normalizedCurrent.includes(normalizedWanted.slice(0, Math.min(4, normalizedWanted.length)))) {
      setValue(value);
    } else if (!normalizedWanted && String(element.value || "") !== String(value)) {
      setValue(value);
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    return true;
    }

    const fields = allFields(document).filter(isUsable);
    const filled = [];
    const found = [];
    const used = new Set();
    const roles = ["number", "expiry", "expMonth", "expYear", "cvc", "name", "email", "phone", "line1", "line2", "city", "state", "postal_code", "country"];
    for (const role of roles) {
      const value = values[role];
      if (!value) continue;
    const candidates = fields
      .filter((element) => !used.has(element) && matches(element, role))
      .sort((left, right) => {
        if (!["country", "state"].includes(role)) return 0;
        const leftIsSelect = left.tagName.toLowerCase() === "select";
        const rightIsSelect = right.tagName.toLowerCase() === "select";
        return Number(rightIsSelect) - Number(leftIsSelect);
      });
    const target = candidates[0];
      if (target) {
        found.push(role);
        if (setNativeValue(target, value)) {
        used.add(target);
        filled.push(role);
      }
    }
  }
  return {
    href: location.href,
    title: document.title,
    fieldCount: fields.length,
    found,
    filled
  };
})();`;
}

export function buildChatgptShortlinkPaymentButtonLocatorExpression(options = {}) {
  const autoClick = options?.autoClick === true;
  const keywordsJson = JSON.stringify([
    "pay",
    "pay now",
    "payment",
    "confirm",
    "confirm payment",
    "continue",
    "continue to payment",
    "complete",
    "subscribe",
    "subscribe now",
    "purchase",
    "checkout",
    "place order",
    "upgrade",
    "付款",
    "支付",
    "确认",
    "继续",
    "完成",
    "订阅",
    "开通",
    "立即支付",
    "去支付",
  ]).replace(/</g, "\\u003c");

  return `(() => {
  const autoClick = ${autoClick ? "true" : "false"};
  const keywords = ${keywordsJson}.map((keyword) => String(keyword).toLowerCase());

  function allActionControls(root, seen = new Set()) {
    const controls = [];
    if (!root || seen.has(root)) return controls;
    seen.add(root);
    try {
      controls.push(...root.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button'], a[href]"));
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) controls.push(...allActionControls(element.shadowRoot, seen));
      }
    } catch {}
    return controls;
  }

  function isVisible(element) {
    if (!element || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textFor(element) {
    return [
      element.textContent,
      element.value,
      element.id,
      element.name,
      element.className,
      element.getAttribute("aria-label"),
      element.getAttribute("aria-description"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      element.getAttribute("title"),
      element.getAttribute("href")
    ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
  }

  function scoreControl(element) {
    const text = textFor(element).toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
      if (keyword && text.includes(keyword)) score += Math.max(2, keyword.length);
    }
    const tag = element.tagName.toLowerCase();
    const type = String(element.type || "").toLowerCase();
    const role = String(element.getAttribute("role") || "").toLowerCase();
    if (tag === "button") score += 8;
    if (tag === "input" && type === "submit") score += 8;
    if (role === "button") score += 4;
    if (/primary|submit|pay|checkout|confirm|subscribe|purchase|continue/i.test(String(element.className || ""))) score += 6;
    if (/^(pay|confirm|continue|subscribe|purchase|付款|支付|确认|继续|订阅)/i.test(text)) score += 6;
    const rect = element.getBoundingClientRect();
    if (rect.top >= 0 && rect.top <= window.innerHeight) score += 4;
    if (rect.width >= 80 && rect.height >= 28) score += 2;
    return score;
  }

  const candidates = allActionControls(document)
    .filter(isVisible)
    .map((element) => ({ element, score: scoreControl(element), text: textFor(element) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best) {
    return {
      href: location.href,
      title: document.title,
      found: false,
      candidates: candidates.length
    };
  }

  const element = best.element;
  element.scrollIntoView({ block: "center", inline: "center" });
  try { element.focus({ preventScroll: true }); } catch {}
  element.style.outline = "3px solid #f97316";
  element.style.outlineOffset = "3px";
  element.style.boxShadow = "0 0 0 5px rgba(249, 115, 22, 0.22)";
  element.setAttribute("data-checkout-final-payment-target", "true");
  let clicked = false;
  if (autoClick) {
    try {
      const rect = element.getBoundingClientRect();
      const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: Math.round(rect.left + Math.max(1, rect.width / 2)),
        clientY: Math.round(rect.top + Math.max(1, rect.height / 2))
      };
      element.dispatchEvent(new MouseEvent("pointerdown", eventInit));
      element.dispatchEvent(new MouseEvent("mousedown", eventInit));
      element.dispatchEvent(new MouseEvent("pointerup", eventInit));
      element.dispatchEvent(new MouseEvent("mouseup", eventInit));
      element.dispatchEvent(new MouseEvent("click", eventInit));
      if (typeof element.click === "function") element.click();
      clicked = true;
    } catch {}
  }

  return {
    href: location.href,
    title: document.title,
    found: true,
    clicked,
    candidates: candidates.length,
    text: best.text.slice(0, 120),
    tagName: element.tagName.toLowerCase(),
    type: String(element.type || ""),
    id: element.id || "",
    className: String(element.className || "").slice(0, 120),
    score: best.score
  };
})();`;
}

function hasCompleteCardFill(filledRoles) {
  return (
    filledRoles.has("number") &&
    filledRoles.has("cvc") &&
    (filledRoles.has("expiry") || (filledRoles.has("expMonth") && filledRoles.has("expYear")))
  );
}

function hasCompleteRequestedBillingFill(filledRoles, cardInput) {
  const input = normalizeDirectCardInput(cardInput);
  const billing = input.billing;
  const address = billing.address ?? {};
  const required = [];
  if (billing.name) required.push("name");
  if (billing.email) required.push("email");
  if (billing.phone) required.push("phone");
  if (billing.country || address.country) required.push("country");
  if (address.line1) required.push("line1");
  if (address.line2) required.push("line2");
  if (address.city) required.push("city");
  if (address.state) required.push("state");
  if (address.postal_code) required.push("postal_code");
  return required.every((role) => filledRoles.has(role));
}

export function hasCompleteChatgptShortlinkFill(filledRoles, cardInput) {
  return hasCompleteCardFill(filledRoles) && hasCompleteRequestedBillingFill(filledRoles, cardInput);
}

export function isLikelyChatgptCardContext(context = {}) {
  const origin = String(context.origin ?? "").trim();
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && ["chatgpt.com", "js.stripe.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isLikelyChatgptCardTarget(target = {}) {
  const type = String(target.type ?? "").toLowerCase();
  if (!["iframe", "page"].includes(type)) return false;
  const url = String(target.url ?? "");
  if (!url) return false;
  if (/backend-api\/sentinel\/frame|hcaptcha|captcha/i.test(url)) return false;
  return /componentName=payment|elements-inner|js\.stripe\.com\/v3|chatgpt\.com\/checkout|\/checkout\//i.test(url);
}

function scoreChatgptCardTarget(target = {}) {
  const url = String(target.url ?? "");
  let score = 0;
  if (String(target.type ?? "").toLowerCase() === "iframe") score += 10;
  if (/componentName=payment/i.test(url)) score += 100;
  if (/elements-inner/i.test(url)) score += 50;
  if (/js\.stripe\.com\/v3/i.test(url)) score += 30;
  if (/chatgpt\.com\/checkout/i.test(url)) score += 20;
  return score;
}

function describeChatgptCardTarget(target = {}) {
  const url = String(target.url ?? "");
  if (/componentName=payment/i.test(url)) return "Stripe payment iframe";
  if (/elements-inner/i.test(url)) return "Stripe elements iframe";
  if (/chatgpt\.com\/checkout/i.test(url)) return "ChatGPT checkout page";
  return String(target.type || "browser target");
}

async function listChromeDebugTargets(port) {
  const targets = await requestChromeDebugJson(port, "/json/list");
  return Array.isArray(targets) ? targets : [];
}

async function evaluateChatgptCardTargets(debugPort, expression, emit, filledRoles, foundRoles, logged) {
  if (!debugPort) return null;

  let targets;
  try {
    targets = await listChromeDebugTargets(debugPort);
  } catch (error) {
    const key = `target-list-error:${error.message}`;
    if (!logged.has(key)) {
      logged.add(key);
      emit({
        type: "log",
        time: new Date().toISOString(),
        stage: "browser",
        message: `读取 Chrome iframe target 失败: ${error.message}`,
      });
    }
    return null;
  }

  const candidates = targets
    .filter((target) => target?.webSocketDebuggerUrl && isLikelyChatgptCardTarget(target))
    .sort((left, right) => scoreChatgptCardTarget(right) - scoreChatgptCardTarget(left));

  if (candidates.length > 0 && !logged.has("target-scan-found")) {
    logged.add("target-scan-found");
    emit({
      type: "log",
      time: new Date().toISOString(),
      stage: "browser",
      message: `检测到 ${candidates.length} 个 checkout/Stripe iframe target，优先进入 payment iframe 写卡。`,
    });
  }

  let lastValue = null;
  for (const target of candidates) {
    let targetCdp = null;
    try {
      targetCdp = new CdpConnection(target.webSocketDebuggerUrl);
      await targetCdp.send("Runtime.enable").catch(() => {});
      const evaluation = await targetCdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      const value = evaluation?.result?.value;
      if (!value || typeof value !== "object") continue;
      lastValue = {
        ...value,
        source: "devtools-target",
        targetUrl: target.url,
        targetType: target.type,
      };
      for (const role of value.found ?? []) foundRoles.add(role);
      for (const role of value.filled ?? []) {
        filledRoles.add(role);
        const key = `target:${target.id ?? target.url}:${role}`;
        if (!logged.has(key)) {
          logged.add(key);
          emit({
            type: "log",
            time: new Date().toISOString(),
            stage: "fill",
            message: `已写入字段: ${role} (${describeChatgptCardTarget(target)})`,
          });
        }
      }
    } catch (error) {
      const key = `target-error:${target.id ?? target.url}:${error.message}`;
      if (!logged.has(key) && /componentName=payment/i.test(String(target.url ?? ""))) {
        logged.add(key);
        emit({
          type: "log",
          time: new Date().toISOString(),
          stage: "browser",
          message: `Stripe payment iframe 写入尝试失败: ${error.message}`,
        });
      }
    } finally {
      if (targetCdp) targetCdp.close();
    }
  }

  return lastValue;
}

function scoreChatgptPaymentButtonTarget(target = {}) {
  const url = String(target.url ?? "");
  let score = 0;
  if (String(target.type ?? "").toLowerCase() === "page") score += 30;
  if (/chatgpt\.com\/checkout/i.test(url)) score += 100;
  if (/\/checkout\//i.test(url)) score += 40;
  if (/componentName=payment|elements-inner|js\.stripe\.com\/v3/i.test(url)) score += 10;
  return score;
}

function summarizePaymentButtonLocator(value = {}) {
  return firstString(value.text, value.id, value.className, value.tagName, "payment button");
}

async function locateChatgptPaymentButtonTargets(debugPort, expression, emit, logged) {
  if (!debugPort) return null;

  let targets;
  try {
    targets = await listChromeDebugTargets(debugPort);
  } catch (error) {
    const key = `payment-button-target-list-error:${error.message}`;
    if (!logged.has(key)) {
      logged.add(key);
      emit({
        type: "log",
        time: new Date().toISOString(),
        stage: "browser",
        message: `读取 Chrome target 失败: ${error.message}`,
      });
    }
    return null;
  }

  const candidates = targets
    .filter((target) => target?.webSocketDebuggerUrl && isLikelyChatgptCardTarget(target))
    .sort((left, right) => scoreChatgptPaymentButtonTarget(right) - scoreChatgptPaymentButtonTarget(left));

  for (const target of candidates) {
    let targetCdp = null;
    try {
      targetCdp = new CdpConnection(target.webSocketDebuggerUrl);
      await targetCdp.send("Runtime.enable").catch(() => {});
      const evaluation = await targetCdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      const value = evaluation?.result?.value;
      if (value?.found) {
        return {
          ...value,
          source: "devtools-target",
          targetUrl: target.url,
          targetType: target.type,
        };
      }
    } catch (error) {
      const key = `payment-button-target-error:${target.id ?? target.url}:${error.message}`;
      if (!logged.has(key)) {
        logged.add(key);
        emit({
          type: "log",
          time: new Date().toISOString(),
          stage: "browser",
          message: `最终付款按钮定位尝试失败: ${error.message}`,
        });
      }
    } finally {
      if (targetCdp) targetCdp.close();
    }
  }

  return null;
}

async function locateChatgptShortlinkPaymentButton(cdp, rootSessionId, contexts, emit, options = {}) {
  const expression = buildChatgptShortlinkPaymentButtonLocatorExpression({
    autoClick: options.clickPaymentButton === true,
  });
  const logged = new Set();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (attempt > 0) await delay(500);
    const targets = [...contexts.values()].filter(isLikelyChatgptCardContext);
    if (targets.length === 0) {
      targets.push({ sessionId: rootSessionId, contextId: null, origin: "https://chatgpt.com" });
    }

    for (const context of targets) {
      let evaluation;
      try {
        const params = {
          expression,
          returnByValue: true,
          awaitPromise: true,
        };
        if (context.contextId) params.contextId = context.contextId;
        evaluation = await cdp.send("Runtime.evaluate", params, context.sessionId);
      } catch {
        continue;
      }
      const value = evaluation?.result?.value;
      if (value?.found) {
        const result = {
          ...value,
          source: "execution-context",
          origin: context.origin,
        };
        emit({
          type: "log",
          time: new Date().toISOString(),
          stage: "browser",
          message: `已定位并高亮最终付款按钮: ${summarizePaymentButtonLocator(result)}`,
        });
        return result;
      }
    }

    const targetResult = await locateChatgptPaymentButtonTargets(options.debugPort, expression, emit, logged);
    if (targetResult?.found) {
      emit({
        type: "log",
        time: new Date().toISOString(),
        stage: "browser",
        message: `已定位并高亮最终付款按钮: ${summarizePaymentButtonLocator(targetResult)}`,
      });
      return targetResult;
    }

    if (attempt === 0 || attempt === 5) {
      emit({
        type: "log",
        time: new Date().toISOString(),
        stage: "browser",
        message: "正在定位最终付款按钮...",
      });
    }
  }

  const result = { found: false, status: "payment_button_not_found" };
  emit({
    type: "log",
    time: new Date().toISOString(),
    stage: "browser",
    message: "未定位到最终付款按钮；浏览器保持打开。",
  });
  return result;
}

async function autofillChatgptShortlinkCard(cdp, rootSessionId, cardInput, contexts, emit, options = {}) {
  const expression = buildChatgptShortlinkCardAutofillExpression(cardInput);
  const filledRoles = new Set();
  const foundRoles = new Set();
  const logged = new Set();
  let lastResult = null;
  const finishFillResult = async (lastFrame) => {
    const result = {
      ok: true,
      status: "filled",
      filled: [...filledRoles],
      found: [...foundRoles],
      lastFrame,
    };
    if (options.locatePaymentButton) {
      result.paymentButton = await locateChatgptShortlinkPaymentButton(cdp, rootSessionId, contexts, emit, options);
    }
    return result;
  };

  for (let attempt = 0; attempt < 36; attempt += 1) {
    await delay(attempt === 0 ? 1800 : 700);
    const targets = [...contexts.values()].filter(isLikelyChatgptCardContext);
    if (targets.length === 0) {
      targets.push({ sessionId: rootSessionId, contextId: null, origin: "https://chatgpt.com" });
    }

    for (const context of targets) {
      let evaluation;
      try {
        const params = {
          expression,
          returnByValue: true,
        };
        if (context.contextId) params.contextId = context.contextId;
        evaluation = await cdp.send("Runtime.evaluate", params, context.sessionId);
      } catch {
        continue;
      }
      const value = evaluation?.result?.value;
      if (!value || typeof value !== "object") continue;
      lastResult = value;
      for (const role of value.found ?? []) foundRoles.add(role);
      for (const role of value.filled ?? []) {
        filledRoles.add(role);
        const key = `${role}:${context.sessionId}:${context.contextId ?? "default"}`;
        if (!logged.has(key)) {
          logged.add(key);
          emit({
            type: "log",
            time: new Date().toISOString(),
            stage: "fill",
            message: `已写入字段: ${role} (${value.href || context.origin || "frame"})`,
          });
        }
      }
      if (hasCompleteChatgptShortlinkFill(filledRoles, cardInput)) {
        return await finishFillResult(value.href);
      }
    }

    const targetResult = await evaluateChatgptCardTargets(
      options.debugPort,
      expression,
      emit,
      filledRoles,
      foundRoles,
      logged,
    );
    if (targetResult) {
      lastResult = targetResult;
      if (hasCompleteChatgptShortlinkFill(filledRoles, cardInput)) {
        return await finishFillResult(targetResult.href || targetResult.targetUrl || "");
      }
    }

    if (attempt === 0 || attempt === 8 || attempt === 18 || attempt === 28) {
      emit({
        type: "log",
        time: new Date().toISOString(),
        stage: "browser",
        message: `等待卡片/账单地址输入框加载... found=${[...foundRoles].join(",") || "none"} filled=${[...filledRoles].join(",") || "none"}`,
      });
    }
  }

  return {
    ok: false,
    status: "fill_incomplete",
    filled: [...filledRoles],
    found: [...foundRoles],
    lastFrame: lastResult?.href ?? "",
    error: "未能在 ChatGPT checkout 页面中完整写入卡号/有效期/CVC",
  };
}

export async function runChatgptShortlinkCard({ card, emit = () => {}, proxyUrl = null } = {}) {
  const input = normalizeDirectCardInput(card);
  const clickPaymentButton = card?.clickPaymentButton === true || isTruthy(card?.clickPaymentButton);
  const locatePaymentButton = card?.locatePaymentButton === true || clickPaymentButton || isTruthy(card?.locatePaymentButton);
  const preparedProxy = await prepareSingleProxyUrl({
    proxyUrl: firstString(proxyUrl, card?.directCardProxyUrl, card?.proxyUrl),
    proxyChain: card?.proxyChain ?? [],
  });
  const resolvedProxyUrl = preparedProxy.proxyUrl;
  const checkoutUrl = normalizeChatgptShortlinkCheckoutUrl(input.checkoutInput);
  if (!input.sessionToken) {
    throw new Error("ChatGPT oaics_* 短链浏览器填卡需要 Session Token");
  }

  const cookies = buildBrowserSessionCookies({
    sessionToken: input.sessionToken,
    sessionCookieName: input.sessionCookieName,
  });
  const executable = findBrowserExecutable();
  const port = 0;
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-shortlink-card-"));
  const chromeOutput = [];
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      ...(resolvedProxyUrl ? [`--proxy-server=${resolvedProxyUrl}`, "--proxy-bypass-list=<-loopback>"] : []),
      "about:blank",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    },
  );
  const captureChromeOutput = (chunk) => {
    const text = String(chunk ?? "").trim();
    if (!text) return;
    chromeOutput.push(text);
    if (chromeOutput.length > 8) chromeOutput.shift();
  };
  child.stdout?.on("data", captureChromeOutput);
  child.stderr?.on("data", captureChromeOutput);

  child.once("exit", async () => {
    await closeProxyBridge(preparedProxy.bridge);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  });

  const finish = (result) => {
    emit({ type: "done", result });
    return result;
  };

  emit({
    type: "log",
    time: new Date().toISOString(),
    stage: "chatgpt",
    message: `启动 ChatGPT 短链浏览器填卡: ${checkoutUrl}; card=${maskCardNumber(input.number)}`,
  });

  emit({
    type: "log",
    time: new Date().toISOString(),
    stage: "chatgpt",
    message: `代理: ${resolvedProxyUrl || "direct"}`,
  });

  if (preparedProxy.bridge) {
    emit({
      type: "log",
      time: new Date().toISOString(),
      stage: "chatgpt",
      message: `proxy chain: ${formatProxyChain(preparedProxy.proxyChain)} via ${preparedProxy.bridge.url}`,
    });
  }

  let browserReady = false;
  let cdp = null;
  try {
    const debugPort = await waitForChromeDebugPort(port, { userDataDir, child, chromeOutput });
    cdp = await connectToChromeDebugPort(debugPort);
    const contexts = new Map();
    cdp.on("Runtime.executionContextCreated", (params, message) => {
      const context = params.context;
      if (!context?.id) return;
      const sessionId = message.sessionId || null;
      if (!sessionId) return;
      contexts.set(`${sessionId}:${context.id}`, {
        sessionId,
        contextId: context.id,
        origin: context.origin,
        frameId: context.auxData?.frameId,
      });
    });
    cdp.on("Target.attachedToTarget", (params) => {
      if (!params.sessionId) return;
      void cdp.send("Runtime.enable", {}, params.sessionId).catch(() => {});
      void cdp.send("Page.enable", {}, params.sessionId).catch(() => {});
    });

    await cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }).catch(() => {});
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);

    for (const cookie of cookies) {
      const result = await cdp.send("Network.setCookie", cookie, sessionId);
      if (result?.success === false) throw new Error(`Chrome refused cookie ${cookie.name}`);
    }
    emit({
      type: "log",
      time: new Date().toISOString(),
      stage: "browser",
      message: `Session Token 已注入，打开 checkout 页面`,
    });
    await cdp.send("Page.navigate", { url: checkoutUrl }, sessionId);
    browserReady = true;

    const fillResult = await autofillChatgptShortlinkCard(cdp, sessionId, input, contexts, emit, {
      debugPort,
      locatePaymentButton,
      clickPaymentButton,
    });
    if (fillResult.ok) {
      emit({
        type: "log",
        time: new Date().toISOString(),
        stage: "browser",
        message: "卡字段已写入浏览器页面；浏览器保持打开，用于确认、3DS 或查看页面结果。",
      });
    }
    return finish({
      ...fillResult,
      mode: "chatgpt-shortlink-browser",
      checkoutUrl,
      card: maskCardNumber(input.number),
    });
  } catch (error) {
    if (!browserReady) child.kill();
    return finish({
      ok: false,
      status: "error",
      mode: "chatgpt-shortlink-browser",
      error: redactCtfPayOutput(formatError(error), input),
      card: maskCardNumber(input.number),
    });
  } finally {
    if (cdp) cdp.close();
  }
}

export function pickDirectCardMode(cardInput) {
  const input = normalizeDirectCardInput(cardInput);
  if (isChatgptShortlinkCheckoutInput(input.checkoutInput)) return "chatgpt-shortlink-browser";
  return "ctf-pay-card";
}

export async function runDirectCardPayment(options = {}) {
  const mode = pickDirectCardMode(options.card);
  const proxyUrl = firstString(options.proxyUrl, options.card?.directCardProxyUrl, options.card?.proxyUrl);
  const proxyChain = Array.isArray(options.proxyChain) ? options.proxyChain : options.card?.proxyChain;
  const card = proxyChain ? { ...options.card, proxyChain } : options.card;
  if (mode === "chatgpt-shortlink-browser") return await runChatgptShortlinkCard({ ...options, card, proxyUrl });
  return await runCtfPayCard({ ...options, card, proxyUrl });
}

export const runDirectCardTest = runDirectCardPayment;

function startDirectCardTestJob(payload, jobs) {
  const job = {
    id: randomUUID(),
    events: [],
    listeners: new Set(),
    done: false,
    createdAt: Date.now(),
    mode: "direct-card",
  };

  const publish = (event) => {
    job.events.push(event);
    for (const listener of job.listeners) listener(event);
    if (event.type === "done") job.done = true;
  };

  jobs.set(job.id, job);
  try {
    job.mode = pickDirectCardMode(payload);
  } catch {
  }
  void runDirectCardPayment({
    card: payload,
    emit: publish,
    proxyUrl: firstString(payload?.directCardProxyUrl, payload?.proxyUrl),
  }).catch((error) => {
    const failure = {
      ok: false,
      status: "error",
      error: redactText(formatError(error)),
    };
    publish({
      type: "log",
      time: new Date().toISOString(),
      stage: "error",
      message: failure.error,
    });
    publish({ type: "done", result: failure });
  });
  return job;
}

function writeSseEvent(response, event) {
  const eventType = event.type === "done" ? "done" : "log";
  response.write(`event: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`);
}

function pruneDirectCardJobs(jobs) {
  const ttlMs = 30 * 60 * 1000;
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.done && now - job.createdAt > ttlMs) jobs.delete(id);
  }
}

async function serveCheckoutFrontend({
  checkoutEntry,
  proxySettings = null,
  checkoutProxyUrl = null,
  directCardProxyUrl = null,
  proxyUrl = null,
  port = DEFAULT_UI_PORT,
} = {}) {
  const paymentPages = new Map();
  const directCardJobs = new Map();
  const defaultProxySettings = proxySettings ?? resolveUiProxySettings({
    checkoutProxyUrl: checkoutProxyUrl ?? proxyUrl,
    directCardProxyUrl: directCardProxyUrl ?? proxyUrl,
    checkoutProxyEnabled: Boolean(checkoutProxyUrl ?? proxyUrl),
    directCardProxyEnabled: Boolean(directCardProxyUrl ?? proxyUrl),
  });
  const html = renderCheckoutToolHtml({
    capturedAt: checkoutEntry.startedDateTime,
    proxySettings: defaultProxySettings,
  });

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/") {
        sendHtml(response, 200, html);
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/direct-card/run") {
        const payload = await readJsonRequest(request);
        const requestProxySettings = resolveUiProxySettings(payload, defaultProxySettings);
        const proxyRoute = resolveChainedProxyRoute(requestProxySettings, requestProxySettings.directCardProxyUrl);
        const job = startDirectCardTestJob({
          ...payload,
          directCardProxyUrl: proxyRoute.proxyUrl,
          proxyChain: proxyRoute.proxyChain,
        }, directCardJobs);
        sendJson(response, 202, { ok: true, jobId: job.id, mode: job.mode });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/direct-card/events/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/direct-card/events/".length));
        const job = directCardJobs.get(id);
        if (!job) {
          sendJson(response, 404, { ok: false, error: "direct card job not found" });
          return;
        }

        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        response.write(": connected\n\n");
        for (const event of job.events) writeSseEvent(response, event);

        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          job.listeners.delete(listener);
        };
        const listener = (event) => {
          if (closed || response.destroyed) return;
          writeSseEvent(response, event);
          if (event.type === "done") {
            cleanup();
            response.end();
          }
        };
        if (job.done) {
          response.end();
          return;
        }
        job.listeners.add(listener);
        request.on("close", cleanup);
        return;
      }

      if (request.method === "POST" && (url.pathname === "/api/create-link" || url.pathname === "/api/open-payment")) {
        const payload = await readJsonRequest(request);
        const sessionFile = url.pathname === "/api/open-payment" ? normalizeUiSessionFile(payload) : null;
        const checkoutTemplate = normalizeCheckoutTemplate(payload);
        const billingAddress = normalizeBillingAddress(payload.billingAddress);
        const requestProxySettings = resolveUiProxySettings(payload, defaultProxySettings);
        const proxyRoute = resolveChainedProxyRoute(requestProxySettings, requestProxySettings.checkoutProxyUrl);
        const result = await createCheckoutSession({
          accessToken: payload.accessToken,
          checkoutEntry,
          proxyUrl: proxyRoute.proxyUrl,
          proxyChain: proxyRoute.proxyChain,
          planName: checkoutTemplate.planName,
          country: checkoutTemplate.paymentCountry,
          currency: checkoutTemplate.paymentCurrency,
          billingAddress,
        });
        const body = buildFrontendCheckoutResponse(result);

        if (url.pathname === "/api/open-payment" && result.ok && result.parsed) {
          if (sessionFile) {
            const browserCheckoutUrl = pickCheckoutBrowserUrl(result.parsed);
            await launchCheckoutBrowser({
              checkoutUrl: browserCheckoutUrl,
              sessionFile,
              billingAddress: result.billingAddress,
            });
            body.browserLaunched = true;
            body.browserCheckoutUrl = browserCheckoutUrl;
          } else {
            const id = randomUUID();
            paymentPages.set(id, {
              data: result.parsed,
              billingAddress: result.billingAddress,
              links: result.links,
              createdAt: Date.now(),
            });
            body.paymentUrl = `/pay/${encodeURIComponent(id)}`;
          }
        }

        sendJson(response, result.ok ? 200 : 502, body);
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/pay/")) {
        const id = decodeURIComponent(url.pathname.slice("/pay/".length));
        const page = paymentPages.get(id);
        if (!page) {
          sendHtml(response, 404, renderPaymentFallbackHtml({
            title: "支付页面已失效",
            message: "请回到控制台重新生成付款会话。",
            links: [],
          }));
          return;
        }

        const unavailableReason = getLocalCheckoutUnavailableReason(page.data);
        if (unavailableReason) {
          sendHtml(response, 200, renderPaymentFallbackHtml({
            title: "本地支付页不可用",
            message: unavailableReason,
            links: page.links,
          }));
          return;
        }

        sendHtml(response, 200, renderLocalCheckoutHtml(buildLocalCheckoutPageData(page.data, page.billingAddress)));
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, 500, { error: redactText(formatError(error)) });
    } finally {
      prunePaymentPages(paymentPages);
      pruneDirectCardJobs(directCardJobs);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const address = server.address();
  console.log(`[ui] open: http://127.0.0.1:${address.port}/`);
  console.log("[ui] press Ctrl+C to stop");

  await new Promise((resolve) => {
    const close = () => server.close(resolve);
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

function buildFrontendCheckoutResponse(result) {
  const response = {
    ok: result.ok,
    status: result.status,
    failureStage: result.failureStage,
    links: result.links,
    redacted: result.redacted,
    billingAddress: result.billingAddress,
    ctfPayCheckoutInput: result.parsed ? pickCtfPayCheckoutInput(result.parsed) : null,
    directCardCheckoutInput: result.parsed ? pickDirectCardCheckoutInput(result.parsed) : null,
    planName: result.planName,
    createPlanName: result.createPlanName,
    checkoutUpdate: result.checkoutUpdate,
    paymentCountry: result.paymentCountry,
    paymentCurrency: result.paymentCurrency,
  };

  if (!result.ok) {
    const checkoutError = result.parsed?.error && typeof result.parsed.error === "object"
      ? result.parsed.error
      : result.parsed && typeof result.parsed === "object"
        ? result.parsed
        : null;
    const message = firstString(
      checkoutError?.message,
      checkoutError?.detail,
      checkoutError?.error,
      checkoutError?.code,
    );
    const param = firstString(checkoutError?.param);
    if (message) {
      response.error = [
        result.failureStage ? `${result.failureStage}:` : "",
        message,
        param ? `(param=${param})` : "",
      ].filter(Boolean).join(" ");
    }
    response.text = redactText(result.text).slice(0, 1000);
  }

  return response;
}

function resolveUiProxyUrl(payload, fieldName, fallbackUrl = null) {
  if (payload && Object.hasOwn(payload, fieldName)) {
    return normalizeOptionalProxyUrl(payload[fieldName]);
  }
  if (payload && Object.hasOwn(payload, "proxyUrl")) {
    return normalizeOptionalProxyUrl(payload.proxyUrl);
  }
  return fallbackUrl;
}

function hasOwn(payload, fieldName) {
  return payload && Object.hasOwn(payload, fieldName);
}

function readUiBoolean(payload, fieldName, fallback = false) {
  if (!hasOwn(payload, fieldName)) return Boolean(fallback);
  const value = payload[fieldName];
  return value === true || isTruthy(value);
}

function readUiText(payload, fieldName, fallback = "") {
  if (!hasOwn(payload, fieldName)) return String(fallback ?? "");
  return String(payload[fieldName] ?? "");
}

function resolveUiProxySettings(payload, fallbackSettings = null) {
  const fallback = fallbackSettings ?? resolveProxySettings({}, {}, null);
  const localProxyPort = normalizeLocalProxyPort(
    readUiText(payload, "localProxyPort", fallback.localProxy?.port ?? 7890),
    fallback.localProxy?.port ?? 7890,
  );
  const localProxyEnabled = readUiBoolean(payload, "localProxyEnabled", fallback.localProxy?.enabled ?? true);
  const checkoutProxyExplicit = readUiBoolean(payload, "checkoutProxyExplicit", fallback.checkoutProxyExplicit ?? false);
  const directCardProxyExplicit = readUiBoolean(payload, "directCardProxyExplicit", fallback.directCardProxyExplicit ?? false);
  const checkoutProxyFallbackText = fallback.checkoutProxyExplicit ? fallback.checkoutProxy?.urls?.join("\n") : "";
  const directCardProxyFallbackText = fallback.directCardProxyExplicit ? fallback.directCardProxy?.urls?.join("\n") : "";
  const checkoutProxyFallbackEnabled = fallback.checkoutProxyExplicit ? fallback.checkoutProxy?.enabled : false;
  const directCardProxyFallbackEnabled = fallback.directCardProxyExplicit ? fallback.directCardProxy?.enabled : false;
  const checkoutProxyUrls = parseOutboundProxyUrlList(readUiText(
    payload,
    "checkoutProxyUrls",
    hasOwn(payload, "checkoutProxyUrl") ? payload.checkoutProxyUrl : checkoutProxyFallbackText,
  ));
  const directCardProxyUrls = parseOutboundProxyUrlList(readUiText(
    payload,
    "directCardProxyUrls",
    hasOwn(payload, "directCardProxyUrl") ? payload.directCardProxyUrl : directCardProxyFallbackText,
  ));
  const checkoutProxyEnabled = readUiBoolean(payload, "checkoutProxyEnabled", checkoutProxyFallbackEnabled);
  const directCardProxyEnabled = readUiBoolean(payload, "directCardProxyEnabled", directCardProxyFallbackEnabled);

  return {
    localProxy: {
      enabled: localProxyEnabled,
      host: "127.0.0.1",
      port: localProxyPort,
      url: localProxyEnabled ? `http://127.0.0.1:${localProxyPort}` : null,
    },
    checkoutProxy: {
      enabled: checkoutProxyEnabled,
      urls: checkoutProxyUrls,
    },
    directCardProxy: {
      enabled: directCardProxyEnabled,
      urls: directCardProxyUrls,
    },
    checkoutProxyExplicit,
    directCardProxyExplicit,
    checkoutProxyUrl: checkoutProxyEnabled ? pickProxyUrl(checkoutProxyUrls) : null,
    directCardProxyUrl: directCardProxyEnabled ? pickProxyUrl(directCardProxyUrls) : null,
  };
}

function sanitizeUiProxySettings(settings) {
  const localProxyPort = normalizeLocalProxyPort(settings?.localProxy?.port ?? 7890, 7890);
  const localProxyEnabled = settings?.localProxy?.enabled !== false;
  const checkoutProxyExplicit = settings?.checkoutProxyExplicit === true;
  const directCardProxyExplicit = settings?.directCardProxyExplicit === true;
  return {
    ...settings,
    localProxy: {
      enabled: localProxyEnabled,
      host: "127.0.0.1",
      port: localProxyPort,
      url: localProxyEnabled ? `http://127.0.0.1:${localProxyPort}` : null,
    },
    checkoutProxy: {
      enabled: checkoutProxyExplicit ? settings?.checkoutProxy?.enabled === true : false,
      urls: checkoutProxyExplicit ? (settings?.checkoutProxy?.urls ?? []) : [],
    },
    directCardProxy: {
      enabled: directCardProxyExplicit ? settings?.directCardProxy?.enabled === true : false,
      urls: directCardProxyExplicit ? (settings?.directCardProxy?.urls ?? []) : [],
    },
    checkoutProxyUrl: checkoutProxyExplicit ? settings?.checkoutProxyUrl ?? null : null,
    directCardProxyUrl: directCardProxyExplicit ? settings?.directCardProxyUrl ?? null : null,
  };
}

export function resolveChainedProxyRoute(proxySettings = {}, outboundProxyUrl = null) {
  const localProxy = proxySettings?.localProxy ?? {};
  const localProxyEnabled = localProxy?.enabled === true;
  const outboundProxyUrlNormalized = normalizeOptionalProxyUrl(outboundProxyUrl);

  if (!localProxyEnabled) {
    const proxyChain = normalizeProxyChain([outboundProxyUrlNormalized]);
    return {
      usesLocalProxy: false,
      usesOutboundProxy: Boolean(outboundProxyUrlNormalized),
      upstreamProxyUrl: outboundProxyUrlNormalized,
      outboundProxyUrl: outboundProxyUrlNormalized,
      proxyUrl: proxyChain[0] ?? null,
      proxyChain,
      localProxy: {
        enabled: false,
        host: "127.0.0.1",
        port: normalizeLocalProxyPort(localProxy?.port ?? 7890, 7890),
        url: null,
        upstreamProxyUrl: outboundProxyUrlNormalized,
      },
    };
  }

  const host = localProxy.host || "127.0.0.1";
  const port = normalizeLocalProxyPort(localProxy.port ?? 7890, 7890);
  const localProxyUrl = `http://${host}:${port}`;
  const proxyChain = normalizeProxyChain([localProxyUrl, outboundProxyUrlNormalized]);
  return {
    usesLocalProxy: true,
    usesOutboundProxy: Boolean(outboundProxyUrlNormalized),
    upstreamProxyUrl: outboundProxyUrlNormalized,
    outboundProxyUrl: outboundProxyUrlNormalized,
    proxyUrl: localProxyUrl,
    proxyChain,
    localProxy: {
      enabled: true,
      host,
      port,
      url: localProxyUrl,
      upstreamProxyUrl: outboundProxyUrlNormalized,
    },
  };
}

function prunePaymentPages(paymentPages) {
  const ttlMs = 30 * 60 * 1000;
  const now = Date.now();
  for (const [id, page] of paymentPages.entries()) {
    if (now - page.createdAt > ttlMs) paymentPages.delete(id);
  }
}

export function normalizeUiSessionFile(payload) {
  const sessionToken = firstString(
    payload?.sessionToken,
    payload?.session_token,
    payload?.nextAuthSessionToken,
    payload?.["__Secure-next-auth.session-token"],
  );
  const useSessionLogin = payload?.useSessionLogin === true || isTruthy(payload?.useSessionLogin);
  if (!useSessionLogin && !sessionToken) return null;
  if (!sessionToken) throw new Error("启用登录态时需要填写 Session Token");

  return normalizeSessionFile({
    accessToken: payload?.accessToken,
    sessionToken,
    sessionCookieName: firstString(payload?.sessionCookieName, payload?.session_cookie_name),
    expires: firstString(payload?.sessionExpires, payload?.expires),
  });
}

async function readJsonRequest(request, maxBytes = 128 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("request body is too large");
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

export function renderCheckoutToolHtml({
  capturedAt,
  proxyUrl = null,
  checkoutProxyUrl = null,
  directCardProxyUrl = null,
  proxySettings = null,
} = {}) {
  const uiCheckoutProxyUrl = normalizeSupportedOutboundProxySeedUrl(checkoutProxyUrl ?? proxyUrl);
  const uiDirectCardProxyUrl = normalizeSupportedOutboundProxySeedUrl(directCardProxyUrl ?? proxyUrl);
  const settings = sanitizeUiProxySettings(proxySettings ?? resolveUiProxySettings({
    checkoutProxyUrl: uiCheckoutProxyUrl,
    directCardProxyUrl: uiDirectCardProxyUrl,
    checkoutProxyEnabled: Boolean(uiCheckoutProxyUrl),
    directCardProxyEnabled: Boolean(uiDirectCardProxyUrl),
    checkoutProxyExplicit: Boolean(uiCheckoutProxyUrl),
    directCardProxyExplicit: Boolean(uiDirectCardProxyUrl),
  }));
  const checkoutProxyText = settings.checkoutProxy?.urls?.join("\n") || "";
  const directCardProxyText = settings.directCardProxy?.urls?.join("\n") || "";
  const metaJson = JSON.stringify({
    capturedAt,
    proxy: settings.checkoutProxyUrl || settings.directCardProxyUrl || "direct",
    localProxyEnabled: settings.localProxy?.enabled === true,
    localProxyPort: settings.localProxy?.port || 7890,
    checkoutProxyEnabled: settings.checkoutProxy?.enabled === true,
    checkoutProxy: checkoutProxyText,
    directCardProxyEnabled: settings.directCardProxy?.enabled === true,
    directCardProxy: directCardProxyText,
    planName: DEFAULT_PLAN_NAME,
    paymentCountry: DEFAULT_PAYMENT_COUNTRY,
    paymentCurrency: DEFAULT_PAYMENT_CURRENCY,
    planOptions: CHECKOUT_PLAN_OPTIONS,
    countryCodes: SUPPORTED_PAYMENT_COUNTRY_CODES,
    currencyCodes: SUPPORTED_PAYMENT_CURRENCY_CODES,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>付款控制台</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f5f2;
      color: #151515;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.92), rgba(245,245,242,0.94)),
        repeating-linear-gradient(90deg, rgba(0,0,0,0.035) 0, rgba(0,0,0,0.035) 1px, transparent 1px, transparent 42px);
    }
    main {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 18px;
      align-items: start;
    }
    header {
      grid-column: 1 / -1;
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 18px;
      padding-bottom: 8px;
      border-bottom: 1px solid #d8d8d3;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      font-size: 12px;
      color: #555;
    }
    .pill {
      border: 1px solid #d8d8d3;
      border-radius: 999px;
      padding: 6px 10px;
      background: rgba(255,255,255,0.72);
    }
    section, aside {
      background: rgba(255,255,255,0.92);
      border: 1px solid #ddddda;
      border-radius: 8px;
      box-shadow: 0 18px 45px rgba(30, 30, 26, 0.08);
    }
    section {
      padding: 24px;
    }
    aside {
      padding: 18px;
    }
    label {
      display: block;
      font-size: 13px;
      color: #4f4f49;
      margin-bottom: 8px;
      font-weight: 700;
    }
    .token-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 44px;
      gap: 8px;
      align-items: center;
    }
    input, textarea, select {
      width: 100%;
      min-width: 0;
      border: 1px solid #c9c9c3;
      border-radius: 7px;
      font: inherit;
      background: #fff;
      color: #151515;
    }
    input, select {
      height: 44px;
      padding: 0 12px;
    }
    textarea {
      min-height: 88px;
      padding: 10px 12px;
      resize: vertical;
      line-height: 1.4;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    input:focus, textarea:focus, select:focus {
      outline: 2px solid #276ef1;
      outline-offset: 1px;
      border-color: #276ef1;
    }
    .session-box {
      display: grid;
      gap: 8px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #deded9;
    }
    .address-box {
      display: grid;
      gap: 10px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #deded9;
    }
    .direct-card-box {
      display: grid;
      gap: 10px;
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px solid #deded9;
    }
    .proxy-box {
      display: grid;
      gap: 10px;
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px solid #deded9;
    }
    .proxy-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      align-items: start;
    }
    .proxy-grid .span-2 {
      grid-column: 1 / -1;
    }
    .local-listener {
      max-width: 280px;
    }
    .proxy-list {
      min-height: 74px;
    }
    .address-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .card-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.8fr) repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .address-grid .wide {
      grid-column: 1 / -1;
    }
    .field {
      display: grid;
      gap: 6px;
    }
    select {
      width: 100%;
      min-height: 42px;
      border: 1px solid #cfcfca;
      border-radius: 7px;
      padding: 0 10px;
      color: #151515;
      background: #fff;
      font: inherit;
    }
    .template-grid {
      display: grid;
      gap: 10px;
      margin-bottom: 16px;
    }
    .check-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: #151515;
      font-size: 13px;
    }
    .check-row input {
      width: 16px;
      height: 16px;
      padding: 0;
      accent-color: #276ef1;
    }
    .icon-button, .action {
      border: 0;
      border-radius: 7px;
      cursor: pointer;
      font: inherit;
      font-weight: 800;
    }
    .icon-button {
      width: 44px;
      height: 44px;
      background: #ebebe7;
      color: #151515;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    .action {
      height: 48px;
      color: #fff;
      background: #151515;
    }
    .action.secondary {
      background: #276ef1;
    }
    .action:disabled, .icon-button:disabled {
      opacity: 0.58;
      cursor: wait;
    }
    .status {
      min-height: 24px;
      margin-top: 14px;
      color: #3f4b5b;
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .status.error {
      color: #b42318;
    }
    .result {
      margin-top: 20px;
      display: grid;
      gap: 12px;
    }
    .links {
      display: grid;
      gap: 8px;
    }
    .link-line {
      display: grid;
      grid-template-columns: 130px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      padding: 10px;
      border: 1px solid #deded9;
      border-radius: 7px;
      background: #fbfbf9;
      font-size: 13px;
    }
    a {
      color: #0b57d0;
      overflow-wrap: anywhere;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }
    pre {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      border: 1px solid #deded9;
      border-radius: 7px;
      padding: 12px;
      background: #111;
      color: #f3f3ed;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .terminal {
      min-height: 210px;
      max-height: 360px;
      color: #b8f5cd;
      background: #0c1511;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 16px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    dl {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 9px 12px;
      margin: 0;
      font-size: 13px;
    }
    dt {
      color: #62625c;
    }
    dd {
      margin: 0;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    @media (max-width: 820px) {
      main {
        grid-template-columns: 1fr;
      }
      header {
        align-items: start;
        flex-direction: column;
      }
      .meta {
        justify-content: flex-start;
      }
      .proxy-grid {
        grid-template-columns: 1fr;
      }
      .actions {
        grid-template-columns: 1fr;
      }
      .address-grid {
        grid-template-columns: 1fr;
      }
      .card-grid {
        grid-template-columns: 1fr 1fr;
      }
      .card-grid .wide {
        grid-column: 1 / -1;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>付款控制台</h1>
      <div class="meta">
        <span class="pill">付款地区 PH / PHP</span>
        <span class="pill" id="proxy"></span>
        <span class="pill" id="capture"></span>
      </div>
    </header>

    <section>
      <label for="token">Access Token</label>
      <div class="token-row">
        <input id="token" type="password" autocomplete="off" spellcheck="false">
        <button id="toggle-token" class="icon-button" type="button" title="显示或隐藏 Access Token">Aa</button>
      </div>
      <div class="session-box">
        <label class="check-row" for="use-session-login">
          <input id="use-session-login" type="checkbox">
          <span>使用登录态</span>
        </label>
        <label for="session-token">Session Token</label>
        <textarea id="session-token" autocomplete="off" spellcheck="false"></textarea>
      </div>
      <div class="proxy-box">
        <h2>代理</h2>
        <div class="proxy-grid">
          <div class="field span-2 local-listener">
            <label class="check-row" for="local-proxy-enabled">
              <input id="local-proxy-enabled" type="checkbox">
              <span>本地 Clash</span>
            </label>
            <input id="local-proxy-port" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="7890">
          </div>
          <div class="field">
            <label class="check-row" for="checkout-proxy-enabled">
              <input id="checkout-proxy-enabled" type="checkbox">
              <span>提链代理</span>
            </label>
            <textarea id="checkout-proxy" class="proxy-list" autocomplete="off" spellcheck="false" placeholder="https://user:pass@example.com:8443&#10;socks5://user:pass@example.com:1080"></textarea>
          </div>
          <div class="field">
            <label class="check-row" for="direct-card-proxy-enabled">
              <input id="direct-card-proxy-enabled" type="checkbox">
              <span>直卡代理</span>
            </label>
            <textarea id="direct-card-proxy" class="proxy-list" autocomplete="off" spellcheck="false" placeholder="https://user:pass@example.com:8443&#10;socks5://user:pass@example.com:1080"></textarea>
          </div>
        </div>
      </div>
      <div class="direct-card-box">
        <h2>CTF-pay 直连银行卡</h2>
        <div class="card-grid">
          <div class="field wide">
            <label for="direct-card-checkout">Checkout URL / Session ID</label>
            <input id="direct-card-checkout" autocomplete="off" spellcheck="false" placeholder="https://chatgpt.com/checkout/openai_llc/cs_live_... 或 cs_live_...">
          </div>
          <div class="field wide">
            <label for="direct-card-number">银行卡号</label>
            <input id="direct-card-number" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242">
          </div>
          <div class="field">
            <label for="direct-card-exp-month">MM</label>
            <input id="direct-card-exp-month" inputmode="numeric" autocomplete="cc-exp-month" placeholder="12">
          </div>
          <div class="field">
            <label for="direct-card-exp-year">YYYY</label>
            <input id="direct-card-exp-year" inputmode="numeric" autocomplete="cc-exp-year" placeholder="2030">
          </div>
          <div class="field">
            <label for="direct-card-cvc">CVC</label>
            <input id="direct-card-cvc" type="password" inputmode="numeric" autocomplete="cc-csc" placeholder="123">
          </div>
        </div>
        <div class="address-box">
          <h2>账单地址</h2>
          <div class="address-grid">
            <div class="field">
              <label for="billing-name">姓名</label>
              <input id="billing-name" data-address="name" autocomplete="billing name">
            </div>
            <div class="field">
              <label for="billing-email">邮箱</label>
              <input id="billing-email" data-address="email" autocomplete="billing email">
            </div>
            <div class="field">
              <label for="billing-phone">电话</label>
              <input id="billing-phone" data-address="phone" autocomplete="billing tel">
            </div>
            <div class="field">
              <label for="billing-country">账单国家</label>
              <input id="billing-country" data-address="country" autocomplete="billing country" placeholder="US">
            </div>
            <div class="field wide">
              <label for="billing-line1">地址 1</label>
              <input id="billing-line1" data-address="line1" autocomplete="billing address-line1">
            </div>
            <div class="field wide">
              <label for="billing-line2">地址 2</label>
              <input id="billing-line2" data-address="line2" autocomplete="billing address-line2">
            </div>
            <div class="field">
              <label for="billing-city">城市</label>
              <input id="billing-city" data-address="city" autocomplete="billing address-level2">
            </div>
            <div class="field">
              <label for="billing-state">州/省</label>
              <input id="billing-state" data-address="state" autocomplete="billing address-level1">
            </div>
            <div class="field">
              <label for="billing-postal-code">邮编</label>
              <input id="billing-postal-code" data-address="postalCode" autocomplete="billing postal-code">
            </div>
          </div>
        </div>
        <div class="actions">
          <button id="run-direct-card" class="action secondary" type="button">运行 CTF-pay 直卡</button>
          <button id="run-direct-card-final" class="action secondary" type="button">运行直卡并点击付款按钮</button>
        </div>
        <pre id="direct-card-terminal" class="terminal" aria-live="polite">[空闲] CTF-pay 直卡日志会显示在这里。</pre>
      </div>
      <div class="actions">
        <button id="create-link" class="action" type="button">生成付款链接</button>
        <button id="open-payment" class="action secondary" type="button">打开付款页面</button>
      </div>
      <div id="status" class="status"></div>
      <div id="result" class="result"></div>
    </section>

    <aside>
      <h2>请求模板</h2>
      <div class="template-grid">
        <div class="field">
          <label for="plan-name">套餐</label>
          <select id="plan-name"></select>
        </div>
        <div class="field">
          <label for="payment-country">付款国家</label>
          <select id="payment-country"></select>
        </div>
        <div class="field">
          <label for="payment-currency">付款币种</label>
          <select id="payment-currency"></select>
        </div>
      </div>
      <dl>
        <dt>当前套餐</dt><dd id="template-plan">chatgptplusplan</dd>
        <dt>入口</dt><dd>all_plans_pricing_modal</dd>
        <dt>界面</dt><dd>custom</dd>
        <dt>付款国家</dt><dd id="template-country">PH</dd>
        <dt>付款币种</dt><dd id="template-currency">PHP</dd>
      </dl>
    </aside>
  </main>
  <script>
    const meta = ${metaJson};
    const tokenInput = document.querySelector("#token");
    const useSessionLoginInput = document.querySelector("#use-session-login");
    const sessionTokenInput = document.querySelector("#session-token");
    const localProxyEnabledInput = document.querySelector("#local-proxy-enabled");
    const localProxyPortInput = document.querySelector("#local-proxy-port");
    const checkoutProxyEnabledInput = document.querySelector("#checkout-proxy-enabled");
    const checkoutProxyInput = document.querySelector("#checkout-proxy");
    const directCardProxyEnabledInput = document.querySelector("#direct-card-proxy-enabled");
    const directCardProxyInput = document.querySelector("#direct-card-proxy");
    const toggleButton = document.querySelector("#toggle-token");
    const createButton = document.querySelector("#create-link");
    const openButton = document.querySelector("#open-payment");
    const directCardRunButton = document.querySelector("#run-direct-card");
    const directCardFinalButton = document.querySelector("#run-direct-card-final");
    const directCardTerminal = document.querySelector("#direct-card-terminal");
    const directCardCheckoutInput = document.querySelector("#direct-card-checkout");
    const directCardNumberInput = document.querySelector("#direct-card-number");
    const directCardExpMonthInput = document.querySelector("#direct-card-exp-month");
    const directCardExpYearInput = document.querySelector("#direct-card-exp-year");
    const directCardCvcInput = document.querySelector("#direct-card-cvc");
    const statusNode = document.querySelector("#status");
    const resultNode = document.querySelector("#result");
    const planInput = document.querySelector("#plan-name");
    const paymentCountryInput = document.querySelector("#payment-country");
    const paymentCurrencyInput = document.querySelector("#payment-currency");
    const templatePlanNode = document.querySelector("#template-plan");
    const templateCountryNode = document.querySelector("#template-country");
    const templateCurrencyNode = document.querySelector("#template-currency");
    const addressInputs = [...document.querySelectorAll("[data-address]")];
    const directCardInputs = [
      directCardCheckoutInput,
      directCardNumberInput,
      directCardExpMonthInput,
      directCardExpYearInput,
      directCardCvcInput
    ];
    const templateInputs = [planInput, paymentCountryInput, paymentCurrencyInput];
    let directCardEventSource = null;

    document.querySelector("#proxy").textContent = "本地 Clash " + (meta.localProxyEnabled ? ("127.0.0.1:" + meta.localProxyPort) : "off") + " / 提链 " + (meta.checkoutProxyEnabled ? "on" : "off") + " / 直卡 " + (meta.directCardProxyEnabled ? "on" : "off");
    document.querySelector("#capture").textContent = "模板 " + (meta.capturedAt || "内置");
    localProxyEnabledInput.checked = !!meta.localProxyEnabled;
    localProxyPortInput.value = meta.localProxyPort || "7890";
    checkoutProxyEnabledInput.checked = !!meta.checkoutProxyEnabled;
    checkoutProxyInput.value = meta.checkoutProxy || "";
    directCardProxyEnabledInput.checked = !!meta.directCardProxyEnabled;
    directCardProxyInput.value = meta.directCardProxy || "";
    populateTemplateInputs();

    toggleButton.addEventListener("click", () => {
      tokenInput.type = tokenInput.type === "password" ? "text" : "password";
      tokenInput.focus();
    });

    createButton.addEventListener("click", () => runCheckout("create-link"));
    openButton.addEventListener("click", () => runCheckout("open-payment"));
    directCardRunButton.addEventListener("click", () => runDirectCardTest());
    directCardFinalButton.addEventListener("click", () => runDirectCardTest({ locatePaymentButton: true, clickPaymentButton: true }));

    function setBusy(isBusy) {
      createButton.disabled = isBusy;
      openButton.disabled = isBusy;
      toggleButton.disabled = isBusy;
      useSessionLoginInput.disabled = isBusy;
      sessionTokenInput.disabled = isBusy;
      localProxyEnabledInput.disabled = isBusy;
      localProxyPortInput.disabled = isBusy;
      checkoutProxyEnabledInput.disabled = isBusy;
      checkoutProxyInput.disabled = isBusy;
      for (const input of addressInputs) input.disabled = isBusy;
      for (const input of templateInputs) input.disabled = isBusy;
    }

    function setDirectCardBusy(isBusy) {
      directCardRunButton.disabled = isBusy;
      directCardFinalButton.disabled = isBusy;
      localProxyEnabledInput.disabled = isBusy;
      localProxyPortInput.disabled = isBusy;
      directCardProxyEnabledInput.disabled = isBusy;
      directCardProxyInput.disabled = isBusy;
      for (const input of directCardInputs) input.disabled = isBusy;
      for (const input of addressInputs) input.disabled = isBusy;
    }

    function setStatus(message, isError = false) {
      statusNode.textContent = message;
      statusNode.classList.toggle("error", isError);
    }

    async function runCheckout(mode) {
      const accessToken = tokenInput.value.trim();
      if (!accessToken) {
        setStatus("请输入 Access Token。", true);
        tokenInput.focus();
        return;
      }

      const useSessionLogin = mode === "open-payment" && useSessionLoginInput.checked;
      const sessionToken = sessionTokenInput.value.trim();
      if (useSessionLogin && !sessionToken) {
        setStatus("启用登录态时需要填写 Session Token。", true);
        sessionTokenInput.focus();
        return;
      }

      let paymentWindow = null;
      if (mode === "open-payment" && !useSessionLogin) {
        paymentWindow = window.open("", "_blank");
        if (paymentWindow) {
          paymentWindow.document.write("<!doctype html><title>付款</title><body style='font-family:system-ui;padding:24px'>正在创建付款会话...</body>");
        }
      }

      setBusy(true);
      setStatus(mode === "open-payment" ? "正在打开付款页面..." : "正在生成付款链接...");
      resultNode.replaceChildren();

      try {
        const requestBody = { accessToken, ...collectCheckoutTemplate() };
        const billingAddress = collectBillingAddress();
        if (Object.keys(billingAddress).length > 0) requestBody.billingAddress = billingAddress;
        if (useSessionLogin) {
          requestBody.useSessionLogin = true;
          requestBody.sessionToken = sessionToken;
        }
        const response = await fetch("/api/" + mode, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody)
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || payload.text || ("checkout 状态 " + payload.status));
        }

        renderResult(payload);
        setStatus(payload.browserLaunched ? "付款浏览器已启动。" : "付款会话已创建。");

        if (mode === "open-payment") {
          if (payload.browserLaunched) {
            if (paymentWindow) paymentWindow.close();
          } else if (payload.paymentUrl && paymentWindow) {
            paymentWindow.location.href = payload.paymentUrl;
          } else if (payload.paymentUrl) {
            window.open(payload.paymentUrl, "_blank");
          }
        }
      } catch (error) {
        if (paymentWindow) paymentWindow.close();
        setStatus(error && error.message ? error.message : String(error), true);
      } finally {
        setBusy(false);
      }
    }

    function collectBillingAddress() {
      const result = {};
      for (const input of addressInputs) {
        const value = input.value.trim();
        if (value) result[input.dataset.address] = value;
      }
      return result;
    }

    function populateTemplateInputs() {
      const countryNames = typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["zh-CN"], { type: "region" })
        : null;
      const currencyNames = typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["zh-CN"], { type: "currency" })
        : null;

      for (const option of meta.planOptions || []) {
        planInput.add(new Option(option.label + " (" + option.value + ")", option.value));
      }
      for (const code of meta.countryCodes || []) {
        const label = countryNames?.of(code) || code;
        paymentCountryInput.add(new Option(code + " - " + label, code));
      }
      for (const code of meta.currencyCodes || []) {
        const label = currencyNames?.of(code) || code;
        paymentCurrencyInput.add(new Option(code + " - " + label, code));
      }

      planInput.value = meta.planName;
      paymentCountryInput.value = meta.paymentCountry;
      paymentCurrencyInput.value = meta.paymentCurrency;
      updateTemplateSummary();
      for (const input of templateInputs) input.addEventListener("change", updateTemplateSummary);
    }

    function collectCheckoutTemplate() {
      const checkoutProxyText = checkoutProxyEnabledInput.checked
        ? normalizeOutboundProxyTextarea(checkoutProxyInput.value, "提链代理")
        : "";
      return {
        planName: planInput.value,
        paymentCountry: paymentCountryInput.value,
        paymentCurrency: paymentCurrencyInput.value,
        localProxyEnabled: localProxyEnabledInput.checked,
        localProxyPort: localProxyPortInput.value.trim(),
        checkoutProxyEnabled: checkoutProxyEnabledInput.checked,
        checkoutProxyUrls: checkoutProxyText,
        checkoutProxyUrl: checkoutProxyText
      };
    }

    function updateTemplateSummary() {
      templatePlanNode.textContent = planInput.value;
      templateCountryNode.textContent = paymentCountryInput.value;
      templateCurrencyNode.textContent = paymentCurrencyInput.value;
    }

    function collectDirectCardInput() {
      const directCardProxyText = directCardProxyEnabledInput.checked
        ? normalizeOutboundProxyTextarea(directCardProxyInput.value, "直卡代理")
        : "";
      return {
        checkoutInput: directCardCheckoutInput.value.trim(),
        accessToken: tokenInput.value.trim(),
        sessionToken: sessionTokenInput.value.trim(),
        paymentCountry: paymentCountryInput.value,
        paymentCurrency: paymentCurrencyInput.value,
        localProxyEnabled: localProxyEnabledInput.checked,
        localProxyPort: localProxyPortInput.value.trim(),
        directCardProxyEnabled: directCardProxyEnabledInput.checked,
        directCardProxyUrls: directCardProxyText,
        directCardProxyUrl: directCardProxyText,
        number: directCardNumberInput.value.trim(),
        expMonth: directCardExpMonthInput.value.trim(),
        expYear: directCardExpYearInput.value.trim(),
        cvc: directCardCvcInput.value.trim(),
        billingAddress: collectBillingAddress()
      };
    }

    function isChatgptBrowserCheckoutInput(value) {
      const raw = String(value || "").trim();
      if (/oaics_[A-Za-z0-9]+/.test(raw)) return true;
      try {
        const parsed = new URL(raw);
        const parts = parsed.pathname.split("/").filter(Boolean);
        const id = parts[2] || "";
        return parsed.origin === "https://chatgpt.com" &&
          parts[0] === "checkout" &&
          parts.length >= 3 &&
          (/^oaics_[A-Za-z0-9]+/.test(id) || /^cs_(?:live|test)_[A-Za-z0-9]+/i.test(id));
      } catch {
        return false;
      }
    }

    function displayDirectCardStage(stage) {
      return {
        ctfpay: "CTF-pay",
        chatgpt: "ChatGPT",
        browser: "浏览器",
        fill: "填卡",
        stdout: "输出",
        stderr: "错误输出",
        error: "错误",
        done: "完成",
        event: "事件"
      }[stage] || stage;
    }

    function appendDirectCardLog(event) {
      const stamp = typeof event.time === "string" ? event.time.slice(11, 19) : "--:--:--";
      const stage = displayDirectCardStage(event.stage || "event");
      const suffix = event.result ? " " + JSON.stringify(event.result) : "";
      const message = event.message || "进程结束";
      directCardTerminal.textContent += "\\n[" + stamp + "] [" + stage + "] " + message + suffix;
      directCardTerminal.scrollTop = directCardTerminal.scrollHeight;
    }

    function normalizeOutboundProxyTextarea(value, label) {
      const newline = String.fromCharCode(10);
      const carriageReturn = String.fromCharCode(13);
      const entries = String(value || "")
        .split(carriageReturn).join(newline)
        .split(newline)
        .reduce((all, line) => all.concat(line.split(",")), [])
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => !/^(direct|none|off|null)$/i.test(item));
      if (entries.length === 0) {
        throw new Error(label + " 至少填写一个 https:// 或 socks5:// 代理");
      }
      const normalized = [];
      for (const entry of entries) {
        const parsed = new URL(entry);
        if (!["https:", "socks5:"].includes(parsed.protocol)) {
          throw new Error(label + " 仅支持 https:// 或 socks5:// 代理");
        }
        normalized.push(parsed.toString().replace(new RegExp("/$"), ""));
      }
      return [...new Set(normalized)].join(newline);
    }

    async function runDirectCardTest(options = {}) {
      const card = collectDirectCardInput();
      if (options.locatePaymentButton) card.locatePaymentButton = true;
      if (options.clickPaymentButton) {
        card.locatePaymentButton = true;
        card.clickPaymentButton = true;
      }
      if (!card.number || !card.expMonth || !card.expYear || !card.cvc) {
        directCardTerminal.textContent = "[错误] 请填写银行卡号、有效期和 CVC。";
        return;
      }
      if (!card.checkoutInput && !card.accessToken) {
        directCardTerminal.textContent = "[错误] 请填写 checkout URL / Session ID，或在上方填写 Access Token 让 CTF-pay 生成 fresh checkout。";
        return;
      }
      if (isChatgptBrowserCheckoutInput(card.checkoutInput) && !card.sessionToken) {
        directCardTerminal.textContent = "[错误] ChatGPT oaics_* 短链填卡需要 Session Token。";
        sessionTokenInput.focus();
        return;
      }

      if (directCardEventSource) {
        directCardEventSource.close();
        directCardEventSource = null;
      }

      const chatgptBrowserMode = isChatgptBrowserCheckoutInput(card.checkoutInput);
      directCardTerminal.textContent = chatgptBrowserMode
        ? (card.locatePaymentButton
          ? (card.clickPaymentButton
            ? "[连接中] 正在启动 ChatGPT 短链浏览器填卡链路，完成后点击付款按钮..."
            : "[连接中] 正在启动 ChatGPT 短链浏览器填卡链路，完成后定位付款按钮...")
          : "[连接中] 正在启动 ChatGPT 短链浏览器填卡链路...")
        : "[连接中] 正在启动 CTF-pay/card.py 直卡链路...";
      setDirectCardBusy(true);
      try {
        const response = await fetch("/api/direct-card/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(card)
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.jobId) {
          throw new Error(payload.error || "CTF-pay 直卡启动失败");
        }

        directCardEventSource = new EventSource("/api/direct-card/events/" + encodeURIComponent(payload.jobId));
        directCardEventSource.addEventListener("log", (event) => {
          appendDirectCardLog(JSON.parse(event.data));
        });
        directCardEventSource.addEventListener("done", (event) => {
          appendDirectCardLog(JSON.parse(event.data));
          directCardEventSource.close();
          directCardEventSource = null;
          setDirectCardBusy(false);
        });
        directCardEventSource.onerror = () => {
          if (!directCardEventSource) return;
          directCardTerminal.textContent += "\\n[传输] 事件流中断。";
          directCardEventSource.close();
          directCardEventSource = null;
          setDirectCardBusy(false);
        };
      } catch (error) {
        directCardTerminal.textContent += "\\n[错误] " + (error && error.message ? error.message : String(error));
        setDirectCardBusy(false);
      }
    }

    function displayLinkLabel(label) {
      return {
        provider_url: "服务商链接",
        checkout_url: "付款链接",
        hosted_url: "托管链接",
        hosted_checkout_url: "托管付款页",
        chatgpt_checkout_url: "ChatGPT 付款链接"
      }[label] || label;
    }

    function renderResult(payload) {
      const fragment = document.createDocumentFragment();
      const links = document.createElement("div");
      links.className = "links";
      const directCardInputUrl = payload.directCardCheckoutInput || payload.ctfPayCheckoutInput || "";
      if (directCardInputUrl) {
        directCardCheckoutInput.value = directCardInputUrl;
        directCardTerminal.textContent = "[就绪] 已将生成的 checkout 链接填入直连输入框。";
      } else if ((directCardCheckoutInput.value || "").includes("oaics_")) {
        directCardCheckoutInput.value = "";
        directCardTerminal.textContent = "[提示] 当前付款链接是 ChatGPT oaics_*，CTF-pay/card.py 需要 Stripe cs_live_* / cs_test_*。可清空此框，直接用 Access Token 让 CTF-pay 生成 hosted fresh checkout。";
      } else if (payload.ok) {
        directCardTerminal.textContent = "[提示] 当前响应没有 Stripe cs_* checkout。CTF-pay 直卡需要 cs_live_* / cs_test_*；也可以留空 checkout 输入，用 Access Token 让 CTF-pay 生成 hosted fresh checkout。";
      }

      if (Array.isArray(payload.links) && payload.links.length) {
        for (const link of payload.links) {
          const row = document.createElement("div");
          row.className = "link-line";
          const label = document.createElement("strong");
          label.textContent = displayLinkLabel(link.label);
          const anchor = document.createElement("a");
          anchor.href = link.url;
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          anchor.textContent = link.url;
          row.append(label, anchor);
          links.append(row);
        }
      }

      if (payload.paymentUrl) {
        const row = document.createElement("div");
        row.className = "link-line";
        const label = document.createElement("strong");
        label.textContent = "本地付款页";
        const anchor = document.createElement("a");
        anchor.href = payload.paymentUrl;
        anchor.target = "_blank";
        anchor.textContent = new URL(payload.paymentUrl, window.location.href).href;
        row.append(label, anchor);
        links.prepend(row);
      }

      if (payload.browserCheckoutUrl) {
        const row = document.createElement("div");
        row.className = "link-line";
        const label = document.createElement("strong");
        label.textContent = "浏览器付款页";
        const anchor = document.createElement("a");
        anchor.href = payload.browserCheckoutUrl;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        anchor.textContent = payload.browserCheckoutUrl;
        row.append(label, anchor);
        links.prepend(row);
      }

      fragment.append(links);
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(payload.redacted || payload, null, 2);
      fragment.append(pre);
      resultNode.replaceChildren(fragment);
    }
  </script>
</body>
</html>`;
}

function renderPaymentFallbackHtml({ title, message, links }) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const linkHtml = (links ?? [])
    .map((link) => {
      const url = escapeHtml(link.url);
      return `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f5f2;
      color: #151515;
    }
    main {
      width: min(680px, 100%);
      background: #fff;
      border: 1px solid #ddddda;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 18px 45px rgba(30, 30, 26, 0.08);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 22px;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 16px;
      color: #4f4f49;
      overflow-wrap: anywhere;
    }
    .links {
      display: grid;
      gap: 10px;
    }
    a {
      color: #0b57d0;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    <div class="links">${linkHtml}</div>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildBrowserSessionCookies(sessionFile) {
  const cookies = [...(sessionFile?.cookies ?? [])];
  if (sessionFile?.sessionToken) {
    cookies.push(...buildSessionTokenCookies(sessionFile));
  }
  return cookies.map(toChromeCookieParams);
}

function buildSessionTokenCookies(sessionFile) {
  const name = sessionFile.sessionCookieName || "__Secure-next-auth.session-token";
  const value = extractCookieValue(sessionFile.sessionToken);
  const baseCookie = {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    expires: normalizeCookieExpires(sessionFile.expires),
  };

  if (value.length <= COOKIE_VALUE_CHUNK_SIZE) {
    return [{ ...baseCookie, name, value }];
  }

  const chunks = [];
  for (let offset = 0, index = 0; offset < value.length; offset += COOKIE_VALUE_CHUNK_SIZE, index += 1) {
    chunks.push({
      ...baseCookie,
      name: `${name}.${index}`,
      value: value.slice(offset, offset + COOKIE_VALUE_CHUNK_SIZE),
    });
  }
  return chunks;
}

function toChromeCookieParams(cookie) {
  const params = {
    name: cookie.name,
    value: extractCookieValue(cookie.value),
    url: "https://chatgpt.com/",
    path: cookie.path || "/",
    secure: cookie.secure !== false,
    httpOnly: cookie.httpOnly !== false,
    sameSite: normalizeSameSite(cookie.sameSite),
    expires: normalizeCookieExpires(cookie.expires),
  };

  if (!params.value) throw new Error(`Cookie ${params.name} has an empty value`);
  return params;
}

export function pickCheckoutBrowserUrl(data) {
  const links = buildCheckoutLinks(data);
  return (
    links.find((link) => link.label === "chatgpt_checkout_url")?.url ??
    links.find((link) => link.url.includes("chatgpt.com/checkout/"))?.url ??
    links[0]?.url ??
    null
  );
}

async function launchCheckoutBrowser({ checkoutUrl, sessionFile, chromePath, remoteDebuggingPort = 0, billingAddress = {} }) {
  if (!checkoutUrl) throw new Error("No checkout URL available for browser launch");
  const cookies = buildBrowserSessionCookies(sessionFile);
  if (cookies.length === 0) throw new Error("No browser cookies available for injection");

  const executable = chromePath || findBrowserExecutable();
  const port = Number.isInteger(remoteDebuggingPort) && remoteDebuggingPort > 0 ? remoteDebuggingPort : 0;
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-checkout-"));
  const chromeOutput = [];

  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "about:blank",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    },
  );
  const captureChromeOutput = (chunk) => {
    const text = String(chunk ?? "").trim();
    if (!text) return;
    chromeOutput.push(text);
    if (chromeOutput.length > 8) chromeOutput.shift();
  };
  child.stdout?.on("data", captureChromeOutput);
  child.stderr?.on("data", captureChromeOutput);

  child.once("exit", async () => {
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  });

  try {
    const debugPort = await waitForChromeDebugPort(port, { userDataDir, child, chromeOutput });
    const cdp = await connectToChromeDebugPort(debugPort);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Network.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      for (const cookie of cookies) {
        let result;
        try {
          result = await cdp.send("Network.setCookie", cookie, sessionId);
        } catch (error) {
          throw new Error(`Failed to set browser cookie ${cookie.name}: ${error.message}`);
        }
        if (result?.success === false) {
          throw new Error(`Chrome refused cookie ${cookie.name}`);
        }
      }
      await cdp.send("Page.navigate", { url: checkoutUrl }, sessionId);
      await autofillCheckoutBillingAddress(cdp, sessionId, billingAddress);
    } finally {
      cdp.close();
    }
  } catch (error) {
    child.kill();
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  console.log(`[browser] launched: ${checkoutUrl}`);
  console.log("[browser] close the launched browser window after finishing payment");
}

async function autofillCheckoutBillingAddress(cdp, sessionId, billingAddress = {}) {
  const expression = buildBillingAddressAutofillExpression(billingAddress);
  if (!expression) return null;

  let lastResult = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(attempt === 0 ? 1200 : 800);
    try {
      const evaluation = await cdp.send(
        "Runtime.evaluate",
        {
          expression,
          returnByValue: true,
        },
        sessionId,
      );
      lastResult = evaluation?.result?.value ?? null;
    } catch (error) {
      lastResult = { filled: 0, skipped: 0, error: error.message };
    }
    if (lastResult?.filled > 0) break;
  }

  if (lastResult) {
    console.log(`[browser] address autofill fields=${lastResult.filled} skipped=${lastResult.skipped}`);
  }
  return lastResult;
}

export function buildBillingAddressAutofillExpression(billingAddress = {}) {
  const details = toStripeBillingDetails(billingAddress);
  if (Object.keys(details).length === 0 && Object.keys(details.address ?? {}).length === 0) return null;
  const payloadJson = JSON.stringify(details).replace(/</g, "\\u003c");
  return `(() => {
  const data = ${payloadJson};
  const values = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    line1: data.address && data.address.line1,
    line2: data.address && data.address.line2,
    city: data.address && data.address.city,
    state: data.address && data.address.state,
    postal_code: data.address && data.address.postal_code,
    country: data.address && data.address.country
  };
  const aliases = {
    name: ["name", "full name", "cardholder", "billing name"],
    email: ["email", "e-mail"],
    phone: ["phone", "tel", "telephone"],
    line1: ["address-line1", "address line 1", "address1", "line1", "street", "street address", "billing address"],
    line2: ["address-line2", "address line 2", "address2", "line2", "apt", "suite", "unit"],
    city: ["address-level2", "city", "locality", "town"],
    state: ["address-level1", "state", "province", "region", "administrative"],
    postal_code: ["postal-code", "postal", "postcode", "zip"],
    country: ["country", "country_code", "country code"]
  };

  function allFields(root, seen = new Set()) {
    const fields = [];
    if (!root || seen.has(root)) return fields;
    seen.add(root);
    try {
      fields.push(...root.querySelectorAll("input, select, textarea"));
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) fields.push(...allFields(element.shadowRoot, seen));
      }
      for (const frame of root.querySelectorAll("iframe")) {
        try {
          if (frame.contentDocument) fields.push(...allFields(frame.contentDocument, seen));
        } catch {}
      }
    } catch {}
    return fields;
  }

  function textFor(element) {
    const labels = [];
    try {
      if (element.labels) {
        for (const label of element.labels) labels.push(label.textContent || "");
      }
    } catch {}
    return [
      element.name,
      element.id,
      element.autocomplete,
      element.placeholder,
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test"),
      ...labels
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function matches(element, field) {
    const text = textFor(element);
    return aliases[field].some((alias) => text.includes(alias));
  }

  function setNativeValue(element, value) {
    if (!value || !element || element.disabled || element.readOnly) return false;
    const tag = element.tagName.toLowerCase();
    if (tag === "select") {
      const wanted = String(value).toLowerCase();
      for (const option of element.options) {
        if (
          String(option.value).toLowerCase() === wanted ||
          String(option.textContent || "").toLowerCase() === wanted ||
          String(option.textContent || "").toLowerCase().includes(wanted)
        ) {
          element.value = option.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }
    const prototype = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    return true;
  }

  const fields = allFields(document);
  let filled = 0;
  let skipped = 0;
  const used = new Set();
  for (const [field, value] of Object.entries(values)) {
    if (!value) continue;
    const target = fields.find((element) => !used.has(element) && matches(element, field));
    if (target && setNativeValue(target, value)) {
      used.add(target);
      filled += 1;
    } else {
      skipped += 1;
    }
  }
  return { filled, skipped };
})();`;
}

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const stat = requireStatSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {}
  }

  throw new Error("Chrome/Edge executable not found; set CHROME_PATH to chrome.exe or msedge.exe");
}

function requireStatSync(filePath) {
  return fsSync.statSync(filePath);
}

async function getFreeTcpPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export function parseChromeDevToolsActivePortFile(contents) {
  const [portLine = "", websocketPath = ""] = String(contents ?? "").split(/\r?\n/);
  const port = Number.parseInt(portLine, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid Chrome DevTools active port: ${JSON.stringify(portLine)}`);
  }
  if (!websocketPath.trim()) {
    throw new Error("Invalid Chrome DevTools active port file: missing websocket path");
  }
  return { port, websocketPath: websocketPath.trim() };
}

export async function waitForChromeDebugPort(port, { userDataDir = null, child = null, chromeOutput = [], timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let detectedPort = Number.isInteger(port) && port > 0 ? port : null;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      const tail = chromeOutput.length > 0 ? `; chrome output: ${chromeOutput.slice(-3).join(" | ")}` : "";
      throw new Error(`Chrome exited before DevTools became available${tail}`);
    }

    if (userDataDir) {
      try {
        const activePortText = await fs.readFile(path.join(userDataDir, "DevToolsActivePort"), "utf8");
        const activePort = parseChromeDevToolsActivePortFile(activePortText);
        detectedPort = activePort.port;
      } catch (error) {
        lastError = error;
      }
    }

    try {
      const candidatePort = detectedPort ?? port;
      if (candidatePort) {
        await requestChromeDebugJson(candidatePort, "/json/version", { timeoutMs: 1200 });
        return candidatePort;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Chrome DevTools endpoint did not start on port ${detectedPort ?? port}: ${lastError?.message ?? "timeout"}`);
}

async function connectToChromeDebugPort(port) {
  ensureLoopbackNoProxy();
  if (typeof WebSocket !== "function") {
    throw new Error("This Node.js runtime does not provide WebSocket; use Node 22+");
  }

  const version = await requestChromeDebugJson(port, "/json/version");
  if (!version.webSocketDebuggerUrl) {
    throw new Error("Chrome DevTools response did not include webSocketDebuggerUrl");
  }

  return new CdpConnection(version.webSocketDebuggerUrl);
}

function requestChromeDebugJson(port, requestPath, { timeoutMs = 2500 } = {}) {
  ensureLoopbackNoProxy();
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        method: "GET",
        timeout: timeoutMs,
        headers: { accept: "application/json" },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Chrome DevTools ${requestPath} failed: ${response.statusCode} ${text.slice(0, 160)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(new Error(`Chrome DevTools ${requestPath} returned invalid JSON: ${error.message}`));
          }
        });
      },
    );
    request.once("timeout", () => {
      request.destroy(new Error(`Chrome DevTools ${requestPath} timed out after ${timeoutMs}ms`));
    });
    request.once("error", reject);
    request.end();
  });
}

class CdpConnection {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    this.socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("Chrome DevTools socket closed"));
      this.pending.clear();
    });
  }

  async send(method, params = {}, sessionId = null) {
    await this.ready;
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify(message));
    return promise;
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (!message.id && message.method) {
      this.emit(message.method, message.params ?? {}, message);
      this.emit("*", message.params ?? {}, message);
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`.trim()));
      return;
    }
    pending.resolve(message.result ?? {});
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) ?? new Set();
    handlers.add(handler);
    this.listeners.set(method, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.listeners.delete(method);
    };
  }

  emit(method, params, message) {
    const handlers = this.listeners.get(method);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(params, message);
      } catch {
      }
    }
  }

  close() {
    this.socket.close();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildCheckoutUpdateBody(checkoutSession, planName = DEFAULT_PLAN_NAME) {
  const planConfig = getCheckoutPlanConfig(planName);
  if (!planConfig.update) return null;

  const checkoutSessionId = firstString(checkoutSession?.checkout_session_id, checkoutSession?.id);
  if (!checkoutSessionId) {
    throw new Error(`Checkout update for ${planConfig.value} requires checkout_session_id`);
  }

  return {
    checkout_session_id: checkoutSessionId,
    processor_entity: firstString(checkoutSession?.processor_entity, "openai_llc"),
    plan_name: planConfig.update.planName,
    price_interval: planConfig.update.priceInterval,
    seat_quantity: planConfig.update.seatQuantity,
  };
}

export function buildCheckoutUpdateHeaders(headers, checkoutSession) {
  const checkoutSessionId = firstString(checkoutSession?.checkout_session_id, checkoutSession?.id);
  const processorEntity = firstString(checkoutSession?.processor_entity, "openai_llc");
  const result = {
    ...headers,
    "x-openai-target-path": "/backend-api/payments/checkout/update",
    "x-openai-target-route": "/backend-api/payments/checkout/update",
  };

  if (checkoutSessionId) {
    result.referer = `https://chatgpt.com/checkout/${encodeURIComponent(processorEntity)}/${encodeURIComponent(checkoutSessionId)}`;
  }

  return result;
}

export async function createCheckoutSession({
  accessToken,
  checkoutEntry = buildEmbeddedCheckoutEntry(),
  proxyUrl = null,
  proxyChain = [],
  planName = DEFAULT_PLAN_NAME,
  country = DEFAULT_PAYMENT_COUNTRY,
  currency = DEFAULT_PAYMENT_CURRENCY,
  billingAddress = {},
} = {}) {
  const checkoutUrl = new URL(checkoutEntry.request.url);
  if (checkoutUrl.origin !== "https://chatgpt.com" || checkoutUrl.pathname !== "/backend-api/payments/checkout") {
    throw new Error(`Refusing unexpected checkout URL: ${checkoutUrl.toString()}`);
  }

  const checkoutTemplate = normalizeCheckoutTemplate({
    planName,
    paymentCountry: country,
    paymentCurrency: currency,
  });
  const planConfig = getCheckoutPlanConfig(checkoutTemplate.planName);
  const normalizedBillingAddress = normalizeBillingAddress({
    ...billingAddress,
    currency: firstString(billingAddress?.currency, checkoutTemplate.paymentCurrency),
  });
  const checkoutBillingDetails = {
    ...normalizedBillingAddress,
    country: checkoutTemplate.paymentCountry,
    currency: checkoutTemplate.paymentCurrency,
  };
  if (checkoutBillingDetails.address) {
    checkoutBillingDetails.address = {
      ...checkoutBillingDetails.address,
      country: checkoutTemplate.paymentCountry,
    };
  }
  const body = JSON.stringify(
    rewriteCheckoutTemplate(checkoutEntry.request.postData?.text, {
      ...checkoutTemplate,
      billingAddress: checkoutBillingDetails,
    }),
  );
  const headers = sanitizeHeaders(checkoutEntry.request.headers, accessToken);
  const response = await postCheckoutRequest(CHECKOUT_ENDPOINT, {
    headers,
    body,
    proxyUrl,
    proxyChain,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}

  let ok = response.ok;
  let status = response.status;
  let finalText = text;
  let finalParsed = parsed;
  let checkoutUpdate = null;
  let failureStage = response.ok ? null : "checkout/create";

  if (response.ok && parsed && planConfig.update) {
    const updateBodyObject = buildCheckoutUpdateBody(parsed, checkoutTemplate.planName);
    const updateResponse = await postCheckoutRequest(CHECKOUT_UPDATE_ENDPOINT, {
      headers: buildCheckoutUpdateHeaders(headers, parsed),
      body: JSON.stringify(updateBodyObject),
      proxyUrl,
      proxyChain,
    });
    const updateText = await updateResponse.text();
    let updateParsed = null;
    try {
      updateParsed = JSON.parse(updateText);
    } catch {}

    const updateSession =
      updateParsed?.checkout_session && typeof updateParsed.checkout_session === "object"
        ? updateParsed.checkout_session
        : null;
    const updateOk = updateResponse.ok && updateParsed?.success !== false && !!updateSession;
    checkoutUpdate = {
      ok: updateOk,
      status: updateResponse.status,
      body: updateBodyObject,
      redacted: updateSession ? redactCheckoutResult(updateSession) : updateParsed ? redactCheckoutResult(updateParsed) : null,
    };
    ok = updateOk;
    status = updateResponse.status;
    finalText = updateText;
    finalParsed = updateSession ?? updateParsed;
    failureStage = updateOk ? null : "checkout/update";
  }

  return {
    ok,
    status,
    failureStage,
    text: finalText,
    parsed: finalParsed,
    links: finalParsed ? buildCheckoutLinks(finalParsed) : [],
    redacted: finalParsed ? redactCheckoutResult(finalParsed) : null,
    billingAddress: normalizedBillingAddress,
    planName: checkoutTemplate.planName,
    createPlanName: planConfig.createPlanName,
    paymentCountry: checkoutTemplate.paymentCountry,
    paymentCurrency: checkoutTemplate.paymentCurrency,
    directCardCheckoutInput: finalParsed ? pickDirectCardCheckoutInput(finalParsed) : null,
    checkoutUpdate,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const checkoutEntry = await loadCheckoutEntry(args);
  const checkoutUrl = new URL(checkoutEntry.request.url);
  if (checkoutUrl.origin !== "https://chatgpt.com") {
    throw new Error(`Refusing non-lab checkout origin: ${checkoutUrl.origin}`);
  }

  const proxySettings = resolveProxySettings(args, process.env, checkoutEntry);
  const { checkoutProxyUrl, directCardProxyUrl } = proxySettings;
  const checkoutProxyRoute = resolveChainedProxyRoute(proxySettings, checkoutProxyUrl);
  if (
    checkoutProxyRoute.proxyChain.length === 1 &&
    shouldReexecForEnvProxy(args, process.env, process.execArgv, checkoutProxyRoute.proxyUrl)
  ) {
    console.log(`[proxy] relaunching with Node --use-env-proxy for ${checkoutProxyRoute.proxyUrl}`);
    const exitCode = await reexecWithEnvProxy(checkoutProxyRoute.proxyUrl, argv);
    process.exitCode = exitCode;
    return;
  }

  if (!args.har) {
    console.log(`[checkout-template] embedded HAR capture ${EMBEDDED_CHECKOUT_CAPTURED_AT}`);
  }

  if (args.ui) {
    await serveCheckoutFrontend({
      checkoutEntry,
      proxySettings,
      port: args.uiPort ?? DEFAULT_UI_PORT,
    });
    return;
  }

  const sessionFile = args.sessionFile
    ? await loadSessionFile(args.sessionFile)
    : args.promptSessionJson
      ? await promptForSessionJson()
      : null;

  if (shouldCheckDns(args, process.env)) {
    const extraCidrs = parseCsv(process.env.LAB_ALLOWED_CIDRS);
    await assertDomainsResolveToLab(REQUIRED_DOMAINS, extraCidrs);
  } else {
    console.log("[dns] skipped by default; pass --check-dns or set LAB_CHECK_DNS=1 to enable");
  }

  const accessToken = sessionFile?.accessToken ?? (await resolveAccessToken(process.env, promptForAccessToken));
  console.log(`[identity] ${JSON.stringify(summarizeAccessTokenIdentity(accessToken))}`);

  console.log(`[checkout] POST ${CHECKOUT_ENDPOINT}`);
  console.log("[checkout] billing_details.country=PH billing_details.currency=PHP");
  console.log("[checkout] no card/CVV/payment confirmation fields will be sent");
  console.log(`[proxy] checkout=${formatProxyChain(checkoutProxyRoute.proxyChain)} direct-card=${directCardProxyUrl || "direct"}`);

  const checkoutSession = await createCheckoutSession({
    accessToken,
    checkoutEntry,
    proxyUrl: checkoutProxyRoute.proxyUrl,
    proxyChain: checkoutProxyRoute.proxyChain,
  });

  console.log(`[checkout] status=${checkoutSession.status}`);
  const { parsed } = checkoutSession;

  if (parsed) {
    for (const line of formatCheckoutLinks(checkoutSession.links)) {
      console.log(line);
    }
    console.log(JSON.stringify(checkoutSession.redacted, null, 2));

    if (checkoutSession.ok && args.serveLocalCheckout) {
      const unavailableReason = getLocalCheckoutUnavailableReason(parsed);
      if (unavailableReason) {
        console.log(`[local-checkout] ${unavailableReason}`);
      } else {
        await serveLocalCheckoutPage(parsed, { port: args.localCheckoutPort ?? 0 });
      }
    }

    if (checkoutSession.ok && args.launchSessionBrowser) {
      if (!sessionFile) {
        throw new Error("--launch-session-browser requires --session-file or --prompt-session-json");
      }
      await launchCheckoutBrowser({
        checkoutUrl: pickCheckoutBrowserUrl(parsed),
        sessionFile,
        chromePath: args.chromePath,
        remoteDebuggingPort: args.remoteDebuggingPort ?? 0,
      });
    }
  } else {
    console.log(redactText(checkoutSession.text).slice(0, 1000));
  }

  if (!checkoutSession.ok) {
    process.exitCode = 1;
  }
}

async function assertDomainsResolveToLab(domains, extraCidrs) {
  for (const domain of domains) {
    const ips = await resolveDomainIps(domain);
    if (ips.length === 0) {
      throw new Error(`DNS check failed: ${domain} resolved to no IPs`);
    }

    const publicIps = ips.filter((ip) => !isPrivateOrLabIp(ip, extraCidrs));
    if (publicIps.length > 0) {
      throw new Error(`DNS check failed: ${domain} resolved outside lab/private ranges: ${publicIps.join(", ")}`);
    }

    console.log(`[dns] ${domain} -> ${ips.join(", ")}`);
  }
}

async function resolveDomainIps(domain) {
  const results = [];
  for (const type of ["resolve4", "resolve6"]) {
    try {
      results.push(...(await dns[type](domain)));
    } catch (error) {
      if (!["ENODATA", "ENOTFOUND", "ENOTIMP"].includes(error?.code)) throw error;
    }
  }
  return [...new Set(results)];
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
    } else if (value === "--check-dns") {
      args.checkDns = true;
    } else if (value === "--proxy") {
      args.proxy = argv[index + 1];
      index += 1;
    } else if (value === "--checkout-proxy") {
      args.checkoutProxy = argv[index + 1];
      index += 1;
    } else if (value === "--direct-card-proxy") {
      args.directCardProxy = argv[index + 1];
      index += 1;
    } else if (value === "--local-proxy") {
      args.localProxy = true;
    } else if (value === "--local-proxy-port") {
      const port = Number.parseInt(argv[index + 1], 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid --local-proxy-port: ${argv[index + 1]}`);
      }
      args.localProxyPort = port;
      index += 1;
    } else if (value === "--no-proxy") {
      args.noProxy = true;
    } else if (value === "--har") {
      args.har = argv[index + 1];
      index += 1;
    } else if (value === "--session-file") {
      args.sessionFile = argv[index + 1];
      index += 1;
    } else if (value === "--prompt-session-json") {
      args.promptSessionJson = true;
    } else if (value === "--launch-session-browser") {
      args.launchSessionBrowser = true;
    } else if (value === "--chrome-path") {
      args.chromePath = argv[index + 1];
      index += 1;
    } else if (value === "--remote-debugging-port") {
      const port = Number.parseInt(argv[index + 1], 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid --remote-debugging-port: ${argv[index + 1]}`);
      }
      args.remoteDebuggingPort = port;
      index += 1;
    } else if (value === "--serve-local-checkout") {
      args.serveLocalCheckout = true;
    } else if (value === "--local-checkout-port") {
      const port = Number.parseInt(argv[index + 1], 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --local-checkout-port: ${argv[index + 1]}`);
      }
      args.localCheckoutPort = port;
      index += 1;
    } else if (value === "--ui") {
      args.ui = true;
    } else if (value === "--ui-port") {
      const port = Number.parseInt(argv[index + 1], 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --ui-port: ${argv[index + 1]}`);
      }
      args.uiPort = port;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

export function shouldCheckDns(args, env = process.env) {
  return Boolean(args?.checkDns || isTruthy(env?.LAB_CHECK_DNS));
}

export function inferProxyUrlFromHarEntry(entry) {
  const ip = entry?.serverIPAddress ?? entry?._serverIPAddress;
  const port = entry?.connection;
  if (ip === "127.0.0.1" && /^\d+$/.test(String(port ?? ""))) {
    return `http://127.0.0.1:${port}`;
  }
  return null;
}

export function resolveProxyUrl(args, env = process.env, checkoutEntry = null) {
  if (args?.noProxy) return null;
  if (args?.proxy) return normalizeProxyUrl(args.proxy);
  if (env?.LAB_PROXY) return normalizeProxyUrl(env.LAB_PROXY);
  if (env?.HTTPS_PROXY) return normalizeProxyUrl(env.HTTPS_PROXY);
  if (env?.HTTP_PROXY) return normalizeProxyUrl(env.HTTP_PROXY);
  return inferProxyUrlFromHarEntry(checkoutEntry);
}

function normalizeOptionalProxyUrl(value) {
  const text = value instanceof URL ? value.toString() : firstString(value);
  if (!text) return null;
  if (/^(direct|none|off|null)$/i.test(text)) return null;
  return normalizeProxyUrl(text);
}

function normalizeSupportedOutboundProxySeedUrl(value) {
  try {
    const text = firstString(value);
    if (!text) return null;
    if (/^(direct|none|off|null)$/i.test(text)) return null;
    const proxy = new URL(text);
    if (!["https:", "socks5:"].includes(proxy.protocol)) return null;
    return proxy.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function parseProxyUrlList(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[\r\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => !/^(direct|none|off|null)$/i.test(item))
        .map(normalizeProxyUrl),
    ),
  ];
}

export function parseOutboundProxyUrlList(value) {
  const entries = String(value ?? "")
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^(direct|none|off|null)$/i.test(item));
  if (entries.length === 0) return [];
  return [
    ...new Set(
      entries
        .map(normalizeProxyUrl)
        .map((item) => {
          const proxy = new URL(item);
          if (!["https:", "socks5:"].includes(proxy.protocol)) {
            throw new Error(`Unsupported outbound proxy protocol: ${proxy.protocol}`);
          }
          return proxy.toString().replace(/\/$/, "");
        }),
    ),
  ];
}

function pickProxyUrl(urls = []) {
  return Array.isArray(urls) && urls.length > 0 ? urls[0] : null;
}

function normalizeProxyEnabled(value, fallback = false) {
  if (value === true || value === false) return value;
  if (typeof value === "string" && value.trim()) return isTruthy(value);
  return Boolean(fallback);
}

function normalizeLocalProxyPort(value, fallback = 7890) {
  const port = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid local proxy port: ${value}`);
  }
  return port;
}

export function resolveProxySettings(args = {}, env = process.env, checkoutEntry = null) {
  if (args?.noProxy) {
    return {
      localProxy: {
        enabled: false,
        host: "127.0.0.1",
        port: normalizeLocalProxyPort(args?.localProxyPort ?? env?.LAB_LOCAL_PROXY_PORT ?? 7890),
        url: null,
      },
      checkoutProxy: { enabled: false, urls: [] },
      directCardProxy: { enabled: false, urls: [] },
      checkoutProxyExplicit: false,
      directCardProxyExplicit: false,
      checkoutProxyUrl: null,
      directCardProxyUrl: null,
    };
  }

  const legacyProxyUrl = resolveProxyUrl(args, env, checkoutEntry);
  const checkoutProxyInput = hasOwn(args, "checkoutProxy") ? args.checkoutProxy : env?.LAB_CHECKOUT_PROXY;
  const directCardProxyInput = hasOwn(args, "directCardProxy") ? args.directCardProxy : env?.LAB_DIRECT_CARD_PROXY;
  const checkoutProxyExplicit = checkoutProxyInput !== undefined;
  const directCardProxyExplicit = directCardProxyInput !== undefined;
  const checkoutProxyUrls = checkoutProxyExplicit
    ? parseOutboundProxyUrlList(checkoutProxyInput)
    : parseProxyUrlList(legacyProxyUrl ?? "");
  const directCardProxyUrls = directCardProxyExplicit
    ? parseOutboundProxyUrlList(directCardProxyInput)
    : parseProxyUrlList(legacyProxyUrl ?? "");
  const localProxyPort = normalizeLocalProxyPort(args?.localProxyPort ?? env?.LAB_LOCAL_PROXY_PORT ?? 7890);
  const localProxyEnabled = normalizeProxyEnabled(
    args?.localProxy,
    env?.LAB_LOCAL_PROXY !== undefined ? isTruthy(env.LAB_LOCAL_PROXY) : true,
  );
  const localProxyUrl = localProxyEnabled ? `http://127.0.0.1:${localProxyPort}` : null;
  const checkoutEnabled = normalizeProxyEnabled(
    args?.checkoutProxyEnabled ?? env?.LAB_CHECKOUT_PROXY_ENABLED,
    checkoutProxyUrls.length > 0,
  );
  const directCardEnabled = normalizeProxyEnabled(
    args?.directCardProxyEnabled ?? env?.LAB_DIRECT_CARD_PROXY_ENABLED,
    directCardProxyUrls.length > 0,
  );

  return {
    localProxy: {
      enabled: localProxyEnabled,
      host: "127.0.0.1",
      port: localProxyPort,
      url: localProxyUrl,
    },
    checkoutProxy: {
      enabled: checkoutEnabled,
      urls: checkoutProxyUrls,
    },
    directCardProxy: {
      enabled: directCardEnabled,
      urls: directCardProxyUrls,
    },
    checkoutProxyExplicit,
    directCardProxyExplicit,
    checkoutProxyUrl: checkoutEnabled ? pickProxyUrl(checkoutProxyUrls) : null,
    directCardProxyUrl: directCardEnabled ? pickProxyUrl(directCardProxyUrls) : null,
  };
}

export function resolveProxyTargets(args, env = process.env, checkoutEntry = null) {
  const settings = resolveProxySettings(args, env, checkoutEntry);
  return {
    checkoutProxyUrl: settings.checkoutProxyUrl,
    directCardProxyUrl: settings.directCardProxyUrl,
  };
}

export function shouldReexecForEnvProxy(args, env = process.env, execArgv = process.execArgv, proxyUrl = null) {
  let proxyProtocol = "";
  try {
    proxyProtocol = proxyUrl ? new URL(proxyUrl).protocol : "";
  } catch {
    proxyProtocol = "";
  }
  return Boolean(
    proxyUrl &&
      proxyProtocol === "http:" &&
      !args?.noProxy &&
      !env?.LAB_PROXY_REEXEC &&
      !execArgv.includes("--use-env-proxy"),
  );
}

export async function resolveAccessToken(env = process.env, prompt = promptForAccessToken) {
  const envToken = String(env?.LAB_ACCESS_TOKEN ?? "").trim();
  if (envToken) return envToken;

  const promptedToken = String(await prompt()).trim();
  if (!promptedToken) {
    throw new Error("Access token is required");
  }
  return promptedToken;
}

function printHelp() {
  console.log(`Usage:
  node checkout_ph_dry_run.mjs
  node checkout_ph_dry_run.mjs --ui
  node checkout_ph_dry_run.mjs --ui --ui-port 8787

Optional:
  $env:LAB_ACCESS_TOKEN = '<lab access token>'
  node checkout_ph_dry_run.mjs --proxy http://127.0.0.1:7890
  node checkout_ph_dry_run.mjs --local-proxy --local-proxy-port 7890
  node checkout_ph_dry_run.mjs --checkout-proxy https://proxy.example:8443 --direct-card-proxy socks5://user:pass@proxy.example:1080
  node checkout_ph_dry_run.mjs --no-proxy
  node checkout_ph_dry_run.mjs --check-dns
  node checkout_ph_dry_run.mjs --serve-local-checkout
  node checkout_ph_dry_run.mjs --serve-local-checkout --local-checkout-port 8787
  node checkout_ph_dry_run.mjs --session-file session.json --launch-session-browser
  node checkout_ph_dry_run.mjs --prompt-session-json --launch-session-browser
  node checkout_ph_dry_run.mjs --session-file session.json --launch-session-browser --chrome-path "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  node checkout_ph_dry_run.mjs --har data_new.har
  $env:LAB_PROXY = 'http://127.0.0.1:7890'
  $env:LAB_LOCAL_PROXY = '1'
  $env:LAB_LOCAL_PROXY_PORT = '7890'
  $env:LAB_CHECKOUT_PROXY = 'https://proxy.example:8443,socks5://user:pass@proxy.example:1080'
  $env:LAB_DIRECT_CARD_PROXY = 'socks5://user:pass@proxy.example:1080'
  $env:LAB_CHECK_DNS = '1'
  $env:LAB_ALLOWED_CIDRS = '100.64.0.0/10'
  $env:CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

By default the script uses an embedded checkout request captured from data_new.har
at ${EMBEDDED_CHECKOUT_CAPTURED_AT}. Pass --har to override the embedded request
with a fresh HAR export.
If --session-file is set, the script reads accessToken and sessionToken from
that JSON file. If --prompt-session-json is set, paste the whole JSON in the
terminal; the script starts once the pasted text parses as complete JSON.
Otherwise, if LAB_ACCESS_TOKEN is not set, the script prompts for the access
token after startup.
The embedded template keeps the HAR proxy metadata (${EMBEDDED_CHECKOUT_PROXY_HOST}:${EMBEDDED_CHECKOUT_PROXY_PORT})
and auto-uses it unless --no-proxy or another proxy setting is supplied.
DNS checks are skipped by default for lab speed. This script stops at checkout
session creation unless --serve-local-checkout is set. It never submits
card/CVV/payment confirmation data from the Node process.`);
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function normalizeProxyUrl(value) {
  const proxy = new URL(String(value));
  if (!["http:", "https:", "socks5:", "socks5h:"].includes(proxy.protocol)) {
    throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
  }
  return proxy.toString().replace(/\/$/, "");
}

function normalizeProxyChain(value) {
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map((item) => normalizeOptionalProxyUrl(item))
    .filter(Boolean)
    .filter((item, index, all) => index === 0 || item !== all[index - 1]);
}

function formatProxyChain(value) {
  const chain = normalizeProxyChain(value);
  return chain.length ? chain.map(redactProxyUrl).join(" -> ") : "direct";
}

async function postCheckoutRequest(url, { headers, body, proxyUrl, proxyChain = [] }) {
  const chain = normalizeProxyChain(proxyChain);
  if (chain.length > 1) {
    return postJsonViaHttpProxy(url, { headers, body, proxyChain: chain });
  }

  if (proxyUrl && !shouldUseNodeEnvProxy(proxyUrl, process.env, process.execArgv)) {
    return postJsonViaHttpProxy(url, { headers, body, proxyUrl });
  }

  return fetch(url, {
    method: "POST",
    headers,
    body,
    credentials: "omit",
    redirect: "manual",
  });
}

function envProxyMatches(proxyUrl, value) {
  if (!proxyUrl || !value) return false;
  try {
    return normalizeProxyUrl(value) === normalizeProxyUrl(proxyUrl);
  } catch {
    return false;
  }
}

export function shouldUseNodeEnvProxy(proxyUrl = null, env = process.env, execArgv = process.execArgv) {
  if (!proxyUrl) return false;
  try {
    if (new URL(proxyUrl).protocol !== "http:") return false;
  } catch {
    return false;
  }
  const hasNodeEnvProxy = execArgv.includes("--use-env-proxy");
  if (!hasNodeEnvProxy) return false;
  const matchingHttpProxy =
    envProxyMatches(proxyUrl, env?.HTTP_PROXY) ||
    envProxyMatches(proxyUrl, env?.HTTPS_PROXY) ||
    envProxyMatches(proxyUrl, env?.LAB_PROXY);
  return env?.LAB_PROXY_REEXEC === "1" && matchingHttpProxy;
}

export function ensureLoopbackNoProxy(env = process.env) {
  const updated = ensureNoProxyHosts(env?.NO_PROXY ?? env?.no_proxy, ["127.0.0.1", "localhost", "::1"]);
  if (updated !== null) {
    env.NO_PROXY = updated;
    env.no_proxy = updated;
  }
  return updated;
}

function ensureNoProxyHosts(existingValue, hosts) {
  const entries = String(existingValue ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const normalized = new Set(entries);
  let changed = false;
  for (const host of hosts) {
    if (!normalized.has(host)) {
      normalized.add(host);
      changed = true;
    }
  }
  const result = [...normalized].join(",");
  return changed ? result : result || null;
}

function reexecWithEnvProxy(proxyUrl, argv) {
  return new Promise((resolve, reject) => {
    const noProxy = ensureNoProxyHosts(process.env.NO_PROXY ?? process.env.no_proxy, ["127.0.0.1", "localhost", "::1"]);
    const child = spawn(process.execPath, ["--use-env-proxy", process.argv[1], ...argv], {
      stdio: "inherit",
      env: {
        ...process.env,
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        LAB_PROXY_REEXEC: "1",
        NO_PROXY: noProxy ?? process.env.NO_PROXY,
        no_proxy: noProxy ?? process.env.no_proxy,
      },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function postJsonViaHttpProxy(targetUrl, { headers, body, proxyUrl = null, proxyChain = [] }) {
  const target = new URL(targetUrl);
  const chain = normalizeProxyChain(proxyChain.length ? proxyChain : [proxyUrl]);
  if (target.protocol !== "https:") {
    throw new Error(`Proxy tunnel only supports HTTPS targets: ${target.protocol}`);
  }
  if (chain.length === 0) {
    throw new Error("Proxy tunnel requires at least one proxy");
  }

  const rawResponse = await requestThroughProxyChain(target, chain, {
    method: "POST",
    headers,
    body,
  });
  const parsed = parseHttpResponse(rawResponse);
  return {
    status: parsed.status,
    ok: parsed.status >= 200 && parsed.status < 300,
    text: async () => parsed.bodyText,
  };
}

async function requestThroughProxyChain(target, proxyChain, request) {
  const socket = await connectTargetThroughProxyChain(proxyChain, target.hostname, 443);

  try {
    const secureSocket = await connectTls(socket, target.hostname);
    return await sendHttp1Request(secureSocket, target, request);
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function connectTargetThroughProxy(proxy, targetHost, targetPort) {
  return await connectTargetThroughProxyChain([proxy], targetHost, targetPort);
}

async function connectTargetThroughProxyChain(proxyChain, targetHost, targetPort) {
  const proxies = normalizeProxyChain(proxyChain).map((value) => new URL(value));
  if (proxies.length === 0) return await connectDirectHost(targetHost, targetPort);

  let socket = await connectToProxyServer(proxies[0]);
  try {
    for (let index = 0; index < proxies.length; index += 1) {
      const proxy = proxies[index];
      if (index > 0) {
        socket = await wrapConnectedProxySocket(socket, proxy);
      }

      const nextProxy = proxies[index + 1] ?? null;
      const nextHost = nextProxy?.hostname ?? targetHost;
      const nextPort = nextProxy ? getProxyPort(nextProxy) : Number(targetPort);

      if (proxy.protocol === "http:" || proxy.protocol === "https:") {
        await establishConnectTunnel(socket, nextHost, nextPort, proxy);
        continue;
      }

      if (proxy.protocol === "socks5:" || proxy.protocol === "socks5h:") {
        await establishSocks5Connect(socket, proxy, nextHost, nextPort);
        continue;
      }

      throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
    }
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function getProxyPort(proxy) {
  if (proxy.port) return Number(proxy.port);
  if (proxy.protocol === "https:") return 443;
  if (proxy.protocol === "socks5:" || proxy.protocol === "socks5h:") return 1080;
  return 80;
}

async function connectToProxyServer(proxy) {
  if (proxy.protocol === "http:" || proxy.protocol === "https:") {
    return await connectToHttpProxy(proxy);
  }
  if (proxy.protocol === "socks5:" || proxy.protocol === "socks5h:") {
    return await connectDirectHost(proxy.hostname, getProxyPort(proxy));
  }
  throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
}

async function wrapConnectedProxySocket(socket, proxy) {
  if (proxy.protocol === "https:") return await connectTls(socket, proxy.hostname);
  return socket;
}

function connectDirectHost(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), host);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function connectToHttpProxy(proxy) {
  return new Promise((resolve, reject) => {
    const port = Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80));
    if (proxy.protocol === "https:") {
      const socket = tls.connect({
        host: proxy.hostname,
        port,
        servername: proxy.hostname,
        rejectUnauthorized: !isTruthy(process.env.LAB_INSECURE_TLS),
      });
      socket.once("secureConnect", () => resolve(socket));
      socket.once("error", reject);
      return;
    }
    const socket = net.connect(port, proxy.hostname);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function establishConnectTunnel(socket, targetHost, targetPort, proxy = null) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      cleanup();
      const header = buffer.subarray(0, headerEnd).toString("latin1");
      const statusLine = header.split("\r\n")[0] ?? "";
      if (!/^HTTP\/1\.[01] 2\d\d\b/.test(statusLine)) {
        reject(new Error(`Proxy CONNECT failed: ${statusLine}`));
        return;
      }
      resolve();
    };

    socket.on("data", onData);
    socket.on("error", onError);
    const authHeader = proxy?.username
      ? [`Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`]
      : [];
    socket.write(
      [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
        "Proxy-Connection: keep-alive",
        ...authHeader,
        "",
        "",
      ].join("\r\n"),
    );
  });
}

async function connectViaSocks5(proxy, targetHost, targetPort) {
  const socket = await connectDirectHost(proxy.hostname, Number(proxy.port || 1080));
  try {
    await establishSocks5Connect(socket, proxy, targetHost, targetPort);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function establishSocks5Connect(socket, proxy, targetHost, targetPort) {
  const reader = createSocketReader(socket);
  try {
    const username = decodeURIComponent(proxy.username || "");
    const password = decodeURIComponent(proxy.password || "");
    const authRequired = username.length > 0 || password.length > 0;
    socket.write(authRequired ? Buffer.from([0x05, 0x01, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await reader.read(2);
    if (greeting[0] !== 0x05) throw new Error("Invalid SOCKS5 greeting response");
    if (greeting[1] === 0x02) {
      const user = Buffer.from(username, "utf8");
      const pass = Buffer.from(password, "utf8");
      if (user.length > 255 || pass.length > 255) throw new Error("SOCKS5 username/password is too long");
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await reader.read(2);
      if (auth[1] !== 0x00) throw new Error("SOCKS5 authentication failed");
    } else if (greeting[1] !== 0x00) {
      throw new Error(`SOCKS5 proxy rejected authentication method: 0x${greeting[1].toString(16)}`);
    }

    const request = buildSocks5ConnectRequest(targetHost, targetPort);
    socket.write(request);
    const header = await reader.read(4);
    if (header[0] !== 0x05) throw new Error("Invalid SOCKS5 connect response");
    if (header[1] !== 0x00) throw new Error(`SOCKS5 connect failed: 0x${header[1].toString(16)}`);
    const atyp = header[3];
    if (atyp === 0x01) await reader.read(4 + 2);
    else if (atyp === 0x04) await reader.read(16 + 2);
    else if (atyp === 0x03) {
      const length = (await reader.read(1))[0];
      await reader.read(length + 2);
    } else {
      throw new Error(`Invalid SOCKS5 address type: 0x${atyp.toString(16)}`);
    }
    reader.dispose();
  } catch (error) {
    reader.dispose();
    throw error;
  }
}

function buildSocks5ConnectRequest(targetHost, targetPort) {
  const port = Buffer.alloc(2);
  port.writeUInt16BE(Number(targetPort), 0);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(targetHost)) {
    return Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x01]),
      Buffer.from(targetHost.split(".").map((part) => Number.parseInt(part, 10))),
      port,
    ]);
  }
  const host = Buffer.from(String(targetHost), "utf8");
  if (host.length > 255) throw new Error(`SOCKS5 target host is too long: ${targetHost}`);
  return Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]), host, port]);
}

function createSocketReader(socket) {
  let buffer = Buffer.alloc(0);
  const waiters = [];
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    flush();
  };
  const onError = (error) => {
    while (waiters.length) waiters.shift().reject(error);
  };
  const onEnd = () => {
    const error = new Error("Socket ended during proxy handshake");
    while (waiters.length) waiters.shift().reject(error);
  };
  const flush = () => {
    while (waiters.length && buffer.length >= waiters[0].size) {
      const waiter = waiters.shift();
      const chunk = buffer.subarray(0, waiter.size);
      buffer = buffer.subarray(waiter.size);
      waiter.resolve(chunk);
    }
  };
  socket.on("data", onData);
  socket.once("error", onError);
  socket.once("end", onEnd);
  return {
    read(size) {
      if (buffer.length >= size) {
        const chunk = buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        return Promise.resolve(chunk);
      }
      return new Promise((resolve, reject) => {
        waiters.push({ size, resolve, reject });
      });
    },
    dispose() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    },
  };
}

export function startLocalHttpProxy({
  host = "127.0.0.1",
  port = 0,
  upstreamProxyUrl = null,
  upstreamProxyChain = [],
} = {}) {
  const upstreamChain = normalizeProxyChain(
    Array.isArray(upstreamProxyChain) && upstreamProxyChain.length ? upstreamProxyChain : [upstreamProxyUrl],
  );
  const server = http.createServer((request, response) => {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("CONNECT only\n");
  });

  server.on("connect", async (request, clientSocket, head) => {
    let target = null;
    let upstreamSocket = null;
    try {
      target = parseConnectTarget(request.url);
      upstreamSocket = upstreamChain.length
        ? await connectTargetThroughProxyChain(upstreamChain, target.host, target.port)
        : await connectDirectHost(target.host, target.port);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: checkout-ui-local-proxy\r\n\r\n");
      if (head?.length) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
      const destroyBoth = () => {
        clientSocket.destroy();
        upstreamSocket.destroy();
      };
      clientSocket.once("error", destroyBoth);
      upstreamSocket.once("error", destroyBoth);
    } catch (error) {
      try {
        clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${formatError(error)}\n`);
      } catch {
      }
      clientSocket.destroy();
      upstreamSocket?.destroy();
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        host,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        upstreamProxyUrl: upstreamChain[0] ?? null,
        upstreamProxyChain: upstreamChain,
        key: JSON.stringify({ host, port: actualPort, upstreamProxyChain: upstreamChain }),
      });
    });
  });
}

function parseConnectTarget(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("CONNECT target is empty");
  const parsed = new URL(`http://${raw}`);
  const host = parsed.hostname;
  const port = Number.parseInt(parsed.port || "443", 10);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CONNECT target: ${raw}`);
  }
  return { host, port };
}

function createLocalProxyController() {
  let running = null;
  return {
    async configure(config = {}) {
      const enabled = config?.enabled === true;
      const nextKey = enabled
        ? JSON.stringify({
          host: config.host || "127.0.0.1",
          port: normalizeLocalProxyPort(config.port, 7890),
          upstreamProxyUrl: normalizeOptionalProxyUrl(config.upstreamProxyUrl),
        })
        : "";
      if (running?.key === nextKey) return running;
      if (running) {
        await new Promise((resolve) => running.server.close(resolve));
        running = null;
      }
      if (!enabled) return null;
      running = await startLocalHttpProxy({
        host: config.host || "127.0.0.1",
        port: normalizeLocalProxyPort(config.port, 7890),
        upstreamProxyUrl: normalizeOptionalProxyUrl(config.upstreamProxyUrl),
      });
      const upstream = running.upstreamProxyUrl ? ` -> ${redactProxyUrl(running.upstreamProxyUrl)}` : " -> direct";
      console.log(`[local-proxy] listening ${running.url}${upstream}`);
      return running;
    },
    async close() {
      if (!running) return;
      const closing = running;
      running = null;
      await new Promise((resolve) => closing.server.close(resolve));
    },
  };
}

function connectTls(socket, servername) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername,
      rejectUnauthorized: !isTruthy(process.env.LAB_INSECURE_TLS),
    });
    secureSocket.once("secureConnect", () => resolve(secureSocket));
    secureSocket.once("error", reject);
  });
}

function sendHttp1Request(socket, target, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const bodyBuffer = Buffer.from(body ?? "", "utf8");
    const requestHeaders = {
      ...headers,
      host: target.host,
      connection: "close",
      "content-length": String(bodyBuffer.length),
    };

    const onData = (chunk) => chunks.push(chunk);
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);

    const headerLines = [
      `${method} ${target.pathname}${target.search} HTTP/1.1`,
      ...Object.entries(requestHeaders)
        .filter(([name, value]) => value !== undefined && value !== null && !String(name).startsWith(":"))
        .map(([name, value]) => `${name}: ${String(value).replace(/\r|\n/g, "")}`),
      "",
      "",
    ];
    socket.write(headerLines.join("\r\n"));
    socket.end(bodyBuffer);
  });
}

function parseHttpResponse(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) throw new Error("Invalid HTTP response from proxy tunnel");

  const headerText = raw.subarray(0, headerEnd).toString("latin1");
  const [statusLine, ...headerLines] = headerText.split("\r\n");
  const status = Number.parseInt(statusLine.split(/\s+/)[1], 10);
  if (Number.isNaN(status)) throw new Error(`Invalid HTTP status line: ${statusLine}`);

  const headers = new Map();
  for (const line of headerLines) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers.set(line.slice(0, index).toLowerCase(), line.slice(index + 1).trim());
  }

  let body = raw.subarray(headerEnd + 4);
  if (/chunked/i.test(headers.get("transfer-encoding") ?? "")) {
    body = decodeChunkedBody(body);
  }
  const encoding = (headers.get("content-encoding") ?? "").toLowerCase();
  if (encoding === "gzip") body = zlib.gunzipSync(body);
  if (encoding === "deflate") body = zlib.inflateSync(body);
  if (encoding === "br") body = zlib.brotliDecompressSync(body);

  return {
    status,
    headers,
    bodyText: body.toString("utf8"),
  };
}

function decodeChunkedBody(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const sizeText = buffer.subarray(offset, lineEnd).toString("latin1").split(";")[0];
    const size = Number.parseInt(sizeText, 16);
    if (!size) break;
    const start = lineEnd + 2;
    const end = start + size;
    chunks.push(buffer.subarray(start, end));
    offset = end + 2;
  }
  return Buffer.concat(chunks);
}

async function promptForAccessToken() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await rl.question("Paste lab access token: ");
  } finally {
    rl.close();
  }
}

async function promptForSessionJson() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const lines = [];

  console.log("Paste session JSON. The script will continue when the JSON is complete:");

  try {
    for await (const line of rl) {
      lines.push(line);
      const text = lines.join("\n").trim();
      if (!text) continue;
      try {
        return normalizeSessionFile(JSON.parse(text));
      } catch (error) {
        if (!isProbablyIncompleteJson(error)) {
          throw new Error(`Invalid session JSON: ${error.message}`);
        }
      }
    }
  } finally {
    rl.close();
  }

  throw new Error("No complete session JSON was provided");
}

function isProbablyIncompleteJson(error) {
  return /end of json input|unterminated string|expected property name|expected ',' or '}'|expected ',' or ']'/i.test(
    String(error?.message ?? ""),
  );
}

function isSecretKey(key) {
  return /secret|publishable_key|client_secret|token|key/i.test(key);
}

function redactId(value) {
  if (typeof value !== "string") return value;
  if (value.length <= 12) return "<redacted>";
  return `${value.slice(0, 12)}...<redacted>`;
}

function redactMiddle(value) {
  if (typeof value !== "string" || !value) return value;
  if (value.length <= 12) return "<redacted>";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function redactEmail(value) {
  if (typeof value !== "string" || !value.includes("@")) return value;
  const [name, domain] = value.split("@");
  const visibleName = name.length <= 2 ? `${name[0] ?? ""}*` : `${name.slice(0, 2)}***`;
  const domainParts = domain.split(".");
  const root = domainParts[0] ?? "";
  const tld = domainParts.slice(1).join(".");
  const visibleDomain = root.length <= 2 ? `${root[0] ?? ""}*` : `${root.slice(0, 2)}***`;
  return `${visibleName}@${visibleDomain}${tld ? `.${tld}` : ""}`;
}

function describeValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function redactText(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
    .replace(/cs_(live|test)_[A-Za-z0-9_-]+/g, "cs_$1_<redacted>")
    .replace(/pk_(live|test)_[A-Za-z0-9_-]+/g, "pk_$1_<redacted>")
    .replace(/secret_[A-Za-z0-9_-]+/g, "secret_<redacted>");
}

function redactProxyUrl(value) {
  try {
    const proxy = new URL(String(value));
    const host = proxy.hostname;
    const port = proxy.port ? `:${proxy.port}` : "";
    return `${proxy.protocol}//${host}${port}`;
  } catch {
    return "<invalid-proxy>";
  }
}

function isIpv4MappedIpv6(ip) {
  return typeof ip === "string" && ip.toLowerCase().startsWith("::ffff:");
}

function isIpv4InCidr(ip, cidr) {
  const [network, prefixText] = String(cidr).split("/");
  const prefix = Number.parseInt(prefixText, 10);
  if (net.isIP(ip) !== 4 || net.isIP(network) !== 4 || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

function ipv4ToInt(ip) {
  return ip
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[error] ${redactText(formatError(error))}`);
    process.exitCode = 1;
  });
}

function formatError(error) {
  const parts = [];
  let current = error;
  while (current) {
    const message = current?.message ?? String(current);
    const code = current?.code ? ` (${current.code})` : "";
    parts.push(`${message}${code}`);
    current = current?.cause;
  }
  return parts.join(" <- caused by: ");
}

export const SUPPORTED_PAYMENT_COUNTRY_CODES = Object.freeze(
  "AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CO KM CG CD CR CI HR CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PS PA PG PY PE PH PL PT QA RO RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR ES LK SD SR SE CH TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW AS AW AX BM BQ BV CC CK CW CX EH FK FO GF GG GI GL GP GU IM JE KY MQ MS NC NF NU PF PM PN PR RE SH SJ SX TC TK UM VG VI WF YT HK MO"
    .split(" "),
);

export const SUPPORTED_PAYMENT_CURRENCY_CODES = Object.freeze(
  "AED AUD BRL CAD CHF CLP COP CZK DKK EGP EUR GBP HUF IDR ILS INR JPY KZT KRW MXN MYR NGN NOK NZD PEN PHP PKR PLN QAR RON SAR SEK SGD THB TWD TZS USD VND ZAR"
    .split(" "),
);

export function paymentCountryOptions(locale = "zh-CN") {
  let displayNames = null;
  try {
    displayNames = typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale], { type: "region" })
      : null;
  } catch {
    displayNames = null;
  }
  return SUPPORTED_PAYMENT_COUNTRY_CODES.map((code) => ({
    code,
    label: displayNames?.of(code) || code,
  }));
}

export function paymentCurrencyOptions(locale = "zh-CN") {
  let displayNames = null;
  try {
    displayNames = typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([locale], { type: "currency" })
      : null;
  } catch {
    displayNames = null;
  }
  return SUPPORTED_PAYMENT_CURRENCY_CODES.map((code) => ({
    code,
    label: displayNames?.of(code) || code,
  }));
}

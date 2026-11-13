// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { formatBookingNumber } from "../lib/cashbook/booking-number";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cashbookConfigSchema, renderPurpose, validDate, validIban, validPurpose, validatePayment } from "../lib/cashbook/validation";
import { defaultCashbookConfig, type CashbookPayment } from "../lib/cashbook-types";
import { buildCardNumber } from "../lib/numbering-format";
const payment: CashbookPayment = { business: true, cardId: null, receiptIds: [], number: "G001", amount: 12345, budgetTitle: "1200", holder: "Alex Example", iban: "DE89370400440532013000", bank: "Example", purpose: "", place: "Köthen", date: "2026-11-13" };
test("cashbook payment validation distinguishes missing, zero, invalid IBAN and invalid dates", () => { assert.equal(validIban(payment.iban), true); assert.equal(validIban("DE00370400440532013000"), false); assert.equal(validDate("2026-02-29"), false); assert.equal(validDate("2024-02-29"), true); assert.equal(validatePayment({ ...payment, amount: 0 }).amount, 0); assert.equal(validatePayment({ ...payment, holder: " Alex\nExample\0 " }).holder, "Alex Example"); for (const patch of [{ amount: -1 }, { amount: 2000000001 }, { holder: "" }, { bank: "" }, { budgetTitle: "" }, { place: "" }, { iban: "invalid" }, { date: "2026-02-30" }])
    assert.throws(() => validatePayment({ ...payment, ...patch })); });
test("purpose templates skip empty optional purpose without stray whitespace and preserve explicit HT text", () => { const template = "{{purpose}} {{number}} HT{{budgetTitle}}"; assert.equal(validPurpose(template), true); assert.equal(renderPurpose(template, payment, []), "G001 HT1200"); assert.equal(renderPurpose(template, { ...payment, purpose: "Materials" }, []), "Materials G001 HT1200"); assert.equal(renderPurpose("{{receipts}} {{amount}}", payment, ["G001_Q1.pdf", "G001_Q2.pdf"]), "G001_Q1, G001_Q2 123,45 €"); for (const invalid of ["{{unknown}}", "{{amount", "{{constructor}}", "{{__proto__}}", "x".repeat(4001)])
    assert.equal(validPurpose(invalid), false); assert.equal(buildCardNumber({ prefix: "G", year: "2026", code: "AB", separator: "_", padding: 3 }, 42), "G042_2026_AB"); });
test("cashbook configuration rejects unsupported fields and excessive numbering widths", () => { assert.ok(cashbookConfigSchema.safeParse(defaultCashbookConfig).success); assert.equal(cashbookConfigSchema.safeParse({ ...defaultCashbookConfig, numbering: { ...defaultCashbookConfig.numbering, padding: 10000 } }).success, false); assert.equal(cashbookConfigSchema.safeParse({ ...defaultCashbookConfig, mapping: { unknown: "field" } }).success, false); });

test("booking numbers support umlauts, minimum widths and safe previews",()=>{
 assert.equal(formatBookingNumber({prefix:"KÖT",digits:4},1),"KÖT-0001");
 assert.equal(formatBookingNumber({prefix:" KÖT ",digits:4},42),"KÖT-0042");
 assert.equal(formatBookingNumber({prefix:"KÖT",digits:4},10000),"KÖT-10000");
 assert.equal(formatBookingNumber({prefix:"KÖT",digits:10000000},1),"KÖT-000000000001");
 for(const config of [{prefix:"",digits:4},{prefix:"KÖT",digits:0},{prefix:"KÖT",digits:13}])assert.equal(cashbookConfigSchema.safeParse({...defaultCashbookConfig,bookingNumbering:config}).success,false);
});

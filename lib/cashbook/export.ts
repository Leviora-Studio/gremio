// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import type { Column, Table } from "@/lib/export";
import type { cashbookEntries } from "@/lib/db/schema";
export const cashbookExportColumns:Column[]=[
 {key:"bookingNumber",header:"Buchungsnummer",width:1.7},
 {key:"number",header:"Antrags-/G-Nummer",width:1.9},
 {key:"holder",header:"Kontoinhaber",width:2.6},
 {key:"amount",header:"Betrag (€)",width:1.5,money:true},
 {key:"budgetTitle",header:"Haushaltstitel",width:1.7},
 {key:"iban",header:"IBAN",width:2.8},
 {key:"bank",header:"Bank",width:2.5},
 {key:"purpose",header:"Verwendungszweck",width:4},
 {key:"authorizedAt",header:"Anweisung erteilt",width:2.3,date:"datetime"},
 {key:"bookingDate",header:"Buchungstag",width:1.8,date:"date"},
 {key:"correction",header:"Korrektur",width:2.8},
];
export function buildCashbookTable(entries:typeof cashbookEntries.$inferSelect[]):Table{
 const numbers=new Map(entries.map(entry=>[entry.id,entry.bookingNumber]));
 return {title:"Kassenbuch",columns:cashbookExportColumns,rows:entries.filter(entry=>entry.state==="posted").map(entry=>({cells:[entry.bookingNumber,entry.data.number,entry.data.holder,entry.data.amount/100,entry.data.budgetTitle,entry.data.iban,entry.data.bank,entry.data.purpose,entry.authorizedAt?.toISOString()??null,entry.bookingDate,entry.correctsId?`Korrektur zu ${numbers.get(entry.correctsId)??"unbekannter Buchung"}`:"Original"]}))};
}

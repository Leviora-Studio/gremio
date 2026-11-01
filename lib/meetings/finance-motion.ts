// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
/** Shared placeholder catalog. No arbitrary expressions or object-property access. */
export const financeMotionFields = [
 {key:"title",label:"Kartentitel",field:"",example:"Kulturveranstaltung"},
 {key:"number",label:"Antragsnummer",field:"number",example:"AN-2026-0042"},
 {key:"requested_amount",label:"Beantragter Betrag",field:"requested_amount",example:"1.234,56 €"},
 {key:"applicant",label:"Antragsteller",field:"applicant",example:"Alex Beispiel"},
 {key:"account",label:"Konto",field:"account",example:"Veranstaltungen"},
 {key:"budget_title",label:"Haushaltstitel",field:"budget_title",example:"1001"},
 {key:"approved_amount",label:"Genehmigter Betrag",field:"approved_amount",example:"1.000,00 €"},
 {key:"actual_amount",label:"Tatsächliche Ausgaben",field:"actual_amount",example:"950,00 €"},
 {key:"decision_ref",label:"Beschlussreferenz",field:"decision_ref",example:"Beschluss 12/2026"},
 {key:"deadline",label:"Frist",field:"deadline",example:"11.11.2026"},
 {key:"meeting",label:"Geplant für Sitzung",field:"meeting",example:"11.11.2026"},
 {key:"instruction_date",label:"Anweisungsdatum",field:"instruction_date",example:"12.11.2026"},
 {key:"transfer_date",label:"Überweisungsdatum",field:"transfer_date",example:"13.11.2026"},
 {key:"notes",label:"Interne Notizen",field:"notes",example:"Beispielnotiz"},
 {key:"applicant_note",label:"Hinweis für Antragsteller",field:"applicant_note",example:"Belege nachreichen"},
] as const;
export function renderFinanceMotion(template:string,values:Record<string,string>){
 return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(_match,key:string)=>Object.hasOwn(values,key)?values[key]:"Nicht freigegeben").slice(0,10000);
}
export function validFinanceMotion(template:string,visible:Set<string>){
 return template.length<=10000&&!/[{}]{2}/.test(template.replace(/\{\{[^]*?\}\}/g,""))&&[...template.matchAll(/\{\{([^]*?)\}\}/g)].every(match=>financeMotionFields.some(f=>f.key===match[1].trim()&&(!f.field||visible.has(f.field))));
}

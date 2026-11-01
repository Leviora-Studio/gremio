// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {z} from "zod";
import {sanitizeSingleLine,sanitizeMultiLine} from "@/lib/text";
const line=(max:number)=>z.preprocess(sanitizeSingleLine,z.string().max(max));
const text=z.preprocess(sanitizeMultiLine,z.string().max(10000));
const fields={title:line(200).pipe(z.string().min(1)),description:text.default(""),motion:text.default(""),presenter:line(200).default(""),kind:z.enum(["information","discussion","decision"]).default("discussion"),durationMinutes:z.coerce.number().int().min(1).max(480).default(5),confidential:z.boolean().default(false)};
export const defaultTopicsInput=z.array(z.object({...fields,section:z.enum(["opening","public","non_public"]).default("opening"),children:z.array(z.object(fields)).max(100).default([])})).max(100).refine(roots=>roots.reduce((sum,root)=>sum+1+root.children.length,0)<=200,"Höchstens 200 Standard-TOPs einschließlich Unter-TOPs.");
export type DefaultTopicChild=z.infer<typeof defaultTopicsInput>[number]["children"][number];
export type DefaultTopic=z.infer<typeof defaultTopicsInput>[number];
export const newDefaultTopic=(title="Neuer TOP"):DefaultTopic=>({title,description:"",motion:"",presenter:"",kind:"discussion",durationMinutes:5,confidential:false,section:"opening",children:[]});
/** Faithful editable boilerplate from the supplied StuRa template; placeholders are intentional. */
export const regularitiesDefaults:DefaultTopic[]=[{
 ...newDefaultTopic("Begrüßung und Regularien"),
 children:[
  {...newDefaultTopic("Feststellung der Beschlussfähigkeit"),description:"Beschlussfähigkeit ist [gegeben / nicht gegeben], es sind [x] von 5 Stimmen anwesend."},
  {...newDefaultTopic("Abstimmung der Tagesordnung"),kind:"decision" as const,description:"Die Tagesordnung wird [einstimmig / mehrheitlich] [mit Änderungen] angenommen.\n[Änderungen der Tagesordnung eintragen, falls vorhanden, sonst löschen]"},
  {...newDefaultTopic("Fristgemäße Einladung"),description:"Es wurde [fristgemäß / nicht fristgemäß] am [Datum] per [E-Mail] zur Sitzung eingeladen.\n[Bei nicht fristgemäßer Einladung Grund und Abstimmungsergebnis eintragen, sonst löschen]"},
  {...newDefaultTopic("Bestätigung des Protokolls"),kind:"decision" as const,description:"Das Protokoll vom [Datum] wird [einstimmig bestätigt / mehrheitlich bestätigt / nicht bestätigt / auf die nächste Sitzung verschoben].\n[Grund eintragen, falls nicht bestätigt oder verschoben, sonst löschen]"},
  {...newDefaultTopic("Beschlusskontrolle"),description:"Beschlüsse werden kontrolliert.\n[Ergebnis je Beschluss eintragen, ohne Namen]"},
 ].map(({section:_section,children:_children,...child})=>child),
}];

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {test} from "node:test";
import assert from "node:assert/strict";
import {PDFDocument} from "pdf-lib";
import {renderAgendaListPdf} from "../lib/meetings/agenda-pdf";
import {agendaTopics} from "../lib/meetings/agenda";
import {extractPdfText} from "../lib/pdf-text";

test("agenda PDF lists ordered numbered titles and children without topic details",async()=>{
  const base={state:"scheduled",description:"PRIVATE DESCRIPTION",presenter:"PRIVATE PRESENTER",motion:"PRIVATE MOTION",durationMinutes:99};
  const topics=agendaTopics([
    {...base,id:3,parentId:null,position:2,title:"Closed discussion",section:"non_public" as const},
    {...base,id:2,parentId:1,position:1,title:"Child heading"},
    {...base,id:1,parentId:null,position:0,title:"Opening heading"},
  ]);
  const {text}=await extractPdfText(await renderAgendaListPdf(topics));
  assert.match(text,/Tagesordnungspunkte/);
  assert.ok(text.indexOf("TOP 1: Opening heading")<text.indexOf("TOP 1.1: Child heading"));
  assert.ok(text.indexOf("TOP 1.1: Child heading")<text.indexOf("TOP I: Closed discussion"));
  assert.doesNotMatch(text,/PRIVATE|99|Eingeplant|Verantwortlich|Beratung/);
});

test("agenda PDF wraps long titles across multiple pages and supports an empty agenda",async()=>{
  const topics=Array.from({length:100},(_,i)=>({number:String(i+1),parentId:null,title:`Heading ${i+1} ${"long title ".repeat(15)}`}));
  const output=await renderAgendaListPdf(topics);
  assert.ok((await PDFDocument.load(output)).getPageCount()>1);
  const {text}=await extractPdfText(output);assert.match(text,/TOP 100: Heading 100/);
  const empty=await extractPdfText(await renderAgendaListPdf([]));assert.equal(empty.text.replace(/^--- Seite 1 ---\s*/,"").trim(),"Tagesordnungspunkte");
});

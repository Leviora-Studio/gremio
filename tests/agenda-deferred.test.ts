// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {test} from "node:test";
import assert from "node:assert/strict";
import {agendaTopics,romanNumber} from "../lib/meetings/agenda";
test("deferring main and child TOPs preserves their agenda position and numbering",()=>{
 const rows=[{id:1,parentId:null,position:0,state:'scheduled'},{id:2,parentId:1,position:1,state:'scheduled'},{id:3,parentId:null,position:2,state:'treated'},{id:4,parentId:null,position:3,state:'withdrawn'}];
 const before=agendaTopics(rows).map(t=>[t.id,t.number]);
 assert.deepEqual(agendaTopics(rows.map(t=>t.id===1||t.id===2?{...t,state:'deferred'}:t)).map(t=>[t.id,t.number]),before);
});
test("withdrawn parents and deferred children remain together on the agenda",()=>{
 const rows=[{id:1,parentId:null,position:0,state:'withdrawn'},{id:2,parentId:1,position:1,state:'deferred'},{id:3,parentId:null,position:2,state:'scheduled'}];
 assert.deepEqual(agendaTopics(rows).map(t=>[t.id,t.number,t.parentId]),[[1,'1',null],[2,'1.1',1],[3,'2',null]]);
});

test("agenda separates sections, inherits child sections and numbers each independently",()=>{
 const rows=[{id:1,parentId:null,position:0,state:"scheduled",section:"non_public" as const},{id:2,parentId:1,position:1,state:"deferred",section:"public" as const},{id:3,parentId:null,position:2,state:"treated",section:"public" as const},{id:4,parentId:null,position:3,state:"withdrawn",section:"non_public" as const}];
 assert.deepEqual(agendaTopics(rows).map(t=>[t.id,t.number,t.section]),[[3,"1","public"],[1,"I","non_public"],[2,"I.1","non_public"],[4,"II","non_public"]]);
 assert.deepEqual(agendaTopics(rows,{firstSection:"non_public",publicNumbering:"roman",nonPublicNumbering:"arabic"}).map(t=>[t.id,t.number]),[[1,"1"],[2,"1.1"],[4,"2"],[3,"I"]]);
 assert.deepEqual(agendaTopics(rows.map(t=>({...t,state:"deferred"}))).map(t=>[t.id,t.number]),[[3,"1"],[1,"I"],[2,"I.1"],[4,"II"]]);
});
test("orphaned deferred TOPs retain their inherited section and roman numerals support larger agendas",()=>{
 const rows=[{id:1,parentId:null,position:0,state:"proposed",section:"non_public" as const},{id:2,parentId:1,position:1,state:"deferred",section:"non_public" as const}];
 assert.deepEqual(agendaTopics(rows).map(t=>[t.id,t.parentId,t.number,t.section]),[[2,null,"I","non_public"]]);
 assert.deepEqual([4,9,14,49,99,444,999,1000].map(romanNumber),["IV","IX","XIV","XLIX","XCIX","CDXLIV","CMXCIX","M"]);
});

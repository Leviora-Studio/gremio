// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {test} from "node:test";
import assert from "node:assert/strict";
import {agendaTopics} from "../lib/meetings/agenda";
test("deferring main and child TOPs preserves their agenda position and numbering",()=>{
 const rows=[{id:1,parentId:null,position:0,state:'scheduled'},{id:2,parentId:1,position:1,state:'scheduled'},{id:3,parentId:null,position:2,state:'treated'},{id:4,parentId:null,position:3,state:'withdrawn'}];
 const before=agendaTopics(rows).map(t=>[t.id,t.number]);
 assert.deepEqual(agendaTopics(rows.map(t=>t.id===1||t.id===2?{...t,state:'deferred'}:t)).map(t=>[t.id,t.number]),before);
});
test("withdrawn parents and deferred children remain together on the agenda",()=>{
 const rows=[{id:1,parentId:null,position:0,state:'withdrawn'},{id:2,parentId:1,position:1,state:'deferred'},{id:3,parentId:null,position:2,state:'scheduled'}];
 assert.deepEqual(agendaTopics(rows).map(t=>[t.id,t.number,t.parentId]),[[1,'1',null],[2,'1.1',1],[3,'2',null]]);
});

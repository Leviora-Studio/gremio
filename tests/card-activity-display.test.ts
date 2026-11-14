// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {test} from "node:test";
import assert from "node:assert/strict";
import {cardActivityDisplay} from "../lib/card-activity-display";
import {visibleActivityDetail} from "../lib/card-field-projection";

test("historical planning snapshots separate reason and complete before/after positions",()=>{
 const reason="Original allocation was incorrect.\nVorher:\nThis is part of the reason.\nNachher:\nStill the reason.";
 const detail=`Korrektureintrag\nBegründung: ${reason}\nVorher:\n1. 100,00 € · Konto Main · HT 1200\n2. 50,00 € · Konto Other · HT 1300\nNachher:\n1. 90,00 € · Konto Main · HT 1200`;
 const result=cardActivityDisplay("budget_plan_correction",detail);
 assert.equal(result.title,"Einplanung korrigiert");assert.equal(result.planning?.reason,reason);
 assert.equal(result.planning?.before.length,2);assert.equal(result.planning?.after.length,1);
 assert.equal(result.planning?.before[1],"2. 50,00 € · Konto Other · HT 1300");
 assert.equal(result.planning?.after[0],"1. 90,00 € · Konto Main · HT 1200");
 assert.equal(detail.includes(reason),true,"the stored text is not rewritten");
});

test("empty plans, older free text and hidden fields remain meaningful and private",()=>{
 const empty=cardActivityDisplay("budget_plan","Haushaltstitel-Einplanung aktualisiert\nVorher:\nKeine Einplanung\nNachher:\n1. 10,00 € · Konto Main · HT 1200");
 assert.deepEqual(empty.planning?.before,[]);assert.equal(empty.planning?.after.length,1);assert.equal(empty.planning?.reason,null);
 assert.deepEqual(cardActivityDisplay("budget_plan","Older unstructured entry"),{title:"Haushaltstitel eingeplant",detail:"Older unstructured entry",planning:null});
 for(const type of ["deadline","assignee","budget_plan_correction"]){
  const detail=visibleActivityDetail({type,detail:"Secret value"},new Set(),false);
  const display=cardActivityDisplay(type,detail);
  assert.equal(JSON.stringify(display).includes("Secret value"),false);
  if(type!=="budget_plan_correction")assert.equal(display.title,"Karte aktualisiert");
 }
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { TRASH_RETENTION_MS } from "@/lib/trash-retention";
import { pool } from "@/lib/db";
import type { PoolClient } from "pg";
import type { User } from "@/lib/db/schema";
import { deleteConfirmationError } from "@/lib/confirmation";
import { absPath } from "@/lib/attachments";
import { unlink } from "node:fs/promises";
import { authorizeAttachmentTrash, attachmentTrashContext } from "@/lib/attachment-trash";
import { authorizeCardTrash } from "@/lib/card-trash";
import { TrashError } from "@/lib/trash-error";
export { TrashError } from "@/lib/trash-error";
import { requireMeeting, requireTopic } from "@/lib/meetings/access";

export const trashKinds = {
 attachment:{table:"attachments",label:"Datei"},card:{table:"cards",label:"Karte"},
 board:{table:"boards",label:"Board"},finance:{table:"finance_boards",label:"Finanzübersicht"},inventory:{table:"inventory_boards",label:"Inventar"},cashbook:{table:"cashbooks",label:"Kassenbuch"},
 group:{table:"groups",label:"Gruppe"},account:{table:"accounts",label:"Konto"},priority:{table:"priorities",label:"Priorität"},location:{table:"locations",label:"Standort"},feedback:{table:"feedback_areas",label:"Feedback-Bereich"},
 board_template:{table:"board_templates",label:"Boardvorlage"},finance_template:{table:"finance_templates",label:"Finanzvorlage"},meeting_template:{table:"meeting_area_templates",label:"Sitzungsbereichsvorlage"},meeting_area:{table:"meeting_areas",label:"Sitzungsbereich"},meeting:{table:"meetings",label:"Sitzung"},topic:{table:"meeting_topics",label:"Thema / TOP"},
} as const;
export type TrashKind = keyof typeof trashKinds;
type ResourceRow = {id:number;board_id?:number;locked_at?:Date|null;owner_id?:number;name?:string;title?:string;label?:string;is_application_board?:boolean;inventory_board_id?:number|null;revision?:number;is_finance_topic?:boolean;is_finance_item?:boolean;confidential?:boolean;area_id?:number;parent_id?:number|null;meeting_id?:number|null;loan_board_id?:number|null;loan_active_status_id?:number|null;loan_returned_status_id?:number|null};
type TrashContext = {boards?:number[];tracking?:{inventoryId:number;activeStatusId:number|null;returnedStatusId:number|null;links:{id:number;card_id:number}[]};children?:{id:number;parent_id:number;confidential:boolean;snapshot:Record<string,unknown>}[];purgeScope?:Record<string,number[]>};
type TrashRow = {id:number;kind:TrashKind;entity_id:number;deleted_at:Date;expires_at:Date;state:string;context:TrashContext;cleanup_paths:string[]};

function kindInfo(kind:TrashKind){if(!Object.hasOwn(trashKinds,kind))throw new TrashError("Ungültiger Papierkorb-Eintrag.");return trashKinds[kind];}
async function liveUser(client:PoolClient,user:User,admin=false){const row=(await client.query("select * from users where id=$1 and is_active=true for share",[user.id])).rows[0];if(!row||admin&&row.role!=="admin")throw new TrashError("Nur Administrationskonten dürfen diese Aktion ausführen.");return {...user,role:row.role,isActive:row.is_active} as User;}
async function owns(client:PoolClient,user:User,kind:"board"|"finance"|"inventory",row:Pick<ResourceRow,"id"|"owner_id">){if(user.role==="admin"||row.owner_id===user.id)return true;const table=kind==="board"?"board_owners":kind==="finance"?"finance_board_owners":"inventory_board_owners";return !!(await client.query(`select 1 from ${table} where board_id=$1 and user_id=$2`,[row.id,user.id])).rowCount;}
async function lockMeetingParent(client:PoolClient,kind:TrashKind,id:number){
 if(kind!=="topic"&&kind!=="meeting")return null;
 const identity=(await client.query(kind==="topic"?"select meeting_id from meeting_topics where id=$1":"select id as meeting_id from meetings where id=$1",[id])).rows[0];
 if(identity?.meeting_id==null)return null;
 const meeting=(await client.query("select area_id from meetings where id=$1",[identity.meeting_id])).rows[0];
 if(meeting){await client.query("select id from meeting_areas where id=$1 for share",[meeting.area_id]);await client.query("select id from meetings where id=$1 for update",[identity.meeting_id]);}
 return identity.meeting_id as number;
}
async function authorize(client:PoolClient,user:User,kind:TrashKind,row:ResourceRow){
 if(kind==="card"){
  await authorizeCardTrash(client,user,{boardId:row.board_id});
  if(row.locked_at)throw new TrashError("Diese Karte ist dauerhaft gesperrt und kann nicht gelöscht werden.");
 }else if(kind==="board"){
  if(row.is_application_board&&user.role!=="admin")throw new TrashError("Antragsboards dürfen nur durch Administrationskonten gelöscht werden.");
  if(row.inventory_board_id!=null){const inv=(await client.query<ResourceRow>("select * from inventory_boards where id=$1 and deleted_at is null",[row.inventory_board_id])).rows[0];if(!inv||!await owns(client,user,"inventory",inv))throw new TrashError("Kein Verwaltungszugriff auf das Inventar.");}
  else if(!await owns(client,user,"board",row))throw new TrashError("Kein Verwaltungszugriff auf dieses Board.");
 }else if(kind==="finance"){if(user.role!=="admin")throw new TrashError("Finanzübersichten dürfen nur durch Administrationskonten im Admin-Panel gelöscht werden.");}
 else if(kind==="inventory"){if(!await owns(client,user,kind,row))throw new TrashError("Kein Verwaltungszugriff.");}
 else if(kind==="cashbook"){if(user.role!=="admin")throw new TrashError("Kassenbücher dürfen nur durch Administrationskonten gelöscht werden.");}
 else if(kind==="meeting_area"){if(user.role!=="admin"&&row.owner_id!==user.id)throw new TrashError("Nur Eigentümer und Admins dürfen diesen Sitzungsbereich löschen.");}
 else if(kind==="meeting")await requireMeeting(user,row.id,"manage");
 else if(kind==="topic")await requireTopic(user,row.id,true);
 else if(kind.endsWith("_template")){if(!["admin","template_manager"].includes(user.role))throw new TrashError("Keine Vorlagenverwaltung.");}
 else if(user.role!=="admin")throw new TrashError("Nur Administrationskonten dürfen diese Aktion ausführen.");
}
async function routingBlocker(client:PoolClient,boardIds:number[]){if(!boardIds.length)return;for(const table of ["locations","feedback_areas"]){const row=(await client.query(`select name from ${table} where target_board_id=any($1) and deleted_at is null limit 1`,[boardIds])).rows[0];if(row)throw new TrashError(`Ein Standort oder Feedback-Bereich („${row.name}“) verwendet dieses Board. Bitte zuerst das Routing umstellen.`);}}
export async function moveToTrash(user:User,kind:TrashKind,id:number,confirmation:unknown,options:{revision?:number;trackingInventoryId?:number;cashbookName?:unknown;financeName?:unknown;boardName?:unknown;inventoryName?:unknown;areaName?:unknown;entityName?:unknown}={}){
 if(kind==="attachment")throw new TrashError("Dateien bitte über die Karte in den Board-Papierkorb verschieben.");
 const error=deleteConfirmationError(confirmation);if(error)throw new TrashError(error.error);
 const {table}=kindInfo(kind);if(!Number.isSafeInteger(id)||id<1)throw new TrashError("Ungültiger Eintrag.");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");user=await liveUser(client,user);
  const tracking=options.trackingInventoryId==null?null:(await client.query<ResourceRow>("select * from inventory_boards where id=$1 and deleted_at is null for update",[options.trackingInventoryId])).rows[0];
  const cardBoard=kind==="card"?(await client.query("select board_id from cards where id=$1",[id])).rows[0]?.board_id:null;
  if(cardBoard!=null)await client.query("select id from boards where id=$1 for share",[cardBoard]);
  const lockedMeetingId=await lockMeetingParent(client,kind,id);
  const row=(await client.query<ResourceRow>(`select * from ${table} where id=$1 and deleted_at is null for update`,[id])).rows[0];if(!row)throw new TrashError("Der Eintrag ist nicht verfügbar oder liegt bereits im Papierkorb.");
  if(kind==="topic"&&(row.meeting_id??null)!==lockedMeetingId)throw new TrashError("Das Thema wurde zwischenzeitlich verschoben. Bitte neu laden.");
  await authorize(client,user,kind,row);
  if(kind==="cashbook"&&(typeof options.cashbookName!=="string"||options.cashbookName!==row.name))throw new TrashError("Bitte den aktuellen vollständigen Namen des Kassenbuchs exakt eingeben. Wurde es umbenannt, bitte neu laden.");
  if(kind==="finance"&&(typeof options.financeName!=="string"||options.financeName!==row.name))throw new TrashError("Bitte den aktuellen vollständigen Namen der Finanzübersicht exakt eingeben. Wurde sie umbenannt, bitte neu laden.");
  if(kind==="board"&&row.inventory_board_id==null&&(typeof options.boardName!=="string"||options.boardName!==row.name))throw new TrashError("Bitte den aktuellen vollständigen Namen des Boards exakt eingeben. Wurde es umbenannt, bitte neu laden.");
  if(kind==="inventory"&&(typeof options.inventoryName!=="string"||options.inventoryName!==row.name))throw new TrashError("Bitte den aktuellen vollständigen Namen des Inventars exakt eingeben. Wurde es umbenannt, bitte neu laden.");
  if(kind==="meeting_area"&&(typeof options.areaName!=="string"||options.areaName!==row.name))throw new TrashError("Bitte den aktuellen vollständigen Namen des Sitzungsbereichs exakt eingeben. Wurde er umbenannt, bitte neu laden.");
  if((kind==="group"||kind.endsWith("_template"))&&(typeof options.entityName!=="string"||options.entityName!==row.name))throw new TrashError("Bitte den aktuellen vollständigen Namen exakt eingeben. Wurde der Eintrag umbenannt, bitte neu laden.");
  if(options.revision!==undefined&&row.revision!==options.revision)throw new TrashError("Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.");
  const context:TrashContext & {boardId?:number}={};
  if(kind==="card"){if(cardBoard!==row.board_id)throw new TrashError("Die Karte wurde zwischenzeitlich verschoben. Bitte neu laden.");context.boardId=row.board_id;await client.query("insert into card_activity(card_id,user_id,type,detail) values($1,$2,'card_trashed','Karte in den Board-Papierkorb verschoben.')",[id,user.id]);}
  if(kind==="board"){
   await routingBlocker(client,[id]);
   if(row.inventory_board_id!=null){
    if(!tracking||tracking.id!==row.inventory_board_id||tracking.loan_board_id!==id)throw new TrashError("Bitte das Leihvorgang-Board über die Inventar-Einstellungen entfernen.");
    const links=(await client.query("select id,card_id from inventory_loans where card_id in(select id from cards where board_id=$1) order by id for update",[id])).rows;
    context.tracking={inventoryId:tracking.id,activeStatusId:tracking.loan_active_status_id??null,returnedStatusId:tracking.loan_returned_status_id??null,links};
    await client.query("update inventory_loans set card_id=null where id=any($1)",[links.map(link=>link.id)]);
    await client.query("update inventory_boards set loan_board_id=null,loan_active_status_id=null,loan_returned_status_id=null where id=$1",[tracking.id]);
   }
  }
  if(kind==="inventory"){
   const children=(await client.query("select id from boards where inventory_board_id=$1 and deleted_at is null order by id for update",[id])).rows.map(row=>row.id);
   await routingBlocker(client,children);context.boards=children;
  }
  if(kind==="account"){
   const used=(await client.query("select 1 from card_budget_positions where account_id=$1 union all select 1 from card_budget_plans where allocations @> jsonb_build_array(jsonb_build_object('accountId',$1::integer)) union all select 1 from card_budget_plan_corrections where before_allocations @> jsonb_build_array(jsonb_build_object('accountId',$1::integer)) or after_allocations @> jsonb_build_array(jsonb_build_object('accountId',$1::integer)) union all select 1 from finance_board_sources where account_id=$1 limit 1",[id])).rowCount;
   if(used)throw new TrashError("Dieses Konto wird in Haushaltspositionen, Einplanungen oder Finanzquellen verwendet. Bitte dort zuerst ein anderes Konto zuordnen.");
  }
  if(kind==="topic"){
   const children=(await client.query("select id,parent_id,confidential from meeting_topics where parent_id=$1 and deleted_at is null order by id for update",[id])).rows;
   if(row.is_finance_topic&&children.length)throw new TrashError("Bitte zuerst die Unter-TOPs entfernen.");
   const detached=(await client.query("update meeting_topics set parent_id=null,confidential=confidential or $2 where id=any($1) returning id,to_jsonb(meeting_topics) as snapshot",[children.map(child=>child.id),!!row.confidential])).rows;
   context.children=children.map(child=>({...child,snapshot:detached.find(after=>after.id===child.id)!.snapshot}));
   if(row.meeting_id!=null)await client.query("update meetings set revision=revision+1 where id=$1",[row.meeting_id]);
  }
  const deletedAt=new Date(),expiresAt=new Date(deletedAt.getTime()+TRASH_RETENTION_MS);
  const label=String(row.name??row.title??row.label??`#${id}`);
  const entry=(await client.query("insert into trash_entries(kind,entity_id,label,deleted_by,deleted_at,expires_at,context) values ($1,$2,$3,$4,$5,$6,$7) returning id",[kind,id,label,user.id,deletedAt,expiresAt,JSON.stringify(context)])).rows[0];
  await client.query("select set_config('gremio.trash_move',$1,true)",[String(entry.id)]);
  await client.query(`update ${table} set deleted_at=$1 where id=$2`,[deletedAt,id]);
  if(kind==="inventory"&&context.boards?.length)await client.query("update boards set deleted_at=$1 where id=any($2)",[deletedAt,context.boards]);
  await client.query("COMMIT");return entry.id as number;
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function restoreTrashEntry(user:User,id:number,confirmation:unknown){
 if(!Number.isSafeInteger(id)||id<1)throw new TrashError("Ungültiger Eintrag.");
 if(typeof confirmation!=="string"||confirmation.trim()!=="WIEDERHERSTELLEN")throw new TrashError("Bitte WIEDERHERSTELLEN genau so eingeben.");
 const client=await pool.connect();try{
  await client.query("BEGIN");await liveUser(client,user,true);
  const entry=(await client.query<TrashRow>("select * from trash_entries where id=$1 for update",[id])).rows[0];
  if(!entry||entry.state!=="trashed")throw new TrashError("Dieser Eintrag kann nicht wiederhergestellt werden.");
  if(new Date(entry.expires_at).getTime()<=Date.now())throw new TrashError("Die Wiederherstellungsfrist von 30 Tagen ist abgelaufen.");
  if(entry.kind==="attachment"||entry.kind==="card")throw new TrashError("Dateien und Karten bitte im Papierkorb des zugehörigen Boards wiederherstellen.");
  const lockedMeetingId=await lockMeetingParent(client,entry.kind,entry.entity_id);
  const info=kindInfo(entry.kind),row=(await client.query<ResourceRow>(`select * from ${info.table} where id=$1 for update`,[entry.entity_id])).rows[0];if(!row)throw new TrashError("Die ursprünglichen Daten sind nicht mehr vorhanden.");
  if(entry.kind==="topic"&&(row.meeting_id??null)!==lockedMeetingId)throw new TrashError("Das Thema wurde zwischenzeitlich verschoben. Bitte neu laden.");
  const context=entry.context;
  if(entry.kind==="topic"&&row.parent_id!=null){const parent=(await client.query("select deleted_at,is_finance_topic from meeting_topics where id=$1",[row.parent_id])).rows[0];if(!parent||parent.deleted_at||row.is_finance_item&&!parent.is_finance_topic)throw new TrashError("Bitte zuerst den zugehörigen übergeordneten TOP wiederherstellen bzw. wieder als Finanzanträge-TOP einrichten.");}
  if(entry.kind==="board"&&row.inventory_board_id!=null){if(!(await client.query("select 1 from inventory_boards where id=$1 and deleted_at is null",[row.inventory_board_id])).rowCount)throw new TrashError("Bitte zuerst das zugehörige Inventar wiederherstellen.");}
  if(entry.kind==="meeting"||entry.kind==="topic"&&row.meeting_id!=null){const areaId=entry.kind==="meeting"?row.area_id:(await client.query("select area_id from meetings where id=$1",[row.meeting_id])).rows[0]?.area_id;if(areaId==null||!(await client.query("select 1 from meeting_areas where id=$1 and deleted_at is null",[areaId])).rowCount)throw new TrashError("Bitte zuerst den zugehörigen Sitzungsbereich wiederherstellen.");}
  if(entry.kind==="topic"&&row.meeting_id!=null){if(!(await client.query("select 1 from meetings where id=$1 and deleted_at is null",[row.meeting_id])).rowCount)throw new TrashError("Bitte zuerst die zugehörige Sitzung wiederherstellen.");}
  if(context.tracking){
   const tracking=context.tracking,inv=(await client.query<ResourceRow>("select * from inventory_boards where id=$1 and deleted_at is null for update",[tracking.inventoryId])).rows[0];
   if(!inv||inv.loan_board_id!=null)throw new TrashError("Das Inventar ist nicht verfügbar oder hat bereits ein anderes Aufgabentrackingboard. Bitte dieses zuerst entfernen.");
   for(const link of tracking.links){const loan=(await client.query("select card_id from inventory_loans where id=$1 for update",[link.id])).rows[0];if(loan&&loan.card_id!=null)throw new TrashError("Ein Leihvorgang wurde inzwischen einem anderen Board zugeordnet.");}
  }
  await client.query("select set_config('gremio.trash_restore',$1,true)",[String(entry.id)]);
  await client.query(`update ${info.table} set deleted_at=null where id=$1`,[entry.entity_id]);
  if(context.boards?.length)await client.query("update boards set deleted_at=null where id=any($1) and deleted_at=$2",[context.boards,entry.deleted_at]);
  if(context.tracking){const t=context.tracking;await client.query("update inventory_boards set loan_board_id=$1,loan_active_status_id=$2,loan_returned_status_id=$3 where id=$4",[entry.entity_id,t.activeStatusId,t.returnedStatusId,t.inventoryId]);for(const link of t.links)await client.query("update inventory_loans set card_id=$1 where id=$2 and card_id is null",[link.card_id,link.id]);}
  if(context.children?.length)for(const child of context.children)await client.query("update meeting_topics set parent_id=$1,confidential=$4 where id=$2 and parent_id is null and deleted_at is null and to_jsonb(meeting_topics)=$3::jsonb",[entry.entity_id,child.id,JSON.stringify(child.snapshot),child.confidential]);
  if(entry.kind==="topic"&&row.meeting_id!=null)await client.query("update meetings set revision=revision+1 where id=$1",[row.meeting_id]);
  await client.query("update trash_entries set state='restored',finished_at=now(),finished_by=$2,last_error=null where id=$1",[id,user.id]);await client.query("COMMIT");
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

async function purgeSnapshot(client:PoolClient,entry:TrashRow){
 if(entry.kind==="attachment")return {scope:{} as Record<string,number[]>,paths:entry.cleanup_paths};
 const scope:Record<string,number[]>={ [kindInfo(entry.kind).table]:[entry.entity_id] },paths:string[]=[];
 const ids=async(query:string,args:unknown[]) => (await client.query(query,args)).rows.map(row=>Number(row.id));
 if(entry.kind==="inventory"){scope.boards=await ids("select id from boards where inventory_board_id=$1 order by id for update",[entry.entity_id]);scope.inventory_items=await ids("select id from inventory_items where board_id=$1 order by id for update",[entry.entity_id]);paths.push(...(await client.query("select path from inventory_attachments where item_id=any($1)",[scope.inventory_items])).rows.map(row=>row.path));}
 if(entry.kind==="board")scope.boards=[entry.entity_id];
 if(entry.kind==="card")scope.cards=[entry.entity_id];
 if(scope.boards?.length){scope.cards=await ids("select id from cards where board_id=any($1) order by id for update",[scope.boards]);scope.board_statuses=await ids("select id from board_statuses where board_id=any($1) order by id for update",[scope.boards]);paths.push(...(await client.query("select path from attachments where card_id=any($1) union all select path from board_instruction_forms where board_id=any($2)",[scope.cards,scope.boards])).rows.map(row=>row.path));}
 if(entry.kind==="card")paths.push(...(await client.query("select path from attachments where card_id=$1",[entry.entity_id])).rows.map(row=>row.path));
 if(entry.kind==="cashbook"){
  const rows=(await client.query("select id,files from cashbook_entries where cashbook_id=$1 order by id for update",[entry.entity_id])).rows;scope.cashbook_entries=rows.map(row=>row.id);
  for(const row of rows)for(const file of row.files)if(typeof file.path==="string")paths.push(file.path);
  paths.push(...(await client.query("select detail->'before'->>'templatePath' as path from cashbook_activity where cashbook_id=$1 union all select detail->'after'->>'templatePath' as path from cashbook_activity where cashbook_id=$1",[entry.entity_id])).rows.flatMap(row=>typeof row.path==="string"?[row.path]:[]));
  const book=(await client.query("select config from cashbooks where id=$1",[entry.entity_id])).rows[0];if(book?.config.templatePath)paths.push(book.config.templatePath);
 }
 if(entry.kind==="meeting_area"){
  await client.query("select id from meeting_areas where id=$1 for update",[entry.entity_id]);
  scope.meetings=await ids("select id from meetings where area_id=$1 order by id for update",[entry.entity_id]);
  scope.meeting_topics=await ids("select id from meeting_topics where meeting_id=any($1) order by id for update",[scope.meetings]);
  const area=(await client.query("select word_template_path from meeting_areas where id=$1",[entry.entity_id])).rows[0];if(area?.word_template_path)paths.push(area.word_template_path);
 }
 if(entry.kind==="meeting")scope.meeting_topics=await ids("select id from meeting_topics where meeting_id=$1 order by id for update",[entry.entity_id]);
 if(entry.kind==="topic")scope.meeting_topics=[entry.entity_id];
 if(scope.meeting_topics?.length)paths.push(...(await client.query("select path from meeting_documents where topic_id=any($1)",[scope.meeting_topics])).rows.map(row=>row.path));
 if(scope.cards?.length||scope.boards?.length){
  const deletedFiles=(await client.query("select cleanup_paths from trash_entries where kind='attachment' and state in ('trashed','purging') and ((context->>'cardId')=any($1) or (context->>'boardId')=any($2))",[(scope.cards??[]).map(String),(scope.boards??[]).map(String)])).rows;
  for(const row of deletedFiles)paths.push(...row.cleanup_paths);
 }

 return {scope,paths:[...new Set(paths)]};
}
async function fileStillReferenced(path:string){
 return !!(await pool.query(`select 1 where exists(select 1 from trash_entries where kind='attachment' and state='trashed' and cleanup_paths @> jsonb_build_array($1::text)) or exists(select 1 from attachments where path=$1) or exists(select 1 from inventory_attachments where path=$1) or exists(select 1 from meeting_documents where path=$1) or exists(select 1 from board_instruction_forms where path=$1) or exists(select 1 from form_documents where path=$1) or exists(select 1 from meeting_areas where word_template_path=$1) or exists(select 1 from users where avatar_path=$1 or signature_path=$1) or exists(select 1 from cashbooks where config->>'templatePath'=$1) or exists(select 1 from cashbook_entries where files @> jsonb_build_array(jsonb_build_object('path',$1::text)))`,[path])).rowCount;
}
/** No file IO occurs while rows are locked. Pending cleanup survives a restart. */
export async function purgeTrashEntry(user:User|null,id:number,confirmation:unknown,now=new Date(),boardId?:number,expectedKind?:"card"|"attachment"){
 if(!Number.isSafeInteger(id)||id<1)throw new TrashError("Ungültiger Eintrag.");
 if(user&&(typeof confirmation!=="string"||confirmation.trim()!=="ENDGÜLTIG"))throw new TrashError("Bitte ENDGÜLTIG genau so eingeben.");
 const client=await pool.connect();let paths:string[]=[];
 try{
  await client.query("BEGIN");if(user)await liveUser(client,user,boardId===undefined);
  const entry=(await client.query<TrashRow>("select * from trash_entries where id=$1 for update",[id])).rows[0];
  if(!entry||!["trashed","purging"].includes(entry.state))throw new TrashError("Dieser Eintrag liegt nicht mehr im Papierkorb.");
  if(expectedKind!==undefined&&entry.kind!==expectedKind)throw new TrashError("Dieser Eintrag gehört nicht zu diesem Papierkorbbereich.");
  if(boardId!==undefined&&!["attachment","card"].includes(entry.kind))throw new TrashError("Dieser Eintrag gehört nicht zum Board-Papierkorb.");
  if(user&&entry.kind==="attachment")await authorizeAttachmentTrash(client,user,entry.context,boardId);
  if(user&&entry.kind==="card")await authorizeCardTrash(client,user,entry.context,boardId);
  if(!user&&entry.state==="trashed"&&new Date(entry.expires_at)>now)throw new TrashError("Die Aufbewahrungsfrist ist noch nicht abgelaufen.");
  if(entry.state==="purging")paths=entry.cleanup_paths;
  else {
   const {scope,paths:storedPaths}=await purgeSnapshot(client,entry);paths=storedPaths;
   await client.query("update trash_entries set context=context||jsonb_build_object('purgeScope',$1::jsonb) where id=$2",[JSON.stringify(scope),id]);
   await client.query("select set_config('gremio.trash_purge',$1,true)",[String(id)]);
   if(scope.boards?.length)for(const routing of ["locations","feedback_areas"])await client.query(`update ${routing} set target_board_id=null,target_status_id=null where target_board_id=any($1) and deleted_at is not null`,[scope.boards]);
   if(scope.cards?.length){
    await client.query("delete from card_budget_plan_corrections where card_id=any($1)",[scope.cards]);
    await client.query("delete from cards where id=any($1)",[scope.cards]);
   }
   if(entry.kind==="inventory"&&scope.boards?.length)await client.query("delete from boards where id=any($1)",[scope.boards]);
   if(entry.kind==="cashbook"){
    await client.query("delete from cashbook_activity where cashbook_id=$1",[entry.entity_id]);
    for(const entryId of [...(scope.cashbook_entries??[])].sort((a,b)=>b-a))await client.query("delete from cashbook_entries where id=$1",[entryId]);
    await client.query("delete from cashbook_access where cashbook_id=$1",[entry.entity_id]);
   }
   if(entry.kind==="meeting_area"&&scope.meetings?.length)await client.query("delete from meetings where id=any($1)",[scope.meetings]);
   if(entry.kind==="group")await client.query("delete from cashbook_access where group_id=$1",[entry.entity_id]);
   if(entry.kind==="attachment"){
    const context=attachmentTrashContext(entry.context);
    if(user)await client.query("insert into card_activity(card_id,user_id,type,detail) select id,$2,'attachment_purged',$3 from cards where id=$1 and board_id=$4 and exists(select 1 from boards where id=$4 and deleted_at is null)",[context.cardId,user.id,`Endgültig aus dem Papierkorb gelöscht: ${context.attachment.filename}`,context.boardId]);
   }else if(entry.kind!=="card"){
    const result=await client.query(`delete from ${kindInfo(entry.kind).table} where id=$1 and deleted_at is not null`,[entry.entity_id]);
    if(!result.rowCount)throw new TrashError("Die ursprünglichen Daten sind nicht mehr vorhanden.");
   }
   if(scope.cards?.length||scope.boards?.length)await client.query("update trash_entries set state='purged',finished_at=now(),label='',context='{}',cleanup_paths='[]',last_error=null,finished_by=$2 where kind='attachment' and ((context->>'cardId')=any($1) or (context->>'boardId')=any($3)) and state in ('trashed','purging')",[(scope.cards??[]).map(String),user?.id??null,(scope.boards??[]).map(String)]);
   for(const [kind,table] of [["board","boards"],["card","cards"],["meeting","meetings"],["topic","meeting_topics"]])if(scope[table]?.length)await client.query("update trash_entries set state='purged',finished_at=now(),label='',context='{}',last_error=null,finished_by=$4 where kind=$1 and entity_id=any($2) and id<>$3 and state='trashed'",[kind,scope[table],id,user?.id??null]);
   await client.query("update trash_entries set state='purging',cleanup_paths=$1,last_error=null,finished_by=$3 where id=$2",[JSON.stringify(paths),id,user?.id??null]);
  }
  await client.query("COMMIT");
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
 try{
  for(const path of paths){if(await fileStillReferenced(path))continue;try{await unlink(absPath(path));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
  await pool.query("update trash_entries set state='purged',finished_at=now(),cleanup_paths='[]',context='{}',label='',last_error=null where id=$1 and state='purging'",[id]);
 }catch(error){await pool.query("update trash_entries set last_error=$1 where id=$2 and state='purging'",["Die Daten sind endgültig gelöscht; die lokale Dateibereinigung wird erneut versucht.",id]);throw error;}
}
export async function sweepTrash(now=new Date()){
 const rows=(await pool.query("select id from trash_entries where (state='trashed' and expires_at<=$1) or state='purging' order by expires_at,id",[now])).rows;
 let purged=0;
 for(const row of rows){try{await purgeTrashEntry(null,row.id,undefined,now);purged++;}catch(error){console.error(`[trash] Cleanup #${row.id} failed`,error instanceof Error?error.name:"Error");await pool.query("update trash_entries set last_error=$1 where id=$2 and state='trashed'",["Endgültige Löschung derzeit nicht möglich. Bitte verknüpfte Ressourcen prüfen oder die Löschung erneut versuchen.",row.id]);}}
 return purged;
}
export async function runDailyTrashCleanup(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now).map(part=>[part.type,part.value]));
 const date=`${parts.year}-${parts.month}-${parts.day}`;if(Number(parts.hour)<3)return false;
 const previous=(await pool.query("select last_date from maintenance_runs where name='trash'")).rows[0];if(previous?.last_date===date)return false;
 await sweepTrash(now);
 await pool.query("insert into maintenance_runs(name,last_date) values ('trash',$1) on conflict(name) do update set last_date=excluded.last_date",[date]);return true;
}
const globals=globalThis as unknown as {__trashScheduler?:boolean};
export function startTrashScheduler(){if(globals.__trashScheduler)return;globals.__trashScheduler=true;let running=false;const tick=async()=>{if(running)return;running=true;try{await runDailyTrashCleanup();}catch(error){console.error("[trash] Daily cleanup failed",error instanceof Error?error.name:"Error");}finally{running=false;}};setTimeout(()=>void tick(),30000);setInterval(()=>void tick(),60000);}

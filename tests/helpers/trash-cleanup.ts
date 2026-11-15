// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { randomUUID } from "node:crypto";
import { db, pool } from "../../lib/db";
import { users } from "../../lib/db/schema";
import { moveToTrash, purgeTrashEntry, trashKinds, type TrashKind } from "../../lib/trash";
/** Test-only cleanup uses the real whole-resource purge; it never disables guards. */
export async function purgeTestResource(kind:TrashKind,id:number){
 if(!/^\/gremio_workflows_test_/.test(new URL(process.env.DATABASE_URL!).pathname))throw Error("isolated test database required");
 const table=trashKinds[kind].table;
 const row=(await pool.query(`select * from ${table} where id=$1`,[id])).rows[0];if(!row)return;
 const [admin]=await db.insert(users).values({username:`cleanup-${randomUUID()}`,role:"admin"}).returning();
 try{
  let entry=(await pool.query("select id from trash_entries where kind=$1 and entity_id=$2 and state in ('trashed','purging')",[kind,id])).rows[0];
  if(!entry){const entryId=await moveToTrash(admin,kind,id,"LÖSCHEN",{...(row.revision==null?{}:{revision:row.revision}),...(kind==="cashbook"?{cashbookName:row.name}:kind==="finance"?{financeName:row.name}:kind==="board"?{boardName:row.name}:kind==="inventory"?{inventoryName:row.name}:kind==="meeting_area"?{areaName:row.name}:kind==="group"||kind.endsWith("_template")?{entityName:row.name}:{})});entry={id:entryId};}
  await purgeTrashEntry(admin,entry.id,"ENDGÜLTIG");
 }finally{await pool.query("delete from users where id=$1",[admin.id]);}
}
export async function purgeTestMeetings(areaId:number){for(const row of (await pool.query("select id from meetings where area_id=$1 order by id desc",[areaId])).rows)await purgeTestResource("meeting",row.id);}

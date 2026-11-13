// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {randomUUID} from "node:crypto";
import {and,eq} from "drizzle-orm";
import {db,pool} from "../lib/db";
import * as s from "../lib/db/schema";
import {createBoardFromTemplate} from "../lib/boards";
import {uploadWordTemplate} from "../lib/meetings/word";
import {wordTemplateFixture} from "../tests/word-template-fixture";
import {unzipOffice,zip} from "../lib/zip";

async function main(){
  const target=new URL(process.env.DATABASE_URL??"");
  if(target.hostname!=="gremio-db"||target.pathname!=="/gremio_local_test"||process.env.APP_BASE_URL!=="http://localhost:3010"){
    throw new Error("Demo-Seed ist ausschließlich im isolierten lokalen Docker-Stack erlaubt.");
  }
  await db.insert(s.users).values({username:"demo-admin",name:"Demo Administration",role:"admin"}).onConflictDoNothing();
  const [owner]=await db.select().from(s.users).where(eq(s.users.username,"demo-admin"));
  if(owner.role!=="admin")throw new Error("Das vorhandene Demo-Konto ist kein Admin.");
  let [board]=await db.select().from(s.boards).where(and(eq(s.boards.ownerId,owner.id),eq(s.boards.name,"Demo – Finanzanträge")));
  if(!board){
    const [template]=await db.select().from(s.boardTemplates).where(eq(s.boardTemplates.name,"Antragsboard"));
    const id=await createBoardFromTemplate(owner.id,"Demo – Finanzanträge","Fiktive Anträge für lokale Tests",template?.id??null);
    [board]=await db.select().from(s.boards).where(eq(s.boards.id,id));
  }
  const statuses=await db.select().from(s.boardStatuses).where(eq(s.boardStatuses.boardId,board.id)).orderBy(s.boardStatuses.position);
  if(!statuses.length)throw new Error("Demoboard hat keine Spalten.");
  const samples=[
    {title:"Ersti-Frühstück",applicant:"Fachschaft Beispiel",requestedAmount:45000},
    {title:"Material für die Kunst-AG",applicant:"Initiative Kreativ",requestedAmount:12500},
    {title:"Campus-Sommerfest",applicant:"Organisationsteam Campus",requestedAmount:90000},
    {title:"Neue Moderationsmaterialien",applicant:"Referat Veranstaltungen",requestedAmount:8000},
  ];
  for(const [index,sample] of samples.entries()){
    const number=`DEMO-${index+1}`;
    const [existing]=await db.select({id:s.cards.id}).from(s.cards).where(and(eq(s.cards.boardId,board.id),eq(s.cards.number,number)));
    if(!existing)await db.insert(s.cards).values({...sample,boardId:board.id,statusId:statuses[index%statuses.length].id,number,token:randomUUID(),creatorUserId:owner.id,notes:"Fiktiver Datensatz – ausschließlich für lokale Tests.",position:index});
  }
  let [area]=await db.select().from(s.meetingAreas).where(and(eq(s.meetingAreas.ownerId,owner.id),eq(s.meetingAreas.name,"Demo – StuRa Köthen")));
  if(!area){
    area=await db.transaction(async tx=>{
      const [created]=await tx.insert(s.meetingAreas).values({ownerId:owner.id,name:"Demo – StuRa Köthen",description:"Lokale Beispielsitzungen mit Haupt- und Unter-TOPs."}).returning();
      const nextWeek=new Date(Date.now()+7*86400000);nextWeek.setUTCHours(17,0,0,0);
      const [meeting]=await tx.insert(s.meetings).values({areaId:created.id,ownerId:owner.id,title:"Demo-Sitzung – Protokoll und Tagesordnung testen",committee:created.name,startsAt:nextWeek,location:"Demo-Sitzungsraum",chair:"Demo Administration",state:"planning"}).returning();
      const base={meetingId:meeting.id,createdBy:owner.id,presenter:"Demo Administration",state:"scheduled" as const};
      const [opening]=await tx.insert(s.meetingTopics).values({...base,title:"Begrüßung und Regularien",section:"opening",durationMinutes:5,position:0}).returning();
      await tx.insert(s.meetingTopics).values([
        {...base,title:"Feststellung der Beschlussfähigkeit",section:"opening",parentId:opening.id,durationMinutes:1,position:1},
        {...base,title:"Beschluss der Tagesordnung",section:"opening",parentId:opening.id,durationMinutes:2,position:2,motion:"Die vorliegende Tagesordnung wird beschlossen."},
        {...base,title:"Berichte aus den Referaten",durationMinutes:10,position:3,kind:"information",description:"Hier kann während der Sitzung das Protokoll ergänzt werden."},
      ]);
      const [finance]=await tx.insert(s.meetingTopics).values({...base,title:"Finanzanträge",durationMinutes:15,position:4}).returning();
      await tx.insert(s.meetingTopics).values([
        {...base,title:"Ersti-Frühstück",parentId:finance.id,durationMinutes:5,position:5,kind:"decision",motion:"Für das Ersti-Frühstück werden bis zu 450 Euro bewilligt.",description:"Fiktiver Beispielantrag für einen TOP mit Beschlussvorschlag."},
        {...base,title:"Material für die Kunst-AG",parentId:finance.id,durationMinutes:5,position:6,kind:"decision",motion:"Für Materialien werden bis zu 125 Euro bewilligt."},
        {...base,title:"Planung des Campus-Sommerfests",durationMinutes:10,position:7,state:"deferred",description:"Beispiel für einen vertagten TOP."},
        {...base,title:"Sonstiges",durationMinutes:5,position:8,isMiscellaneous:true},
        {...base,title:"Vertrauliche interne Angelegenheit (Demo)",section:"non_public",confidential:true,durationMinutes:5,position:9,description:"Fiktiver vertraulicher Inhalt zum Prüfen der Exporte."},
      ]);
      return created;
    });
  }
  if(!area.wordTemplatePath){
    const files=unzipOffice(wordTemplateFixture());
    for(const file of files)if(file.name==="word/document.xml")file.data=Buffer.from(file.data.toString().replace("Keep this letterhead","Protokollvorlage – lokale Demo").replace("Signature","Unterschriften"));
    const bytes=zip(files);
    await uploadWordTemplate(owner,area.id,new File([new Uint8Array(bytes)],"Demo-Protokollvorlage.dotx"),area.wordTemplateRevision);
  }
  console.log("Demo bereit: Admin, vier Finanzanträge und eine Sitzung mit Unter-TOPs, Beschlussvorschlägen und Wordvorlage.");
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Demo-Seed fehlgeschlagen");process.exitCode=1;}).finally(()=>pool.end());

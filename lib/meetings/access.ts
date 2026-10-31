// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { meetings, meetingAreas, meetingAreaAccess, meetingTopics, userGroups, type User } from "@/lib/db/schema";
import { projectFinanceTopics } from "./finance-projection";
export class MeetingError extends Error {}
export function canManageMeeting(user: User, meeting: typeof meetings.$inferSelect): boolean {
  return user.isActive && (user.role === "admin" || user.id === meeting.ownerId);
}
export async function areaAccessLevel(user: User, area: typeof meetingAreas.$inferSelect): Promise<"read" | "write" | null> {
  if (!user.isActive) return null;
  if (user.role === "admin" || area.ownerId === user.id) return "write";
  const groups = await db.select({id:userGroups.groupId}).from(userGroups).where(eq(userGroups.userId,user.id));
  const grants = await db.select({level:meetingAreaAccess.accessLevel}).from(meetingAreaAccess).where(and(eq(meetingAreaAccess.areaId,area.id),or(eq(meetingAreaAccess.userId,user.id),groups.length?inArray(meetingAreaAccess.groupId,groups.map(g=>g.id)):undefined)));
  return grants.some(g=>g.level==="write")?"write":grants.length?"read":null;
}
export async function requireArea(user: User, id: number, mode: "read" | "write" | "manage" = "read") {
  if(!Number.isSafeInteger(id)||id<1||id>2147483647)throw new MeetingError("Kein Zugriff.");
  const [area]=await db.select().from(meetingAreas).where(eq(meetingAreas.id,id));
  if(!area)throw new MeetingError("Kein Zugriff.");
  const level=await areaAccessLevel(user,area);
  if(!level || mode==="write"&&level!=="write" || mode==="manage"&&user.role!=="admin"&&user.id!==area.ownerId)throw new MeetingError("Kein Zugriff.");
  return area;
}
export async function meetingAccessLevel(user: User, meeting: typeof meetings.$inferSelect): Promise<"read" | "write" | null> {
  const [area]=await db.select().from(meetingAreas).where(eq(meetingAreas.id,meeting.areaId));
  return area?areaAccessLevel(user,area):null;
}
export async function requireMeeting(user: User, id: number, mode: "read" | "write" | "manage" = "read") {
  if(!Number.isSafeInteger(id)||id<1||id>2147483647)throw new MeetingError("Kein Zugriff.");
  const [meeting]=await db.select().from(meetings).where(eq(meetings.id,id));
  if(!meeting)throw new MeetingError("Kein Zugriff.");
  const area=await requireArea(user,meeting.areaId,mode);
  return {...meeting,ownerId:area.ownerId,committee:area.name};
}
export async function accessibleAreas(user: User) {
  if(!user.isActive)return [];
  return db.select().from(meetingAreas).where(user.role==="admin"?undefined:or(eq(meetingAreas.ownerId,user.id),sql`exists(select 1 from meeting_area_access a where a.area_id=${meetingAreas.id} and (a.user_id=${user.id} or a.group_id in(select group_id from user_groups where user_id=${user.id})))`)).orderBy(asc(meetingAreas.name));
}
export async function accessibleMeetings(user: User) {
  const areas=await accessibleAreas(user);
  if(!areas.length)return [];
  const rows=await db.select().from(meetings).where(inArray(meetings.areaId,areas.map(a=>a.id))).orderBy(desc(meetings.startsAt),desc(meetings.id));
  return rows.map(meeting=>{const area=areas.find(a=>a.id===meeting.areaId)!;return {...meeting,ownerId:area.ownerId,committee:area.name};});
}
export async function requireTopic(user: User, id: number, edit = false) {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new MeetingError("Kein Zugriff.");
  const [topic] = await db.select().from(meetingTopics).where(eq(meetingTopics.id, id));
  if (!topic) throw new MeetingError("Kein Zugriff.");
  if (topic.meetingId == null) {
    if (!user.isActive || (user.role !== "admin" && topic.createdBy !== user.id)) throw new MeetingError("Kein Zugriff.");
    return { topic, meeting: null };
  }
  const meeting = await requireMeeting(user, topic.meetingId, edit ? "write" : "read");
  if (topic.parentId != null) await requireTopic(user,topic.parentId);
  if (topic.confidential && !canManageMeeting(user, meeting)) throw new MeetingError("Kein Zugriff.");
  if(edit&&topic.transferred)throw new MeetingError("Dieser TOP wurde bereits weitergegeben. Bitte den TOP in der neuen Sitzung bearbeiten.");
  if (edit && meeting.state === "closed") throw new MeetingError("Die Sitzung ist abgeschlossen. Die Verwaltung kann sie wieder öffnen.");
  return { topic, meeting };
}
export async function visibleTopics(user: User, meetingId: number) {
  const meeting = await requireMeeting(user, meetingId);
  const rows=await db.select().from(meetingTopics).where(and(eq(meetingTopics.meetingId, meetingId), canManageMeeting(user, meeting) ? undefined : eq(meetingTopics.confidential, false))).orderBy(asc(meetingTopics.position), asc(meetingTopics.id));
  const visible=new Set(rows.map(row=>row.id));
  const shown=rows.filter(row=>(row.parentId==null||visible.has(row.parentId))&&!row.hiddenAfterTransfer);
  const shownIds=new Set(shown.map(t=>t.id));
  return projectFinanceTopics(user,shown.map(row=>row.parentId!=null&&!shownIds.has(row.parentId)?{...row,parentId:null}:row));
}
export async function personalTopics(user: User,view:"active"|"past"="active") {
  if(!user.isActive)return [];
  const own=await db.select().from(meetingTopics).where(and(isNull(meetingTopics.meetingId), eq(meetingTopics.createdBy, user.id), view==="past"?or(eq(meetingTopics.state,"treated"),sql`${meetingTopics.resolvedAt} is not null`):and(sql`${meetingTopics.state} <> 'treated'`,isNull(meetingTopics.resolvedAt)))).orderBy(desc(meetingTopics.id));
  if(view==="past")return own;
  const untracked=await db.select().from(meetingTopics).where(and(eq(meetingTopics.createdBy,user.id),sql`${meetingTopics.meetingId} is not null`,isNull(meetingTopics.originTopicId),eq(meetingTopics.state,"withdrawn")));
  for(const row of untracked){try{await requireTopic(user,row.id);own.push(row);}catch{/* No source content without current session access. */}}
  return own.sort((a,b)=>b.id-a.id);
}

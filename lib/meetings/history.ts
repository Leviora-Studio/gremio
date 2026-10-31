// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {asc,eq,inArray} from "drizzle-orm";
import {db} from "@/lib/db";
import {meetingTopics,meetingTopicActivity,type User} from "@/lib/db/schema";
import {requireTopic} from "./access";
export type TopicHistoryEntry={id:number;meetingId:number;meetingTitle:string;state:typeof meetingTopicActivity.$inferSelect.state;transferred:boolean;eventId?:number;occurredAt?:string;baseline?:boolean};
/** Resolve each destination separately; membership of a source never grants destination access. */
export async function topicDestinations(user:User,ids:number[]){
 const result:Record<number,TopicHistoryEntry[]>={};if(!ids.length)return result;
 const rows=await db.select({id:meetingTopics.id,previous:meetingTopics.previousTopicId}).from(meetingTopics).where(inArray(meetingTopics.previousTopicId,ids)).orderBy(asc(meetingTopics.id));
 for(const row of rows){try{const {topic,meeting}=await requireTopic(user,row.id);if(meeting)(result[row.previous!]??=[]).push({id:topic.id,meetingId:meeting.id,meetingTitle:meeting.title,state:topic.state,transferred:topic.transferred});}catch{/* No destination metadata without live access. */}}
 return result;
}
export async function personalTopicHistory(user:User,id:number):Promise<TopicHistoryEntry[]>{
 const {topic,meeting}=await requireTopic(user,id);if(meeting)return topic.createdBy===user.id&&topic.state==="withdrawn"&&topic.originTopicId==null?[{id:topic.id,meetingId:meeting.id,meetingTitle:meeting.title,state:"withdrawn",transferred:false,baseline:true}]:[];
 const rows=await db.select().from(meetingTopicActivity).where(eq(meetingTopicActivity.originTopicId,topic.id)).orderBy(asc(meetingTopicActivity.occurredAt),asc(meetingTopicActivity.id));const result:TopicHistoryEntry[]=[];
 const visible=new Map<number,Awaited<ReturnType<typeof requireTopic>>|null>();
 for(const row of rows){
  if(row.topicId==null)continue;
  if(!visible.has(row.topicId)){try{visible.set(row.topicId,await requireTopic(user,row.topicId));}catch{visible.set(row.topicId,null);}}
  const current=visible.get(row.topicId);
  if(current?.meeting)result.push({id:row.topicId,eventId:row.id,meetingId:current.meeting.id,meetingTitle:current.meeting.title,state:row.state,transferred:false,occurredAt:row.occurredAt.toISOString(),baseline:row.baseline});
 }
 return result;
}

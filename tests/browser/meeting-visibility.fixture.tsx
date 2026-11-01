// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Agenda} from '@/components/meetings/Agenda';
import {MeetingWorkspace} from '@/components/meetings/Workspace';
import {TopicStatusControl} from '@/components/meetings/TopicStatusControl';
import {TopicTransferControl} from '@/components/meetings/TopicTransferControl';
import {MeetingDialog} from '@/components/meetings/Dialog';
import {MeetingFields,TopicFields} from '@/components/meetings/Fields';
import {MeetingActionForm} from '@/components/meetings/ActionForm';
import {FinanceConfiguration} from '@/components/meetings/FinanceConfiguration';
import {TopicTrail} from '@/components/meetings/TopicTrail';
import {FileInput} from '@/components/FileInput';
import {Select} from '@/components/Select';
const long='FinanzantragzurUnterstützungstudentischerInitiativen'.repeat(4);
const targets=Array.from({length:35},(_,i)=>({value:String(i+1),label:`Sitzung ${i+1}: ${long}`}));
const items=Array.from({length:4},(_,i)=>({id:i+1,title:i===3?long:`Thema ${i+1}`,parentId:i===3?3:null,position:i,state:'scheduled' as const,durationMinutes:10,kind:'discussion' as const,confidential:false,presenter:i===3?long:''}));
function Fixture(){
 const [writer,setWriter]=useState(true);
 const actions=Object.fromEntries(items.map(item=>[item.id,<><TopicStatusControl id={item.id} title={item.title} state="scheduled" revision={0}/><TopicTransferControl id={item.id} targets={targets}/><div className="w-full"><TopicTrail entries={[{id:1,meetingId:1,meetingTitle:long,state:'deferred',transferred:false}]}/></div></>]));
 return <main className="mx-auto min-w-0 max-w-5xl space-y-6 p-4 pb-24 sm:p-6"><header className="flex flex-wrap gap-2"><h1 className="w-full text-2xl font-bold">Sitzungsbereich</h1><button className="btn-secondary" onClick={()=>setWriter(!writer)}>{writer?'Lesend ansehen':'Planung ansehen'}</button>
  <MeetingDialog label="Neue Sitzung" title="Sitzung anlegen"><MeetingActionForm action={async()=>({})}><MeetingFields areaId={1}/></MeetingActionForm></MeetingDialog>
  <MeetingDialog label={writer?'TOP anlegen':'TOP vorschlagen'} title="Thema einreichen"><MeetingActionForm action={async()=>({})}><TopicFields editableState={writer}/></MeetingActionForm></MeetingDialog></header>
  <MeetingWorkspace writer={writer} scheduledCount={items.length} topics={items.map(t=>({...t,state:'proposed' as const,description:long,own:false}))} actions={writer?actions:{}} agenda={<Agenda items={items} meetingId={1} revision={0} editable={writer} startsAt={null} actions={writer?actions:{}}/>}/>
  <section className="card min-w-0 p-5"><h2 className="mb-4 text-lg font-semibold">Finanzanträge</h2><FinanceConfiguration areaId={1} motionTemplate="Bis zu {{requested_amount}}" boards={[{id:1,name:long,fields:["requested_amount"],statuses:targets.map(t=>({id:Number(t.value),name:t.label}))}]} boardId={1} sourceIds={[]} targetId={1}/></section>
  <section className="card min-w-0 p-5"><MeetingActionForm compact submit="Freigabe speichern" action={async()=>({})}><div className="min-w-0 w-full sm:w-56"><label className="label">Zugriff</label><Select portal ariaLabel="Testfreigabe" options={[{value:'read',label:'Lesend'},{value:'write',label:'Lesend und schreibend'}]} defaultValue="read"/></div></MeetingActionForm></section>
  <section className="card min-w-0 p-5"><MeetingActionForm action={async()=>({})}><FileInput name="file" className="flex-wrap"/><label className="flex items-start gap-2 text-sm"><input type="checkbox"/>Ich gebe diese Datei für alle zum TOP berechtigten Sitzungsteilnehmer frei.</label></MeetingActionForm></section>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

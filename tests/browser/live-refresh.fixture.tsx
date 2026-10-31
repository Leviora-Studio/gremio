// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppLiveRefresh} from '@/components/AppLiveRefresh';
import {MeetingActionForm} from '@/components/meetings/ActionForm';
import {RenameWithConfirm} from '@/components/admin/RenameWithConfirm';
import {LiveRefreshGuard} from '@/lib/live-refresh-guard';

declare global { interface Window { fixtureGuard: LiveRefreshGuard } }
window.fixtureGuard = new LiveRefreshGuard();
function Fixture() {
 const [modal,setModal]=useState(false);
 const [name,setName]=useState("Original");
 return <><AppLiveRefresh/><button onClick={()=>setModal(!modal)}>Dialog</button>
  {modal&&<div role="dialog" aria-modal="true">Unveränderter Dialog</div>}
  <MeetingActionForm action={async()=>{await new Promise(resolve=>setTimeout(resolve,250));return {success:'Gespeichert'};}}>
   <label>Titel<input name="title" defaultValue=""/></label>
   <input type="hidden" name="id" value="fixed"/>
   <label>Suche<input name="search" type="search"/></label>
   <label data-live-refresh-filter>Filter<input name="filter"/></label>
   <select name="select" defaultValue="a"><option>a</option><option>b</option></select>
   <button type="reset">Verwerfen</button>
  </MeetingActionForm>
  <section aria-label="Umbenennen"><RenameWithConfirm currentName={name} entityLabel="Test" action={async(_,data)=>{setName(String(data.get('name')));return {success:'Name gespeichert'};}}/></section>
  <details><summary>Thema</summary><form><input name="draft" aria-label="Eingeklappter Entwurf" defaultValue=""/></form></details>
 </>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useState } from "react";
import { DatePicker } from "@/components/DatePicker";
import { Select } from "@/components/Select";
export function MeetingDateTimeField({name,label,initial=""}:{name:string;label:string;initial?:string}) {
  const [date,setDate]=useState(initial.slice(0,10));
  const [hour,setHour]=useState(initial.slice(11,13)||"18");
  const [minute,setMinute]=useState(initial.slice(14,16)||"00");
  const options=(count:number)=>Array.from({length:count},(_,i)=>({value:String(i).padStart(2,"0"),label:String(i).padStart(2,"0")}));
  return <div className="space-y-1"><label className="label">{label}</label><input type="hidden" name={name} value={date?`${date}T${hour}:${minute}`:""}/>
    <DatePicker portal value={date} onChange={setDate} ariaLabel={`${label}: Datum`} />
    <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><Select portal ariaLabel={`${label}: Stunde`} value={hour} onChange={setHour} options={options(24)}/></div><span>:</span><div className="min-w-0 flex-1"><Select portal ariaLabel={`${label}: Minute`} value={minute} onChange={setMinute} options={options(60)}/></div><span className="text-sm text-slate-500">Uhr</span></div>
  </div>;
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useState } from "react";
import { Modal } from "@/components/Modal";
export function MeetingDialog({label,title,children,primary=false,initialOpen=false}:{label:string;title:string;children:React.ReactNode;primary?:boolean;initialOpen?:boolean}) {
  const [open,setOpen]=useState(initialOpen);
  return <><button type="button" className={primary?"btn-primary max-w-full h-auto min-h-10 whitespace-normal py-2":"btn-secondary max-w-full h-auto min-h-10 whitespace-normal py-2"} onClick={()=>setOpen(true)}>{label}</button><Modal open={open} onClose={()=>setOpen(false)} title={title} manageFocus portal><div className="space-y-5">{children}</div></Modal></>;
}

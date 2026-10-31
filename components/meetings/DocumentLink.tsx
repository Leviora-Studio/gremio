// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { AttachmentLink } from "@/components/pdf/AttachmentLink";
export function MeetingDocumentLink({document}:{document:{id:number;filename:string;mime:string}}) {
  const src=`/api/meeting-document/${document.id}`;
  if(document.mime==="application/pdf")return <AttachmentLink id={document.id} filename={document.filename} mime={document.mime} src={src} editable={false} className="break-all text-brand-700 hover:underline"/>;
  return <a className="break-all text-brand-700 hover:underline" href={src} download>{document.filename}</a>;
}

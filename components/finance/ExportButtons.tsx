// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {ExportControls} from "@/components/export/ExportControls";
import type {ExportColumn} from "@/lib/export-selection";
export function ExportButtons({fbId,view,columns,label="Export:",className="mb-3 flex flex-wrap items-center gap-2"}:{fbId:number;view:string;columns:ExportColumn[];label?:string;className?:string}){
 return <ExportControls endpoint={`/finanzen/${fbId}/export?view=${encodeURIComponent(view)}`} columns={columns} grouped={["plan","live","actual"].includes(view)} label={label} className={className}/>;
}

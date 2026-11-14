// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use server";
import {requireAdmin} from "@/lib/auth";
import {revalidatePath} from "next/cache";
import {setApplicationModule,type ApplicationModule} from "@/lib/application-form-modules";
export async function changeApplicationModuleAction(module:ApplicationModule,enabled:boolean,revision:number,confirmation:string){
 const user=await requireAdmin();
 try{await setApplicationModule(user,module,enabled,revision,confirmation);}
 catch(error){return {error:error instanceof Error?error.message:"Modul konnte nicht geändert werden."};}
 for(const path of ["/","/admin/standorte","/admin/finanzantraege-formular"])revalidatePath(path);
 return {success:true};
}

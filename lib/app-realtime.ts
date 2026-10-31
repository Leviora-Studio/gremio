// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {Client} from "pg";
import {EventEmitter} from "node:events";
import {env} from "@/lib/env";
const globalState=globalThis as unknown as {__appChangeEmitter?:EventEmitter;__appChangeStarted?:boolean;__appChangeTimer?:ReturnType<typeof setTimeout>};
const emitter=globalState.__appChangeEmitter??=new EventEmitter();emitter.setMaxListeners(0);
function changed(){if(globalState.__appChangeTimer)return;globalState.__appChangeTimer=setTimeout(()=>{globalState.__appChangeTimer=undefined;emitter.emit("change");},750);globalState.__appChangeTimer.unref();}
function start(){
 if(globalState.__appChangeStarted)return;globalState.__appChangeStarted=true;
 function connect(){const client=new Client({connectionString:env.DATABASE_URL});let down=false;
  function reconnect(){if(down)return;down=true;client.removeAllListeners();void client.end().catch(()=>{});setTimeout(connect,2000).unref();}
  client.on("notification",message=>{if(message.channel==="app_change")changed();});client.on("error",reconnect);client.on("end",reconnect);
  void client.connect().then(()=>client.query("LISTEN app_change")).then(changed).catch(reconnect);
 }
 connect();
}
/** No table names, IDs, counts, tokens or business data enter the browser stream. */
export function subscribeAppChanges(callback:()=>void):()=>void{start();emitter.on("change",callback);return()=>{emitter.off("change",callback);};}

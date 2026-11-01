// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { deflateRawSync, inflateRawSync } from "node:zlib";

// CRC32 (wie in lib/xlsx.ts) — eigenständig, damit der ZIP-Helfer unabhängig ist.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Minimaler ZIP-Container (deflate, ohne Zip64). Dateinamen werden als UTF-8
 * geschrieben und das General-Purpose-Flag-Bit 11 gesetzt, damit Umlaute in
 * Entpackern korrekt erscheinen.
 */
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  const UTF8 = 0x0800; // Flag-Bit 11: Dateiname ist UTF-8
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    // 32-Bit-Offset-Schutz: ohne Zip64 sind Offsets auf 4 GB begrenzt. Sollte ein
    // Aufrufer das je erreichen, lieber klar scheitern als einen kaputten ZIP bauen.
    if (offset > 0xffffffff) {
      throw new Error("ZIP zu groß (über 4 GB, Zip64 nicht unterstützt).");
    }
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const comp = deflateRawSync(f.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // Datum 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(UTF8, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/** Read a bounded, CRC-checked Office ZIP without extracting paths to disk. */
export function unzipOffice(buffer: Buffer): {name:string;data:Buffer}[] {
  const fail=()=>{throw new Error("Invalid or unsupported Office ZIP.");};
  if(buffer.length<22||buffer.length>25*1024*1024)return fail();
  let end=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){
    if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
  }
  if(end<0)return fail();
  const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),offset=buffer.readUInt32LE(end+16);
  if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||buffer.readUInt16LE(end+8)!==count||count>2048||offset+size!==end)return fail();
  const files:{name:string;data:Buffer}[]=[],names=new Set<string>();
  let cursor=offset,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>end||buffer.readUInt32LE(cursor)!==0x02014b50)return fail();
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),crc=buffer.readUInt32LE(cursor+16),compressed=buffer.readUInt32LE(cursor+20),expanded=buffer.readUInt32LE(cursor+24);
    const nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),local=buffer.readUInt32LE(cursor+42);
    const next=cursor+46+nameLength+extra+comment;
    if(next>end||flags&1||![0,8].includes(method)||buffer.readUInt16LE(cursor+34)||expanded>32*1024*1024||(total+=expanded)>64*1024*1024)return fail();
    const name=buffer.subarray(cursor+46,cursor+46+nameLength).toString("utf8");
    if(!name||name.startsWith("/")||name.includes("\\")||name.includes("\0")||name.split("/").some(part=>part===".."||part===".")||names.has(name))return fail();
    names.add(name);
    if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50||buffer.readUInt16LE(local+8)!==method)return fail();
    const localNameLength=buffer.readUInt16LE(local+26),localExtra=buffer.readUInt16LE(local+28),dataStart=local+30+localNameLength+localExtra;
    if(dataStart+compressed>offset||!buffer.subarray(local+30,local+30+localNameLength).equals(buffer.subarray(cursor+46,cursor+46+nameLength)))return fail();
    const packed=buffer.subarray(dataStart,dataStart+compressed);
    const data=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:Math.max(1,expanded)});
    if(data.length!==expanded||crc32(data)!==crc)return fail();
    if(!name.endsWith("/"))files.push({name,data});
    cursor=next;
  }
  if(cursor!==end)return fail();
  return files;
}

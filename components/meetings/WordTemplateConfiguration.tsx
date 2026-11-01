// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import {useEffect,useState} from "react";
import {Select} from "@/components/Select";
import {FileInput} from "@/components/FileInput";
import {MeetingActionForm} from "./ActionForm";
import {uploadWordTemplateAction,saveWordConfigurationAction,removeWordTemplateAction} from "@/app/intern/sitzungen/actions";
import {wordStyleRoles,type MeetingWordConfiguration,type WordTemplateInfo} from "@/lib/meetings/word-template-types";
export function WordTemplateConfiguration({areaId,name,revision,info,configuration,error}:{areaId:number;name:string|null;revision:number;info:WordTemplateInfo|null;configuration:MeetingWordConfiguration|null;error?:string}){
  const config=configuration??info?.configuration;
  const [insertion,setInsertion]=useState(config?.insertion??"placeholder");
  useEffect(()=>setInsertion(config?.insertion??"placeholder"),[config?.insertion,revision]);
  return <div className="min-w-0 space-y-5">
    <p className="text-sm text-slate-500">Mit einer DOCX- oder DOTX-Vorlage steht Eigentümern und Admins zusätzlich ein Wordexport zur Verfügung. Kopf- und Fußzeilen, Bilder, Tabellen und Formatvorlagen werden aus der Datei übernommen. Beide Exporte enthalten auch vertrauliche TOPs.</p>
    {name&&<p className="break-words text-sm">Vorlage: <a className="text-brand-700 hover:underline" href={`/api/meeting-areas/${areaId}/word-template`}>{name}</a></p>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <MeetingActionForm action={uploadWordTemplateAction.bind(null,areaId)} submit={name?"Wordvorlage ersetzen":"Wordvorlage hochladen"}><input type="hidden" name="revision" value={revision}/><label className="block text-sm">Wordvorlage<FileInput name="template" accept=".docx,.dotx" required/></label></MeetingActionForm>
    {info&&config&&<MeetingActionForm action={saveWordConfigurationAction.bind(null,areaId)} submit="Wordexport-Einstellungen speichern"><input type="hidden" name="revision" value={revision}/><div className="grid gap-4 sm:grid-cols-2">{Object.entries(wordStyleRoles).map(([role,label])=><div key={role} className="min-w-0"><label className="label">{label}</label><Select key={`${revision}-${role}`} portal searchable name={`style_${role}`} ariaLabel={label} defaultValue={config.styles[role as keyof typeof config.styles]} options={info.styles.map(style=>({value:style.id,label:style.name}))}/></div>)}</div>
      <div><label className="label">Tagesordnung einfügen</label><Select portal name="insertion" ariaLabel="Tagesordnung einfügen" value={insertion} onChange={value=>setInsertion(value as typeof insertion)} options={[{value:"replace",label:"Gewählten Musterbereich ersetzen"},...(info.hasPlaceholder?[{value:"placeholder",label:"Platzhalter {{TAGESORDNUNG}} ersetzen"}]:[]),{value:"append",label:"Am Ende der Vorlage ergänzen"}]}/></div>
      {insertion==="replace"&&<div className="space-y-4"><p className="text-sm text-slate-500">Der Bereich vom Anfang bis vor das ausgewählte Ende wird durch die Sitzungs-TOPs ersetzt. Wähle das Ende so, dass z. B. Unterschriftsfelder erhalten bleiben. Anwesenheit und Abstimmungen werden nicht erfunden.</p><div><label className="label">Beginn des Musterbereichs (wird ersetzt)</label><Select key={`start-${revision}`} portal searchable name="start" ariaLabel="Beginn des Musterbereichs" defaultValue={String(config.start)} options={info.blocks.map(block=>({value:String(block.index),label:block.label}))}/></div><div><label className="label">Ende des Musterbereichs (bleibt erhalten)</label><Select key={`end-${revision}`} portal searchable name="end" ariaLabel="Ende des Musterbereichs" defaultValue={String(config.end)} options={[...info.blocks.map(block=>({value:String(block.index),label:block.label})),{value:String(info.blocks.length),label:"Dokumentende"}]}/></div></div>}
      {insertion!=="replace"&&<><input type="hidden" name="start" value={config.start}/><input type="hidden" name="end" value={config.end}/></>}
      <p className="text-sm text-slate-500">Alternativ kann die Vorlage einen einzelnen Absatz mit {"{{TAGESORDNUNG}}"} enthalten. Optionale Textplatzhalter: {"{{SITZUNGSTITEL}}, {{GREMIUM}}, {{DATUM}}, {{BEGINN}}, {{ORT}}, {{SITZUNGSLEITUNG}}"}. Datum, Beginn, Ort und Sitzungsleitung werden auch in gleichnamige einfache Inhaltssteuerelemente eingetragen. Inhaltsverzeichnisse und Seitenfelder werden beim Öffnen in Word aktualisiert.</p>
    </MeetingActionForm>}
    {name&&<MeetingActionForm action={removeWordTemplateAction.bind(null,areaId)} submit="Wordvorlage entfernen"><input type="hidden" name="revision" value={revision}/><p className="text-sm text-slate-500">Ohne Vorlage wird der Wordexport für diesen Bereich ausgeblendet.</p></MeetingActionForm>}
  </div>;
}

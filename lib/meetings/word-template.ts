// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { zip, unzipOffice } from "@/lib/zip";
import { agendaSections, agendaSectionLabels, type AgendaSettings, type AgendaSection } from "./agenda";
import { wordStyleRoles, type MeetingWordConfiguration, type WordStyleMapping, type WordTemplateInfo } from "./word-template-types";

const WORD_NS="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DOCX_TYPE="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const DOTX_TYPE="application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
const meta=XMLParser.getMetaDataSymbol() as symbol;
type Node=Record<string,unknown>;
type Part={xml:string;nodes:Node[];positions:number[]};
type Patch={start:number;end:number;text:string};
const local=(name:string)=>name.replace(/^.*:/,"");
const tag=(node:Node)=>Object.keys(node).find(key=>key!==":@"&&!key.startsWith("#"))??"";
const children=(node:Node):Node[]=>Array.isArray(node[tag(node)])?node[tag(node)] as Node[]:[];
const find=(node:Node,name:string)=>children(node).find(child=>local(tag(child))===name);
const attr=(node:Node|undefined,name:string):string=>node?String(Object.entries((node[":@"]??{}) as Record<string,unknown>).find(([key])=>local(key.replace(/^@_/,""))===name)?.[1]??""):"";
function descendants(node:Node,name:string):Node[]{return children(node).flatMap(child=>[...(local(tag(child))===name?[child]:[]),...descendants(child,name)]);}
const text=(node:Node):string=>local(tag(node))==="t"?children(node).map(child=>String(child["#text"]??"")).join(""):descendants(node,"t").map(text).join("");
export const wordXmlEscape=(value:string)=>value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
function parse(xml:string):Part{
  if(xml.length>8*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error("Ungültige Word-XML-Struktur.");
  // The parser normalizes CRLF; translate its offsets back to the unmodified source.
  const positions:number[]=[];let normalized=0;
  for(let i=0;i<xml.length;i++){positions[normalized++]=i;if(xml[i]==="\r"&&xml[i+1]==="\n")i++;}positions[normalized]=xml.length;
  const nodes=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,captureMetaData:true,processEntities:true,maxNestedTags:100}).parse(xml) as Node[];
  return {xml,nodes,positions};
}
function bounds(part:Part,node:Node){const data=(node as unknown as Record<symbol,{startIndex:number;endIndex:number}>)[meta];if(!data)throw new Error("Word-Element nicht lesbar.");return {start:part.positions[data.startIndex],end:part.positions[data.endIndex]};}
function raw(part:Part,node:Node){const {start,end}=bounds(part,node);return part.xml.slice(start,end);}
function patch(part:Part,patches:Patch[]):string{
  let result=part.xml,last=part.xml.length;
  for(const change of patches.sort((a,b)=>b.start-a.start)){if(change.end>last||change.start>change.end)throw new Error("Überlappende Word-Ersetzungsbereiche.");result=result.slice(0,change.start)+change.text+result.slice(change.end);last=change.start;}
  return result;
}
const root=(part:Part,name:string)=>part.nodes.find(node=>local(tag(node))===name);
function mainBody(part:Part){const document=root(part,"document"),body=document&&find(document,"body");if(!body)throw new Error("Die Vorlage enthält keinen Word-Dokumentkörper.");return body;}
function paragraphStyle(node:Node){const props=find(node,"pPr");return attr(props&&find(props,"pStyle"),"val");}
function partText(files:{name:string;data:Buffer}[],name:string){const file=files.find(file=>file.name===name);if(!file)throw new Error(`Vorlagenbestandteil fehlt: ${name}`);return file.data.toString("utf8");}
function load(buffer:Buffer){
  const files=unzipOffice(buffer);
  if(files.some(file=>/vbaProject|_xmlsignatures\//i.test(file.name)))throw new Error("Bitte eine unsignierte Wordvorlage ohne Makros verwenden.");
  const types=partText(files,"[Content_Types].xml"),typePart=parse(types),mainTypes=children(root(typePart,"Types")??{}).filter(node=>local(tag(node))==="Override"&&attr(node,"PartName")==="/word/document.xml");
  if(mainTypes.length!==1||![DOCX_TYPE,DOTX_TYPE].includes(attr(mainTypes[0],"ContentType")))throw new Error("Bitte eine DOCX- oder DOTX-Vorlage verwenden.");
  const document=parse(partText(files,"word/document.xml")),styles=parse(partText(files,"word/styles.xml"));
  if(!document.xml.includes(WORD_NS))throw new Error("Dieses Word-Format wird nicht unterstützt. Bitte als DOCX oder DOTX speichern.");
  if(!styleNodes(styles).some(node=>attr(node,"type")==="paragraph"))throw new Error("Die Vorlage enthält keine zuordenbaren Absatzformatvorlagen.");
  // Validate all XML without ever fetching external entities or relationships.
  for(const file of files)if(/\.(xml|rels)$/.test(file.name))parse(file.data.toString("utf8"));
  return {files,types,document,styles};
}
function styleNodes(part:Part){return children(root(part,"styles")??{}).filter(node=>local(tag(node))==="style");}
function chooseStyles(styles:Part):WordStyleMapping{
  const nodes=styleNodes(styles).filter(node=>attr(node,"type")==="paragraph");
  const pick=(candidates:string[],fallback:string)=>candidates.map(candidate=>nodes.find(node=>attr(node,"styleId")===candidate||attr(find(node,"name"),"val")===candidate)).find(Boolean)??nodes.find(node=>attr(node,"styleId")===fallback)??nodes[0];
  const body=attr(nodes.find(node=>attr(node,"default")==="1")??pick(["Standard","Normal"],""),"styleId");
  return {
    body,section:attr(pick(["Bereich","Heading1","berschrift1","heading 1"],body),"styleId"),
    publicTopic:attr(pick(["TOP1","TOP 1","Heading1","berschrift1","heading 1"],body),"styleId"),
    publicSubtopic:attr(pick(["TOP2","TOP 2","Heading2","berschrift2","heading 2"],body),"styleId"),
    nonPublicTopic:attr(pick(["NTOP1","NÖ TOP 1","TOP1","TOP 1","Heading1","berschrift1"],body),"styleId"),
    nonPublicSubtopic:attr(pick(["NTOP2","NÖ TOP 2","TOP2","TOP 2","Heading2","berschrift2"],body),"styleId"),
  };
}
export function inspectWordTemplate(buffer:Buffer):WordTemplateInfo{
  const source=load(buffer),body=children(mainBody(source.document)).filter(node=>tag(node)),styles=chooseStyles(source.styles);
  const topicStyles=new Set([styles.publicTopic,styles.publicSubtopic,styles.nonPublicTopic,styles.nonPublicSubtopic].filter(id=>id!==styles.body));
  const first=body.findIndex(node=>local(tag(node))==="p"&&topicStyles.has(paragraphStyle(node)));
  let last=first;
  for(let i=first;i>=0&&i<body.length;i++)if(topicStyles.has(paragraphStyle(body[i])))last=i;
  let end=Math.max(0,last+1);
  while(end<body.length&&local(tag(body[end]))==="p"&&!descendants(body[end],"bookmarkStart").some(node=>["Ende","GREMIO_AGENDA_END"].includes(attr(node,"name"))))end++;
  const start=first>0&&paragraphStyle(body[first-1])===styles.section?first-1:first;
  const hasPlaceholder=body.some(node=>local(tag(node))==="p"&&text(node).trim()==="{{TAGESORDNUNG}}");
  return {styles:styleNodes(source.styles).filter(node=>attr(node,"type")==="paragraph").map(node=>({id:attr(node,"styleId"),name:attr(find(node,"name"),"val")||attr(node,"styleId")})),
    blocks:body.filter(node=>local(tag(node))!=="sectPr").map(node=>({index:body.indexOf(node),label:`${body.indexOf(node)+1}: ${local(tag(node))==="tbl"?"Tabelle – ":""}${text(node).trim().slice(0,110)||"Leerer Absatz / Abschnittswechsel"}`})),hasPlaceholder,
    configuration:{styles,insertion:hasPlaceholder?"placeholder":first>=0?"replace":"append",start:Math.max(0,start),end},};
}
function validateReplacementBoundary(blocks:Node[],start:number,end:number){
  let depth=0;const depths=[0],markers=new Map<string,{start?:number;end?:number}>();
  for(const [index,block] of blocks.entries()){
    for(const field of descendants(block,"fldChar")){
      const type=attr(field,"fldCharType");if(type==="begin")depth++;else if(type==="end")depth--;
      if(depth<0)throw new Error("Die Vorlage enthält ein unvollständiges Wordfeld.");
    }
    depths.push(depth);
    for(const kind of ["bookmark","commentRange"]){
      for(const suffix of ["Start","End"]){
        for(const node of descendants(block,kind+suffix)){const key=`${kind}:${attr(node,"id")}`,entry=markers.get(key)??{};entry[suffix==="Start"?"start":"end"]=index;markers.set(key,entry);}
      }
    }
  }
  const inside=(index:number)=>index>=start&&index<end;
  if(depth!==0||depths[start]!==0||depths[end]!==0||[...markers.values()].some(marker=>marker.start!==undefined&&marker.end!==undefined&&inside(marker.start)!==inside(marker.end)))throw new Error("Der Musterbereich darf Textmarken, Kommentare oder Wordfelder nicht zerschneiden. Bitte den Bereich erweitern oder einen eigenen Platzhalter verwenden.");
}
export function validateWordConfiguration(buffer:Buffer,configuration:MeetingWordConfiguration){
  const info=inspectWordTemplate(buffer);
  if(!configuration||!configuration.styles||Object.keys(wordStyleRoles).some(role=>!info.styles.some(style=>style.id===configuration.styles[role as keyof WordStyleMapping])))throw new Error("Bitte jeder Rolle eine vorhandene Absatzformatvorlage zuordnen.");
  if(!["replace","placeholder","append"].includes(configuration.insertion))throw new Error("Bitte eine gültige Einfügeposition wählen.");
  if(configuration.insertion==="placeholder"&&!info.hasPlaceholder)throw new Error("Der Platzhalter {{TAGESORDNUNG}} muss allein in einem Absatz stehen.");
  if(configuration.insertion==="replace"&&(!Number.isInteger(configuration.start)||!Number.isInteger(configuration.end)||configuration.start<0||configuration.end<=configuration.start||configuration.end>info.blocks.length))throw new Error("Bitte einen gültigen Musterbereich wählen (Ende ist das erste zu erhaltende Element).");
  const source=load(buffer),blocks=children(mainBody(source.document)).filter(node=>tag(node));
  if(configuration.insertion==="replace")validateReplacementBoundary(blocks,configuration.start,configuration.end);
  if(configuration.insertion==="placeholder"){
    const indexes=blocks.flatMap((node,index)=>local(tag(node))==="p"&&text(node).trim()==="{{TAGESORDNUNG}}"?[index]:[]);
    if(indexes.length!==1||descendants(blocks[indexes[0]],"sdt").length||descendants(blocks[indexes[0]],"sectPr").length)throw new Error("Bitte genau einen einfachen Platzhalterabsatz ohne Inhaltssteuerelement oder Abschnittswechsel verwenden.");
    validateReplacementBoundary(blocks,indexes[0],indexes[0]+1);
  }
  return configuration;
}

export type WordExportLine=string|{text:string;href?:string;bold?:boolean};
export type WordExportTopic={id:number;parentId:number|null;section:AgendaSection;number:string;title:string;lines:WordExportLine[]};
export type WordExportContent={topics:WordExportTopic[];settings:AgendaSettings;values:Record<string,string>};
function ensureWordPrefix(xml:string,element:string){
  return xml.replace(new RegExp(`<([\\w]+:)?${element}\\b[^>]*>`),opening=>{
    const name=opening.match(/^<([^\s/>]+)/)![1];
    if(!/xmlns:w=/.test(opening))opening=opening.replace(/\/?>$/,ending=>` xmlns:w="${WORD_NS}"${ending}`);
    return opening.endsWith("/>")?opening.slice(0,-2)+`></${name}>`:opening;
  });
}
function paragraph(style:string,value:string,props="",bookmark?:{id:number;name:string},link?:{id:string;style:string},bold=false){
  const run=`<w:r>${link||bold?`<w:rPr>${link?(link.style?`<w:rStyle w:val="${wordXmlEscape(link.style)}"/>`:'<w:u w:val="single"/>'):""}${bold?'<w:b w:val="1"/><w:bCs w:val="1"/>':""}</w:rPr>`:""}<w:t xml:space="preserve">${wordXmlEscape(value)}</w:t></w:r>`;
  const content=link?`<w:hyperlink r:id="${link.id}" w:history="1">${run}</w:hyperlink>`:run;
  return `<w:p><w:pPr><w:pStyle w:val="${wordXmlEscape(style)}"/>${props}</w:pPr>${bookmark?`<w:bookmarkStart w:id="${bookmark.id}" w:name="${bookmark.name}"/>`:""}${content}${bookmark?`<w:bookmarkEnd w:id="${bookmark.id}"/>`:""}</w:p>`;
}
/** Derive numbering geometry from the actual mapped styles; never modify their definitions. */
function numbering(source:ReturnType<typeof load>,mapping:WordStyleMapping,settings:AgendaSettings){
  let xml=source.files.find(file=>file.name==="word/numbering.xml")?.data.toString("utf8")??`<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="${WORD_NS}"></w:numbering>`;
  xml=ensureWordPrefix(xml,"numbering");const part=parse(xml),nodes=children(root(part,"numbering")??{}),styles=styleNodes(source.styles);
  const effective=(id:string,seen=new Set<string>()):{numId:string;level:number}|null=>{
    if(seen.has(id))return null;seen.add(id);const node=styles.find(s=>attr(s,"styleId")===id);if(!node)return null;
    const props=find(node,"pPr"),num=props&&find(props,"numPr"),numId=num&&attr(find(num,"numId"),"val");
    if(numId&&numId!=="0")return {numId,level:Number(attr(find(num!,"ilvl"),"val")||0)};
    const parent=attr(find(node,"basedOn"),"val");return parent?effective(parent,seen):null;
  };
  const level=(style:string,seen=new Set<string>()):Node|undefined=>{
    if(seen.has(style))return;seen.add(style);const info=effective(style);if(!info)return;
    const instance=nodes.find(node=>local(tag(node))==="num"&&attr(node,"numId")===info.numId),aid=instance&&attr(find(instance,"abstractNumId"),"val");
    const abstract=nodes.find(node=>local(tag(node))==="abstractNum"&&attr(node,"abstractNumId")===aid);
    if(!abstract)return;const direct=children(abstract).find(node=>local(tag(node))==="lvl"&&Number(attr(node,"ilvl"))===info.level);
    if(direct)return direct;const link=attr(find(abstract,"numStyleLink"),"val");return link?level(link,seen):undefined;
  };
  let abstractId=Math.max(0,...nodes.filter(n=>local(tag(n))==="abstractNum").map(n=>Number(attr(n,"abstractNumId"))))+1;
  let numId=Math.max(0,...nodes.filter(n=>local(tag(n))==="num").map(n=>Number(attr(n,"numId"))))+1;
  const ids={} as Record<AgendaSection,number>,abstracts:string[]=[],instances:string[]=[];
  for(const section of agendaSections(settings).filter(section=>section!=="opening")){
    const roles=section==="public"?[mapping.publicTopic,mapping.publicSubtopic]:[mapping.nonPublicTopic,mapping.nonPublicSubtopic];
    const format=(section==="public"?settings.publicNumbering??"arabic":settings.nonPublicNumbering??"roman")==="roman"?"upperRoman":"decimal";
    const levels=roles.map((style,index)=>{
      const original=level(style),props=original&&find(original,"pPr"),run=original&&find(original,"rPr");
      // Preserve list indents/tabs/fonts, while the configured numbering controls labels.
      return `<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="${index===0?format:"decimal"}"/><w:pStyle w:val="${wordXmlEscape(style)}"/><w:lvlText w:val="${index===0?"%1":"%1.%2"}"/><w:lvlJc w:val="left"/>${props?raw(part,props):""}${run?raw(part,run):""}</w:lvl>`;
    }).join("");
    abstracts.push(`<w:abstractNum w:abstractNumId="${abstractId}"><w:multiLevelType w:val="multilevel"/>${levels}</w:abstractNum>`);
    instances.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${abstractId}"/></w:num>`);ids[section]=numId++;abstractId++;
  }
  const firstNum=nodes.find(node=>local(tag(node))==="num"),closing=xml.lastIndexOf("</");
  xml=patch(part,firstNum?[{start:bounds(part,firstNum).start,end:bounds(part,firstNum).start,text:abstracts.join("")},{start:closing,end:closing,text:instances.join("")}]:[{start:closing,end:closing,text:abstracts.join("")+instances.join("")}]);
  ids.opening=ids.public;
  return {xml,ids};
}
function fillMetadata(xml:string,values:Record<string,string>){
  const part=parse(xml),patches:Patch[]=[];const document=root(part,"document");if(!document)return xml;
  const aliases:Record<string,string>={Ort:"ORT",Datum:"DATUM",Beginn:"BEGINN",Sitzungsleitung:"SITZUNGSLEITUNG",Sitzungstitel:"SITZUNGSTITEL",Gremium:"GREMIUM"};
  const filled=new Set<Node>();
  for(const control of descendants(document,"sdt")){
    const props=find(control,"sdtPr"),content=find(control,"sdtContent"),alias=props&&attr(find(props,"alias"),"val");
    const key=alias&&aliases[alias],value=key&&values[key];
    if(!props||!content||!value||find(props,"dataBinding")||(!find(props,"text")&&!find(props,"date")))continue;
    const texts=descendants(content,"t");if(!texts.length)continue;
    for(const [index,node] of texts.entries()){filled.add(node);const b=bounds(part,node),original=raw(part,node);patches.push({...b,text:original.replace(/>[^]*<\//,()=>`>${index===0?wordXmlEscape(value):""}</`)});}
    const showing=find(props,"showingPlcHdr");if(showing){
      patches.push({...bounds(part,showing),text:""});
      for(const style of descendants(content,"rStyle"))if(/placeholder|platzhalter/i.test(attr(style,"val")))patches.push({...bounds(part,style),text:""});
    }
    const date=find(props,"date");if(date&&values.ISO_DATUM){const dateXml=raw(part,date),value=wordXmlEscape(values.ISO_DATUM);const opening=/\b(?:\w+:)?fullDate=/.test(dateXml)?dateXml.replace(/\b(?:\w+:)?fullDate="[^"]*"/,()=>`w:fullDate="${value}"`):dateXml.replace(/<[^>]+/,first=>first+` w:fullDate="${value}"`);patches.push({...bounds(part,date),text:opening});}
  }
  for(const node of descendants(document,"p")){
    const texts=descendants(node,"t").filter(t=>!filled.has(t));if(!texts.length)continue;
    const joined=texts.map(text).join("");
    if(!/\{\{(?:SITZUNGSTITEL|GREMIUM|DATUM|BEGINN|ORT|SITZUNGSLEITUNG)\}\}/.test(joined))continue;
    // Patch only text nodes; runs, formatting, controls and surrounding markup survive.
    const matches=[...joined.matchAll(/\{\{(SITZUNGSTITEL|GREMIUM|DATUM|BEGINN|ORT|SITZUNGSLEITUNG)\}\}/g)];
    let offset=0;const ranges=texts.map(t=>{const start=offset;offset+=text(t).length;return {node:t,start,end:offset,value:text(t)};});
    for(const match of matches.reverse()){
      const start=match.index!,end=start+match[0].length;
      for(const range of ranges){if(range.end<=start||range.start>=end)continue;range.value=range.value.slice(0,Math.max(0,start-range.start))+(range.start<=start?values[match[1]]??"":"")+range.value.slice(Math.min(range.value.length,end-range.start));}
    }
    for(const range of ranges)patches.push({...bounds(part,range.node),text:raw(part,range.node).replace(/>[^]*<\//,()=>`>${wordXmlEscape(range.value)}</`)});
  }
  return patch(part,patches);
}
/** Resolve linked headers/footers before sections move, so their appearance cannot depend on the new predecessor. */
function sectionProperties(part:Part){
  const inherited=new Map<string,{kind:string;xml:string}>(),result=new Map<Node,string>();
  for(const section of descendants(root(part,"document")!,"sectPr")){
    const references=children(section).filter(node=>["headerReference","footerReference"].includes(local(tag(node))));
    for(const reference of references){const kind=local(tag(reference));inherited.set(`${kind}:${attr(reference,"type")}`,{kind,xml:raw(part,reference)});}
    const original=raw(part,section),base=bounds(part,section).start;
    let remaining=original;
    for(const reference of [...references].reverse()){const b=bounds(part,reference);remaining=remaining.slice(0,b.start-base)+remaining.slice(b.end-base);}
    const ordered=[...inherited.values()].sort((a,b)=>(a.kind==="headerReference"?0:1)-(b.kind==="headerReference"?0:1));
    const opening=remaining.indexOf(">")+1;
    result.set(section,remaining.slice(0,opening)+ordered.map(ref=>ref.xml).join("")+remaining.slice(opening));
  }
  return result;
}
/** Patch only the document body, numbering and field-refresh flag; opaque package parts stay byte-identical. */
export function buildWordFromTemplate(buffer:Buffer,configuration:MeetingWordConfiguration,content:WordExportContent):Buffer{
  validateWordConfiguration(buffer,configuration);const source=load(buffer),mapping=configuration.styles;
  source.document=parse(ensureWordPrefix(source.document.xml,"document"));
  const part=source.document,body=mainBody(part),blocks=children(body).filter(node=>tag(node)),patches:Patch[]=[],nums=numbering(source,mapping,content.settings);
  let bookmarkId=Math.max(0,...descendants(root(part,"document")!,"bookmarkStart").map(node=>Number(attr(node,"id"))||0))+1;
  const prefix=`Gremio${bookmarkId}_`,bookmarks=new Map<number,{id:number;name:string}>();
  for(const topic of content.topics)bookmarks.set(topic.id,{id:bookmarkId++,name:`${prefix}TOP${topic.id}`});
  const relPart=parse(partText(source.files,"word/_rels/document.xml.rels")),relRoot=root(relPart,"Relationships")!;
  const usedIds=new Set(children(relRoot).map(node=>attr(node,"Id"))),hyperlinks=new Map<string,string>();
  const hyperlinkStyle=attr(styleNodes(source.styles).find(node=>attr(node,"type")==="character"&&/^(hyperlink|internet link)$/i.test(attr(find(node,"name"),"val"))),"styleId");
  function cardLink(href:string){
    const url=new URL(href);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error("Ungültiger Kartenlink.");
    const target=url.href;let id=hyperlinks.get(target);
    if(!id){id=`gremioCard${hyperlinks.size+1}`;while(usedIds.has(id))id+="x";usedIds.add(id);hyperlinks.set(target,id);}return id;
  }
  const sectionContent=(section:AgendaSection)=>{
    let xml=section==="opening"?"":paragraph(mapping.section,agendaSectionLabels[section],'<w:keepNext/><w:numPr><w:numId w:val="0"/></w:numPr><w:outlineLvl w:val="0"/>');
    const topics=content.topics.filter(topic=>topic.section===section);
    if(!topics.length&&section!=="opening")xml+=paragraph(mapping.body,"Keine TOPs in diesem Bereich eingeplant.");
    for(const topic of topics){
      const child=topic.parentId!=null,style=section!=="non_public"?(child?mapping.publicSubtopic:mapping.publicTopic):(child?mapping.nonPublicSubtopic:mapping.nonPublicTopic);
      xml+=paragraph(style,topic.title,`<w:keepNext/><w:numPr><w:ilvl w:val="${child?1:0}"/><w:numId w:val="${nums.ids[section]}"/></w:numPr><w:outlineLvl w:val="${child?1:0}"/>`,bookmarks.get(topic.id));
      for(const line of topic.lines){
        if(typeof line==="string")for(const paragraphText of line.split(/\r?\n/))xml+=paragraph(mapping.body,paragraphText);
        else for(const paragraphText of line.text.split(/\r?\n/))xml+=paragraph(mapping.body,paragraphText,"",undefined,line.href?{id:cardLink(line.href),style:hyperlinkStyle}:undefined,line.bold);
      }
    }
    return xml;
  };
  let start:number,end:number;
  if(configuration.insertion==="placeholder"){
    const placeholders=blocks.filter(node=>local(tag(node))==="p"&&text(node).trim()==="{{TAGESORDNUNG}}");
    if(placeholders.length!==1||descendants(placeholders[0],"sectPr").length)throw new Error("Bitte genau einen Platzhalterabsatz ohne Abschnittswechsel verwenden.");
    ({start,end}=bounds(part,placeholders[0]));patches.push({start,end,text:agendaSections(content.settings).map(sectionContent).join("")});
  }else if(configuration.insertion==="append"){
    const section=blocks.find(node=>local(tag(node))==="sectPr");const at=section?bounds(part,section).start:part.xml.lastIndexOf("</",bounds(part,body).end-1);start=at;end=at;patches.push({start,end,text:agendaSections(content.settings).map(sectionContent).join("")});
  }else{
    const selected=blocks.slice(configuration.start,configuration.end);start=bounds(part,selected[0]).start;end=bounds(part,selected.at(-1)!).end;
    const breaks=selected.flatMap(node=>descendants(node,"sectPr").map(section=>({node,section})));
    const terminal=blocks.find(node=>local(tag(node))==="sectPr");
    let replacement="";
    if(breaks.length===0){replacement+=agendaSections(content.settings).map(sectionContent).join("");}
    else{
      // Section properties belong to the preceding content. Retain front matter and
      // move the existing public/nonpublic page systems with their semantic section.
      if(breaks.length!==2||!terminal)throw new Error("Der Musterbereich enthält eine komplexe Abschnittsstruktur. Bitte einen einzelnen Platzhalterabsatz in einer vorbereiteten Vorlage verwenden.");
      const first=breaks[0],second=breaks[1];
      const between=blocks.slice(blocks.indexOf(first.node)+1,blocks.indexOf(second.node));
      const originals=new Set(between.map(text).map(value=>value.replace(/\s+/g," ").trim()).filter(value=>value===agendaSectionLabels.public||value===agendaSectionLabels.non_public));
      if(originals.size!==1)throw new Error("Die Seitenabschnitte können keinem Tagesordnungsbereich sicher zugeordnet werden. Bitte einen Platzhalter verwenden.");
      const middleIsNonPublic=originals.has(agendaSectionLabels.non_public);
      const resolved=sectionProperties(part);
      const sectionProps={public:resolved.get(middleIsNonPublic?terminal:second.section)!,non_public:resolved.get(middleIsNonPublic?second.section:terminal)!};
      const order=agendaSections(content.settings).filter(section=>section!=="opening");
      replacement=sectionContent("opening")+raw(part,first.node)+sectionContent(order[0])+`<w:p><w:pPr>${sectionProps[order[0]]}</w:pPr></w:p>`+sectionContent(order[1]);
      patches.push({...bounds(part,terminal),text:sectionProps[order[1]]});
    }
    patches.push({start,end,text:replacement});
  }
  // Replace cached TOC entries as well: never ship stale sample TOPs or page references.
  let fieldDepth=0,tocStart:Node|undefined;
  for(const node of blocks){
    const begin=bounds(part,node).start;
    if(begin>=start&&begin<end)continue;
    for(const field of descendants(node,"fldChar")){
      if(attr(field,"fldCharType")==="begin")fieldDepth++;
      else if(attr(field,"fldCharType")==="end")fieldDepth--;
    }
    if(descendants(node,"instrText").some(instruction=>children(instruction).some(t=>/^TOC\s/.test(String(t["#text"]??"").trim())&&!/\\[caf]\b/.test(String(t["#text"]??"")))))tocStart=node;
    if(tocStart&&fieldDepth===0){
      const field='<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
      const tocStyles=styleNodes(source.styles);
      const tocStyle=(level:number)=>attr(tocStyles.find(style=>attr(find(style,"name"),"val").toLowerCase()===`toc ${level}`),"styleId")||mapping.body;
      const entries=agendaSections(content.settings).flatMap(section=>[
        ...(section==="opening"?[]:[{value:agendaSectionLabels[section],level:1,anchor:""}]),
        ...content.topics.filter(topic=>topic.section===section).map(topic=>({value:`${topic.number} ${topic.title}`,level:topic.parentId==null?1:2,anchor:bookmarks.get(topic.id)!.name})),
      ]);
      const cache=entries.map((entry,index)=>`<w:p><w:pPr><w:pStyle w:val="${wordXmlEscape(tocStyle(entry.level))}"/></w:pPr>${index===0?field:""}${entry.anchor?`<w:hyperlink w:anchor="${entry.anchor}">`:""}<w:r><w:t>${wordXmlEscape(entry.value)}</w:t></w:r>${entry.anchor?"</w:hyperlink>":""}${index===entries.length-1?'<w:r><w:fldChar w:fldCharType="end"/></w:r>':""}</w:p>`).join("");
      patches.push({start:bounds(part,tocStart).start,end:bounds(part,node).end,text:cache});tocStart=undefined;
    }
  }
  let document=fillMetadata(patch(part,patches),content.values);
  if(hyperlinks.size)document=document.replace(/<([\w]+:)?document\b[^>]*>/,opening=>/xmlns:r=/.test(opening)?opening:opening.slice(0,-1)+' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  parse(document);
  const files=source.files.map(file=>{
    if(file.name==="word/document.xml")return {...file,data:Buffer.from(document)};
    if(file.name==="[Content_Types].xml"){
      const types=source.types.replace(DOTX_TYPE,DOCX_TYPE);
      return {...file,data:Buffer.from(types)};
    }
    if(file.name==="word/numbering.xml")return {...file,data:Buffer.from(nums.xml)};
    if(file.name==="word/settings.xml"){
      const settings=ensureWordPrefix(file.data.toString("utf8"),"settings"),settingsPart=parse(settings),settingsRoot=root(settingsPart,"settings")!;
      const clean=patch(settingsPart,descendants(settingsRoot,"updateFields").map(node=>({...bounds(settingsPart,node),text:""})));
      return {...file,data:Buffer.from(clean.replace(/<\/[^>]*settings>/,'<w:updateFields w:val="false"/>$&'))};
    }
    return file;
  });
  function ensurePart(name:string,data:Buffer,contentType:string,relationshipType:string){
    if(!files.some(file=>file.name===name))files.push({name,data});
    const types=files.find(file=>file.name==="[Content_Types].xml")!,typeXml=types.data.toString("utf8"),typePart=parse(typeXml),typeRoot=root(typePart,"Types")!;
    const typePrefix=tag(typeRoot).includes(":")?tag(typeRoot).split(":")[0]+":":"";
    if(!children(typeRoot).some(node=>attr(node,"PartName")===`/${name}`))types.data=Buffer.from(typeXml.replace(/<\/[^>]*Types>/,()=>`<${typePrefix}Override PartName="/${name}" ContentType="${contentType}"/>`+typeXml.match(/<\/[^>]*Types>/)![0]));
    const rel=files.find(file=>file.name==="word/_rels/document.xml.rels");if(!rel)throw new Error("Word-Beziehungen fehlen.");
    const relXml=rel.data.toString("utf8"),relPart=parse(relXml),relRoot=root(relPart,"Relationships")!,rels=children(relRoot),relPrefix=tag(relRoot).includes(":")?tag(relRoot).split(":")[0]+":":"";
    if(!rels.some(node=>attr(node,"Type")===relationshipType)){
      const used=new Set(rels.map(node=>attr(node,"Id")));let id="gremio"+name.replace(/[^a-z]/gi,"");while(used.has(id))id+="x";
      rel.data=Buffer.from(relXml.replace(/<\/[^>]*Relationships>/,closing=>`<${relPrefix}Relationship Id="${id}" Type="${relationshipType}" Target="${name.slice(5)}"/>`+closing));
    }
  }
  ensurePart("word/numbering.xml",Buffer.from(nums.xml),"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml","http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering");
  ensurePart("word/settings.xml",Buffer.from(`<w:settings xmlns:w="${WORD_NS}"><w:updateFields w:val="false"/></w:settings>`),"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml","http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings");
  if(hyperlinks.size){
    const rel=files.find(file=>file.name==="word/_rels/document.xml.rels")!,prefix=tag(relRoot).includes(":")?tag(relRoot).split(":")[0]+":":"";
    const additions=[...hyperlinks].map(([target,id])=>`<${prefix}Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${wordXmlEscape(target)}" TargetMode="External"/>`).join("");
    rel.data=Buffer.from(rel.data.toString("utf8").replace(/<\/[^>]*Relationships>/,closing=>additions+closing));
  }
  // Verify the package we actually return, including every XML part and CRC.
  const output=zip(files);load(output);document="";return output;
}

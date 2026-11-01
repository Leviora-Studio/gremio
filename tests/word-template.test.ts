// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {XMLValidator} from "fast-xml-parser";
import {unzipOffice,zip} from "../lib/zip";
import {inspectWordTemplate,buildWordFromTemplate,validateWordConfiguration,type WordExportContent} from "../lib/meetings/word-template";
import {wordTemplateFixture} from "./word-template-fixture";
const content:WordExportContent={settings:{},values:{ORT:'Room <&> $&'},topics:[{id:1,parentId:null,section:'public',number:'1',title:'Public <&> topic',lines:['Description','Outcome']},{id:2,parentId:1,section:'public',number:'1.1',title:'Child topic',lines:[]},{id:3,parentId:null,section:'non_public',number:'I',title:'Confidential topic',lines:['Vertraulich']}]};
const xml=(bytes:Buffer,name='word/document.xml')=>unzipOffice(bytes).find(file=>file.name===name)!.data.toString('utf8');

test('Word export preserves opaque parts, uses real styles and numbering, and converts DOTX to DOCX',()=>{
 for(const numbering of [false,true])for(const lineEndings of [false,true]){
  const template=wordTemplateFixture({numbering,lineEndings}),info=inspectWordTemplate(template),before=unzipOffice(template),result=buildWordFromTemplate(template,info.configuration,content),after=unzipOffice(result);
  assert.equal(info.configuration.styles.publicTopic,'TOP1');assert.equal(info.configuration.styles.nonPublicTopic,'NTOP1');assert.equal(info.configuration.insertion,'placeholder');
  const changed=new Set(['word/document.xml','word/numbering.xml','word/settings.xml','[Content_Types].xml','word/_rels/document.xml.rels']);
  for(const file of before)if(!changed.has(file.name))assert.deepEqual(after.find(f=>f.name===file.name)?.data,file.data,file.name);
  for(const file of after)if(/\.(xml|rels)$/.test(file.name))assert.equal(XMLValidator.validate(file.data.toString('utf8')),true,file.name);
  const document=xml(result);assert.match(document,/w:pStyle w:val="TOP1"/);assert.match(document,/w:pStyle w:val="TOP2"/);assert.match(document,/w:pStyle w:val="NTOP1"/);
  assert.match(document,/Public &lt;&amp;&gt; topic/);assert.match(document,/Room &lt;&amp;&gt; \$&amp;/);assert.doesNotMatch(document,/TAGESORDNUNG/);assert.ok(document.indexOf('Public &lt;')<document.indexOf('Confidential topic'));
  assert.doesNotMatch(document,/>1 Public/,'no duplicate manual/automatic numbering');
  assert.match(xml(result,'word/numbering.xml'),/upperRoman/);assert.match(xml(result,'word/numbering.xml'),/w:lvlText w:val="%1.%2"/);
  assert.match(xml(result,'word/settings.xml'),/w:updateFields w:val="false"/);assert.doesNotMatch(xml(result,'[Content_Types].xml'),/template.main/);
  assert.match(xml(result,'word/_rels/document.xml.rels'),/numbering.xml/);
  assert.ok(document.includes('Signature'));assert.ok(document.includes('Keep this letterhead'));
 }
});
test('mapped sample block replacement keeps the following signature table and respects section order',()=>{
 const template=wordTemplateFixture({placeholder:false}),info=inspectWordTemplate(template);
 assert.equal(info.configuration.insertion,'replace');
 const result=buildWordFromTemplate(template,info.configuration,{...content,settings:{firstSection:'non_public',publicNumbering:'roman',nonPublicNumbering:'arabic'}});
 assert.doesNotMatch(xml(result),/Old sample/);assert.match(xml(result),/Signature/);assert.ok(xml(result).indexOf('Confidential topic')<xml(result).indexOf('Public &lt;'));
 assert.throws(()=>validateWordConfiguration(template,{...info.configuration,styles:{...info.configuration.styles,body:'missing'}}),/Absatzformatvorlage/);
 assert.throws(()=>validateWordConfiguration(template,{...info.configuration,end:0}),/Musterbereich/);
});
test('Word upload rejects broken archives, CRC mismatches, macros and DTDs',()=>{
 assert.throws(()=>inspectWordTemplate(Buffer.from('Not a zip')));
 const bytes=wordTemplateFixture();const corrupt=Buffer.from(bytes);corrupt[50]^=255;assert.throws(()=>inspectWordTemplate(corrupt));
 const files=unzipOffice(bytes);assert.throws(()=>inspectWordTemplate(zip([...files,{name:'word/vbaProject.bin',data:Buffer.from('macro')}])),/Makros/);
 assert.throws(()=>inspectWordTemplate(zip(files.map(f=>f.name==='customXml/item1.xml'?{...f,data:Buffer.from('<!DOCTYPE x [<!ENTITY ex SYSTEM "file:///etc/passwd">]><x>&ex;</x>')}:f))),/XML/);
 assert.throws(()=>inspectWordTemplate(zip([...files,{name:'../evil',data:Buffer.from('bad')}])),/ZIP/);
});
test('provided official DOTX replaces samples while preserving section geometry and every opaque part',{skip:!process.env.GREMIO_WORD_TEMPLATE_FIXTURE},async()=>{
 const template=await readFile(process.env.GREMIO_WORD_TEMPLATE_FIXTURE!),info=inspectWordTemplate(template);
 assert.equal(info.configuration.insertion,'replace');assert.equal(info.configuration.styles.publicTopic,'TOP1');assert.equal(info.configuration.styles.nonPublicSubtopic,'NTOP2');
 for(const firstSection of ['public','non_public'] as const){
  const result=buildWordFromTemplate(template,info.configuration,{...content,settings:{firstSection}}),before=unzipOffice(template),after=unzipOffice(result);
  for(const file of before)if(!['word/document.xml','word/numbering.xml','word/settings.xml','[Content_Types].xml'].includes(file.name))assert.deepEqual(after.find(f=>f.name===file.name)?.data,file.data,file.name);
  const document=xml(result);assert.doesNotMatch(document,/Begrüßung|Sachverhalt in ein bis drei|Titel des Tagesordnungspunkts|Toc243741/);assert.match(document,/Unterschrift Sitzungsleitung/);
  assert.equal((document.match(/<w:sectPr\b/g)||[]).length,(xml(template).match(/<w:sectPr\b/g)||[]).length);
  assert.equal(document.indexOf('Confidential topic')<document.indexOf('Public &lt;'),firstSection==='non_public');
 }
});

test('empty numbering/settings roots and missing settings are expanded without corrupting generic templates',()=>{
 const source=wordTemplateFixture();
 for(const missing of [false,true]){
  const files=unzipOffice(source).filter(f=>!missing||f.name!=="word/settings.xml").map(f=>f.name==="word/settings.xml"?{...f,data:Buffer.from('<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')}:f);
  files.push({name:"word/numbering.xml",data:Buffer.from('<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')});
  const template=zip(files),result=buildWordFromTemplate(template,inspectWordTemplate(template).configuration,content);
  assert.match(xml(result,'word/numbering.xml'),/w:abstractNum/);assert.match(xml(result,'word/settings.xml'),/w:updateFields/);
 }
});

test('replacement boundaries cannot split Word fields or bookmarks',()=>{
 const files=unzipOffice(wordTemplateFixture());
 for(const marker of ['field','bookmark']){
  const template=zip(files.map(file=>{
   if(file.name!=='word/document.xml')return file;
   const begin=marker==='field'?'<w:fldChar w:fldCharType="begin"/>':'<w:bookmarkStart w:id="90" w:name="Crossing"/>';
   const end=marker==='field'?'<w:fldChar w:fldCharType="end"/>':'<w:bookmarkEnd w:id="90"/>';
   let document=file.data.toString('utf8');
   document=marker==='field'?document.replace('<w:body>','<w:body><w:p><w:r>'+begin+'</w:r></w:p>'):document.replace('<w:p><w:r><w:rPr>','<w:p>'+begin+'<w:r><w:rPr>');
   document=document.replace('<w:tbl>',marker==='field'?'<w:p><w:r>'+end+'</w:r></w:p><w:tbl>':'<w:p>'+end+'</w:p><w:tbl>');
   return {...file,data:Buffer.from(document)};
  }));
  const info=inspectWordTemplate(template);assert.throws(()=>buildWordFromTemplate(template,info.configuration,content),/zerschneiden/);
 }
});

test('append insertion stays inside a document body without explicit section properties',()=>{
 const template=zip(unzipOffice(wordTemplateFixture()).map(file=>file.name==='word/document.xml'?{...file,data:Buffer.from(file.data.toString('utf8').replace(/<w:sectPr>[^]*?<\/w:sectPr>/,''))}:file));
 const info=inspectWordTemplate(template),result=buildWordFromTemplate(template,{...info.configuration,insertion:'append'},content),document=xml(result);
 assert.ok(document.indexOf('Confidential topic')<document.indexOf('</w:body>'));
});

test('Word export keeps the template title and uses actual hyperlink relationships for card links',()=>{
 const template=wordTemplateFixture(),info=inspectWordTemplate(template);
 const legacy={...info.configuration,styles:{...info.configuration.styles,title:"obsolete-unused-style"}};
 const href="https://gremio.example/intern/card/42?view=full&from=agenda";
 const result=buildWordFromTemplate(template,legacy,{...content,topics:[{...content.topics[0],lines:[{text:"Interne Karte: "+href,href},"Text with https://not-auto-linked.example"]}]}),document=xml(result),rels=xml(result,'word/_rels/document.xml.rels');
 assert.match(document,/Keep this letterhead/);assert.doesNotMatch(document,/w:pStyle w:val="Titel"/);assert.match(document,/<w:hyperlink r:id="gremioCard1"/);assert.match(rels,/TargetMode="External"/);assert.match(rels,/card\/42\?view=full&amp;from=agenda/);
 assert.doesNotMatch(rels,/not-auto-linked/);assert.doesNotMatch(document,/Beginn:|Sitzungsleitung:/);
 assert.throws(()=>buildWordFromTemplate(template,info.configuration,{...content,topics:[{...content.topics[0],lines:[{text:"bad",href:"javascript:alert(1)"}]}]}),/Kartenlink/);
});
test('opening topics precede both areas, share public numbering and stay before the first original section break',{skip:!process.env.GREMIO_WORD_TEMPLATE_FIXTURE},async()=>{
 const template=await readFile(process.env.GREMIO_WORD_TEMPLATE_FIXTURE!),info=inspectWordTemplate(template);
 const result=buildWordFromTemplate(template,info.configuration,{...content,settings:{firstSection:'non_public'},topics:[{id:9,parentId:null,section:'opening',number:'1',title:'Opening regularities',lines:[]},{...content.topics[0],number:'2'},content.topics[2]]}),document=xml(result);
 assert.ok(document.indexOf('Opening regularities')<document.indexOf('Confidential topic'));assert.ok(document.lastIndexOf('Opening regularities')<document.indexOf('<w:sectPr'));
 const opening=document.slice(document.lastIndexOf('Opening regularities')-250,document.lastIndexOf('Opening regularities'));
 assert.match(opening,/w:pStyle w:val="TOP1"/);
});

test('Word export disables automatic field recalculation even when a template enables it with another prefix',()=>{
 const files=unzipOffice(wordTemplateFixture()).map(file=>file.name==='word/settings.xml'?{...file,data:Buffer.from('<x:settings xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:updateFields x:val="true"/><x:compat/></x:settings>')}:file);
 const template=zip(files),output=buildWordFromTemplate(template,inspectWordTemplate(template).configuration,content),settings=xml(output,'word/settings.xml');
 assert.match(settings,/<w:updateFields w:val="false"\/>/);assert.doesNotMatch(settings,/<x:updateFields/);assert.match(settings,/<x:compat\/>/);
});

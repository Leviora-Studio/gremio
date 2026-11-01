// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import {zip} from "../lib/zip";
export function wordTemplateFixture({lineEndings=false,placeholder=true,numbering=false}:{lineEndings?:boolean;placeholder?:boolean;numbering?:boolean}={}){
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const files:Record<string,string>={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
 'word/document.xml':`<w:document xmlns:w="${ns}"><w:body>\r\n<w:p><w:r><w:t>Keep this letterhead</w:t></w:r></w:p>\r\n<w:p><w:r><w:t>{{ORT}}</w:t></w:r></w:p>\r\n${placeholder?'<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{{TAGES</w:t></w:r><w:r><w:t>ORDNUNG}}</w:t></w:r></w:p>':'<w:p><w:pPr><w:pStyle w:val="TOP1"/></w:pPr><w:r><w:t>Old sample</w:t></w:r></w:p><w:p><w:r><w:t>Old sample body</w:t></w:r></w:p>'}<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Signature</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
 'word/styles.xml':`<w:styles xmlns:w="${ns}"><w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>${['Titel','Bereich','TOP1','TOP2','NTOP1','NTOP2'].map(id=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="Standard"/>${numbering&&id==='TOP1'?'<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>':''}<w:rPr><w:color w:val="123456"/></w:rPr></w:style>`).join('')}</w:styles>`,
 'word/settings.xml':`<w:settings xmlns:w="${ns}"><w:compat/></w:settings>`,
 'word/header1.xml':`<w:hdr xmlns:w="${ns}"><w:p><w:r><w:t>Original header</w:t></w:r></w:p></w:hdr>`,
 'customXml/item1.xml':'<keep>Unchanged custom XML</keep>',
 };
 files['word/_rels/document.xml.rels']=files['word/_rels/document.xml.rels'].replace('</Relationships>','<Relationship Id="settings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>');
 files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>');
 if(numbering){
 files['word/_rels/document.xml.rels']=files['word/_rels/document.xml.rels'].replace('</Relationships>','<Relationship Id="numbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
 files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>','<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
 files['word/numbering.xml']=`<w:numbering xmlns:w="${ns}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/><w:pPr><w:ind w:left="432" w:hanging="432"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
 }
 return zip(Object.entries(files).map(([name,xml])=>({name,data:Buffer.from(lineEndings?xml:xml.replace(/\r\n/g,'\n'))})));
}

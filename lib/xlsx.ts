// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { deflateRawSync } from "node:zlib";

// Minimaler, abhängigkeitsfreier XLSX-Writer: mehrere Blätter, Spaltenbreiten,
// fette Kopfzeile, Euro-Format, sowie hervorgehobene Abschnitts- (gefüllt) und
// Summenzeilen (fett + Oberlinie). Eigener Code → im Standalone-Build immer
// mitgebündelt.

export type XlsxCell = string | number | null;
export type XlsxRowStyle = "section" | "total" | "top" | "sub";
export type XlsxRow = { cells: XlsxCell[]; style?: XlsxRowStyle };
export type XlsxColumn = { header: string; money?: boolean; width?: number };
export type XlsxSheet = {
  name: string;
  columns: XlsxColumn[];
  rows: XlsxRow[];
};

// --- CRC32 ------------------------------------------------------------------
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

function esc(s: string): string {
  return (
    s
      // In XML 1.0 illegale C0-Steuerzeichen (außer Tab 0x09, LF 0x0A, CR 0x0D)
      // entfernen, sonst lehnt Excel die erzeugte XLSX als beschädigt ab.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  );
}

function colRef(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetName(name: string, i: number): string {
  return name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || `Tabelle${i + 1}`;
}

// cellXfs-Indizes: 0 default | 1 fett(Kopf) | 2 Geld | 3 Abschnitt-Text
// | 4 Abschnitt-Geld | 5 Summe-Text | 6 Summe-Geld | 7 Oberpunkt-Text
// | 8 Oberpunkt-Geld. „sub" (Unterpunkt) = normal (Einrückung im Titel).
function cellStyle(
  isHeader: boolean,
  rowStyle: XlsxRowStyle | undefined,
  money: boolean,
): number {
  if (isHeader) return 1;
  if (rowStyle === "section") return money ? 4 : 3;
  if (rowStyle === "total") return money ? 6 : 5;
  if (rowStyle === "top") return money ? 8 : 7;
  return money ? 2 : 0;
}

function colsXml(columns: XlsxColumn[]): string {
  const cols = columns
    .map((c, i) =>
      c.width != null
        ? `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`
        : "",
    )
    .join("");
  return cols ? `<cols>${cols}</cols>` : "";
}

function sheetXml(sheet: XlsxSheet): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    colsXml(sheet.columns),
    "<sheetData>",
  ];
  const allRows: XlsxRow[] = [
    { cells: sheet.columns.map((c) => c.header) },
    ...sheet.rows,
  ];
  allRows.forEach((row, ri) => {
    const rnum = ri + 1;
    const isHeader = ri === 0;
    // Abschnitts-/Summenzeilen füllen alle Spalten (auch leere), damit
    // Hintergrund/Linie durchgehend wirken.
    const fillEmpty =
      isHeader ||
      row.style === "section" ||
      row.style === "total" ||
      row.style === "top";
    out.push(`<row r="${rnum}">`);
    sheet.columns.forEach((col, ci) => {
      const v = row.cells[ci];
      const ref = colRef(ci) + rnum;
      const s = cellStyle(isHeader, row.style, !!col.money);
      const sAttr = s ? ` s="${s}"` : "";
      if (v == null || v === "") {
        if (fillEmpty && s) out.push(`<c r="${ref}"${sAttr}/>`);
        return;
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        out.push(`<c r="${ref}"${sAttr}><v>${v}</v></c>`);
      } else {
        out.push(
          `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`,
        );
      }
    });
    out.push("</row>");
  });
  out.push("</sheetData></worksheet>");
  return out.join("");
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor rgb="FFD9E1F2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF2FB"/><bgColor rgb="FFEDF2FB"/></patternFill></fill></fills>
<borders count="3"><border/><border><top style="thin"><color rgb="FF000000"/></top></border><border><left style="thin"><color rgb="FF9BA6B8"/></left><right style="thin"><color rgb="FF9BA6B8"/></right><top style="thin"><color rgb="FF9BA6B8"/></top></border></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="9">
<xf/>
<xf fontId="1" applyFont="1"/>
<xf numFmtId="164" applyNumberFormat="1"/>
<xf fontId="1" fillId="2" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="1" fillId="2" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf fontId="1" borderId="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" borderId="1" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf fontId="1" fillId="3" borderId="2" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="3" borderId="2" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const comp = deflateRawSync(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // date 1980-01-01
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
    cen.writeUInt16LE(0, 8);
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

export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const files: { name: string; data: Buffer }[] = [];
  const add = (name: string, content: string) =>
    files.push({ name, data: Buffer.from(content, "utf8") });

  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  add("xl/styles.xml", STYLES_XML);

  const sheetTags = sheets
    .map(
      (s, i) =>
        `<sheet name="${esc(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("");
  add(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`,
  );

  const rels =
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );

  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
  );

  return zip(files);
}

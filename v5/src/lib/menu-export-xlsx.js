/**
 * Menu export workbook (single sheet) in the Measured palette: title band,
 * meta line, header row, category bands, frozen header.
 */

import { strToU8, zipSync } from 'fflate';
import { cellValue } from './menu-exports.js';

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colRef(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const S = { title: 1, meta: 2, head: 3, group: 4, text: 5, money: 6, pct: 7, note: 8 };

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="&quot;£&quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/>
  </numFmts>
  <fonts count="6">
    <font><sz val="11"/><color rgb="FF18181B"/><name val="Outfit"/></font>
    <font><b/><sz val="22"/><color rgb="FF18181B"/><name val="Outfit"/></font>
    <font><sz val="10"/><color rgb="FF71717A"/><name val="Outfit"/></font>
    <font><b/><sz val="9"/><color rgb="FF71717A"/><name val="Outfit"/></font>
    <font><b/><sz val="13"/><color rgb="FF18181B"/><name val="Outfit"/></font>
    <font><sz val="9"/><color rgb="FF71717A"/><name val="Outfit"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4F4F5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFD4D4D8"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="medium"><color rgb="FF18181B"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"><alignment vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function text(ref, value, style) {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function number(ref, value, style) {
  return `<c r="${ref}" s="${style}"><v>${Math.round(Number(value) * 100) / 100}</v></c>`;
}

/**
 * @param {{ model, title: string, meta: string[], notes?: string[], sheetName?: string }} input
 * @returns {Uint8Array}
 */
export function buildMenuExportXlsx({ model, title, meta = [], notes = [], sheetName = 'Menu', orientation = 'portrait' }) {
  const cols = model.columns;
  const last = colRef(cols.length - 1);
  const out = [];
  const merges = [`A1:${last}1`, `A2:${last}2`];
  let r = 1;
  out.push(`<row r="1" ht="34" customHeight="1">${text('A1', title, S.title)}</row>`);
  out.push(`<row r="2" ht="18" customHeight="1">${text('A2', meta.filter(Boolean).join('   ·   '), S.meta)}</row>`);
  r = 4;
  const headRow = r;
  out.push(`<row r="${r}" ht="22" customHeight="1">${cols.map((c, i) => text(`${colRef(i)}${r}`, c.label.toUpperCase(), S.head)).join('')}</row>`);
  r += 1;
  model.groups.forEach((g) => {
    merges.push(`A${r}:${last}${r}`);
    out.push(`<row r="${r}" ht="24" customHeight="1">${text(`A${r}`, g.category, S.group)}</row>`);
    r += 1;
    g.rows.forEach((row) => {
      out.push(`<row r="${r}" ht="22" customHeight="1">${cols.map((c, i) => {
        const ref = `${colRef(i)}${r}`;
        const v = cellValue(row, c);
        if (v == null || v === '') return text(ref, '', S.text);
        if (c.money) return number(ref, v, S.money);
        if (c.pct) return number(ref, v, S.pct);
        return text(ref, v, S.text);
      }).join('')}</row>`);
      r += 1;
    });
  });
  r += 1;
  notes.filter(Boolean).forEach((n) => {
    merges.push(`A${r}:${last}${r}`);
    out.push(`<row r="${r}">${text(`A${r}`, n, S.note)}</row>`);
    r += 1;
  });

  const widths = cols.map((c) => (
    c.key === 'menuName' || c.key === 'productName' ? 36 : c.key === 'serve' ? 16 : c.key === 'abv' ? 12 : 14
  ));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
  <sheetData>${out.join('')}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>
  <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="${orientation === 'landscape' ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const safeSheet = xmlEscape(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Menu');
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(stylesXml),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }, { level: 6 });
}

import { strToU8, zipSync } from 'fflate';

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function textCell(ref, value, style = 0) {
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function numberCell(ref, value, style = 5) {
  return `<c r="${ref}" s="${style}"><v>${round2(value)}</v></c>`;
}

function reportGroups(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const category = row?.p?.category?.name || 'Uncategorised';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, products]) => ({
      category,
      products: products.slice().sort((a, b) =>
        (a?.p?.name || '').localeCompare(b?.p?.name || '')),
    }));
}

function worksheetXml(rows, eventName) {
  const groups = reportGroups(rows);
  const output = [];
  const merges = ['A1:E1', 'A2:E2'];
  let rowNumber = 1;

  output.push(`<row r="${rowNumber}" ht="28" customHeight="1">${textCell('A1', `${eventName || 'Event'} — Volume Report`, 1)}</row>`);
  rowNumber += 1;
  output.push(`<row r="${rowNumber}" ht="20" customHeight="1">${textCell('A2', 'Full product volumes: PLU, PLU with 5% uplift, and physical consumption', 2)}</row>`);
  rowNumber += 2;
  output.push(`<row r="${rowNumber}" ht="22" customHeight="1">${
    textCell(`A${rowNumber}`, 'Product', 3)
  }${textCell(`B${rowNumber}`, 'Case Size', 3)}${textCell(`C${rowNumber}`, 'PLU', 3)}${
    textCell(`D${rowNumber}`, 'PLU + 5%', 3)
  }${textCell(`E${rowNumber}`, 'Consumption', 3)}</row>`);
  rowNumber += 1;

  let grandPlu = 0;
  let grandConsumption = 0;

  for (const group of groups) {
    const categoryRow = rowNumber;
    merges.push(`A${categoryRow}:E${categoryRow}`);
    output.push(`<row r="${categoryRow}" ht="21" customHeight="1">${
      textCell(`A${categoryRow}`, `${group.category} (${group.products.length})`, 4)
    }</row>`);
    rowNumber += 1;

    let categoryPlu = 0;
    let categoryConsumption = 0;
    for (const row of group.products) {
      const plu = round2(row.plu);
      const consumption = round2(row.consumption);
      categoryPlu += plu;
      categoryConsumption += consumption;
      output.push(`<row r="${rowNumber}">${
        textCell(`A${rowNumber}`, row?.p?.name || 'Unnamed product', 5)
      }${textCell(`B${rowNumber}`, row?.p?.case_size || '', 5)}${
        numberCell(`C${rowNumber}`, plu)
      }${numberCell(`D${rowNumber}`, plu * 1.05)}${
        numberCell(`E${rowNumber}`, consumption)
      }</row>`);
      rowNumber += 1;
    }

    categoryPlu = round2(categoryPlu);
    categoryConsumption = round2(categoryConsumption);
    grandPlu += categoryPlu;
    grandConsumption += categoryConsumption;
    output.push(`<row r="${rowNumber}" ht="20" customHeight="1">${
      textCell(`A${rowNumber}`, `${group.category} total`, 6)
    }${textCell(`B${rowNumber}`, '', 6)}${numberCell(`C${rowNumber}`, categoryPlu, 6)}${
      numberCell(`D${rowNumber}`, categoryPlu * 1.05, 6)
    }${numberCell(`E${rowNumber}`, categoryConsumption, 6)}</row>`);
    rowNumber += 2;
  }

  grandPlu = round2(grandPlu);
  grandConsumption = round2(grandConsumption);
  output.push(`<row r="${rowNumber}" ht="24" customHeight="1">${
    textCell(`A${rowNumber}`, 'GRAND TOTAL', 7)
  }${textCell(`B${rowNumber}`, '', 7)}${numberCell(`C${rowNumber}`, grandPlu, 7)}${
    numberCell(`D${rowNumber}`, grandPlu * 1.05, 7)
  }${numberCell(`E${rowNumber}`, grandConsumption, 7)}</row>`);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="38" customWidth="1"/>
    <col min="2" max="2" width="20" customWidth="1"/>
    <col min="3" max="5" width="16" customWidth="1"/>
  </cols>
  <sheetData>${output.join('')}</sheetData>
  <mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Aptos"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
    <font><b/><sz val="11"/><name val="Aptos"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEDF2F7"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFD9E1E8"/></bottom><diagonal/></border>
    <border><left/><right/><top style="thin"><color rgb="FF9FB3C8"/></top><bottom style="thin"><color rgb="FF9FB3C8"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="4" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="4" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function buildVolumeReportXlsx(rows, eventName = 'Event') {
  const files = {
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
  <sheets><sheet name="Volume Report" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(stylesXml),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml(rows, eventName)),
  };
  return zipSync(files, { level: 6 });
}

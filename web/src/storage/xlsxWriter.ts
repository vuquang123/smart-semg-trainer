import { ZipWriter } from './zipWriter';

export type XlsxStyle =
  | 0 // default text
  | 1 // header
  | 2 // integer #,##0
  | 3 // decimal #,##0.0
  | 4 // decimal #,##0.00
  | 5 // percent 0.0%
  | 6 // datetime yyyy-mm-dd hh:mm:ss
  | 7 // wrapped text
  | 8 // warning / notice highlight
  | 9; // decimal 0.000

export type XlsxCell =
  | { type: 'string'; value: string; style?: XlsxStyle }
  | { type: 'number'; value: number; style?: XlsxStyle }
  | { type: 'date'; value: Date; style?: XlsxStyle }
  | { type: 'blank'; style?: XlsxStyle };

export type XlsxSheetSpec = {
  name: string;
  columns: number[];
  rows: XlsxCell[][];
  freezeHeader?: boolean;
  autoFilter?: boolean;
  autoFilterLastRow?: number;
};

export function strCell(value: string, style: XlsxStyle = 0): XlsxCell {
  return { type: 'string', value, style };
}

export function numCell(value: number | null | undefined, style: XlsxStyle = 3): XlsxCell {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { type: 'blank', style: 0 };
  }
  return { type: 'number', value, style };
}

export function dateCell(value: Date | null | undefined): XlsxCell {
  if (!value || Number.isNaN(value.getTime())) {
    return { type: 'blank', style: 0 };
  }
  return { type: 'date', value, style: 6 };
}

function sanitizeSheetName(raw: string): string {
  const cleaned = raw.replace(/[\\/*?:[\]]/g, ' ').trim() || 'Sheet';
  return cleaned.slice(0, 31);
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colRef(index: number): string {
  let n = index;
  let ref = '';
  while (n >= 0) {
    ref = String.fromCharCode((n % 26) + 65) + ref;
    n = Math.floor(n / 26) - 1;
  }
  return ref;
}

function dateToExcelSerial(date: Date): number {
  const localMs = date.getTime() - date.getTimezoneOffset() * 60000;
  return localMs / 86400000 + 25569;
}

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="6">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="#,##0.0"/>
    <numFmt numFmtId="166" formatCode="#,##0.00"/>
    <numFmt numFmtId="167" formatCode="0.0%"/>
    <numFmt numFmtId="168" formatCode="yyyy-mm-dd hh:mm:ss"/>
    <numFmt numFmtId="169" formatCode="0.000"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF1F5E49"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF7A5114"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF1E6"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFBF6E8"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE4D7"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="169" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function encodeWorksheetChunks(sheet: XlsxSheetSpec): Uint8Array[] {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let buf = '';
  const flush = () => {
    if (buf.length > 0) {
      chunks.push(encoder.encode(buf));
      buf = '';
    }
  };
  const push = (s: string) => {
    buf += s;
    if (buf.length >= 32768) flush();
  };

  const maxCols = Math.max(
    sheet.columns.length,
    sheet.rows.reduce((m, r) => Math.max(m, r.length), 1)
  );

  push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n');
  push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');

  if (sheet.freezeHeader) {
    push(
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    );
  } else {
    push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
  }

  if (sheet.columns.length > 0) {
    push('<cols>');
    for (let i = 0; i < sheet.columns.length; i++) {
      const w = Math.max(8, Math.min(80, sheet.columns[i] ?? 14));
      push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
    }
    push('</cols>');
  }

  push('<sheetData>');
  for (let rIdx = 0; rIdx < sheet.rows.length; rIdx++) {
    const row = sheet.rows[rIdx]!;
    const rNum = rIdx + 1;
    const isHeader = rIdx === 0;
    push(isHeader ? `<row r="${rNum}" ht="26" customHeight="1">` : `<row r="${rNum}">`);
    for (let cIdx = 0; cIdx < row.length; cIdx++) {
      const cell = row[cIdx]!;
      const ref = `${colRef(cIdx)}${rNum}`;
      const style = cell.style ?? 0;
      if (cell.type === 'blank') {
        if (style !== 0) push(`<c r="${ref}" s="${style}"/>`);
      } else if (cell.type === 'number') {
        push(`<c r="${ref}" t="n" s="${style}"><v>${cell.value}</v></c>`);
      } else if (cell.type === 'date') {
        push(`<c r="${ref}" t="n" s="${style}"><v>${dateToExcelSerial(cell.value)}</v></c>`);
      } else {
        push(`<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`);
      }
    }
    push('</row>');
  }
  push('</sheetData>');

  if (sheet.autoFilter && sheet.rows.length >= 1) {
    const lastRow = sheet.autoFilterLastRow ?? sheet.rows.length;
    push(`<autoFilter ref="A1:${colRef(maxCols - 1)}${Math.max(1, lastRow)}"/>`);
  }

  push('</worksheet>');
  flush();
  return chunks;
}

export async function buildXlsxWorkbook(sheets: XlsxSheetSpec[]): Promise<Uint8Array> {
  const safeSheets = sheets.map(s => ({ ...s, name: sanitizeSheetName(s.name) }));
  const zip = new ZipWriter();

  const sheetOverrides = safeSheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-officedocument.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetOverrides}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookSheets = safeSheets
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets}</sheets>
</workbook>`;

  const wbRelsList = [
    ...safeSheets.map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    ),
    `<Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  ].join('');

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${wbRelsList}
</Relationships>`;

  await zip.addEntry('[Content_Types].xml', contentTypes);
  await zip.addEntry('_rels/.rels', rootRels);
  await zip.addEntry('xl/workbook.xml', workbookXml);
  await zip.addEntry('xl/_rels/workbook.xml.rels', workbookRels);
  await zip.addEntry('xl/styles.xml', buildStylesXml());

  for (let i = 0; i < safeSheets.length; i++) {
    await zip.addEntry(`xl/worksheets/sheet${i + 1}.xml`, encodeWorksheetChunks(safeSheets[i]!));
  }

  return zip.build();
}

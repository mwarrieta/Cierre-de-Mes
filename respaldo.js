/* ===================================================================
   respaldo.js · genera el archivo de respaldo en el propio navegador
   El .xlsx se escribe a mano sobre JSZip: un xlsx es un ZIP con XML,
   y hacerlo así evita sumar 900 KB de librería a una app que tiene que
   abrir sin señal en una tablet.
   =================================================================== */
(function () {
const MESES_N = ['01-Enero','02-Febrero','03-Marzo','04-Abril','05-Mayo','06-Junio',
                 '07-Julio','08-Agosto','09-Septiembre','10-Octubre','11-Noviembre','12-Diciembre'];

const xmlEsc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c]));

function col(n) {                       // 1 -> A, 27 -> AA
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

// ---------- .xlsx escrito a mano ----------
function hojaXml(filas) {
  const lineas = filas.map((fila, i) => {
    const celdas = fila.map((v, j) => {
      const ref = col(j + 1) + (i + 1);
      if (v === null || v === undefined || v === '') return '';
      const estilo = i === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v))
        return `<c r="${ref}"${estilo}><v>${v}</v></c>`;
      return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${i + 1}">${celdas}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetData>${lineas}</sheetData></worksheet>`;
}

function construirExcel(hojas) {         // hojas: [{nombre, filas}]
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  const xl = zip.folder('xl');
  xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
${hojas.map((h, i) => `<sheet name="${xmlEsc(h.nombre).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}
</sheets></workbook>`);
  xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  xl.file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/></cellXfs>
</styleSheet>`);
  const ws = xl.folder('worksheets');
  hojas.forEach((h, i) => ws.file(`sheet${i + 1}.xml`, hojaXml(h.filas)));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

// ---------- nombres de carpeta y archivo seguros ----------
const limpio = s => String(s ?? 'sin-dato')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9 ._+-]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);

window.RESPALDO = { construirExcel, limpio, MESES_N, col };
})();

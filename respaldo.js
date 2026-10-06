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
// Una hoja puede ser una lista simple ({nombre, filas}), una portada ({portada: true,
// filas con celdas { v, fuente: 'grande'|'titulo'|'b'|'nota' }}) o una Tabla de Excel:
//   { nombre, filas, intro: [título, nota…], tabla: { nombre, franjas, totales: {etiqueta, desde} },
//     grafico: { titulo, desde, hasta } }
// filas[0] es el encabezado. Una celda puede ser un valor o { v, s: 'num'|'ent'|'pct'|'txt', oculto }.
// "oculto" deja el valor en la celda (el filtro lo sigue viendo) pero no lo muestra.
// Una fila con la propiedad .gris lleva fondo gris claro (franjas por bloque) y con
// .fuente = 'cons' su texto va en azul sobrio. Los números se muestran sin decimales
// (el valor guardado conserva sus decimales: las sumas no pierden precisión).
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TIPO = t => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`;

// Paleta: grises neutros. Franja muy clara, encabezado un poco más oscuro.
const GRIS = { franja: 'FFF5F5F5', cab: 'FFBFBFBF', tot: 'FFE7E7E7', linea: 'FF8C8C8C', texto: 'FF262626', nota: 'FF595959', barra: '7F7F7F', cons: 'FF1F5C99' };
const FMT = { gen: 0, num: 164, ent: 3, pct: 165, oculto: 166 };
const FUENTE = { n: 0, b: 1, titulo: 2, nota: 3, cons: 4, grande: 5 };
const RELLENO = { no: 0, franja: 2, cab: 3, tot: 4 };
const BORDE = { no: 0, cab: 1, tot: 2 };

// Registro de estilos: cada combinación usada se agrega una sola vez a cellXfs.
function registroEstilos() {
  const claves = ['gen|n|no|no', 'gen|b|no|no'];   // 0 normal · 1 negrita (listas simples)
  const idx = new Map(claves.map((k, i) => [k, i]));
  const de = (fmt = 'gen', fuente = 'n', relleno = 'no', borde = 'no') => {
    const k = `${fmt}|${fuente}|${relleno}|${borde}`;
    if (!idx.has(k)) { idx.set(k, claves.length); claves.push(k); }
    return idx.get(k);
  };
  const xml = () => claves.map(k => {
    const [f, fu, r, b] = k.split('|');
    return `<xf xfId="0" numFmtId="${FMT[f]}" fontId="${FUENTE[fu]}" fillId="${RELLENO[r]}" borderId="${BORDE[b]}"` +
      ` applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"` +
      // los enteros cortos (fotos, N.º) van centrados: pegados a la derecha se leen con la columna vecina
      (f === 'ent' ? ' applyAlignment="1"><alignment horizontal="center"/></xf>' : '/>');
  }).join('');
  return { de, xml, cuantos: () => claves.length };
}

const valorDe = v => (v && typeof v === 'object') ? v.v : v;
const refHoja = nombre => `'${String(nombre).replace(/'/g, "''")}'`;

function celdaXml(ref, v, s) {
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
  const st = s ? ` s="${s}"` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
}

// Arma el XML de una hoja y, si corresponde, su tabla y su gráfico.
function armarHoja(h, n, est) {
  const filas = h.filas;
  const ncol = Math.max(1, ...filas.map(f => f.length));
  const intro = h.intro || [];
  const off = intro.length ? intro.length + 1 : 0;          // filas antes del encabezado
  const filaCab = off + 1;                                    // 1-based
  const ultimaDato = off + filas.length;
  const tot = h.tabla && h.tabla.totales;
  const filaTot = tot ? ultimaDato + 1 : null;
  const xml = [];

  intro.forEach((t, i) => xml.push(`<row r="${i + 1}">${celdaXml('A' + (i + 1), t,
    est.de('gen', i === 0 ? 'titulo' : 'nota'))}</row>`));

  filas.forEach((fila, i) => {
    const r = off + i + 1;
    const celdas = [];
    if (i === 0 && !h.portada) {
      for (let j = 0; j < (h.tabla ? ncol : fila.length); j++)
        // en una Tabla el encabezado no puede quedar vacío ni repetido
        celdas.push(celdaXml(col(j + 1) + r, h.tabla ? (fila[j] || `Col${j + 1}`) : fila[j],
          h.tabla ? est.de('gen', 'b', 'cab', 'cab') : 1));
    } else {
      const relleno = fila.gris ? 'franja' : 'no';
      for (let j = 0; j < (h.tabla ? ncol : fila.length); j++) {
        const c = fila[j];
        const v = valorDe(c);
        if (!h.tabla) {
          const fu = c && typeof c === 'object' ? c.fuente : null;
          celdas.push(celdaXml(col(j + 1) + r, v, fu ? est.de('gen', fu) : 0)); continue;
        }
        const o = (c && typeof c === 'object') ? c : {};
        const fmt = o.oculto ? 'oculto' : (o.s || (typeof v === 'number' ? 'num' : 'gen'));
        const fuente = o.fuente || fila.fuente || 'n';
        const s = (fmt === 'gen' && relleno === 'no' && fuente === 'n') ? 0 : est.de(fmt === 'txt' ? 'gen' : fmt, fuente, relleno);
        celdas.push(celdaXml(col(j + 1) + r, v, s));
      }
    }
    xml.push(`<row r="${r}">${celdas.join('')}</row>`);
  });

  // "Total filtrado" va justo debajo y FUERA de la Tabla: SUBTOTAL ignora igual las
  // filas ocultas por el filtro, y así el gráfico la lee en Excel y en LibreOffice
  // (LibreOffice no grafica la fila de totales integrada de una Tabla).
  if (tot) {
    const sEt = est.de('gen', 'b', 'tot', 'tot'), sNum = est.de('num', 'b', 'tot', 'tot');
    const celdas = [celdaXml(col(1) + filaTot, tot.etiqueta, sEt)];
    for (let j = 1; j < ncol; j++) {
      const ref = col(j + 1) + filaTot;
      if (j < tot.desde) { celdas.push(`<c r="${ref}" s="${sEt}"/>`); continue; }
      const rango = `${col(j + 1)}${filaCab + 1}:${col(j + 1)}${ultimaDato}`;
      // valor ya calculado (todo visible) para que se vea aunque el lector no recalcule
      const suma = filas.slice(1).reduce((a, f) => a + (typeof valorDe(f[j]) === 'number' ? valorDe(f[j]) : 0), 0);
      celdas.push(`<c r="${ref}" s="${sNum}"><f>SUBTOTAL(109,${rango})</f><v>${Math.round(suma * 100) / 100}</v></c>`);
    }
    xml.push(`<row r="${filaTot}">${celdas.join('')}</row>`);
  }

  // anchos: lo que pide el texto más largo, con tope
  const anchos = [];
  for (let j = 0; j < ncol; j++) {
    let w = 6;
    filas.forEach((f, i) => {
      const v = valorDe(f[j]);
      if (v === null || v === undefined || v === '') return;
      const largo = typeof v === 'number' ? String(Math.round(v)).length * 1.35 + 4 : String(v).length;
      w = Math.max(w, largo + (i === 0 ? 4 : 1));
    });
    anchos.push(Math.min(h.tabla ? (h.tabla.anchoMax || 42) : 60, Math.ceil(w)));
  }
  if (h.anchos) h.anchos.forEach((w, j) => { if (w) anchos[j] = w; });
  const cols = `<cols>${anchos.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;

  const rels = [];
  let tablaXml = null, dibujoXml = null, graficoXml = null;
  if (h.tabla) {
    const columnas = filas[0].concat(Array(ncol - filas[0].length).fill(''))
      .map((c, j) => `<tableColumn id="${j + 1}" name="${xmlEsc(c || `Col${j + 1}`)}"/>`);
    tablaXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${n}" name="${h.tabla.nombre}" displayName="${h.tabla.nombre}" ref="A${filaCab}:${col(ncol)}${ultimaDato}">
<autoFilter ref="A${filaCab}:${col(ncol)}${ultimaDato}"/>
<tableColumns count="${ncol}">${columnas.join('')}</tableColumns>
<tableStyleInfo name="CierreGris" showFirstColumn="0" showLastColumn="0" showRowStripes="${h.tabla.franjas === false ? 0 : 1}" showColumnStripes="0"/>
</table>`;
    rels.push({ id: 'rIdT', tipo: TIPO('table'), destino: `../tables/table${n}.xml` });
  }

  if (h.grafico && tot) {
    const d = h.grafico.desde, hasta = h.grafico.hasta;           // columnas 0-based de los meses
    const cats = filas[0].slice(d, hasta + 1);
    const vals = [];
    for (let j = d; j <= hasta; j++)
      vals.push(filas.slice(1).reduce((a, f) => a + (typeof valorDe(f[j]) === 'number' ? valorDe(f[j]) : 0), 0));
    const fCats = `${refHoja(h.nombre)}!$${col(d + 1)}$${filaCab}:$${col(hasta + 1)}$${filaCab}`;
    const fVals = `${refHoja(h.nombre)}!$${col(d + 1)}$${filaTot}:$${col(hasta + 1)}$${filaTot}`;
    graficoXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="es-CL" sz="1200" b="1"/><a:t>${xmlEsc(h.grafico.titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xmlEsc(tot.etiqueta)}</c:v></c:tx>
<c:spPr><a:solidFill><a:srgbClr val="${GRIS.barra}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>
<c:cat><c:strRef><c:f>${xmlEsc(fCats)}</c:f><c:strCache><c:ptCount val="${cats.length}"/>${cats.map((c, i) => `<c:pt idx="${i}"><c:v>${xmlEsc(c)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:f>${xmlEsc(fVals)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${Math.round(v * 100) / 100}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>
</c:ser><c:gapWidth val="60"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>
<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E0E0E0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>
</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
    // a la derecha de la tabla, a la altura del encabezado: queda a la vista al filtrar
    const c0 = ncol + 1, r0 = filaCab - 1;
    dibujoXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">
<xdr:twoCellAnchor><xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${c0 + 9}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0 + 20}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Grafico ${n}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId1"/></a:graphicData></a:graphic>
</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
    rels.push({ id: 'rIdD', tipo: TIPO('drawing'), destino: `../drawings/drawing${n}.xml` });
  }

  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_R}">
${h.tabla || h.portada ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''}<sheetViews><sheetView workbookViewId="0"${h.tabla || h.portada ? ' showGridLines="0"' : ''}>${h.portada ? '' : `<pane ySplit="${filaCab}" topLeftCell="A${filaCab + 1}" activePane="bottomLeft" state="frozen"/>`}</sheetView></sheetViews>
${cols}<sheetData>${xml.join('')}</sheetData>
${h.tabla || h.portada ? '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : ''}${
  // al imprimir, cada hoja lleva arriba el grupo y la hoja, y abajo el número de página
  h.encabezado ? `<headerFooter><oddHeader>${xmlEsc('&L&"Calibri,Bold"' + h.encabezado.replace(/&/g, '&&') + '&R&A')}</oddHeader><oddFooter>${xmlEsc('&LCierre de Mes&RPágina &P de &N')}</oddFooter></headerFooter>` : ''}
${dibujoXml ? '<drawing r:id="rIdD"/>' : ''}${tablaXml ? '<tableParts count="1"><tablePart r:id="rIdT"/></tableParts>' : ''}</worksheet>`;
  return { hoja, rels, tablaXml, dibujoXml, graficoXml };
}

const relsXml = rels => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_REL}">${rels.map(r => `<Relationship Id="${r.id}" Type="${r.tipo}" Target="${r.destino}"/>`).join('')}</Relationships>`;

function construirExcel(hojas) {         // hojas: [{nombre, filas, intro?, tabla?, grafico?}]
  const zip = new JSZip();
  const est = registroEstilos();
  const partes = hojas.map((h, i) => armarHoja(h, i + 1, est));
  const extra = [];
  partes.forEach((p, i) => {
    if (p.tablaXml) extra.push(`<Override PartName="/xl/tables/table${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
    if (p.dibujoXml) extra.push(`<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  });
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
${extra.join('\n')}
</Types>`);
  zip.folder('_rels').file('.rels', relsXml([{ id: 'rId1', tipo: TIPO('officeDocument'), destino: 'xl/workbook.xml' }]));
  const xl = zip.folder('xl');
  xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="${NS_R}"><sheets>
${hojas.map((h, i) => `<sheet name="${xmlEsc(h.nombre).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}
</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  xl.folder('_rels').file('workbook.xml.rels', relsXml([
    ...hojas.map((_, i) => ({ id: `rId${i + 1}`, tipo: TIPO('worksheet'), destino: `worksheets/sheet${i + 1}.xml` })),
    { id: 'rIdS', tipo: TIPO('styles'), destino: 'styles.xml' }
  ]));
  const solido = c => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`;
  const linea = (lado, c) => `<border><${lado} style="thin"><color rgb="${c}"/></${lado}></border>`;
  // La Tabla usa el estilo "CierreGris": encabezado gris medio y franjas gris muy claro.
  xl.file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="0.0&quot;%&quot;;-0.0&quot;%&quot;;0.0&quot;%&quot;"/><numFmt numFmtId="166" formatCode=";;;"/></numFmts>
<fonts count="6"><font><sz val="11"/><color rgb="${GRIS.texto}"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="${GRIS.texto}"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="${GRIS.texto}"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="${GRIS.nota}"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="${GRIS.cons}"/><name val="Calibri"/></font><font><b/><sz val="24"/><color rgb="${GRIS.texto}"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${solido(GRIS.franja)}${solido(GRIS.cab)}${solido(GRIS.tot)}</fills>
<borders count="3"><border/>${linea('bottom', GRIS.linea)}${linea('top', GRIS.linea)}</borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="${est.cuantos()}">${est.xml()}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="2"><dxf><font><b/><color rgb="${GRIS.texto}"/></font><fill><patternFill patternType="solid"><bgColor rgb="${GRIS.cab}"/></patternFill></fill><border><bottom style="thin"><color rgb="${GRIS.linea}"/></bottom></border></dxf><dxf><fill><patternFill patternType="solid"><bgColor rgb="${GRIS.franja}"/></patternFill></fill></dxf></dxfs>
<tableStyles count="1" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"><tableStyle name="CierreGris" pivot="0" count="2"><tableStyleElement type="headerRow" dxfId="0"/><tableStyleElement type="firstRowStripe" dxfId="1"/></tableStyle></tableStyles>
</styleSheet>`);
  const ws = xl.folder('worksheets');
  partes.forEach((p, i) => {
    const n = i + 1;
    ws.file(`sheet${n}.xml`, p.hoja);
    if (p.rels.length) ws.folder('_rels').file(`sheet${n}.xml.rels`, relsXml(p.rels));
    if (p.tablaXml) xl.folder('tables').file(`table${n}.xml`, p.tablaXml);
    if (p.dibujoXml) {
      xl.folder('drawings').file(`drawing${n}.xml`, p.dibujoXml);
      xl.folder('drawings').folder('_rels').file(`drawing${n}.xml.rels`,
        relsXml([{ id: 'rId1', tipo: TIPO('chart'), destino: `../charts/chart${n}.xml` }]));
      xl.folder('charts').file(`chart${n}.xml`, p.graficoXml);
    }
  });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

// ---------- nombres de carpeta y archivo seguros ----------
const limpio = s => String(s ?? 'sin-dato')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9 ._+-]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);

window.RESPALDO = { construirExcel, limpio, MESES_N, col };
})();

/* ===================================================================
   app.js · Cierre de Mes
   Dos interfaces sobre la misma base: Terreno (móvil) y Consola (PC).
   =================================================================== */
(function () {
const { sb, idb } = DB;
const C = window.CONFIG;

// ------------------------------------------------------------------ estado
const S = {
  usuario: null,           // fila de cierre_mes.usuarios
  catalogo: null,
  periodo: campanaSugerida(),          // campaña de toma; ver nombreCampana()
  periodoConsumo: primerDiaDelMes(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)),
  periodoCF: primerDiaDelMes(new Date()),   // Casa de Fuerza: generadores y recargas
  lecturas: [],            // lecturas del periodo
  ultimas: [],             // última lectura conocida por variable
  pendientes: 0,
  vista: 'terreno',
  filtro: ''
};

// ------------------------------------------------------------------ utilidades
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, hijos = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const h of [].concat(hijos)) if (h) n.append(h);
  return n;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function primerDiaDelMes(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
const MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];
function nombrePeriodo(p) {
  const [a, m] = p.split('-');
  return `${MESES[+m - 1]} ${a}`;
}

/* ------------------------------------------------------------------
   CAMPAÑA vs MES DE CONSUMO
   La lectura del 1 de septiembre menos la del 1 de agosto es el consumo
   de AGOSTO. Por eso la toma de un mes cierra el mes anterior, y en las
   pantallas de terreno se dice así: "septiembre 2026 · cierra agosto".
   En Consumos e informes el periodo ya es el mes consumido, no la toma.
   ------------------------------------------------------------------ */
function mesAnterior(p) {
  const [a, m] = p.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return d.toISOString().slice(0, 10);
}
function nombreCampana(p) {
  return `${nombrePeriodo(p)} · cierra ${nombrePeriodo(mesAnterior(p)).split(' ')[0]}`;
}
// Cerca de fin de mes lo normal es adelantar la toma: son muchos puntos y no
// alcanzan a hacerse todos el día 1. Desde el día 25 la app propone la campaña
// del mes siguiente, que es la que en verdad se está tomando.
function campanaSugerida(hoy = new Date()) {
  const d = hoy.getDate() >= 25
    ? new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1)
    : hoy;
  return primerDiaDelMes(d);
}
function num(v, dec = 0) {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fechaCorta(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CL',
    { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const UNIDAD = { kWh: 'kWh', MWh: 'MWh', m3: 'm³', L: 'L', Hrs: 'h', kW: 'kW' };

// Para los ejes: 4.898.081 es ilegible en una etiqueta de 10px. 4,9 M sí se lee.
function numCorto(v) {
  const n = Math.abs(Number(v));
  if (n >= 1e9) return (v / 1e9).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' MM';
  if (n >= 1e6) return (v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' M';
  if (n >= 1e4) return (v / 1e3).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + ' k';
  return num(v);
}

let tostadaTimer;
function toast(msg, malo = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (malo ? ' bad' : '');
  t.hidden = false;
  clearTimeout(tostadaTimer);
  tostadaTimer = setTimeout(() => { t.hidden = true; }, malo ? 5000 : 2600);
}

function modal(titulo, nodo) {
  $('#modal-titulo').textContent = titulo;
  const cuerpo = $('#modal-cuerpo');
  cuerpo.replaceChildren(nodo);
  $('#modal').hidden = false;
}
function cerrarModal() { $('#modal').hidden = true; $('#modal-cuerpo').replaceChildren(); }

// El orden de los grupos es parte del formato del informe: viene de la columna
// `orden` de la tabla grupos, editable en Configuración → Grupos. Los grupos
// sin orden y los puntos sin grupo van al final.
function ordenGrupo(nombre) {
  if (!nombre) return 9999;
  const g = (S.catalogo?.grupos || []).find(x => x.nombre === nombre);
  return g && g.orden != null ? g.orden : 999;
}
function compararGrupos(a, b) {
  return ordenGrupo(a) - ordenGrupo(b) || String(a || '').localeCompare(String(b || ''));
}

const esSupervisor = () => ['admin', 'supervisor'].includes(S.usuario?.rol);
const esAdmin = () => S.usuario?.rol === 'admin';

// ------------------------------------------------------------------ login
$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const boton = e.target.querySelector('button');
  boton.disabled = true; boton.textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({
    email: $('#login-correo').value.trim(),
    password: $('#login-clave').value
  });
  boton.disabled = false; boton.textContent = 'Entrar';
  if (error) {
    const p = $('#login-error');
    p.textContent = error.message === 'Invalid login credentials'
      ? 'Correo o contraseña incorrectos.' : error.message;
    p.hidden = false;
    return;
  }
  await arrancar();
});

// Cada persona cambia su propia contraseña sin depender del panel de Supabase
// ni de que alguien se la reasigne: si eso cuesta, nadie cambia la que le dieron.
$('#btn-clave').addEventListener('click', () => {
  const nueva = el('input', { type: 'password', autocomplete: 'new-password' });
  const otra  = el('input', { type: 'password', autocomplete: 'new-password' });
  const aviso = el('p', { class: 'banda warn', hidden: true });
  const boton = el('button', { class: 'btn primario grande', text: 'Cambiar la contraseña',
    onclick: async () => {
      const a = nueva.value, b = otra.value;
      const problema =
        a.length < 8 ? 'La contraseña debe tener al menos 8 caracteres.' :
        a !== b ? 'Las dos contraseñas no coinciden.' :
        /^(?:\d+|[a-zA-Z]+)$/.test(a) ? 'Mezcla letras y números: solo letras o solo números se adivina rápido.' :
        null;
      if (problema) { aviso.textContent = problema; aviso.hidden = false; return; }
      if (!navigator.onLine) { aviso.textContent = 'Necesitas señal para cambiar la contraseña.'; aviso.hidden = false; return; }
      boton.disabled = true;
      const { error } = await sb.auth.updateUser({ password: a });
      boton.disabled = false;
      if (error) { aviso.textContent = error.message; aviso.hidden = false; return; }
      cerrarModal();
      toast('Contraseña cambiada. Se usa la nueva la próxima vez que entres.');
    } });

  modal('Cambiar mi contraseña', el('div', {}, [
    el('p', { class: 'ayuda', text: `Cuenta: ${S.usuario.correo}` }),
    el('label', { text: 'Contraseña nueva' }, [nueva]),
    el('label', { text: 'Repítela' }, [otra]),
    aviso,
    boton,
    el('p', { class: 'ayuda', text:
      'Al menos 8 caracteres, con letras y números. La sesión abierta sigue funcionando; ' +
      'la contraseña nueva se usa la próxima vez que entres.' })
  ]));
});

$('#btn-salir').addEventListener('click', async () => {
  const p = await DB.pendientes();
  if (p.length && !confirm(`Tienes ${p.length} registro(s) sin sincronizar. Si cierras sesión se quedan guardados en este dispositivo. ¿Salir igual?`)) return;
  await sb.auth.signOut();
  location.reload();
});

// ------------------------------------------------------------------ arranque
async function arrancar() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { $('#vista-login').classList.add('activa'); $('#app').hidden = true; return; }

  const { data: perfil, error } = await sb.from('usuarios').select('*').eq('id', user.id).single();
  if (error || !perfil) {
    $('#login-error').textContent = 'Tu cuenta existe pero no está dada de alta en Cierre de Mes. Pídele a un administrador que te agregue.';
    $('#login-error').hidden = false;
    await sb.auth.signOut();
    return;
  }
  S.usuario = perfil;

  $('#vista-login').classList.remove('activa');
  $('#app').hidden = false;
  $('#menu-usuario').textContent = `${perfil.nombre} · ${perfil.rol}`;

  // opciones de menú según rol
  $$('#menu [data-rol]').forEach(b => {
    const req = b.dataset.rol;
    const ok = req === 'admin' ? esAdmin()
             : req === 'casa_fuerza' ? (esSupervisor() || !!S.usuario.casa_fuerza)
             : esSupervisor();
    b.hidden = !ok;
  });

  try { S.catalogo = await DB.catalogo(); }
  catch (e) { toast('No se pudo bajar el catálogo: ' + e.message, true); return; }

  // Casa de Fuerza solo aparece si hay generadores dentro del alcance del
  // usuario: a un supervisor de otra empresa no le sirve un menú vacío.
  if (!S.usuario.casa_fuerza && !(S.catalogo.generadores || []).length) {
    $$('#menu [data-rol="casa_fuerza"]').forEach(b => { b.hidden = true; });
  }

  // En iOS, Safari borra el almacenamiento tras unos días sin usar el sitio.
  // Pedir persistencia lo evita, y solo se concede si la app está instalada.
  DB.pedirPersistencia();

  await refrescarDatos();
  await actualizarConexion();
  ir(esSupervisor() ? 'tablero' : 'terreno');
  if (navigator.onLine) sincronizar(true);
}

async function refrescarDatos() {
  if (navigator.onLine) {
    try {
      S.lecturas = await DB.lecturasDelPeriodo(S.periodo);
      S.ultimas = await DB.ultimasLecturas();
      return;
    } catch (e) { console.warn(e); }
  }
  S.lecturas = await DB.lecturasCache(S.periodo);
  S.ultimas = await DB.ultimasCache();
}

// ------------------------------------------------------------------ conexión y cola
async function actualizarConexion() {
  const cola = await DB.pendientes();
  S.pendientes = cola.length;
  const chip = $('#chip-conexion');
  if (!navigator.onLine) { chip.className = 'chip off'; chip.textContent = 'Sin señal'; }
  else if (S.pendientes)  { chip.className = 'chip cola'; chip.textContent = `${S.pendientes} por enviar`; }
  else                    { chip.className = 'chip on';  chip.textContent = 'Al día'; }

  // Un chip discreto es fácil de ignorar. Si hay algo sin enviar, se ve sí o sí.
  const b = $('#banner-cola');
  if (!S.pendientes) { b.hidden = true; return; }
  const masViejo = Math.min(...cola.map(x => x.creado || Date.now()));
  const horas = Math.floor((Date.now() - masViejo) / 3600e3);
  const antiguedad = horas < 1 ? 'hace menos de una hora'
    : horas < 48 ? `hace ${horas} horas` : `hace ${Math.floor(horas / 24)} días`;
  b.hidden = false;
  poner(b,
    el('span', { class: 'crece', html:
      `<b>${S.pendientes} registro(s) sin enviar</b> · el más antiguo, ${antiguedad}. ` +
      (navigator.onLine ? 'Hay señal: se están enviando.' : 'Se enviarán solos cuando vuelva la señal.') }),
    el('button', { class: 'btn chico', text: 'Ver dispositivo', onclick: () => ir('dispositivo') }));
}

async function sincronizar(silencioso = false) {
  const cola = await DB.pendientes();
  if (!cola.length) { if (!silencioso) toast('No hay nada pendiente por enviar'); return; }
  if (!navigator.onLine) { if (!silencioso) toast('Sin señal. Se enviará solo cuando vuelva.', true); return; }

  $('#btn-sync').disabled = true;
  const r = await DB.sincronizar();
  $('#btn-sync').disabled = false;

  await refrescarDatos();
  await actualizarConexion();
  render();

  if (r.fallidos) toast(`Enviados ${r.enviados}. Quedaron ${r.fallidos} con error.`, true);
  else if (r.enviados) toast(`${r.enviados} registro(s) enviados`);
}

$('#btn-sync').addEventListener('click', () => sincronizar());
window.addEventListener('online',  () => { actualizarConexion(); sincronizar(true); });
window.addEventListener('offline', () => actualizarConexion());

// ------------------------------------------------------------------ navegación
function menuAbierto(abrir) {
  $('#menu').classList.toggle('abierto', abrir);
  $('#velo').hidden = !abrir;
}
$('#btn-menu').addEventListener('click', () => menuAbierto(!$('#menu').classList.contains('abierto')));
$('#velo').addEventListener('click', () => menuAbierto(false));
$('#modal-cerrar').addEventListener('click', cerrarModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') cerrarModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal(); });

$$('#menu button[data-vista]').forEach(b =>
  b.addEventListener('click', () => ir(b.dataset.vista)));

function ir(vista) {
  S.vista = vista;
  S.filtro = '';
  $$('#menu button[data-vista]').forEach(b => b.classList.toggle('sel', b.dataset.vista === vista));
  if (window.innerWidth < 900) menuAbierto(false);
  render();
}

const TITULOS = {
  terreno: 'Terreno', tablero: 'Tablero del mes', validacion: 'Validación',
  consumos: 'Consumos e informes', avisos: 'Avisos', equipos: 'Equipos',
  dispositivo: 'Este dispositivo',
  puntos: 'Puntos de medición', grupos: 'Grupos', respaldo: 'Respaldo',
  usuarios: 'Usuarios', auditoria: 'Auditoría',
  generadores: 'Casa de Fuerza · Generadores', recargas: 'Casa de Fuerza · Recargas',
  etiquetas: 'Etiquetas QR'
};

// replaceChildren(...) convierte cualquier argumento que no sea un nodo en texto:
// un null intermedio termina impreso como la palabra "null" en pantalla.
function poner(cont, ...hijos) {
  cont.replaceChildren(...hijos.flat().filter(Boolean));
}

function render() {
  $('#titulo-vista').textContent = TITULOS[S.vista] || '';
  $('#subtitulo-vista').textContent =
    ['equipos','puntos','grupos','respaldo','usuarios','auditoria','avisos','consumos','dispositivo','generadores','etiquetas'].includes(S.vista) ? ''
      : S.vista === 'recargas' ? nombrePeriodo(S.periodoCF)
      : ['terreno','tablero','validacion'].includes(S.vista) ? nombreCampana(S.periodo)
      : nombrePeriodo(S.vista === 'consumos' ? S.periodoConsumo : S.periodo);
  // Cada vista escribe en SU propio contenedor. Si una consulta lenta termina
  // después de que el usuario cambió de sección, escribe en un nodo ya desechado
  // en vez de pisar la vista nueva.
  const c = el('div');
  $('#contenido').replaceChildren(c);
  ({
    terreno: vistaTerreno, tablero: vistaTablero, validacion: vistaValidacion,
    consumos: vistaConsumos, avisos: vistaAvisos, equipos: vistaEquipos,
    dispositivo: vistaDispositivo,
    puntos: vistaPuntos, grupos: vistaGrupos, respaldo: vistaRespaldo,
    usuarios: vistaUsuarios, auditoria: vistaAuditoria,
    generadores: vistaGeneradores, recargas: vistaRecargas,
    etiquetas: vistaEtiquetas
  }[S.vista] || vistaTerreno)(c);
}

// ------------------------------------------------------------------ selector de periodo
function selectorPeriodo(campo = 'periodo', alCambiar = null) {
  const hoy = new Date();
  const campana = campo === 'periodo';
  const opciones = [];
  // el mes siguiente va primero: es el que se adelanta a fin de mes
  for (let i = -1; i < 24; i++) {
    opciones.push(primerDiaDelMes(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)));
  }
  const sel = el('select', {
    onchange: async e => {
      S[campo] = e.target.value;
      if (alCambiar) { alCambiar(); return; }
      await refrescarDatos();
      render();
    }
  });
  for (const p of opciones) {
    sel.append(el('option', { value: p, selected: p === S[campo] || null,
      text: campana ? nombreCampana(p) : nombrePeriodo(p) }));
  }
  return el('label', { class: 'crece', text: campana ? 'Toma de' : 'Periodo' }, [sel]);
}

/* ===================================================================
   VISTA · TERRENO
   =================================================================== */
function vistaTerreno(c) {
  const buscador = el('div', { class: 'buscador' }, [
    el('input', {
      type: 'search', placeholder: 'Buscar por TAG, punto o sitio…', value: S.filtro,
      oninput: e => { S.filtro = e.target.value.toLowerCase(); pintarLista(); }
    })
  ]);
  const cabecera = el('div', { class: 'fila entre seccion' }, [
    selectorPeriodo(),
    el('button', { class: 'btn primario grande', text: 'Escanear código',
      onclick: () => escanearYAbrir() })
  ]);
  // La confusión clásica: creer que la toma del 1 de septiembre "es" septiembre.
  const explicacion = el('p', { class: 'ayuda', text:
    `Estás tomando la lectura de ${nombrePeriodo(S.periodo)}, que cierra el consumo de ` +
    `${nombrePeriodo(mesAnterior(S.periodo))}: el totalizador de hoy menos el del mes pasado. ` +
    'Puedes adelantarla los últimos días del mes; la app guarda la fecha real en que la tomaste.' });
  const lista = el('div', { id: 'lista-puntos' });
  c.append(cabecera, explicacion, buscador, lista);
  pintarLista();
}

function estadoDeVariable(v) {
  const l = S.lecturas.find(x => x.variable_id === v.id);
  if (l) return { clase: 'lista', l };
  return { clase: 'pendiente', l: null };
}

async function pintarLista() {
  const cont = $('#lista-puntos');
  if (!cont) return;
  const cola = await DB.pendientes();
  const enCola = new Set(cola.map(x => x.variable_id));

  const f = S.filtro;
  const items = S.catalogo.variables.filter(v => {
    if (!f) return true;
    const eq = v.punto.equipo?.tag || '';
    return `${v.punto.nombre} ${v.punto.sitio.nombre} ${v.nombre} ${eq}`.toLowerCase().includes(f);
  });

  cont.replaceChildren();
  if (!items.length) { cont.append(el('p', { class: 'vacio', text: 'Nada coincide con la búsqueda.' })); return; }

  const porSitio = {};
  for (const v of items) (porSitio[v.punto.sitio.nombre] ||= []).push(v);

  const pend = items.filter(v => !S.lecturas.some(l => l.variable_id === v.id) && !enCola.has(v.id)).length;
  cont.append(el('p', { class: 'ayuda', text: `${items.length} lecturas del mes · ${pend} pendientes` }));

  for (const sitio of Object.keys(porSitio).sort()) {
    cont.append(el('div', { class: 'grupo-sitio', text: sitio }));
    for (const v of porSitio[sitio].sort((a, b) => a.punto.nombre.localeCompare(b.punto.nombre))) {
      const { clase, l } = estadoDeVariable(v);
      const cl = enCola.has(v.id) ? 'cola' : clase;
      const tag = v.punto.equipo?.tag;
      const u = UNIDAD[v.unidad_reporte] || v.unidad_reporte;

      cont.append(el('button', { class: 'item ' + cl, onclick: () => abrirCaptura(v) }, [
        el('span', { class: 'txt' }, [
          el('span', { class: 'n', text: v.punto.nombre }),
          el('span', { class: 'd', text: `${tag ? tag + ' · ' : ''}${v.nombre} · ${u}` })
        ]),
        el('span', { class: 'val', html: cl === 'cola'
          ? '<span class="pill acento">por enviar</span>'
          : l ? `${l.sin_dato ? 'sin dato' : num(l.valor)}<small>${esc(quien(l))}</small>`
              : '<span class="pill neutro">pendiente</span>' })
      ]));
    }
  }
}

const estadoTexto = e => ({ borrador: 'borrador', enviada: 'por validar',
  validada: 'validada', rechazada: 'rechazada', descartada: 'descartada' }[e] || e);

// Quién tomó la lectura y cuándo: la mayoría de los choques se evitan con solo verlo.
function quien(l) {
  const n = S.catalogo.gente?.[l.tomada_por];
  const cuando = l.fecha_lectura
    ? new Date(l.fecha_lectura).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }) : '';
  if (!n) return `${estadoTexto(l.estado)}${cuando ? ' · ' + cuando : ''}`;
  return `${n.split(' ')[0]} · ${cuando}`;
}

/* ---------------- captura de una lectura ---------------- */
async function abrirCaptura(v) {
  const anterior = S.ultimas.find(u => u.variable_id === v.id);
  const yaHay = S.lecturas.find(l => l.variable_id === v.id);
  const equipo = v.punto.equipo || {};
  const u = UNIDAD[v.unidad_reporte] || v.unidad_reporte;
  const doble = v.formato_lectura === 'doble_mwh_kwh';

  let banda = null;
  if (navigator.onLine) {
    try {
      const { data } = await sb.rpc('banda_esperada', { p_variable_id: v.id });
      banda = data && data.length ? data[0] : null;
    } catch { /* sin banda, no pasa nada */ }
  }

  let blobFoto = null;

  const cajaFoto = el('div', { class: 'foto-caja' });
  const inputFoto = el('input', { type: 'file', accept: 'image/*', capture: 'environment',
    onchange: async e => {
      const f = e.target.files[0]; if (!f) return;
      blobFoto = await DB.comprimirFoto(f, v.punto.foto_calidad || 'normal');
      previa.src = URL.createObjectURL(blobFoto);
      previa.hidden = false;
      pesoFoto.textContent = `Foto lista · ${Math.round(blobFoto.size / 1024)} KB`;
    } });
  const previa = el('img', { class: 'foto-previa', hidden: true, alt: 'Foto del medidor' });
  const pesoFoto = el('p', { class: 'ayuda', text:
    (v.punto.foto_obligatoria ? 'La foto es obligatoria en este punto.' : 'La foto es opcional en este punto.') +
    (v.punto.foto_calidad === 'alta' ? ' Se guarda en calidad alta.' : '') });
  cajaFoto.append(inputFoto, previa, pesoFoto);

  const campoValor = doble ? null : el('input', {
    type: 'number', inputmode: 'decimal', class: 'dato-grande',
    step: v.decimales_display > 0 ? '0.' + '0'.repeat(v.decimales_display - 1) + '1' : '1',
    placeholder: '0', oninput: evaluar
  });
  const campoMwh = doble ? el('input', { type: 'number', inputmode: 'numeric',
    class: 'dato-grande', placeholder: 'MWh', oninput: evaluar }) : null;
  const campoKwh = doble ? el('input', { type: 'number', inputmode: 'numeric',
    class: 'dato-grande', placeholder: 'kWh', oninput: evaluar }) : null;

  const avisoBanda = el('div', { class: 'banda ok', hidden: true });
  const obs = el('textarea', { placeholder: 'Algo que el supervisor deba saber: una detención, un cambio de equipo, un consumo raro…' });
  const chkSinDato = el('input', { type: 'checkbox', onchange: e => {
    const off = e.target.checked;
    [campoValor, campoMwh, campoKwh].forEach(x => { if (x) { x.disabled = off; x.value = ''; } });
    evaluar();
  } });

  function valorActual() {
    if (doble) return (Number(campoMwh.value || 0) * 1000) + Number(campoKwh.value || 0);
    const bruto = Number(campoValor.value);
    if (!campoValor.value) return null;
    return v.unidad_display === 'MWh' && v.unidad_reporte === 'kWh' ? bruto * 1000 : bruto;
  }

  function evaluar() {
    if (chkSinDato.checked) { avisoBanda.hidden = true; return; }
    const val = valorActual();
    if (val === null || Number.isNaN(val)) { avisoBanda.hidden = true; return; }

    const alertas = [];
    if (anterior && val < Number(anterior.valor)) {
      alertas.push(['bad', `Esta lectura (${num(val)}) es MENOR que la anterior (${num(anterior.valor)}). Puede ser un reinicio del totalizador o un dígito de menos.`]);
    }
    if (anterior && val === Number(anterior.valor)) {
      alertas.push(['warn', 'La lectura es idéntica a la anterior. ¿La leíste o se copió?']);
    }
    if (anterior && Number(anterior.valor) > 0) {
      const razon = val / Number(anterior.valor);
      if (razon > 9.5 || razon < 0.105) {
        alertas.push(['bad', 'La lectura saltó un orden de magnitud respecto de la anterior. Revisa la coma o un dígito de más.']);
      }
    }
    if (banda && anterior) {
      const consumo = val - Number(anterior.valor);
      const z = (consumo - Number(banda.media)) / Number(banda.sigma);
      if (Math.abs(z) > 3) {
        alertas.push(['bad', `El consumo (${num(consumo)} ${u}) está muy lejos de lo habitual (~${num(banda.media)} ${u}). Revisa el número y deja una observación.`]);
      } else if (Math.abs(z) > 1.5) {
        const pct = Math.round((consumo / Number(banda.media) - 1) * 100);
        alertas.push(['warn', `El consumo está ${pct > 0 ? pct + '% por sobre' : Math.abs(pct) + '% por debajo'} de lo habitual (~${num(banda.media)} ${u}). Puedes guardar igual.`]);
      }
    }

    if (!alertas.length) { avisoBanda.hidden = true; return; }
    const peor = alertas.find(a => a[0] === 'bad') || alertas[0];
    avisoBanda.className = 'banda ' + peor[0];
    avisoBanda.textContent = alertas.map(a => a[1]).join(' ');
    avisoBanda.hidden = false;
  }

  // Verificación opcional del medidor: confirma que el instrumento que está
  // al frente es el que la base cree instalado en este punto.
  const zonaMedidor = el('div');
  const btnMedidor = el('button', { class: 'btn chico', text: 'Verificar el medidor con el QR',
    onclick: () => verificarMedidor(v, zonaMedidor) });
  poner(zonaMedidor, btnMedidor);

  const cuerpo = el('div', { class: 'captura' }, [
    el('div', { class: 'anterior' }, [
      el('span', { html: `<b>${esc(v.punto.nombre)}</b><br><small>${esc(v.punto.sitio.nombre)}${equipo.tag ? ' · ' + esc(equipo.tag) : ''}</small>` }),
      el('span', { html: anterior
        ? `Anterior<br><b>${num(anterior.valor)} ${u}</b><br><small>${fechaCorta(anterior.fecha_lectura)}</small>`
        : '<small>Sin lectura anterior</small>' })
    ]),
    el('label', { text: doble ? 'Lectura del display · MWh' : `Lectura del display · ${UNIDAD[v.unidad_display] || v.unidad_display}` },
      [doble ? campoMwh : campoValor]),
    doble ? el('label', { text: 'Lectura del display · kWh' }, [campoKwh]) : null,
    avisoBanda,
    zonaMedidor,
    cajaFoto,
    el('label', { text: 'Observación' }, [obs]),
    el('label', { class: 'fila' },
      [chkSinDato, el('span', { text: 'No se pudo leer · dejar sin dato' })]),
    el('div', { class: 'acciones-fijas' }, [
      el('button', { class: 'btn primario grande', text: 'Guardar lectura', onclick: guardar }),
      el('button', { class: 'btn', text: 'Registrar un aviso de este punto',
        onclick: () => { cerrarModal(); abrirAviso(v.punto); } })
    ])
  ]);

  if (yaHay) {
    const mio = yaHay.tomada_por === S.usuario.id;
    const nombre = S.catalogo.gente?.[yaHay.tomada_por] || 'otra persona';
    cuerpo.prepend(el('div', { class: 'banda ' + (mio ? 'warn' : 'bad'), text: mio
      ? `Ya tomaste este punto en ${nombrePeriodo(S.periodo)}: ${num(yaHay.valor)} ${u}. Si guardas de nuevo hoy, reemplazas tu lectura.`
      : `${nombre} ya lo tomó el ${fechaCorta(yaHay.fecha_lectura)} con ${num(yaHay.valor)} ${u}. ` +
        'Si guardas igual, quedan dos lecturas y el supervisor elige cuál vale. Ninguna se pierde.' }));
  }

  async function guardar() {
    const sinDato = chkSinDato.checked;
    const val = sinDato ? null : valorActual();

    if (!sinDato && (val === null || Number.isNaN(val))) {
      return toast('Escribe la lectura o marca "no se pudo leer"', true);
    }
    if (v.punto.foto_obligatoria && !blobFoto && !sinDato) {
      return toast('Este punto exige foto', true);
    }

    const fila = {
      variable_id: v.id,
      periodo: S.periodo,
      fecha_lectura: new Date().toISOString(),
      valor_display: doble ? null : (campoValor.value === '' ? null : Number(campoValor.value)),
      valor_mwh: doble ? Number(campoMwh.value || 0) : null,
      valor_kwh: doble ? Number(campoKwh.value || 0) : null,
      sin_dato: sinDato,
      observacion: obs.value.trim() || null,
      dispositivo: navigator.userAgent.slice(0, 120)
    };

    await DB.encolar(fila, blobFoto);
    cerrarModal();
    toast('Guardado en el dispositivo');
    await actualizarConexion();
    await pintarLista();
    if (navigator.onLine) sincronizar(true);
  }

  modal(v.punto.nombre, cuerpo);
  setTimeout(() => (doble ? campoMwh : campoValor)?.focus(), 100);
}

/* ---------------- aviso de anomalía ---------------- */
function abrirAviso(punto, textoPrevio = '') {
  const sel = el('select');
  for (const a of S.catalogo.catalogoAvisos) {
    sel.append(el('option', { value: a.id, text: a.categoria,
      selected: (textoPrevio && /cambi|medidor/i.test(a.categoria)) || null }));
  }
  const desc = el('textarea', { value: textoPrevio,
    placeholder: 'Qué viste, desde cuándo, si requiere intervención…' });
  const cuerpo = el('div', {}, [
    el('p', { class: 'ayuda', text: punto.nombre }),
    el('label', { text: 'Categoría' }, [sel]),
    el('label', { text: 'Descripción' }, [desc]),
    el('button', { class: 'btn primario grande', text: 'Abrir aviso', onclick: async () => {
      const cat = S.catalogo.catalogoAvisos.find(a => a.id == sel.value);
      const { error } = await sb.from('avisos').insert({
        punto_id: punto.id, categoria_id: cat.id, severidad: cat.severidad,
        descripcion: desc.value.trim() || null, abierto_por: S.usuario.id
      });
      if (error) return toast('No se pudo abrir el aviso: ' + error.message, true);
      cerrarModal(); toast('Aviso abierto');
    } })
  ]);
  modal('Nuevo aviso', cuerpo);
}

/* ===================================================================
   VISTA · TABLERO
   =================================================================== */
async function vistaTablero(c) {
  c.append(el('div', { class: 'fila entre seccion' }, [selectorPeriodo()]));
  const zona = el('div'); c.append(zona);
  zona.append(el('p', { class: 'cargando', text: 'Calculando…' }));

  const total = S.catalogo.variables.length;
  const leidas = new Set(S.lecturas.map(l => l.variable_id)).size;
  const porValidar = S.lecturas.filter(l => l.estado === 'enviada').length;
  const validadas = S.lecturas.filter(l => l.estado === 'validada').length;
  const sinDato = S.lecturas.filter(l => l.sin_dato).length;

  let alertas = [];
  try {
    const { data } = await sb.from('v_alertas_duras').select('*').eq('periodo', S.periodo);
    alertas = data || [];
  } catch { /* ignorar */ }

  let avisosAbiertos = 0;
  try {
    const { count } = await sb.from('avisos').select('id', { count: 'exact', head: true }).neq('estado', 'resuelto');
    avisosAbiertos = count || 0;
  } catch { /* ignorar */ }

  let dups = 0;
  try {
    const { count } = await sb.from('v_duplicados').select('variable_id', { count: 'exact', head: true })
      .eq('periodo', S.periodo);
    dups = count || 0;
  } catch { /* ignorar */ }

  poner(zona,
    el('div', { class: 'kpis seccion' }, [
      kpi(leidas + ' / ' + total, 'lecturas tomadas'),
      kpi(total - leidas, 'faltantes', total - leidas ? 'aviso' : ''),
      kpi(porValidar, 'por validar', porValidar ? 'aviso' : ''),
      kpi(validadas, 'validadas'),
      kpi(alertas.length, 'fuera de rango', alertas.length ? 'alerta' : ''),
      kpi(sinDato, 'sin dato'),
      kpi(avisosAbiertos, 'avisos abiertos', avisosAbiertos ? 'aviso' : ''),
      kpi(dups, 'tomados dos veces', dups ? 'alerta' : '')
    ]),
    await bloqueDuplicados(S.periodo),
    el('div', { class: 'seccion' }, [
      el('h2', { text: 'Faltan por leer' }),
      tablaFaltantes()
    ])
  );
}
function kpi(v, k, clase = '') {
  return el('div', { class: 'kpi ' + clase }, [
    el('div', { class: 'v', text: String(v) }), el('div', { class: 'k', text: k })
  ]);
}
function tablaFaltantes() {
  const hechas = new Set(S.lecturas.map(l => l.variable_id));
  const faltan = S.catalogo.variables.filter(v => !hechas.has(v.id));
  if (!faltan.length) return el('p', { class: 'vacio', text: 'Están todas las lecturas del mes.' });
  return tabla(
    ['Sitio', 'Punto', 'TAG', 'Variable', 'Unidad'],
    faltan.slice(0, 300).map(v => [
      v.punto.sitio.nombre, v.punto.nombre,
      v.punto.equipo?.tag || '—',
      v.nombre, UNIDAD[v.unidad_reporte] || v.unidad_reporte
    ])
  );
}

// En pantalla ancha es una tabla con el encabezado fijo.
// En celular o tablet angosta, cada fila se convierte en una tarjeta:
// por eso cada celda lleva el nombre de su columna en data-col.
function tabla(cabeceras, filas, opciones = {}) {
  const thead = el('thead', {}, [el('tr', {}, cabeceras.map(h => el('th', { text: h })))]);
  const tbody = el('tbody', {}, filas.map(f => el('tr', {}, f.map((celda, j) => {
    const props = { 'data-col': cabeceras[j] || '' };
    if (opciones.num?.includes(j)) props.class = 'num';
    if (celda instanceof Node) return el('td', props, [celda]);
    props.text = String(celda ?? '—');
    return el('td', props);
  }))));
  return el('div', { class: 'tabla-caja' }, [el('table', {}, [thead, tbody])]);
}

/* ===================================================================
   VISTA · VALIDACIÓN
   =================================================================== */
async function vistaValidacion(c) {
  c.append(el('div', { class: 'fila entre seccion' }, [selectorPeriodo()]));
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando lecturas…' })]);
  c.append(zona);

  let alertas = [];
  try {
    const { data } = await sb.from('v_alertas_duras').select('*').eq('periodo', S.periodo);
    alertas = data || [];
  } catch { /* ignorar */ }
  const porLectura = {};
  for (const a of alertas) (porLectura[a.lectura_id] ||= []).push(a);

  const dup = await bloqueDuplicados(S.periodo);
  const pendientes = S.lecturas.filter(l => !['validada', 'descartada'].includes(l.estado));
  if (!pendientes.length) {
    poner(zona, dup, el('p', { class: 'vacio', text: 'No hay lecturas por validar en este periodo.' }));
    return;
  }

  const filas = pendientes.map(l => {
    const v = S.catalogo.variables.find(x => x.id === l.variable_id);
    const u = v ? (UNIDAD[v.unidad_reporte] || v.unidad_reporte) : '';
    const al = porLectura[l.id] || [];
    return [
      v ? v.punto.sitio.nombre : '—',
      v ? v.punto.nombre : ('variable ' + l.variable_id),
      v ? v.nombre : '',
      l.sin_dato ? el('span', { class: 'pill warn', text: 'sin dato' })
                 : el('span', { class: 'num', text: `${num(l.valor)} ${u}` }),
      fechaCorta(l.fecha_lectura),
      al.length ? el('span', { class: 'pill ' + (al.some(a => a.severidad === 'alta') ? 'bad' : 'warn'),
                               text: al.length + ' alerta' + (al.length > 1 ? 's' : '') })
                : el('span', { class: 'pill ok', text: 'sin alertas' }),
      el('div', { class: 'fila' }, [
        el('button', { class: 'btn chico', text: 'Revisar', onclick: () => revisarLectura(l, v, al) })
      ])
    ];
  });

  poner(zona, dup, tabla(
    ['Sitio', 'Punto', 'Variable', 'Lectura', 'Fecha', 'Estado', ''], filas));
}

async function revisarLectura(l, v, alertas) {
  const u = v ? (UNIDAD[v.unidad_reporte] || v.unidad_reporte) : '';
  const cuerpo = el('div');

  // foto
  if (l.fotos && l.fotos.length) {
    for (const f of l.fotos) {
      const { data } = await sb.storage.from(C.BUCKET).createSignedUrl(f.storage_path, 600);
      if (data?.signedUrl) cuerpo.append(el('img', { src: data.signedUrl, alt: 'Foto del medidor' }));
    }
  } else {
    cuerpo.append(el('p', { class: 'banda warn', text: 'Esta lectura no tiene foto: no se puede contrastar el número contra el display.' }));
  }

  cuerpo.append(el('div', { class: 'anterior' }, [
    el('span', { html: `<b>${esc(v?.punto.nombre || '')}</b><br><small>${esc(v?.nombre || '')}</small>` }),
    el('span', { html: `<b>${l.sin_dato ? 'Sin dato' : num(l.valor) + ' ' + u}</b><br><small>${fechaHora(l.fecha_lectura)}</small>` })
  ]));

  for (const a of alertas) {
    cuerpo.append(el('div', { class: 'banda ' + (a.severidad === 'alta' ? 'bad' : 'warn'), text: a.detalle }));
  }
  if (l.observacion) {
    cuerpo.append(el('p', { class: 'ayuda', html: '<b>Observación de terreno:</b> ' + esc(l.observacion) }));
  }

  const nuevoValor = el('input', { type: 'number', value: l.valor_display ?? '', placeholder: 'Corregir valor' });
  const motivo = el('input', { type: 'text', placeholder: 'Motivo de la corrección (obligatorio si cambias el valor)' });
  const obsVal = el('textarea', { placeholder: 'Observación de la validación (opcional)' });

  // --- reinicio del totalizador ---------------------------------------
  const hayReinicio = alertas.some(x => x.regla === 'lectura_menor_que_anterior') || l.es_reset;
  const consumoReal = el('input', { type: 'number', value: l.consumo_manual ?? '',
                                    placeholder: `Consumo real del mes en ${u}` });
  const tipoReset = el('select');
  for (const [v_, t] of [['vuelta_contador','El display dio la vuelta'],
                         ['cambio_equipo','Se cambió el medidor'],
                         ['reprogramacion','Se reprogramó el equipo']]) {
    tipoReset.append(el('option', { value: v_, selected: l.tipo_reset === v_ || null, text: t }));
  }
  const cajaReset = el('div', { class: 'card', style: 'margin:16px 0' }, [
    el('h4', { style: 'margin-top:0', text: 'El totalizador se reinició' }),
    el('p', { class: 'ayuda', text: 'La resta contra la lectura anterior no sirve. Escribe cuánto se consumió realmente ese mes y queda registrado con tu motivo.' }),
    el('label', { text: 'Qué pasó' }, [tipoReset]),
    el('label', { text: 'Consumo real del mes' }, [consumoReal]),
    el('div', { class: 'fila' }, [
      el('button', { class: 'btn chico', text: 'Registrar el reinicio', onclick: async () => {
        if (!motivo.value.trim()) return toast('Escribe el motivo en el campo de abajo', true);
        const r = await sb.rpc('marcar_reinicio', {
          p_id: l.id, p_consumo: Number(consumoReal.value),
          p_tipo: tipoReset.value, p_motivo: motivo.value.trim() });
        if (r.error) return toast(r.error.message, true);
        toast('Reinicio registrado'); cerrarModal();
        await refrescarDatos(); render();
      } }),
      l.es_reset ? el('button', { class: 'btn chico peligro', text: 'Quitar la marca', onclick: async () => {
        const r = await sb.rpc('quitar_reinicio', { p_id: l.id, p_motivo: motivo.value.trim() });
        if (r.error) return toast(r.error.message, true);
        toast('Marca quitada'); cerrarModal();
        await refrescarDatos(); render();
      } }) : null
    ])
  ]);

  cuerpo.append(
    hayReinicio ? cajaReset : null,
    el('label', { text: 'Valor del display' }, [nuevoValor]),
    el('label', { text: 'Motivo del cambio' }, [motivo]),
    el('label', { text: 'Observación de validación' }, [obsVal]),
    el('div', { class: 'fila', style: 'margin-top:16px' }, [
      el('button', { class: 'btn ok crece', text: 'Validar', onclick: async () => {
        if (String(nuevoValor.value) !== String(l.valor_display ?? '')) {
          if (!motivo.value.trim()) return toast('Cambiaste el valor: escribe el motivo', true);
          const r = await sb.rpc('corregir_lectura', {
            p_id: l.id, p_valor_display: Number(nuevoValor.value), p_motivo: motivo.value.trim()
          });
          if (r.error) return toast(r.error.message, true);
        }
        const r2 = await sb.rpc('validar_lectura', { p_id: l.id, p_aprobar: true, p_obs: obsVal.value.trim() || null });
        if (r2.error) return toast(r2.error.message, true);
        cerrarModal(); toast('Lectura validada');
        await refrescarDatos(); render();
      } }),
      el('button', { class: 'btn peligro', text: 'Rechazar', onclick: async () => {
        if (!obsVal.value.trim()) return toast('Escribe por qué la rechazas', true);
        const r = await sb.rpc('validar_lectura', { p_id: l.id, p_aprobar: false, p_obs: obsVal.value.trim() });
        if (r.error) return toast(r.error.message, true);
        cerrarModal(); toast('Lectura rechazada · vuelve a terreno');
        await refrescarDatos(); render();
      } })
    ])
  );
  modal('Validar lectura', cuerpo);
}

/* ===================================================================
   GRÁFICO · barras de una sola serie
   Una serie por unidad: mezclar kWh con m³ en un mismo eje sería mentir.
   =================================================================== */
function graficoBarras(datos, { titulo, unidad, alto = 200 } = {}) {
  if (!datos.length) return null;
  const W = 760, H = alto, mIzq = 74, mDer = 14, mArr = 20, mAba = 30;
  const anchoUtil = W - mIzq - mDer, altoUtil = H - mArr - mAba;
  const max = Math.max(...datos.map(d => d.valor), 1);
  const paso = anchoUtil / datos.length;
  const anchoBarra = Math.min(paso - 6, 54);
  const maxIdx = datos.findIndex(d => d.valor === max);

  // escala redondeada para que la grilla dé números legibles
  const magnitud = Math.pow(10, Math.floor(Math.log10(max)));
  const tope = Math.ceil(max / (magnitud / 2)) * (magnitud / 2);
  const lineas = [0, 0.25, 0.5, 0.75, 1].map(f => f * tope);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `${titulo}. ${datos.map(d => `${d.etiqueta}: ${num(d.valor)} ${unidad}`).join('. ')}`);
  svg.classList.add('grafico');

  const ns = (t, at, txt) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', t);
    for (const [k, v] of Object.entries(at)) n.setAttribute(k, v);
    if (txt !== undefined) n.textContent = txt;
    return n;
  };
  const y = v => mArr + altoUtil - (v / tope) * altoUtil;

  for (const l of lineas) {
    svg.append(ns('line', { x1: mIzq, x2: W - mDer, y1: y(l), y2: y(l), class: 'grid' }));
    svg.append(ns('text', { x: mIzq - 10, y: y(l) + 4, class: 'ejeY' }, numCorto(l)));
  }

  datos.forEach((d, i) => {
    const x = mIzq + i * paso + (paso - anchoBarra) / 2;
    const h = Math.max((d.valor / tope) * altoUtil, d.valor > 0 ? 2 : 0);
    const g = ns('g', { class: 'barra' });
    g.append(ns('rect', { x, y: y(d.valor), width: anchoBarra, height: h, rx: 4, class: 'marca' }));
    g.append(ns('rect', { x: mIzq + i * paso, y: mArr, width: paso, height: altoUtil, class: 'zona' }));
    g.append(ns('title', {}, `${d.etiqueta}: ${num(d.valor)} ${unidad}`));
    svg.append(g);
    svg.append(ns('text', { x: x + anchoBarra / 2, y: H - 10, class: 'ejeX' }, d.etiqueta));
    if (i === maxIdx) {   // etiqueta directa solo en el máximo
      svg.append(ns('text', { x: x + anchoBarra / 2, y: y(d.valor) - 7, class: 'valorMax' }, numCorto(d.valor)));
    }
  });
  svg.append(ns('line', { x1: mIzq, x2: W - mDer, y1: y(0), y2: y(0), class: 'base' }));

  return el('figure', { class: 'figura' }, [
    el('figcaption', { text: `${titulo} · ${unidad}` }),
    svg
  ]);
}

/* ===================================================================
   VISTA · ESTE DISPOSITIVO
   Lo que hay guardado acá y no en el servidor. Es la pantalla que
   responde "¿puedo confiar en que no se me perdió nada?".
   =================================================================== */
async function vistaDispositivo(c) {
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Revisando el dispositivo…' })]);
  c.append(zona);

  const [cola, alm] = await Promise.all([DB.pendientes(), DB.estadoAlmacenamiento()]);
  const mb = b => b == null ? '—' : (b / 1048576).toFixed(1) + ' MB';
  const masViejo = cola.length ? Math.min(...cola.map(x => x.creado || Date.now())) : null;
  const conError = cola.filter(x => x.intentos > 0);
  const instalada = window.matchMedia('(display-mode: standalone)').matches;

  poner(zona,
    el('div', { class: 'kpis seccion' }, [
      kpi(cola.length, 'registros sin enviar', cola.length ? 'aviso' : ''),
      kpi(conError.length, 'con error de envío', conError.length ? 'alerta' : ''),
      kpi(masViejo ? fechaCorta(new Date(masViejo).toISOString()) : '—', 'el más antiguo'),
      kpi(mb(alm.usado), 'ocupado en este equipo')
    ]),

    el('div', { class: 'card seccion' }, [
      el('h4', { style: 'margin-top:0', text: 'Almacenamiento persistente' }),
      alm.persistido
        ? el('p', { class: 'banda ok', text:
            'Concedido. El navegador no va a borrar lo guardado por falta de uso.' })
        : el('p', { class: 'banda warn', text: instalada
            ? 'No concedido todavía. Toca el botón para pedirlo.'
            : 'No concedido. En iPhone y iPad el navegador solo lo concede si la app está ' +
              'instalada en la pantalla de inicio: abre el menú Compartir y elige "Agregar a pantalla de inicio".' }),
      el('button', { class: 'btn', text: 'Pedir almacenamiento persistente', onclick: async () => {
        const ok = await DB.pedirPersistencia();
        toast(ok ? 'Concedido' : 'El navegador no lo concedió. Instala la app en la pantalla de inicio.', !ok);
        render();
      } }),
      el('p', { class: 'ayuda', text:
        'Sin esto, Safari borra lo guardado tras unos días sin abrir el sitio. En Android no ocurre.' })
    ]),

    el('div', { class: 'card seccion' }, [
      el('h4', { style: 'margin-top:0', text: 'Cola de envío' }),
      cola.length
        ? el('div', {}, [
            el('p', { class: 'ayuda', text: 'Estos registros están guardados acá y todavía no llegaron al servidor.' }),
            tabla(['Qué', 'Valor', 'Guardado', 'Intentos', 'Último error'],
              cola.map(x => {
                // La cola mezcla lecturas del cierre con recargas y movimientos
                // de generador: cada una se describe con lo suyo.
                let que, valor;
                if (x.tipo === 'recarga') {
                  const g = (S.catalogo.generadores || []).find(gg => gg.id === x.generador_id);
                  que = 'Recarga · ' + (g ? g.n_equipo : 'generador ' + x.generador_id);
                  valor = num(x.litros) + ' L';
                } else if (x.tipo === 'movimiento_generador') {
                  const g = (S.catalogo.generadores || []).find(gg => gg.id === x.generador_id);
                  que = (TIPOS_MOV[x.movimiento] || x.movimiento) + ' · ' + (g ? g.n_equipo : x.generador_id);
                  valor = x.horometro != null ? num(x.horometro) + ' h' : '—';
                } else {
                  const v = S.catalogo.variables.find(vv => vv.id === x.variable_id);
                  que = v ? `${v.punto.sitio.nombre} · ${v.punto.nombre}` : 'variable ' + x.variable_id;
                  valor = x.sin_dato ? 'sin dato' : num(x.valor_display ?? (x.valor_mwh || 0) * 1000 + (x.valor_kwh || 0));
                }
                return [que, valor, fechaHora(new Date(x.creado).toISOString()),
                        x.intentos || 0, x.ultimoError || '—'];
              }), { num: [3] }),
            el('div', { class: 'fila' }, [
              el('button', { class: 'btn primario', text: 'Intentar enviar ahora', onclick: () => sincronizar() }),
              el('button', { class: 'btn', text: 'Guardar lo pendiente en un archivo', onclick: exportarCola })
            ])
          ])
        : el('p', { class: 'banda ok', text: 'No queda nada por enviar. Todo lo tomado está en el servidor.' })
    ]),

    el('div', { class: 'card seccion' }, [
      el('h4', { style: 'margin-top:0', text: 'Recomendaciones' }),
      el('ul', {}, [
        el('li', { text: 'Instala la app en la pantalla de inicio; así el navegador protege lo guardado.' }),
        el('li', { text: 'Nunca tomes datos en una ventana privada o de incógnito: se borra al cerrarla.' }),
        el('li', { text: 'Si vas a estar varios días sin señal, guarda lo pendiente en un archivo antes de salir.' }),
        el('li', { text: 'Android es más seguro que iPhone para la captura en terreno.' })
      ])
    ])
  );

  async function exportarCola() {
    const datos = await DB.exportarPendientes();
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    descargar(blob, `Pendientes_${new Date().toISOString().slice(0,10)}.json`);
    toast('Archivo guardado. Consérvalo hasta que la cola se vacíe.');
  }
}

/* ===================================================================
   DUPLICADOS · dos personas tomaron el mismo punto
   =================================================================== */
async function bloqueDuplicados(periodo) {
  const { data } = await sb.from('v_duplicados').select('*').eq('periodo', periodo);
  if (!data || !data.length) return null;

  return el('div', { class: 'seccion' }, [
    el('h2', { text: 'Puntos tomados dos veces' }),
    el('p', { class: 'ayuda', text:
      'Dos personas registraron el mismo punto en este mes. Elige cuál vale: la otra queda descartada, ' +
      'con tu motivo y en la auditoría. Ninguna se borra.' }),
    tabla(['Sitio', 'Punto', 'Variable', 'Lecturas', ''],
      data.map(d => [
        d.sitio, d.punto, d.variable,
        el('span', { class: 'pill warn', text: d.n_lecturas + ' lecturas' }),
        el('button', { class: 'btn chico', text: 'Resolver', onclick: () => resolverDuplicado(d) })
      ]), { num: [3] })
  ]);
}

async function resolverDuplicado(d) {
  const { data: lects } = await sb.from('lecturas')
    .select('id, valor, fecha_lectura, observacion, estado, tomada_por, sin_dato, fotos(id, storage_path)')
    .in('id', d.lecturas).order('fecha_lectura');
  const v = S.catalogo.variables.find(x => x.id === d.variable_id);
  const u = v ? (UNIDAD[v.unidad_reporte] || v.unidad_reporte) : '';

  const motivo = el('input', { placeholder: 'Por qué te quedas con una y descartas la otra' });
  const tarjetas = [];
  for (const l of (lects || [])) {
    const foto = el('div');
    if (l.fotos?.length) {
      const { data: url } = await sb.storage.from(C.BUCKET).createSignedUrl(l.fotos[0].storage_path, 600);
      if (url?.signedUrl) foto.append(el('img', { src: url.signedUrl, alt: 'Foto del medidor' }));
    } else {
      foto.append(el('p', { class: 'ayuda', text: 'Sin foto' }));
    }
    tarjetas.push(el('div', { class: 'card' }, [
      el('h4', { style: 'margin-top:0', text: S.catalogo.gente?.[l.tomada_por] || 'sin autor' }),
      el('p', { class: 'ayuda', text: fechaHora(l.fecha_lectura) }),
      el('p', { style: 'font-size:26px;font-weight:700;margin:0',
                text: l.sin_dato ? 'sin dato' : `${num(l.valor)} ${u}` }),
      l.observacion ? el('p', { class: 'ayuda', text: l.observacion }) : null,
      foto,
      el('button', { class: 'btn ok', text: 'Esta es la que vale', onclick: async () => {
        if (!motivo.value.trim()) return toast('Escribe el motivo', true);
        for (const otra of lects) {
          if (otra.id === l.id) continue;
          const r = await sb.rpc('descartar_lectura', { p_id: otra.id, p_motivo: motivo.value.trim() });
          if (r.error) return toast(r.error.message, true);
        }
        cerrarModal(); toast('Duplicado resuelto');
        await refrescarDatos(); render();
      } })
    ]));
  }

  modal(`${d.punto} · ${d.variable}`, el('div', {}, [
    el('label', { text: 'Motivo' }, [motivo]),
    el('div', { class: 'grid2' }, tarjetas)
  ]));
}

/* ===================================================================
   VISTA · CONSUMOS E INFORMES
   =================================================================== */
const MODOS = { mes: 'Un mes', anio: 'Un año', rango: 'Un rango' };

async function vistaConsumos(c) {
  S.rep = S.rep || {
    modo: 'mes',
    mes: S.periodoConsumo,
    anio: String(new Date().getFullYear()),
    desde: primerDiaDelMes(new Date(new Date().getFullYear(), 0, 1)),
    hasta: S.periodoConsumo,
    grupo: '', sitio: ''
  };
  const R = S.rep;

  const selModo = el('select', { onchange: e => { R.modo = e.target.value; pintarFiltros(); cargar(); } });
  for (const [k, v] of Object.entries(MODOS))
    selModo.append(el('option', { value: k, selected: R.modo === k || null, text: v }));

  const gruposVisibles = new Set(S.catalogo.variables.map(v => v.grupo_id));
  const selGrupo = el('select', { onchange: e => { R.grupo = e.target.value; cargar(); } });
  selGrupo.append(el('option', { value: '', text: 'Todos los grupos' }));
  for (const g of S.catalogo.grupos.filter(g => gruposVisibles.has(g.id))
                                   .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999)))
    selGrupo.append(el('option', { value: g.nombre, selected: R.grupo === g.nombre || null, text: g.nombre }));

  const sitiosVisibles = [...new Set(S.catalogo.variables.map(v => v.punto.sitio.nombre))].sort();
  const selSitio = el('select', { onchange: e => { R.sitio = e.target.value; cargar(); } });
  selSitio.append(el('option', { value: '', text: 'Todos los sitios' }));
  for (const s of sitiosVisibles)
    selSitio.append(el('option', { value: s, selected: R.sitio === s || null, text: s }));

  const zonaFiltros = el('div', { class: 'fila crece' });
  const barra = el('div', { class: 'fila seccion' }, [
    el('label', { text: 'Ver' }, [selModo]),
    zonaFiltros,
    el('label', { text: 'Grupo' }, [selGrupo]),
    el('label', { text: 'Sitio' }, [selSitio])
  ]);
  const acciones = el('div', { class: 'fila entre seccion' }, [
    el('p', { class: 'ayuda crece', id: 'resumen-rango' }),
    el('span', { class: 'ayuda', id: 'planilla-paso' }),
    el('button', { class: 'btn', text: 'Descargar Excel', onclick: async e => {
      const b = e.target; b.disabled = true;
      const [d, h] = limites();
      try { await descargarPlanilla(d, h, { grupo: R.grupo, sitio: R.sitio }); }
      catch (err) { toast('No se pudo armar la planilla: ' + (err.message || err), true); }
      finally { b.disabled = false; $('#planilla-paso').textContent = ''; }
    } }),
    el('button', { class: 'btn', text: 'Todo el histórico en Excel', onclick: async e => {
      const b = e.target; b.disabled = true;
      try {
        const { data } = await sb.from('v_consumos').select('mes').order('mes').limit(1);
        const primero = data && data.length ? data[0].mes : primerDiaDelMes(new Date());
        await descargarPlanilla(primero, primerDiaDelMes(new Date()), { grupo: R.grupo, sitio: R.sitio });
      } catch (err) { toast('No se pudo armar la planilla: ' + (err.message || err), true); }
      finally { b.disabled = false; $('#planilla-paso').textContent = ''; }
    } }),
    el('button', { class: 'btn', text: 'Vista para imprimir', onclick: () => imprimirInforme() })
  ]);
  const zona = el('div');
  c.append(barra, acciones, zona);

  function opcionesMes(valorActual, alCambiar) {
    const hoy = new Date(); const sel = el('select', { onchange: e => { alCambiar(e.target.value); cargar(); } });
    for (let i = 0; i < 36; i++) {
      const p = primerDiaDelMes(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1));
      sel.append(el('option', { value: p, selected: p === valorActual || null, text: nombrePeriodo(p) }));
    }
    return sel;
  }

  function pintarFiltros() {
    zonaFiltros.replaceChildren();
    if (R.modo === 'mes') {
      zonaFiltros.append(el('label', { class: 'crece', text: 'Mes' },
        [opcionesMes(R.mes, v => R.mes = v)]));
    } else if (R.modo === 'anio') {
      const sel = el('select', { onchange: e => { R.anio = e.target.value; cargar(); } });
      const y = new Date().getFullYear();
      for (let a = y; a >= y - 4; a--)
        sel.append(el('option', { value: String(a), selected: R.anio === String(a) || null, text: String(a) }));
      zonaFiltros.append(el('label', { class: 'crece', text: 'Año' }, [sel]));
    } else {
      zonaFiltros.append(
        el('label', { class: 'crece', text: 'Desde' }, [opcionesMes(R.desde, v => R.desde = v)]),
        el('label', { class: 'crece', text: 'Hasta' }, [opcionesMes(R.hasta, v => R.hasta = v)]));
    }
  }

  function limites() {
    if (R.modo === 'mes')  return [R.mes, R.mes];
    if (R.modo === 'anio') return [`${R.anio}-01-01`, `${R.anio}-12-01`];
    return R.desde <= R.hasta ? [R.desde, R.hasta] : [R.hasta, R.desde];
  }

  async function cargar() {
    zona.replaceChildren(el('p', { class: 'cargando', text: 'Calculando consumos…' }));
    const [desde, hasta] = limites();
    let q = sb.from('v_consumos').select('*').gte('mes', desde).lte('mes', hasta)
              .order('sitio').order('punto');
    if (R.grupo) q = q.eq('grupo', R.grupo);
    if (R.sitio) q = q.eq('sitio', R.sitio);
    const { data, error } = await q;
    if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }
    S.repDatos = { filas: data, desde, hasta };
    poner(zona, ...armarInforme(data, desde, hasta));
    const r = $('#resumen-rango');
    if (r) r.textContent = data.length
      ? `${new Set(data.map(f => f.punto_id)).size} puntos · ${data.length} valores calculados`
      : '';
  }

  pintarFiltros();
  cargar();
}

/* ---------- armado del informe (se reutiliza en pantalla y al imprimir) ---------- */
function armarInforme(data, desde, hasta) {
  if (!data.length) {
    return [el('p', { class: 'vacio', html:
      `No hay consumos calculados en ese periodo.<br>` +
      'Un mes se puede calcular recién cuando existe la lectura del mes siguiente.' })];
  }

  const meses = [...new Set(data.map(f => f.mes))].sort();
  const unidades = [...new Set(data.map(f => f.unidad_reporte))];
  const partes = [];

  // ---- KPIs por unidad + calidad del dato ----
  const kpis = [];
  for (const u of unidades) {
    const total = data.filter(f => f.unidad_reporte === u).reduce((a, f) => a + Number(f.consumo), 0);
    kpis.push(kpi(num(total), `total ${UNIDAD[u] || u}`));
  }
  const metodos = { directo: 0, prorrateado: 0, estimado: 0 };
  for (const f of data) metodos[f.metodo] = (metodos[f.metodo] || 0) + 1;
  const provisionales = data.filter(f => !f.completo).length;
  kpis.push(kpi(new Set(data.map(f => f.punto_id)).size, 'puntos'));
  if (provisionales) kpis.push(kpi(provisionales, 'valores provisionales', 'aviso'));
  partes.push(el('div', { class: 'kpis seccion' }, kpis));

  // ---- gráfico por unidad: totales mensuales ----
  for (const u of unidades) {
    const serie = meses.map(m => ({
      etiqueta: nombrePeriodo(m).split(' ')[0].slice(0, 3),
      valor: data.filter(f => f.mes === m && f.unidad_reporte === u)
                 .reduce((a, f) => a + Number(f.consumo), 0)
    })).filter(d => d.valor > 0);
    if (serie.length > 1) {
      partes.push(graficoBarras(serie,
        { titulo: 'Consumo mensual del conjunto', unidad: UNIDAD[u] || u }));
    }
  }

  // ---- tabla ----
  if (meses.length === 1) {
    partes.push(tabla(
      ['Sitio', 'Punto', 'TAG', 'Variable', 'Consumo', 'Unidad', 'Días', 'Método', 'Estado'],
      data.map(f => [
        f.sitio, f.punto, f.tag || '—', f.variable,
        num(f.consumo), UNIDAD[f.unidad_reporte] || f.unidad_reporte, f.dias_asignados,
        el('span', { class: 'pill ' + ({ directo: 'ok', prorrateado: 'acento', estimado: 'warn' }[f.metodo] || 'neutro'), text: f.metodo }),
        el('span', { class: 'pill ' + (f.completo ? 'ok' : 'warn'), text: f.completo ? 'cerrado' : 'provisional' })
      ]), { num: [4, 6] }));
  } else {
    // pivote: una fila por punto·variable, una columna por mes
    const claves = new Map();
    for (const f of data) {
      const k = f.variable_id;
      if (!claves.has(k)) claves.set(k, { f, meses: {} });
      claves.get(k).meses[f.mes] = Number(f.consumo);
    }
    const cab = ['Sitio', 'Punto', 'TAG', 'Variable', 'Un.',
                 ...meses.map(m => nombrePeriodo(m).split(' ')[0].slice(0, 3)), 'Total'];
    const filas = [...claves.values()]
      .sort((a, b) => compararGrupos(a.f.grupo, b.f.grupo) ||
                      `${a.f.sitio}${a.f.punto}`.localeCompare(`${b.f.sitio}${b.f.punto}`))
      .map(({ f, meses: mm }) => {
        const vals = meses.map(m => mm[m]);
        const total = vals.reduce((a, v) => a + (v || 0), 0);
        return [f.sitio, f.punto, f.tag || '—', f.variable,
                UNIDAD[f.unidad_reporte] || f.unidad_reporte,
                ...vals.map(v => v === undefined ? '—' : num(v)), num(total)];
      });
    partes.push(tabla(cab, filas, { num: cab.map((_, i) => i).filter(i => i >= 5) }));
  }

  // ---- declaración de calidad ----
  const total = data.length;
  const pct = n => Math.round(100 * n / total);
  partes.push(el('div', { class: 'calidad' }, [
    el('h4', { text: 'Calidad del dato' }),
    el('p', { html:
      `De ${total} valores del periodo: <b>${metodos.directo || 0}</b> (${pct(metodos.directo || 0)}%) ` +
      `salen de lecturas tomadas el día 1; <b>${metodos.prorrateado || 0}</b> (${pct(metodos.prorrateado || 0)}%) ` +
      `se prorratearon por desfase en la fecha de lectura; <b>${metodos.estimado || 0}</b> (${pct(metodos.estimado || 0)}%) ` +
      `provienen de la carga histórica, donde no existe la fecha real de lectura. ` +
      (provisionales ? `<b>${provisionales}</b> valores son provisionales: el mes cierra cuando llegue la lectura siguiente.` : '') })
  ]));

  return partes;
}

/* ---------- informe imprimible ---------- */
async function imprimirInforme() {
  if (!S.repDatos || !S.repDatos.filas.length) return toast('No hay datos para imprimir', true);
  const { filas, desde, hasta } = S.repDatos;
  const R = S.rep;
  const puntos = [...new Set(filas.map(f => f.punto_id))];

  // avisos abiertos y lecturas faltantes del alcance
  let avisos = [];
  try {
    const { data } = await sb.from('avisos')
      .select('descripcion, severidad, abierto_en, punto:puntos(nombre), categoria:catalogo_avisos(categoria)')
      .neq('estado', 'resuelto').in('punto_id', puntos.slice(0, 200));
    avisos = data || [];
  } catch { /* sin avisos */ }

  const titulo = R.grupo || R.sitio || 'Todos los puntos';
  const periodo = desde === hasta ? nombrePeriodo(desde)
                                  : `${nombrePeriodo(desde)} a ${nombrePeriodo(hasta)}`;

  const hoja = el('div', { class: 'hoja' }, [
    el('header', { class: 'hoja-cab' }, [
      el('div', {}, [
        el('h1', { text: 'Informe de consumos' }),
        el('p', { class: 'hoja-sub', text: `${titulo} · ${periodo}` })
      ]),
      el('div', { class: 'hoja-meta', html:
        `Algorta Norte<br>Generado por ${esc(S.usuario.nombre)}<br>${fechaHora(new Date().toISOString())}` })
    ]),
    ...armarInforme(filas, desde, hasta),
    avisos.length ? el('div', { class: 'seccion' }, [
      el('h4', { text: 'Avisos abiertos en estos puntos' }),
      tabla(['Punto', 'Categoría', 'Severidad', 'Abierto', 'Descripción'], avisos.map(a => [
        a.punto?.nombre || '—', a.categoria?.categoria || '—', a.severidad,
        fechaCorta(a.abierto_en), a.descripcion || '—']))
    ]) : null,
    el('p', { class: 'hoja-pie', text:
      'Los consumos se calculan repartiendo lo medido entre dos lecturas sobre los días de calendario que cubren. ' +
      'Un mes queda cerrado cuando existe la lectura del mes siguiente.' })
  ]);

  const cont = document.getElementById('impresion');
  cont.replaceChildren(hoja);
  document.body.classList.add('imprimiendo');
  const limpiar = () => {
    document.body.classList.remove('imprimiendo');
    cont.replaceChildren();
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);
  setTimeout(() => window.print(), 120);
}

/* ===================================================================
   PLANILLA ANUAL EN EXCEL
   Dos miradas del mismo dato, porque sirven para cosas distintas:
   · Resumen anual  → una fila por punto, para leer y mandar.
   · Detalle mensual → totalizador, consumo y variación, para revisar.
   Más una pestaña por grupo, para mandarle a cada sector solo lo suyo.
   =================================================================== */

// PostgREST devuelve 1.000 filas como máximo. Con dos años de lecturas eso
// truncaría la planilla en silencio, que es la peor forma de fallar.
async function traerTodo(armar, paso = 1000) {
  const salida = [];
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await armar().range(desde, desde + paso - 1);
    if (error) throw error;
    salida.push(...data);
    if (data.length < paso) return salida;
  }
}

const MES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function etiquetaMes(m, variosAnios) {
  const [a, mm] = m.split('-');
  return variosAnios ? `${MES_CORTO[+mm - 1]}-${a}` : MES_CORTO[+mm - 1];
}
const mesSiguiente = m => {
  const d = new Date(m + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};
// Excel no acepta : \ / ? * [ ] en el nombre de una hoja, ni más de 31 caracteres.
const nombreHoja = (s, usados) => {
  let base = String(s).replace(/[:\\\/\?\*\[\]]/g, '-').slice(0, 31) || 'Hoja';
  let n = base, i = 2;
  while (usados.has(n)) { n = base.slice(0, 28) + '~' + i++; }
  usados.add(n);
  return n;
};

async function descargarPlanilla(desde, hasta, filtros = {}) {
  const paso = t => { const p = $('#planilla-paso'); if (p) p.textContent = t; };
  if (typeof JSZip === 'undefined') {
    paso('Cargando el compresor…');
    await new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = 'jszip.js'; s.onload = ok; s.onerror = mal;
      document.head.append(s);
    });
  }
  paso('Consultando consumos…');
  const cons = await traerTodo(() => {
    let q = sb.from('v_consumos').select('*').gte('mes', desde).lte('mes', hasta)
              .order('mes').order('sitio').order('punto');
    if (filtros.grupo) q = q.eq('grupo', filtros.grupo);
    if (filtros.sitio) q = q.eq('sitio', filtros.sitio);
    return q;
  });
  if (!cons.length) { paso(''); return toast('No hay consumos en ese periodo', true); }

  paso('Consultando lecturas…');
  // El totalizador de un mes es la lectura del mes siguiente, así que hay que
  // pedir un mes más para que la última columna no quede vacía.
  const lect = await traerTodo(() => {
    let q = sb.from('v_respaldo').select('*')
             .gte('periodo', desde).lte('periodo', mesSiguiente(hasta))
             .order('periodo');
    if (filtros.grupo) q = q.eq('grupo', filtros.grupo);
    if (filtros.sitio) q = q.eq('sitio', filtros.sitio);
    return q;
  });

  paso('Armando el libro…');
  const meses = [...new Set(cons.map(c => c.mes))].sort();
  const variosAnios = new Set(meses.map(m => m.slice(0, 4))).size > 1;
  const cabMeses = meses.map(m => etiquetaMes(m, variosAnios));

  // ---- datos por variable ----
  const porVar = new Map();
  for (const c of cons) {
    if (!porVar.has(c.variable_id)) porVar.set(c.variable_id, {
      tag: c.tag || '', sitio: c.sitio, grupo: c.grupo || 'Sin grupo', punto: c.punto,
      variable: c.variable, unidad: c.unidad_reporte, cons: {}, estado: {}, metodo: {}, lect: {}
    });
    const v = porVar.get(c.variable_id);
    v.cons[c.mes] = Number(c.consumo);
    v.estado[c.mes] = c.completo ? 'cerrado' : 'provisional';
    v.metodo[c.mes] = c.metodo;
  }
  for (const f of lect) {
    const v = porVar.get(f.variable_id);
    if (v && f.valor !== null) v.lect[f.periodo] = Number(f.valor);
  }
  const filasVar = [...porVar.values()].sort((a, b) =>
    compararGrupos(a.grupo, b.grupo) ||
    (a.sitio + a.punto).localeCompare(b.sitio + b.punto));

  const totalFila = v => meses.reduce((s, m) => s + (v.cons[m] || 0), 0);

  // ---- 1 · Resumen anual: bloques por grupo y unidad, con subtotal ----
  const resumen = [['TAG', 'Sitio', 'Punto', 'Variable', 'Unidad', ...cabMeses, 'TOTAL']];
  const general = {};
  // Un subtotal que mezcla kWh con m3 es un número que no significa nada:
  // por eso cada grupo cierra con un subtotal POR UNIDAD.
  let grupoActual = null, acumGrupo = {};
  const cerrarGrupo = () => {
    if (grupoActual === null) return;
    for (const [u, acum] of Object.entries(acumGrupo)) {
      resumen.push(['', '', `Subtotal ${grupoActual}`, '', u,
        ...meses.map(m => redondear(acum[m])),
        redondear(meses.reduce((s, m) => s + (acum[m] || 0), 0))]);
    }
    resumen.push([]);
  };
  for (const v of filasVar) {
    if (v.grupo !== grupoActual) {
      cerrarGrupo();
      grupoActual = v.grupo; acumGrupo = {};
      resumen.push([`GRUPO: ${grupoActual}`]);
    }
    (general[v.unidad] ||= {});
    (acumGrupo[v.unidad] ||= {});
    meses.forEach(m => {
      general[v.unidad][m] = (general[v.unidad][m] || 0) + (v.cons[m] || 0);
      acumGrupo[v.unidad][m] = (acumGrupo[v.unidad][m] || 0) + (v.cons[m] || 0);
    });
    resumen.push([v.tag, v.sitio, v.punto, v.variable, v.unidad,
      ...meses.map(m => redondear(v.cons[m])), redondear(totalFila(v))]);
  }
  cerrarGrupo();
  for (const [u, acum] of Object.entries(general)) {
    resumen.push(['', '', `TOTAL GENERAL (${u})`, '', u,
      ...meses.map(m => redondear(acum[m])), redondear(meses.reduce((s, m) => s + (acum[m] || 0), 0))]);
  }

  // ---- 2 · Detalle mensual: totalizador, consumo y variación ----
  const detalle = [['TAG', 'Sitio', 'Grupo', 'Punto', 'Variable', 'Unidad', 'Fila', ...cabMeses]];
  for (const v of filasVar) {
    detalle.push([v.tag, v.sitio, v.grupo, v.punto, v.variable, v.unidad, 'Totalizador',
      ...meses.map(m => redondear(v.lect[mesSiguiente(m)]))]);
    detalle.push(['', '', '', '', '', '', 'Consumo del mes',
      ...meses.map(m => redondear(v.cons[m]))]);
    detalle.push(['', '', '', '', '', '', 'Var. % vs mes anterior', ...meses.map((m, i) => {
      if (i === 0) return '';
      const a = v.cons[meses[i - 1]], b = v.cons[m];
      // en puntos porcentuales: -62,8 se lee solo; -0,628 obliga a formatear la celda
      return (a && b) ? Number((100 * (b - a) / a).toFixed(1)) : '';
    })]);
    detalle.push(['', '', '', '', '', '', 'Estado', ...meses.map(m => v.estado[m] || '')]);
  }

  // ---- 3 · una hoja por grupo ----
  const usados = new Set();
  const hojas = [
    { nombre: nombreHoja('Resumen anual', usados), filas: resumen },
    { nombre: nombreHoja('Detalle mensual', usados), filas: detalle }
  ];
  const grupos = [...new Set(filasVar.map(v => v.grupo))].sort(compararGrupos);
  for (const g of grupos) {
    const suyas = filasVar.filter(v => v.grupo === g);
    const f = [[`GRUPO: ${g}`], [], ['TAG', 'Sitio', 'Punto', 'Variable', 'Unidad', ...cabMeses, 'TOTAL']];
    for (const v of suyas)
      f.push([v.tag, v.sitio, v.punto, v.variable, v.unidad,
        ...meses.map(m => redondear(v.cons[m])), redondear(totalFila(v))]);
    const porUnidad = {};
    for (const v of suyas) { (porUnidad[v.unidad] ||= {}); meses.forEach(m => porUnidad[v.unidad][m] = (porUnidad[v.unidad][m] || 0) + (v.cons[m] || 0)); }
    f.push([]);
    for (const [u, acum] of Object.entries(porUnidad))
      f.push(['', '', `TOTAL ${g} (${u})`, '', u,
        ...meses.map(m => redondear(acum[m])), redondear(meses.reduce((s, m) => s + (acum[m] || 0), 0))]);
    hojas.push({ nombre: nombreHoja(g, usados), filas: f });
  }

  // ---- 4 · lecturas y 5 · consumos en formato largo ----
  hojas.push({ nombre: nombreHoja('Lecturas', usados), filas: [
    ['Periodo', 'Fecha de lectura', 'Fecha estimada', 'Sitio', 'Grupo', 'Punto', 'TAG', 'Variable',
     'Unidad', 'Valor', 'Sin dato', 'Reinicio', 'Consumo declarado', 'Estado', 'Origen',
     'Observación', 'Obs. validación', 'Foto'],
    ...lect.map(f => [f.periodo, String(f.fecha_lectura).slice(0, 19).replace('T', ' '),
      f.fecha_estimada ? 'sí' : 'no', f.sitio, f.grupo || '', f.punto, f.tag || '', f.variable,
      f.unidad, f.valor === null ? '' : Number(f.valor), f.sin_dato ? 'sí' : 'no',
      f.es_reset ? (f.tipo_reset || 'sí') : 'no',
      f.consumo_manual === null || f.consumo_manual === undefined ? '' : Number(f.consumo_manual),
      f.estado, f.origen, f.observacion || '', f.obs_validacion || '', f.storage_path ? 'sí' : 'no'])
  ]});
  hojas.push({ nombre: nombreHoja('Consumos', usados), filas: [
    ['Mes', 'Sitio', 'Grupo', 'Punto', 'TAG', 'Variable', 'Unidad', 'Consumo', 'Días', 'Método', 'Estado'],
    ...cons.map(c => [c.mes, c.sitio, c.grupo || '', c.punto, c.tag || '', c.variable,
      c.unidad_reporte, Number(c.consumo), c.dias_asignados, c.metodo,
      c.completo ? 'cerrado' : 'provisional'])
  ]});

  // ---- 6 · calidad del dato ----
  const cuenta = (arr, f) => arr.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
  const porMetodo = cuenta(cons, c => c.metodo);
  const prov = cons.filter(c => !c.completo);
  hojas.push({ nombre: nombreHoja('Calidad del dato', usados), filas: [
    ['Concepto', 'Valor'],
    ['Periodo', `${nombrePeriodo(desde)} a ${nombrePeriodo(hasta)}`],
    ['Generado', new Date().toLocaleString('es-CL')],
    ['Generado por', S.usuario.nombre],
    ['Filtro de grupo', filtros.grupo || 'todos'],
    ['Filtro de sitio', filtros.sitio || 'todos'],
    ['Puntos', new Set(cons.map(c => c.punto_id)).size],
    ['Valores de consumo', cons.length],
    ['Lecturas incluidas', lect.length],
    [],
    ['Cómo se calculó cada consumo', ''],
    ['directo (lectura del día 1)', porMetodo.directo || 0],
    ['prorrateado (fecha corrida)', porMetodo.prorrateado || 0],
    ['estimado (carga histórica)', porMetodo.estimado || 0],
    [],
    ['Valores provisionales', prov.length],
    ['', 'Un mes queda cerrado cuando existe la lectura del mes siguiente.'],
    [],
    ['Cómo leer la planilla', ''],
    ['', 'El consumo de un mes se reparte entre las lecturas que lo cubren, por días de calendario.'],
    ['', 'En "Detalle mensual", el totalizador de un mes es la lectura tomada al comienzo del mes siguiente.'],
    ...prov.slice(0, 200).map(c => ['provisional', `${c.mes} · ${c.punto} · ${c.variable}`])
  ]});

  paso('Escribiendo el archivo…');
  const blob = await window.RESPALDO.construirExcel(hojas);
  const alcance = filtros.grupo ? '_' + window.RESPALDO.limpio(filtros.grupo)
                : filtros.sitio ? '_' + window.RESPALDO.limpio(filtros.sitio) : '';
  descargar(blob, `Consumos_${desde.slice(0, 7)}_a_${hasta.slice(0, 7)}${alcance}.xlsx`);
  paso('');
  toast(`Planilla lista: ${filasVar.length} puntos, ${meses.length} meses`);
}

// Excel guarda lo que le den: conviene no arrastrar 12 decimales de un prorrateo.
function redondear(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return Math.round(Number(v) * 100) / 100;
}

/* ===================================================================
   VISTA · AVISOS
   =================================================================== */
async function vistaAvisos(c) {
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando avisos…' })]);
  c.append(zona);
  const { data, error } = await sb.from('avisos')
    .select('id, descripcion, severidad, estado, abierto_en, resuelto_en, obs_resolucion, punto:puntos(nombre, sitio:sitios(nombre)), categoria:catalogo_avisos(categoria)')
    .order('abierto_en', { ascending: false });
  if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }
  if (!data.length) { zona.replaceChildren(el('p', { class: 'vacio', text: 'No hay avisos registrados.' })); return; }

  const filas = data.map(a => [
    a.punto?.sitio?.nombre || '—', a.punto?.nombre || '—', a.categoria?.categoria || '—',
    el('span', { class: 'pill ' + ({ alta: 'bad', media: 'warn', baja: 'neutro' }[a.severidad]), text: a.severidad }),
    el('span', { class: 'pill ' + (a.estado === 'resuelto' ? 'ok' : 'warn'), text: a.estado }),
    fechaCorta(a.abierto_en),
    a.descripcion || '—',
    a.estado === 'resuelto' ? '—' : el('button', { class: 'btn chico', text: 'Resolver', onclick: () => resolverAviso(a) })
  ]);
  zona.replaceChildren(
    el('p', { class: 'ayuda', text: `${data.filter(a => a.estado !== 'resuelto').length} avisos abiertos de ${data.length}` }),
    tabla(['Sitio', 'Punto', 'Categoría', 'Severidad', 'Estado', 'Abierto', 'Descripción', ''], filas));
}

function resolverAviso(a) {
  const obs = el('textarea', { placeholder: 'Qué se hizo para resolverlo' });
  modal('Resolver aviso', el('div', {}, [
    el('p', { class: 'ayuda', text: `${a.punto?.nombre} · ${a.categoria?.categoria}` }),
    el('label', { text: 'Observación de la solución' }, [obs]),
    el('button', { class: 'btn primario grande', text: 'Marcar como resuelto', onclick: async () => {
      const { error } = await sb.from('avisos').update({
        estado: 'resuelto', resuelto_por: S.usuario.id,
        resuelto_en: new Date().toISOString(), obs_resolucion: obs.value.trim() || null
      }).eq('id', a.id);
      if (error) return toast(error.message, true);
      cerrarModal(); toast('Aviso resuelto'); render();
    } })
  ]));
}

/* ===================================================================
   CONFIGURACIÓN · EQUIPOS
   El equipo existe por sí solo. Se asigna a un punto, y esa asignación
   tiene fecha: por eso se puede saber dónde estuvo cada medidor.
   =================================================================== */
const ESTADO_EQUIPO = {
  en_servicio:   ['ok',     'en servicio'],
  bodega:        ['neutro', 'en bodega'],
  en_reparacion: ['warn',   'en reparación'],
  baja:          ['bad',    'dado de baja']
};

async function vistaEquipos(c) {
  const filtro = el('input', { type: 'search', placeholder: 'Buscar por TAG, marca, serie o punto…',
    oninput: e => { S.filtro = e.target.value.toLowerCase(); pintar(); } });
  const selEstado = el('select', { onchange: pintar });
  selEstado.append(el('option', { value: '', text: 'Todos los estados' }));
  for (const [k, v] of Object.entries(ESTADO_EQUIPO))
    selEstado.append(el('option', { value: k, text: v[1] }));

  c.append(
    el('div', { class: 'fila entre seccion' }, [
      el('p', { class: 'ayuda crece', text: 'El inventario de aparatos. Un equipo puede estar instalado, en bodega, en reparación o dado de baja.' }),
      el('button', { class: 'btn', text: '+ Equipo nuevo', onclick: () => editarEquipo(null) })
    ]),
    el('div', { class: 'buscador fila' }, [el('div', { class: 'crece' }, [filtro]), selEstado])
  );
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando equipos…' })]);
  c.append(zona);

  let equipos = [];
  const { data, error } = await sb.from('v_equipos').select('*').order('tag', { nullsFirst: false });
  if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }
  equipos = data;

  function pintar() {
    const f = S.filtro, est = selEstado.value;
    const lista = equipos.filter(e =>
      (!est || e.estado === est) &&
      (!f || `${e.tag} ${e.marca} ${e.modelo} ${e.n_serie} ${e.punto_actual} ${e.sitio}`.toLowerCase().includes(f)));

    const filas = lista.map(e => [
      e.tag || el('span', { class: 'pill warn', text: 'sin TAG' }),
      e.marca || '—',
      e.modelo || '—',
      e.n_serie || el('span', { class: 'pill warn', text: 'falta' }),
      e.tipo || '—',
      e.sitio || '—',
      e.punto_actual || el('span', { class: 'pill neutro', text: 'sin instalar' }),
      el('span', { class: 'pill ' + (ESTADO_EQUIPO[e.estado]?.[0] || 'neutro'),
                   text: ESTADO_EQUIPO[e.estado]?.[1] || e.estado }),
      e.certificado
        ? el('span', { class: 'pill ' + (e.certificado_vencido ? 'bad' : 'ok'),
                       text: e.certificado_vencido ? 'vencido' : 'sí' })
        : el('span', { class: 'pill neutro', text: 'no' }),
      el('button', { class: 'btn chico', text: 'Abrir', onclick: () => editarEquipo(e) })
    ]);
    poner(zona,
      el('p', { class: 'ayuda', text:
        `${lista.length} equipos · ${equipos.filter(e => !e.punto_actual_id).length} sin instalar · ` +
        `${equipos.filter(e => e.certificado_vencido).length} con certificado vencido` }),
      tabla(['TAG', 'Marca', 'Modelo', 'Serie', 'Tipo', 'Sitio', 'Instalado en', 'Estado', 'Cert.', ''],
            filas, { etiquetas: true }));
  }
  pintar();
}

async function editarEquipo(eq) {
  const nuevo = !eq;
  const f = {
    tag:   el('input', { value: eq?.tag || '' }),
    marca: el('input', { value: eq?.marca || '' }),
    modelo: el('input', { value: eq?.modelo || '' }),
    serie: el('input', { value: eq?.n_serie || '' }),
    desc:  el('input', { value: eq?.descripcion || '' }),
    sitio: el('select'),
    tipo:  el('select'),
    cert:  el('input', { type: 'checkbox', checked: eq?.certificado || null }),
    ncert: el('input', { value: eq?.n_certificado || '' }),
    vence: el('input', { type: 'date', value: eq?.vence_certificado || '' })
  };
  f.sitio.append(el('option', { value: '', text: '— sin sitio —' }));
  for (const s of S.catalogo.sitios)
    f.sitio.append(el('option', { value: s.id, selected: eq?.sitio_id === s.id || null, text: s.nombre }));
  const tipos = {};
  for (const v of S.catalogo.variables) tipos[v.punto.tipo.id] = v.punto.tipo.nombre;
  f.tipo.append(el('option', { value: '', text: '— sin tipo —' }));
  for (const [id, nombre] of Object.entries(tipos))
    f.tipo.append(el('option', { value: id, selected: eq?.tipo_equipo_id == id || null, text: nombre }));

  const cuerpo = el('div', {}, [
    el('label', { text: 'TAG' }, [f.tag]),
    el('label', { text: 'Marca' }, [f.marca]),
    el('label', { text: 'Modelo' }, [f.modelo]),
    el('label', { text: 'N° de serie' }, [f.serie]),
    el('label', { text: 'Descripción' }, [f.desc]),
    el('label', { text: 'Sitio al que pertenece' }, [f.sitio]),
    el('label', { text: 'Tipo de equipo' }, [f.tipo]),
    el('label', { class: 'fila' }, [f.cert, el('span', { text: 'Certificado' })]),
    el('label', { text: 'N° de certificado' }, [f.ncert]),
    el('label', { text: 'Vence el' }, [f.vence]),
    el('button', { class: 'btn primario grande', style: 'margin-top:14px', text: 'Guardar', onclick: guardar })
  ]);

  // --- instalación y su historial ---
  if (!nuevo) {
    const zonaHist = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando historial…' })]);
    cuerpo.append(el('h3', { text: 'Dónde está instalado', style: 'margin-top:26px' }), zonaHist);

    const { data: hist } = await sb.from('asignaciones')
      .select('id, desde, hasta, motivo, punto:puntos(id, nombre, sitio:sitios(nombre))')
      .eq('equipo_id', eq.id).order('desde', { ascending: false });

    const selPunto = el('select');
    selPunto.append(el('option', { value: '', text: '— elegir punto —' }));
    const puntosOrdenados = [...new Map(S.catalogo.variables.map(v => [v.punto.id, v.punto])).values()]
      .sort((a, b) => `${a.sitio.nombre}${a.nombre}`.localeCompare(`${b.sitio.nombre}${b.nombre}`));
    for (const p of puntosOrdenados)
      selPunto.append(el('option', { value: p.id, text: `${p.sitio.nombre} · ${p.nombre}` }));
    const fechaMov = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const motivoMov = el('input', { placeholder: 'Motivo del movimiento' });

    poner(zonaHist,
      eq.punto_actual
        ? el('div', { class: 'anterior' }, [
            el('span', { html: `Instalado en<br><b>${esc(eq.punto_actual)}</b>` }),
            el('span', { html: `desde<br><b>${fechaCorta(eq.instalado_desde)}</b>` })
          ])
        : el('p', { class: 'banda warn', text: 'Este equipo no está instalado en ningún punto.' }),
      el('label', { text: 'Instalar o mover a' }, [selPunto]),
      el('label', { text: 'Fecha del movimiento' }, [fechaMov]),
      el('label', { text: 'Motivo' }, [motivoMov]),
      el('div', { class: 'fila' }, [
        el('button', { class: 'btn', text: 'Asignar a este punto', onclick: async () => {
          if (!selPunto.value) return toast('Elige un punto', true);
          const r = await sb.rpc('asignar_equipo', {
            p_equipo_id: eq.id, p_punto_id: Number(selPunto.value),
            p_desde: fechaMov.value, p_motivo: motivoMov.value.trim() || null });
          if (r.error) return toast(r.error.message, true);
          cerrarModal(); toast('Equipo asignado');
          S.catalogo = await DB.descargarCatalogo(); render();
        } }),
        eq.punto_actual_id ? el('button', { class: 'btn peligro', text: 'Retirar', onclick: async () => {
          if (!motivoMov.value.trim()) return toast('Escribe el motivo del retiro', true);
          const r = await sb.rpc('retirar_equipo', {
            p_equipo_id: eq.id, p_hasta: fechaMov.value,
            p_estado: 'bodega', p_motivo: motivoMov.value.trim() });
          if (r.error) return toast(r.error.message, true);
          cerrarModal(); toast('Equipo retirado a bodega');
          S.catalogo = await DB.descargarCatalogo(); render();
        } }) : null
      ]),
      (hist && hist.length)
        ? el('div', {}, [
            el('h4', { text: 'Historial' }),
            tabla(['Punto', 'Desde', 'Hasta', 'Motivo'], hist.map(a => [
              `${a.punto?.sitio?.nombre || ''} · ${a.punto?.nombre || ''}`,
              fechaCorta(a.desde),
              a.hasta ? fechaCorta(a.hasta) : el('span', { class: 'pill ok', text: 'instalado' }),
              a.motivo || '—'
            ]))
          ])
        : null
    );
  }

  async function guardar() {
    const datos = {
      tag: f.tag.value.trim() || null, marca: f.marca.value.trim() || null,
      modelo: f.modelo.value.trim() || null, n_serie: f.serie.value.trim() || null,
      descripcion: f.desc.value.trim() || null,
      sitio_id: f.sitio.value ? Number(f.sitio.value) : null,
      tipo_equipo_id: f.tipo.value ? Number(f.tipo.value) : null,
      certificado: f.cert.checked,
      n_certificado: f.ncert.value.trim() || null,
      vence_certificado: f.vence.value || null
    };
    const r = nuevo
      ? await sb.from('equipos').insert(datos)
      : await sb.from('equipos').update(datos).eq('id', eq.id);
    if (r.error) return toast(r.error.message, true);
    cerrarModal(); toast('Guardado');
    S.catalogo = await DB.descargarCatalogo(); render();
  }

  modal(nuevo ? 'Equipo nuevo' : (eq.tag || 'Equipo'), cuerpo);
}

/* ===================================================================
   CONFIGURACIÓN · PUNTOS DE MEDICIÓN
   =================================================================== */
async function vistaPuntos(c) {
  c.append(
    el('div', { class: 'fila entre seccion' }, [
      el('p', { class: 'ayuda crece', text: 'El lugar donde se mide. Permanece aunque se cambie el equipo: la serie histórica cuelga de aquí.' }),
      el('button', { class: 'btn', text: '+ Punto nuevo', onclick: () => editarPunto(null) })
    ]),
    el('div', { class: 'buscador' }, [
      el('input', { type: 'search', placeholder: 'Buscar punto, sitio o TAG…',
        oninput: e => { S.filtro = e.target.value.toLowerCase(); pintar(); } })
    ])
  );
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando puntos…' })]);
  c.append(zona);

  const { data, error } = await sb.from('v_puntos').select('*').order('sitio').order('nombre');
  if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }

  function pintar() {
    const f = S.filtro;
    const lista = data.filter(p => !f ||
      `${p.nombre} ${p.sitio} ${p.tag} ${p.area}`.toLowerCase().includes(f));
    const filas = lista.map(p => [
      p.sitio, p.nombre, p.area || '—', p.tipo,
      p.tag || el('span', { class: 'pill neutro', text: 'sin equipo' }),
      p.n_variables,
      p.n_equipos_historicos > 1
        ? el('span', { class: 'pill acento', text: p.n_equipos_historicos + ' equipos' })
        : '—',
      p.foto_obligatoria ? 'sí' : 'no',
      el('button', { class: 'btn chico', text: 'Abrir', onclick: () => editarPunto(p) })
    ]);
    poner(zona,
      el('p', { class: 'ayuda', text:
        `${lista.length} puntos · ${data.filter(p => !p.equipo_id).length} sin equipo instalado` }),
      tabla(['Sitio', 'Punto', 'Área', 'Tipo', 'Equipo', 'Variables', 'Historial', 'Foto', ''],
            filas, { num: [5], etiquetas: true }));
  }
  pintar();
}

async function editarPunto(punto) {
  const nuevo = !punto;
  const f = {
    nombre: el('input', { value: punto?.nombre || '' }),
    sitio:  el('select'),
    area:   el('input', { value: punto?.area || '' }),
    tipo:   el('select'),
    foto:   el('input', { type: 'checkbox', checked: punto?.foto_obligatoria || null }),
    calidad: el('select'),
    obs:    el('textarea', { value: punto?.observaciones || '' })
  };
  for (const s of S.catalogo.sitios)
    f.sitio.append(el('option', { value: s.id, selected: punto?.sitio_id === s.id || null, text: s.nombre }));
  const tipos = {};
  for (const v of S.catalogo.variables) tipos[v.punto.tipo.id] = v.punto.tipo.nombre;
  for (const [id, nombre] of Object.entries(tipos))
    f.tipo.append(el('option', { value: id, selected: punto?.tipo_equipo_id == id || null, text: nombre }));
  for (const [v_, t] of [['normal', 'Normal · ~300 KB'], ['alta', 'Alta · ~500 KB']])
    f.calidad.append(el('option', { value: v_, selected: (punto?.foto_calidad || 'normal') === v_ || null, text: t }));

  const cuerpo = el('div', {}, [
    el('label', { text: 'Nombre del punto' }, [f.nombre]),
    el('label', { text: 'Sitio' }, [f.sitio]),
    el('label', { text: 'Área / zona' }, [f.area]),
    el('label', { text: 'Tipo de equipo que va acá' }, [f.tipo]),
    el('label', { class: 'fila' }, [f.foto, el('span', { text: 'La foto es obligatoria en este punto' })]),
    el('label', { text: 'Calidad de la foto' }, [f.calidad]),
    el('p', { class: 'ayuda', text: 'Normal pesa ~300 KB y alcanza para leer un display. Alta pesa ~500 KB: úsala solo en los puntos que van a facturación o al reporte de la Ley 21.305.' }),
    el('label', { text: 'Observaciones' }, [f.obs]),
    el('button', { class: 'btn primario grande', style: 'margin-top:14px', text: 'Guardar', onclick: guardar })
  ]);

  if (!nuevo) {
    const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando…' })]);
    cuerpo.append(el('h3', { text: 'Equipo instalado', style: 'margin-top:26px' }), zona);

    const [{ data: hist }, { data: vars }, { data: libres }] = await Promise.all([
      sb.from('asignaciones').select('id, desde, hasta, motivo, equipo:equipos(id, tag, marca, modelo)')
        .eq('punto_id', punto.id).order('desde', { ascending: false }),
      sb.from('variables').select('id, nombre, unidad_display, unidad_reporte, formato_lectura, activo')
        .eq('punto_id', punto.id).order('nombre'),
      sb.from('v_equipos').select('id, tag, marca, punto_actual').is('punto_actual_id', null)
        .eq('activo', true).order('tag')
    ]);

    const selEquipo = el('select');
    selEquipo.append(el('option', { value: '', text: '— elegir equipo disponible —' }));
    for (const e of (libres || []))
      selEquipo.append(el('option', { value: e.id, text: `${e.tag || 'sin TAG'} · ${e.marca || ''}` }));
    const fecha = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const motivo = el('input', { placeholder: 'Motivo: instalación, reemplazo por daño…' });

    poner(zona,
      punto.tag
        ? el('div', { class: 'anterior' }, [
            el('span', { html: `<b>${esc(punto.tag)}</b><br><small>${esc(punto.marca || '')} ${esc(punto.modelo || '')}</small>` }),
            el('span', { html: `instalado desde<br><b>${fechaCorta(punto.equipo_desde)}</b>` })
          ])
        : el('p', { class: 'banda warn', text: 'Este punto no tiene equipo instalado.' }),
      el('label', { text: 'Instalar un equipo' }, [selEquipo]),
      (libres && !libres.length) ? el('p', { class: 'ayuda', text: 'No hay equipos disponibles. Retira uno primero o crea uno nuevo en la sección Equipos.' }) : null,
      el('label', { text: 'Fecha' }, [fecha]),
      el('label', { text: 'Motivo' }, [motivo]),
      el('button', { class: 'btn', text: 'Instalar en este punto', onclick: async () => {
        if (!selEquipo.value) return toast('Elige un equipo', true);
        const r = await sb.rpc('asignar_equipo', {
          p_equipo_id: Number(selEquipo.value), p_punto_id: punto.id,
          p_desde: fecha.value, p_motivo: motivo.value.trim() || null });
        if (r.error) return toast(r.error.message, true);
        cerrarModal(); toast('Equipo instalado');
        S.catalogo = await DB.descargarCatalogo(); render();
      } }),
      (hist && hist.length) ? el('div', {}, [
        el('h4', { text: 'Equipos que pasaron por acá' }),
        tabla(['Equipo', 'Desde', 'Hasta', 'Motivo'], hist.map(a => [
          `${a.equipo?.tag || 'sin TAG'} · ${a.equipo?.marca || ''}`,
          fechaCorta(a.desde),
          a.hasta ? fechaCorta(a.hasta) : el('span', { class: 'pill ok', text: 'instalado' }),
          a.motivo || '—'
        ]))
      ]) : null,
      el('h3', { text: 'Variables que se leen', style: 'margin-top:26px' }),
      (vars && vars.length)
        ? tabla(['Variable', 'Display', 'Informe', 'Formato'], vars.map(v => [
            v.nombre, UNIDAD[v.unidad_display] || v.unidad_display,
            UNIDAD[v.unidad_reporte] || v.unidad_reporte, v.formato_lectura]))
        : el('p', { class: 'ayuda', text: 'Sin variables. Un punto sin variables no aparece en terreno.' })
    );
  }

  async function guardar() {
    const datos = {
      nombre: f.nombre.value.trim(),
      sitio_id: Number(f.sitio.value),
      area: f.area.value.trim() || null,
      tipo_equipo_id: Number(f.tipo.value),
      foto_obligatoria: f.foto.checked,
      foto_calidad: f.calidad.value,
      observaciones: f.obs.value.trim() || null
    };
    if (!datos.nombre) return toast('El punto necesita un nombre', true);
    const r = nuevo
      ? await sb.from('puntos').insert(datos)
      : await sb.from('puntos').update(datos).eq('id', punto.id);
    if (r.error) return toast(r.error.message, true);
    cerrarModal(); toast('Guardado');
    S.catalogo = await DB.descargarCatalogo(); render();
  }

  modal(nuevo ? 'Punto nuevo' : punto.nombre, cuerpo);
}

/* ===================================================================
   CONFIGURACIÓN · GRUPOS
   =================================================================== */
async function vistaGrupos(c) {
  c.append(el('div', { class: 'fila entre seccion' }, [
    el('p', { class: 'ayuda crece', text: 'Los grupos son la unidad de reporte: a cada uno se le envía su informe mensual.' }),
    el('button', { class: 'btn', text: '+ Grupo nuevo', onclick: () => editarGrupo(null) })
  ]));
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando grupos…' })]);
  c.append(zona);

  const [{ data: grupos, error }, { data: gp }] = await Promise.all([
    sb.from('grupos').select('*').order('orden').order('nombre'),
    sb.from('grupo_puntos').select('grupo_id, punto_id')
  ]);
  if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }
  const cuenta = {};
  for (const x of (gp || [])) cuenta[x.grupo_id] = (cuenta[x.grupo_id] || 0) + 1;

  // Mover un grupo cambia el orden en que sale en TODOS lados: informes, Excel
  // y las pestañas por grupo. Por eso se edita acá y no en cada pantalla.
  async function mover(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= grupos.length) return;
    const a = grupos[i], b = grupos[j];
    const { error } = await sb.from('grupos').upsert([
      { id: a.id, nombre: a.nombre, orden: j + 1 },
      { id: b.id, nombre: b.nombre, orden: i + 1 }
    ]);
    if (error) return toast(error.message, true);
    await DB.descargarCatalogo().catch(() => {});
    S.catalogo = await DB.catalogo();
    toast('Orden actualizado');
    render();
  }

  zona.replaceChildren(
    el('p', { class: 'ayuda', text:
      'El orden de esta lista es el orden en que salen los grupos en los informes, ' +
      'en el Excel y en las pestañas por grupo.' }),
    tabla(
    ['#', 'Grupo', 'Qué incluye', 'Destinatario', 'Correos', 'Puntos', 'Frecuencia', ''],
    grupos.map((g, i) => [
      String(i + 1),
      g.nombre, g.descripcion || '—', g.destinatario || el('span', { class: 'pill warn', text: 'falta' }),
      (g.correos && g.correos.length) ? g.correos.join(', ') : el('span', { class: 'pill warn', text: 'faltan' }),
      cuenta[g.id] || 0, g.frecuencia,
      el('div', { class: 'fila' }, [
        el('button', { class: 'btn chico', text: '▲', title: 'Subir',
          disabled: i === 0 || null, onclick: () => mover(i, -1) }),
        el('button', { class: 'btn chico', text: '▼', title: 'Bajar',
          disabled: i === grupos.length - 1 || null, onclick: () => mover(i, 1) }),
        el('button', { class: 'btn chico', text: 'Editar', onclick: () => editarGrupo(g) })
      ])
    ]), { num: [0, 5], etiquetas: true }));
}

async function editarGrupo(g) {
  const nuevo = !g;
  const f = {
    nombre: el('input', { value: g?.nombre || '' }),
    desc:   el('input', { value: g?.descripcion || '' }),
    dest:   el('input', { value: g?.destinatario || '' }),
    correos: el('input', { value: (g?.correos || []).join(', '), placeholder: 'separados por coma' }),
    frec:   el('input', { value: g?.frecuencia || 'Mensual' }),
    notas:  el('input', { value: g?.notas || '' })
  };

  const cuerpo = el('div', {}, [
    el('label', { text: 'Nombre del grupo' }, [f.nombre]),
    el('label', { text: 'Qué incluye' }, [f.desc]),
    el('label', { text: 'Destinatario del reporte' }, [f.dest]),
    el('label', { text: 'Correos' }, [f.correos]),
    el('label', { text: 'Frecuencia' }, [f.frec]),
    el('label', { text: 'Notas' }, [f.notas]),
    el('button', { class: 'btn primario grande', style: 'margin-top:14px',
                   text: nuevo ? 'Crear grupo' : 'Guardar', onclick: guardar })
  ]);

  if (!nuevo) {
    const { data: gp } = await sb.from('grupo_puntos').select('punto_id').eq('grupo_id', g.id);
    const dentro = new Set((gp || []).map(x => x.punto_id));
    const puntos = [...new Map(S.catalogo.variables.map(v => [v.punto.id, v.punto])).values()]
      .sort((a, b) => `${a.sitio.nombre}${a.nombre}`.localeCompare(`${b.sitio.nombre}${b.nombre}`));

    const lista = el('div', { style: 'max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:10px' });
    const contador = el('p', { class: 'ayuda' });
    const buscar = el('input', { type: 'search', placeholder: 'Filtrar puntos…', oninput: pintarPuntos });

    function pintarPuntos() {
      const q = buscar.value.toLowerCase();
      lista.replaceChildren();
      for (const p of puntos) {
        if (q && !`${p.nombre} ${p.sitio.nombre}`.toLowerCase().includes(q)) continue;
        const chk = el('input', { type: 'checkbox', checked: dentro.has(p.id) || null,
          onchange: e => { e.target.checked ? dentro.add(p.id) : dentro.delete(p.id); actualizar(); } });
        lista.append(el('label', { class: 'fila', style: 'margin-bottom:6px' },
          [chk, el('span', { text: `${p.sitio.nombre} · ${p.nombre}` })]));
      }
      actualizar();
    }
    function actualizar() { contador.textContent = `${dentro.size} puntos en el grupo`; }

    cuerpo.append(
      el('h3', { text: 'Puntos del grupo', style: 'margin-top:26px' }),
      buscar, contador, lista,
      el('button', { class: 'btn', style: 'margin-top:12px', text: 'Guardar los puntos', onclick: async () => {
        const del = await sb.from('grupo_puntos').delete().eq('grupo_id', g.id);
        if (del.error) return toast(del.error.message, true);
        if (dentro.size) {
          const ins = await sb.from('grupo_puntos')
            .insert([...dentro].map(punto_id => ({ grupo_id: g.id, punto_id })));
          if (ins.error) return toast(ins.error.message, true);
        }
        cerrarModal(); toast('Puntos del grupo actualizados'); render();
      } })
    );
    pintarPuntos();
  }

  async function guardar() {
    const datos = {
      nombre: f.nombre.value.trim(),
      descripcion: f.desc.value.trim() || null,
      destinatario: f.dest.value.trim() || null,
      correos: f.correos.value.split(',').map(x => x.trim()).filter(Boolean),
      frecuencia: f.frec.value.trim() || 'Mensual',
      notas: f.notas.value.trim() || null
    };
    if (!datos.nombre) return toast('El grupo necesita un nombre', true);
    const r = nuevo
      ? await sb.from('grupos').insert(datos)
      : await sb.from('grupos').update(datos).eq('id', g.id);
    if (r.error) return toast(r.error.message, true);
    cerrarModal(); toast('Guardado');
    S.catalogo = await DB.descargarCatalogo(); render();
  }

  modal(nuevo ? 'Grupo nuevo' : g.nombre, cuerpo);
}

/* ===================================================================
   VISTA · RESPALDO
   Cada lectura y cada foto llevan la marca de cuándo se respaldaron.
   Por eso "solo lo nuevo" es exacto y, además, verificable.
   =================================================================== */
async function vistaRespaldo(c) {
  c.append(el('p', { class: 'ayuda seccion', text:
    'El archivo se arma en este navegador y se descarga a tu PC. Trae las fotos ordenadas por año, mes y grupo, ' +
    'un Excel con todos los datos y un manifiesto con lo que contiene.' }));

  const zonaEstado = el('div', {}, [el('p', { class: 'cargando', text: 'Revisando qué falta por respaldar…' })]);
  const progreso = el('div', { class: 'progreso', hidden: true });
  c.append(zonaEstado, progreso);

  const [{ data: pend }, { data: hechos }] = await Promise.all([
    sb.from('v_pendiente_respaldo').select('*'),
    sb.from('respaldos').select('*').order('creado_en', { ascending: false }).limit(10)
  ]);

  const sinRespaldo = (pend || []).reduce((a, p) => a + Number(p.lecturas_sin_respaldo), 0);
  const fotosSin    = (pend || []).reduce((a, p) => a + Number(p.fotos_sin_respaldo), 0);
  const mesesSin    = (pend || []).filter(p => Number(p.lecturas_sin_respaldo) > 0);

  const hoy = new Date();
  const mesActual = primerDiaDelMes(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const selDesde = el('select'), selHasta = el('select');
  for (let i = 0; i < 36; i++) {
    const p = primerDiaDelMes(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1));
    selDesde.append(el('option', { value: p, selected: i === 11 || null, text: nombrePeriodo(p) }));
    selHasta.append(el('option', { value: p, selected: i === 0 || null, text: nombrePeriodo(p) }));
  }

  poner(zonaEstado,
    el('div', { class: 'kpis seccion' }, [
      kpi(sinRespaldo, 'lecturas sin respaldar', sinRespaldo ? 'aviso' : ''),
      kpi(fotosSin, 'fotos sin respaldar', fotosSin ? 'aviso' : ''),
      kpi(mesesSin.length, 'meses con algo pendiente'),
      kpi((hechos || []).length ? fechaCorta(hechos[0].creado_en) : '—', 'último respaldo')
    ]),
    el('div', { class: 'grid2' }, [
      el('div', { class: 'card' }, [
        el('h4', { style: 'margin-top:0', text: 'Solo lo nuevo' }),
        el('p', { class: 'ayuda', text: sinRespaldo
          ? `${sinRespaldo} lecturas que nunca se respaldaron, de cualquier mes. Es el que vas a usar todos los meses.`
          : 'No hay nada pendiente: todo lo cargado ya está respaldado.' }),
        el('button', { class: 'btn primario', disabled: !sinRespaldo || null,
          text: 'Descargar lo nuevo', onclick: () => generar('nuevo') })
      ]),
      el('div', { class: 'card' }, [
        el('h4', { style: 'margin-top:0', text: 'Este mes' }),
        el('p', { class: 'ayuda', text: `Todo lo de ${nombrePeriodo(mesActual)}, esté respaldado o no.` }),
        el('button', { class: 'btn', text: 'Descargar el mes', onclick: () => generar('mes', mesActual, mesActual) })
      ]),
      el('div', { class: 'card' }, [
        el('h4', { style: 'margin-top:0', text: 'Un rango' }),
        el('div', { class: 'fila' }, [
          el('label', { class: 'crece', text: 'Desde' }, [selDesde]),
          el('label', { class: 'crece', text: 'Hasta' }, [selHasta])
        ]),
        el('button', { class: 'btn', text: 'Descargar el rango',
          onclick: () => generar('rango', selDesde.value, selHasta.value) })
      ]),
      el('div', { class: 'card' }, [
        el('h4', { style: 'margin-top:0', text: 'Todo' }),
        el('p', { class: 'ayuda', text: 'El histórico completo. Se parte en un archivo por año para que el navegador aguante.' }),
        el('button', { class: 'btn', text: 'Descargar todo', onclick: () => generar('todo') })
      ])
    ]),
    mesesSin.length ? el('div', { class: 'seccion' }, [
      el('h2', { text: 'Pendiente por mes' }),
      tabla(['Mes', 'Lecturas del mes', 'Sin respaldar', 'Fotos sin respaldar'],
        mesesSin.map(p => [nombrePeriodo(p.periodo), p.lecturas,
          el('span', { class: 'pill warn', text: String(p.lecturas_sin_respaldo) }),
          p.fotos_sin_respaldo]), { num: [1, 3] })
    ]) : null,
    (hechos && hechos.length) ? el('div', { class: 'seccion' }, [
      el('h2', { text: 'Respaldos anteriores' }),
      tabla(['Cuándo', 'Tipo', 'Periodo', 'Lecturas', 'Fotos', 'Archivo'],
        hechos.map(r => [fechaHora(r.creado_en), r.tipo,
          r.periodo_desde ? `${nombrePeriodo(r.periodo_desde)} → ${nombrePeriodo(r.periodo_hasta)}` : 'todo',
          r.n_lecturas, r.n_fotos, r.archivo || '—']), { num: [3, 4] })
    ]) : null
  );

  // ---------------------------------------------------------------
  async function generar(tipo, desde = null, hasta = null) {
    if (typeof JSZip === 'undefined') {
      paso('Cargando el compresor…');
      await new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = 'jszip.js'; s.onload = ok; s.onerror = mal;
        document.head.append(s);
      }).catch(() => { paso(''); return toast('No se pudo cargar el compresor', true); });
    }
    progreso.hidden = false;
    try {
      paso('Consultando las lecturas…');
      // traerTodo pagina: PostgREST corta en 1.000 filas y un respaldo truncado
      // es peor que no tenerlo.
      const filas = await traerTodo(() => {
        let q = sb.from('v_respaldo').select('*');
        if (tipo === 'nuevo') q = q.is('respaldado_en', null);
        if (desde) q = q.gte('periodo', desde);
        if (hasta) q = q.lte('periodo', hasta);
        return q.order('periodo').order('sitio').order('punto');
      });
      if (!filas.length) { paso(''); progreso.hidden = true; return toast('No hay nada que respaldar con ese criterio'); }

      const periodos = [...new Set(filas.map(f => f.periodo))].sort();
      const rangoDesde = periodos[0], rangoHasta = periodos[periodos.length - 1];

      paso('Calculando consumos…');
      const consumos = await traerTodo(() => sb.from('v_consumos').select('*')
        .gte('mes', rangoDesde).lte('mes', rangoHasta).order('mes'));

      paso('Trayendo inventario, avisos y auditoría…');
      const [inv, avs, aud, rec, mov] = await Promise.all([
        sb.from('v_puntos').select('*'),
        sb.from('avisos').select('id, descripcion, severidad, estado, abierto_en, resuelto_en, obs_resolucion, punto:puntos(nombre, sitio:sitios(nombre)), categoria:catalogo_avisos(categoria)'),
        sb.from('auditoria').select('*').gte('ocurrido_en', rangoDesde).order('ocurrido_en').limit(5000),
        sb.from('v_recargas').select('*').gte('periodo', rangoDesde).lte('periodo', rangoHasta).order('fecha_hora'),
        sb.from('generador_movimientos').select('*, generador:generadores(n_equipo)').order('fecha')
      ]);

      const zip = new JSZip();
      const R = window.RESPALDO;

      // ---- Excel ----
      paso('Armando el Excel…');
      const xlsx = await R.construirExcel(armarHojas(filas, consumos, inv.data || [], avs.data || [],
        aud.data || [], rec.data || [], mov.data || []));
      const nombreXlsx = `Cierre_de_Mes_${rangoDesde.slice(0,7)}_a_${rangoHasta.slice(0,7)}.xlsx`;
      zip.file(nombreXlsx, xlsx);

      // ---- fotos, en Año / Mes / Grupo / TAG_Punto ----
      const conFoto = filas.filter(f => f.storage_path);
      const idsFoto = [];
      const indice = [['Ruta dentro del respaldo', 'Año', 'Mes', 'Grupo', 'Sitio', 'Punto', 'TAG',
                       'Variable', 'Unidad', 'Fecha de lectura', 'Valor', 'Estado', 'Tomada por']];
      for (let i = 0; i < conFoto.length; i++) {
        const f = conFoto[i];
        paso(`Descargando fotos… ${i + 1} de ${conFoto.length}`);
        const { data: url } = await sb.storage.from(C.BUCKET).createSignedUrl(f.storage_path, 900);
        if (!url?.signedUrl) continue;
        const blob = await (await fetch(url.signedUrl)).blob();
        const d = new Date(f.periodo);
        const carpeta = [
          d.getUTCFullYear(),
          R.MESES_N[d.getUTCMonth()],
          R.limpio(f.grupo || f.sitio),
          R.limpio(`${f.tag || 'sin-TAG'}_${f.punto}`)
        ].join('/');
        const nombre = `${String(f.fecha_dia).slice(0,10)}_${R.limpio(f.tag || 'sin-TAG')}_${f.valor ?? 'sd'}.jpg`;
        zip.file(`${carpeta}/${nombre}`, blob);
        idsFoto.push(f.foto_id);
        indice.push([`${carpeta}/${nombre}`, d.getUTCFullYear(), R.MESES_N[d.getUTCMonth()],
          f.grupo || 'Sin grupo', f.sitio, f.punto, f.tag || '', f.variable, f.unidad,
          String(f.fecha_lectura).slice(0, 19).replace('T', ' '),
          f.valor === null ? '' : Number(f.valor), f.estado,
          S.catalogo.gente?.[f.tomada_por] || '']);
      }

      // Buscar una foto abriendo carpeta por carpeta es lento. El índice permite
      // filtrar por punto, mes o persona y saltar directo a la ruta.
      if (indice.length > 1) {
        zip.file('indice_fotos.xlsx', await R.construirExcel([{ nombre: 'Fotos', filas: indice }]));
      }

      // ---- manifiesto ----
      const idsLectura = [...new Set(filas.map(f => f.lectura_id))];
      zip.file('manifiesto.json', JSON.stringify({
        generado_en: new Date().toISOString(),
        generado_por: S.usuario.nombre,
        tipo, periodo_desde: rangoDesde, periodo_hasta: rangoHasta,
        lecturas: idsLectura.length, fotos: idsFoto.length,
        excel: nombreXlsx,
        estructura: 'Año / Mes / Grupo / TAG_Punto / fecha_TAG_lectura.jpg',
        indice: 'indice_fotos.xlsx · una fila por foto, con su ruta, el punto y quién la tomó',
        aviso_grupos: 'Las carpetas usan el grupo que el punto tiene HOY. Si un punto cambia de ' +
                      'grupo, los respaldos nuevos lo guardan en la carpeta nueva; los ya ' +
                      'descargados quedan donde estaban.',
        nota: 'Los consumos se calculan repartiendo lo medido entre dos lecturas sobre los días de calendario que cubren.'
      }, null, 2));

      paso('Comprimiendo…');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' },
        m => paso(`Comprimiendo… ${Math.round(m.percent)}%`));
      const archivo = `Respaldo_${tipo}_${rangoDesde.slice(0,7)}_a_${rangoHasta.slice(0,7)}.zip`;
      descargar(blob, archivo);

      paso('Registrando el respaldo…');
      const { error: e2 } = await sb.rpc('registrar_respaldo', {
        p_tipo: tipo, p_desde: rangoDesde, p_hasta: rangoHasta,
        p_lecturas: idsLectura, p_fotos: idsFoto,
        p_archivo: archivo, p_bytes: blob.size, p_notas: null });
      if (e2) toast('Se descargó, pero no se pudo registrar: ' + e2.message, true);

      paso('');
      progreso.hidden = true;
      toast(`Respaldo listo: ${idsLectura.length} lecturas y ${idsFoto.length} fotos`);
      render();
    } catch (e) {
      paso(''); progreso.hidden = true;
      toast('Falló el respaldo: ' + (e.message || e), true);
    }
  }

  function paso(t) { progreso.textContent = t; }
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- las hojas del Excel ---------- */
function armarHojas(filas, consumos, inventario, avisos, auditoria, recargas = [], movimientos = []) {
  const meses = [...new Set(consumos.map(c => c.mes))].sort();
  const nMes = m => nombrePeriodo(m).split(' ')[0];

  // 1 · con el formato de las planillas de siempre: totalizador, total del mes y variación
  const porVar = new Map();
  for (const f of filas) {
    if (!porVar.has(f.variable_id))
      porVar.set(f.variable_id, { f, lect: {}, cons: {} });
    porVar.get(f.variable_id).lect[f.periodo] = f.valor;
  }
  for (const c of consumos) {
    if (porVar.has(c.variable_id)) porVar.get(c.variable_id).cons[c.mes] = Number(c.consumo);
  }
  // Se rotula por el MES DEL CONSUMO, igual que tus planillas: la columna "Enero"
  // lleva el totalizador leído el 1 de febrero y el consumo de enero.
  const mesesC = [...new Set(consumos.map(c => c.mes))].sort();
  const sigMes = m => { const d = new Date(m + 'T00:00:00Z');
                        d.setUTCMonth(d.getUTCMonth() + 1);
                        return d.toISOString().slice(0, 10); };
  const planilla = [['TAG', 'Sitio', 'Punto', 'Variable', 'Unidad', 'Fila', ...mesesC.map(nMes)]];
  for (const { f, lect, cons } of porVar.values()) {
    planilla.push([f.tag || '', f.sitio, f.punto, f.variable, f.unidad, 'Totalizador',
      ...mesesC.map(m => lect[sigMes(m)] ?? '')]);
    planilla.push(['', '', '', '', '', 'Consumo del mes',
      ...mesesC.map(m => cons[m] ?? '')]);
    planilla.push(['', '', '', '', '', 'Var. %',
      ...mesesC.map((m, i) => {
        if (i === 0) return '';
        const va = cons[mesesC[i - 1]], vb = cons[m];
        return (va && vb) ? Number(((vb - va) / va).toFixed(4)) : '';
      })]);
  }

  return [
    { nombre: 'Formato planilla', filas: planilla },
    { nombre: 'Lecturas', filas: [
      ['ID','Periodo','Fecha de lectura','Fecha estimada','Sitio','Grupo','Punto','TAG','Variable','Unidad',
       'Valor','Sin dato','Reinicio','Consumo declarado','Estado','Origen','Tomada por','Validada por',
       'Observación','Obs. validación','Foto'],
      ...filas.map(f => [f.lectura_id, f.periodo, String(f.fecha_lectura).slice(0,19).replace('T',' '),
        f.fecha_estimada ? 'sí' : 'no', f.sitio, f.grupo || '', f.punto, f.tag || '', f.variable, f.unidad,
        f.valor === null ? '' : Number(f.valor), f.sin_dato ? 'sí' : 'no',
        f.es_reset ? (f.tipo_reset || 'sí') : 'no',
        f.consumo_manual === null ? '' : Number(f.consumo_manual),
        f.estado, f.origen, f.tomada_por || '', f.validada_por || '',
        f.observacion || '', f.obs_validacion || '', f.storage_path || ''])
    ]},
    { nombre: 'Consumos', filas: [
      ['Mes','Sitio','Grupo','Punto','TAG','Variable','Unidad','Consumo','Días','Método','Estado'],
      ...consumos.map(c => [c.mes, c.sitio, c.grupo || '', c.punto, c.tag || '', c.variable,
        c.unidad_reporte, Number(c.consumo), c.dias_asignados, c.metodo,
        c.completo ? 'cerrado' : 'provisional'])
    ]},
    { nombre: 'Inventario', filas: [
      ['Sitio','Punto','Área','Tipo','TAG','Marca','Modelo','Serie','Certificado','Vence','Variables','Equipos históricos'],
      ...inventario.map(p => [p.sitio, p.nombre, p.area || '', p.tipo, p.tag || '', p.marca || '',
        p.modelo || '', p.n_serie || '', p.certificado ? 'sí' : 'no', p.vence_certificado || '',
        p.n_variables, p.n_equipos_historicos])
    ]},
    { nombre: 'Avisos', filas: [
      ['Sitio','Punto','Categoría','Severidad','Estado','Abierto','Resuelto','Descripción','Solución'],
      ...avisos.map(a => [a.punto?.sitio?.nombre || '', a.punto?.nombre || '',
        a.categoria?.categoria || '', a.severidad, a.estado,
        String(a.abierto_en || '').slice(0,10), String(a.resuelto_en || '').slice(0,10),
        a.descripcion || '', a.obs_resolucion || ''])
    ]},
    { nombre: 'Recargas', filas: [
      ['Fecha y hora','Generador','Litros','Combustible','Origen','Guía','Camión','Horómetro',
       'Recibió','Quién registró','Anulada','Motivo anulación','Observaciones'],
      ...recargas.map(r => [String(r.fecha_hora).slice(0,19).replace('T',' '), r.n_equipo,
        Number(r.litros), r.combustible, r.origen || '', r.guia || '', r.camion || '',
        r.horometro === null ? '' : Number(r.horometro), r.operador || '',
        r.registrado_por_nombre || '', r.anulada ? 'sí' : 'no', r.motivo_anulacion || '',
        r.observaciones || ''])
    ]},
    { nombre: 'Generadores', filas: [
      ['Fecha','Generador','Movimiento','Horómetro','kWh','Ubicación','Motivo','Observaciones'],
      ...movimientos.map(m => [String(m.fecha).slice(0,10), m.generador?.n_equipo || m.generador_id,
        m.tipo, m.horometro === null ? '' : Number(m.horometro),
        m.kwh === null ? '' : Number(m.kwh), m.ubicacion || '', m.motivo || '', m.observaciones || ''])
    ]},
    { nombre: 'Auditoría', filas: [
      ['Cuándo','Tabla','Registro','Acción','Campos','Motivo'],
      ...auditoria.map(a => [String(a.ocurrido_en).slice(0,19).replace('T',' '), a.tabla,
        a.registro_id, a.accion, (a.campos_cambiados || []).join(', '), a.motivo || ''])
    ]}
  ];
}

/* ===================================================================
   VISTA · USUARIOS
   =================================================================== */
async function vistaUsuarios(c) {
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando…' })]);
  c.append(el('div', { class: 'fila entre seccion' }, [
    el('p', { class: 'ayuda', text: 'El rol define qué ve cada persona. Para crear una cuenta nueva hay que invitarla desde Supabase; aquí se le asigna el rol.' })
  ]), zona);

  const { data, error } = await sb.from('usuarios').select('*').order('rol');
  if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }

  const ROLES = ['admin', 'supervisor', 'colaborador', 'casa_fuerza', 'visualizador'];
  const filas = data.map(u => {
    const sel = el('select', { onchange: async e => {
      const { error } = await sb.from('usuarios').update({ rol: e.target.value }).eq('id', u.id);
      toast(error ? error.message : `${u.nombre} ahora es ${e.target.value}`, !!error);
    } });
    for (const r of ROLES) sel.append(el('option', { value: r, selected: r === u.rol || null, text: r }));
    const act = el('input', { type: 'checkbox', checked: u.activo || null, onchange: async e => {
      const { error } = await sb.from('usuarios').update({ activo: e.target.checked }).eq('id', u.id);
      toast(error ? error.message : 'Actualizado', !!error);
    } });
    return [u.nombre, u.correo, sel, act, u.casa_fuerza ? 'sí' : 'no'];
  });
  zona.replaceChildren(tabla(['Nombre', 'Correo', 'Rol', 'Activo', 'Casa de Fuerza'], filas));
}

/* ===================================================================
   VISTA · AUDITORÍA
   =================================================================== */
async function vistaAuditoria(c) {
  const selTabla = el('select', { onchange: cargar });
  selTabla.append(el('option', { value: '', text: 'Todas las tablas' }));
  for (const t of ['lecturas', 'equipos', 'puntos', 'variables', 'avisos', 'usuarios', 'periodos'])
    selTabla.append(el('option', { value: t, text: t }));

  const selUsuario = el('select', { onchange: cargar });
  selUsuario.append(el('option', { value: '', text: 'Todos los usuarios' }));

  c.append(el('div', { class: 'fila seccion' }, [
    el('label', { class: 'crece', text: 'Tabla' }, [selTabla]),
    el('label', { class: 'crece', text: 'Usuario' }, [selUsuario])
  ]));
  const zona = el('div'); c.append(zona);

  const { data: us } = await sb.from('usuarios').select('id, nombre');
  const nombres = {};
  for (const u of us || []) { nombres[u.id] = u.nombre; selUsuario.append(el('option', { value: u.id, text: u.nombre })); }

  async function cargar() {
    zona.replaceChildren(el('p', { class: 'cargando', text: 'Cargando auditoría…' }));
    let q = sb.from('auditoria').select('*').order('ocurrido_en', { ascending: false }).limit(300);
    if (selTabla.value) q = q.eq('tabla', selTabla.value);
    if (selUsuario.value) q = q.eq('usuario_id', selUsuario.value);
    const { data, error } = await q;
    if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }
    if (!data.length) { zona.replaceChildren(el('p', { class: 'vacio', text: 'Sin movimientos registrados.' })); return; }

    const filas = data.map(a => [
      fechaHora(a.ocurrido_en), nombres[a.usuario_id] || '—', a.tabla, a.accion,
      (a.campos_cambiados || []).join(', ') || '—',
      a.motivo || '—',
      el('button', { class: 'btn chico', text: 'Ver', onclick: () => verCambio(a, nombres) })
    ]);
    zona.replaceChildren(tabla(['Cuándo', 'Quién', 'Tabla', 'Acción', 'Campos', 'Motivo', ''], filas));
  }
  cargar();
}

function verCambio(a, nombres) {
  const campos = a.campos_cambiados || Object.keys(a.datos_despues || a.datos_antes || {});
  const filas = campos.map(k => [k, String(a.datos_antes?.[k] ?? '—'), String(a.datos_despues?.[k] ?? '—')]);
  modal('Cambio en ' + a.tabla, el('div', {}, [
    el('p', { class: 'ayuda', html: `${fechaHora(a.ocurrido_en)} · ${esc(nombres[a.usuario_id] || 'sistema')}<br>${a.motivo ? '<b>Motivo:</b> ' + esc(a.motivo) : ''}` }),
    tabla(['Campo', 'Antes', 'Después'], filas)
  ]));
}

/* ===================================================================
   VISTA · CASA DE FUERZA · GENERADORES
   El parque cambia: los arrendados entran y se devuelven. Lo que importa
   registrar es la fecha y el horómetro/kWh con que entra y con que sale,
   porque de ahí sale lo que generó durante su estadía.
   =================================================================== */
const TIPOS_MOV = {
  ingreso:    'Ingreso a faena',
  lectura:    'Lectura de horómetro / kWh',
  traslado:   'Traslado dentro de la faena',
  devolucion: 'Devolución al proveedor',
  baja:       'Baja definitiva'
};
const ESTADOS_GEN = ['Operando', 'Disponible', 'Detenido', 'En Revisión', 'Devuelto', 'De baja'];

async function vistaGeneradores(c) {
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando el parque…' })]);
  c.append(zona);

  let gens = [];
  try {
    const { data, error } = await sb.from('v_generadores').select('*').order('n_equipo');
    if (error) throw error;
    gens = data || [];
    await idb.guardar('catalogo', { clave: 'generadores', datos: gens });
  } catch (e) {
    const local = await idb.leer('catalogo', 'generadores');
    gens = local ? local.datos : (S.catalogo.generadores || []);
    if (!navigator.onLine) toast('Sin señal: se muestra el parque de la última vez.');
  }

  const vivos = gens.filter(g => !['Devuelto', 'De baja'].includes(g.estado));
  const operando = vivos.filter(g => g.estado === 'Operando');
  const kwInstalado = operando.reduce((a, g) => a + Number(g.potencia_nominal_kw || 0), 0);
  const sinIngreso = vivos.filter(g => !g.ingreso_fecha);

  const filas = gens.map(g => [
    g.n_equipo,
    g.propiedad === 'Arriendo' ? `Arriendo · ${g.proveedor || '—'}` : (g.proveedor || 'Propio'),
    num(g.potencia_nominal_kw),
    el('span', { class: 'pill ' + (g.estado === 'Operando' ? 'ok'
                  : ['Devuelto', 'De baja'].includes(g.estado) ? '' : 'warn'), text: g.estado || '—' }),
    g.combustible || 'Diesel',
    g.ingreso_fecha ? fechaCorta(g.ingreso_fecha) : '—',
    g.dias_en_faena ?? '—',
    g.horas_estadia != null ? num(g.horas_estadia) : '—',
    g.kwh_estadia != null ? num(g.kwh_estadia) : '—',
    g.litros_estadia != null ? num(g.litros_estadia) : '—',
    el('div', { class: 'fila' }, [
      el('button', { class: 'btn chico', text: 'Registrar', onclick: () => movimientoGenerador(g) }),
      el('button', { class: 'btn chico', text: 'Historial', onclick: () => historialGenerador(g) })
    ])
  ]);

  poner(zona,
    el('div', { class: 'kpis seccion' }, [
      kpi(operando.length, 'operando'),
      kpi(vivos.length - operando.length, 'en faena sin operar', vivos.length - operando.length ? 'aviso' : ''),
      kpi(kwInstalado >= 1000 ? num(kwInstalado / 1000, 1) + ' MW' : num(kwInstalado) + ' kW', 'potencia operando'),
      kpi(sinIngreso.length, 'sin fecha de ingreso', sinIngreso.length ? 'aviso' : '')
    ]),
    sinIngreso.length
      ? el('p', { class: 'banda warn', text:
          `${sinIngreso.length} generador(es) todavía no tienen movimiento de ingreso. ` +
          'Sin esa fecha y ese horómetro no se puede saber cuánto generó cada uno en su estadía.' })
      : null,
    tabla(['Equipo', 'Propiedad', 'kW', 'Estado', 'Combustible', 'Ingreso', 'Días',
           'Horas estadía', 'kWh estadía', 'Litros estadía', ''],
      filas, { num: [2, 6, 7, 8, 9] }),
    el('p', { class: 'ayuda', text:
      'Horas, kWh y litros de la estadía se cuentan desde el último ingreso a faena. ' +
      'Para que avancen hay que registrar cada mes un movimiento de tipo "Lectura".' })
  );
}

function movimientoGenerador(g) {
  const hoy = new Date().toISOString().slice(0, 10);
  const cuerpo = el('div');
  const selTipo = el('select', {}, Object.entries(TIPOS_MOV).map(([k, v]) =>
    el('option', { value: k, text: v, selected: (k === (g.ingreso_fecha ? 'lectura' : 'ingreso')) || null })));
  const fecha = el('input', { type: 'date', value: hoy, max: hoy });
  const horom = el('input', { type: 'number', step: '0.1', inputmode: 'decimal',
    placeholder: g.ultimo_horometro != null ? 'anterior: ' + num(g.ultimo_horometro) : '' });
  const kwh = el('input', { type: 'number', step: '1', inputmode: 'decimal',
    placeholder: g.ultimo_kwh != null ? 'anterior: ' + num(g.ultimo_kwh) : '' });
  const ubic = el('input', { type: 'text', value: g.ubicacion || '' });
  const motivo = el('input', { type: 'text', placeholder: 'por qué se registra' });
  const obs = el('textarea', { rows: 2 });
  const aviso = el('p', { class: 'banda warn', hidden: true });

  const revisar = () => {
    const h = Number(horom.value);
    aviso.hidden = true;
    if (horom.value !== '' && g.ultimo_horometro != null && h < Number(g.ultimo_horometro)) {
      aviso.textContent = `El horómetro que anotaste (${num(h)}) es menor que el último registrado ` +
        `(${num(g.ultimo_horometro)}). Puede ser un cambio de motor o un error de tipeo. ` +
        'Se guarda igual, pero explícalo en el motivo.';
      aviso.hidden = false;
    }
  };
  horom.addEventListener('input', revisar);

  const guardar = el('button', { class: 'btn primario grande', text: 'Guardar movimiento',
    onclick: async () => {
      if (!fecha.value) return toast('Falta la fecha', true);
      const fila = {
        tipo: 'movimiento_generador', generador_id: g.id, movimiento: selTipo.value,
        fecha: fecha.value,
        horometro: horom.value === '' ? null : Number(horom.value),
        kwh: kwh.value === '' ? null : Number(kwh.value),
        ubicacion: ubic.value.trim() || null,
        motivo: motivo.value.trim() || null,
        observaciones: obs.value.trim() || null,
        dispositivo: navigator.userAgent.slice(0, 120)
      };
      guardar.disabled = true;
      if (navigator.onLine) {
        const { error } = await sb.rpc('mover_generador', {
          p_generador_id: fila.generador_id, p_tipo: fila.movimiento, p_fecha: fila.fecha,
          p_horometro: fila.horometro, p_kwh: fila.kwh, p_ubicacion: fila.ubicacion,
          p_motivo: fila.motivo, p_obs: fila.observaciones, p_dispositivo: fila.dispositivo
        });
        guardar.disabled = false;
        if (error) return toast(error.message, true);
        toast('Movimiento registrado');
      } else {
        await DB.encolar(fila);
        await actualizarConexion();
        toast('Guardado en el dispositivo. Se enviará cuando vuelva la señal.');
      }
      cerrarModal();
      render();
    } });

  poner(cuerpo,
    el('p', { class: 'ayuda', html: `<b>${esc(g.n_equipo)}</b> · ${esc(g.proveedor || '')} · ${num(g.potencia_nominal_kw)} kW` }),
    el('label', { text: 'Tipo de movimiento' }, [selTipo]),
    el('label', { text: 'Fecha' }, [fecha]),
    el('label', { text: 'Horómetro (h)' }, [horom]),
    aviso,
    el('label', { text: 'Energía acumulada del equipo (kWh)' }, [kwh]),
    el('label', { text: 'Ubicación' }, [ubic]),
    el('label', { text: 'Motivo' }, [motivo]),
    el('label', { text: 'Observaciones' }, [obs]),
    guardar,
    el('div', { class: 'fila seccion' }, ESTADOS_GEN.filter(e => e !== g.estado).map(e =>
      el('button', { class: 'btn chico', text: 'Marcar ' + e, onclick: async () => {
        const m = prompt(`Motivo para marcar ${g.n_equipo} como ${e}:`) || '';
        const { error } = await sb.rpc('estado_generador',
          { p_generador_id: g.id, p_estado: e, p_motivo: m });
        if (error) return toast(error.message, true);
        cerrarModal(); toast('Estado actualizado'); render();
      } }))),
    el('p', { class: 'ayuda', text: 'Cambiar el estado necesita señal: queda registrado en la auditoría.' })
  );
  modal('Movimiento de generador', cuerpo);
}

async function historialGenerador(g) {
  const cuerpo = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando…' })]);
  modal('Historial · ' + g.n_equipo, cuerpo);
  const [mov, rec] = await Promise.all([
    sb.from('generador_movimientos').select('*').eq('generador_id', g.id).order('fecha', { ascending: false }),
    sb.from('v_recargas').select('*').eq('generador_id', g.id).order('fecha_hora', { ascending: false }).limit(50)
  ]);
  const nombres = S.catalogo.gente || {};
  poner(cuerpo,
    el('h4', { text: 'Movimientos' }),
    (mov.data || []).length
      ? tabla(['Fecha', 'Tipo', 'Horómetro', 'kWh', 'Motivo', 'Quién'],
          mov.data.map(m => [fechaCorta(m.fecha), TIPOS_MOV[m.tipo] || m.tipo,
            m.horometro != null ? num(m.horometro) : '—', m.kwh != null ? num(m.kwh) : '—',
            m.motivo || m.observaciones || '—', nombres[m.registrado_por] || '—']), { num: [2, 3] })
      : el('p', { class: 'vacio', text: 'Sin movimientos registrados.' }),
    el('h4', { text: 'Últimas recargas' }),
    (rec.data || []).length
      ? tabla(['Fecha', 'Litros', 'Origen', 'Guía', 'Quién'],
          rec.data.map(r => [fechaHora(r.fecha_hora), num(r.litros), r.origen || '—', r.guia || '—',
            r.registrado_por_nombre || '—']), { num: [1] })
      : el('p', { class: 'vacio', text: 'Sin recargas registradas.' })
  );
}

/* ===================================================================
   VISTA · CASA DE FUERZA · RECARGAS DE COMBUSTIBLE
   Varias por turno. Se anotan en el momento, con o sin señal.
   Los estanques BBA.4 y BBA.5 siguen midiéndose en el cierre de mes:
   esto es otra cosa, los litros que el camión deja en cada generador.
   =================================================================== */
const ORIGENES = ['BBA.4', 'BBA.5', 'Camión externo', 'Otro'];

async function vistaRecargas(c) {
  c.append(el('div', { class: 'fila entre seccion' }, [
    selectorPeriodo('periodoCF', () => render()),
    el('button', { class: 'btn primario grande', text: '+ Registrar recarga', onclick: () => nuevaRecarga() })
  ]));
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando recargas…' })]);
  c.append(zona);

  const cola = (await DB.pendientes()).filter(x => x.tipo === 'recarga');
  let recargas = [];
  let sinRed = false;
  try {
    const { data, error } = await sb.from('v_recargas').select('*')
      .eq('periodo', S.periodoCF).order('fecha_hora', { ascending: false });
    if (error) throw error;
    recargas = (data || []).filter(r => !r.anulada);
  } catch (e) { sinRed = true; }

  const total = recargas.reduce((a, r) => a + Number(r.litros), 0);
  const porGen = {};
  for (const r of recargas) porGen[r.n_equipo] = (porGen[r.n_equipo] || 0) + Number(r.litros);

  const filas = recargas.map(r => [
    fechaHora(r.fecha_hora), r.n_equipo, num(r.litros), r.combustible,
    r.origen || '—', r.guia || '—', r.camion || '—',
    r.registrado_por_nombre || '—',
    esSupervisor()
      ? el('button', { class: 'btn chico', text: 'Anular', onclick: () => anularRecarga(r) })
      : ''
  ]);

  poner(zona,
    cola.length
      ? el('p', { class: 'banda warn', text:
          `${cola.length} recarga(s) guardadas en este dispositivo, todavía sin enviar.` })
      : null,
    sinRed ? el('p', { class: 'banda warn', text: 'Sin señal: no se pudo traer lo ya enviado al servidor.' }) : null,
    el('div', { class: 'kpis seccion' }, [
      kpi(num(total) + ' L', 'cargados en ' + nombrePeriodo(S.periodoCF)),
      kpi(recargas.length, 'recargas'),
      kpi(Object.keys(porGen).length, 'generadores abastecidos')
    ]),
    recargas.length
      ? tabla(['Fecha y hora', 'Generador', 'Litros', 'Combustible', 'Origen', 'Guía', 'Camión', 'Quién', ''],
          filas, { num: [2] })
      : el('p', { class: 'vacio', text: 'No hay recargas registradas en este mes.' }),
    await bloqueConsumoEspecifico(S.periodoCF)
  );
}

function nuevaRecarga() {
  const gens = (S.catalogo.generadores || []).filter(g => g.activo !== false);
  if (!gens.length) return toast('No hay generadores en tu alcance.', true);

  const ahora = new Date();
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const selGen = el('select', {}, gens.map(g =>
    el('option', { value: g.id, text: `${g.n_equipo}${g.proveedor ? ' · ' + g.proveedor : ''}` })));
  const cuando = el('input', { type: 'datetime-local', value: local });
  const litros = el('input', { type: 'number', step: '1', inputmode: 'decimal', required: true });
  const selComb = el('select', {}, ['Diesel', 'Bunker', 'GNL', 'Otro'].map(x =>
    el('option', { value: x, text: x })));
  const selOrig = el('select', {}, ORIGENES.map(x => el('option', { value: x, text: x })));
  const guia = el('input', { type: 'text', inputmode: 'text' });
  const camion = el('input', { type: 'text' });
  const horom = el('input', { type: 'number', step: '0.1', inputmode: 'decimal' });
  const operador = el('input', { type: 'text', placeholder: 'si la recibió otra persona' });
  const obs = el('textarea', { rows: 2 });

  const sincronizarComb = () => {
    const g = gens.find(x => String(x.id) === selGen.value);
    if (g && g.combustible) selComb.value = ['Diesel','Bunker','GNL'].includes(g.combustible) ? g.combustible : 'Otro';
  };
  selGen.addEventListener('change', sincronizarComb);
  sincronizarComb();

  const boton = el('button', { class: 'btn primario grande', text: 'Guardar recarga', onclick: async () => {
    if (!litros.value || Number(litros.value) <= 0) return toast('Falta cuántos litros se cargaron', true);
    if (!cuando.value) return toast('Falta la fecha y la hora', true);
    const fila = {
      tipo: 'recarga',
      generador_id: Number(selGen.value),
      fecha_hora: new Date(cuando.value).toISOString(),
      litros: Number(litros.value),
      combustible: selComb.value,
      origen: selOrig.value,
      guia: guia.value.trim() || null,
      camion: camion.value.trim() || null,
      horometro: horom.value === '' ? null : Number(horom.value),
      operador: operador.value.trim() || null,
      observaciones: obs.value.trim() || null,
      dispositivo: navigator.userAgent.slice(0, 120)
    };
    boton.disabled = true;
    if (navigator.onLine) {
      const { error } = await sb.rpc('registrar_recarga', {
        p_generador_id: fila.generador_id, p_fecha_hora: fila.fecha_hora, p_litros: fila.litros,
        p_combustible: fila.combustible, p_origen: fila.origen, p_guia: fila.guia,
        p_camion: fila.camion, p_horometro: fila.horometro, p_operador: fila.operador,
        p_obs: fila.observaciones, p_dispositivo: fila.dispositivo
      });
      boton.disabled = false;
      if (error) return toast(error.message, true);
      toast('Recarga registrada');
    } else {
      await DB.encolar(fila);
      await actualizarConexion();
      toast('Guardada en el dispositivo. Se enviará cuando vuelva la señal.');
    }
    cerrarModal();
    render();
  } });

  modal('Registrar recarga', el('div', {}, [
    el('label', { text: 'Generador' }, [selGen]),
    el('label', { text: 'Fecha y hora' }, [cuando]),
    el('label', { text: 'Litros cargados' }, [litros]),
    el('label', { text: 'Combustible' }, [selComb]),
    el('label', { text: 'Origen' }, [selOrig]),
    el('label', { text: 'N° de guía o vale' }, [guia]),
    el('label', { text: 'Camión' }, [camion]),
    el('label', { text: 'Horómetro del generador (opcional)' }, [horom]),
    el('label', { text: 'Quién recibió' }, [operador]),
    el('label', { text: 'Observaciones' }, [obs]),
    boton,
    el('p', { class: 'ayuda', text:
      'Si se envía dos veces la misma carga (mismo generador, misma hora, mismos litros), ' +
      'el sistema la reconoce y no la duplica.' })
  ]));
}

function anularRecarga(r) {
  const motivo = el('input', { type: 'text', placeholder: 'por qué se anula' });
  modal('Anular recarga', el('div', {}, [
    el('p', { class: 'ayuda', html:
      `${esc(r.n_equipo)} · ${num(r.litros)} L · ${esc(fechaHora(r.fecha_hora))}` }),
    el('p', { class: 'banda warn', text: 'No se borra: queda marcada como anulada, con tu nombre y el motivo.' }),
    el('label', { text: 'Motivo' }, [motivo]),
    el('button', { class: 'btn primario', text: 'Anular', onclick: async () => {
      if (!motivo.value.trim()) return toast('El motivo es obligatorio', true);
      const { error } = await sb.rpc('anular_recarga', { p_id: r.id, p_motivo: motivo.value.trim() });
      if (error) return toast(error.message, true);
      cerrarModal(); toast('Recarga anulada'); render();
    } })
  ]));
}

// Litros por kWh: el número que la Ley 21.305 mira de reojo. Es referencial
// mientras las lecturas de horómetro y kWh no se registren todos los meses.
async function bloqueConsumoEspecifico(periodo) {
  let datos = [];
  try {
    const { data } = await sb.from('v_generador_mes').select('*').eq('periodo', periodo).order('n_equipo');
    datos = data || [];
  } catch { return null; }
  if (!datos.length) return null;

  const filas = datos.map(d => [
    d.n_equipo,
    d.litros != null ? num(d.litros) : '—',
    d.horas != null ? num(d.horas, 1) : '—',
    d.kwh != null ? num(d.kwh) : '—',
    d.litros_por_kwh != null
      ? el('span', { class: 'pill ' + (d.litros_por_kwh >= 0.18 && d.litros_por_kwh <= 0.45 ? 'ok' : 'warn'),
                     text: num(d.litros_por_kwh, 3) })
      : '—',
    d.litros_por_hora != null ? num(d.litros_por_hora, 1) : '—',
    d.factor_carga != null ? num(d.factor_carga * 100, 0) + '%' : '—'
  ]);
  return el('div', { class: 'card seccion' }, [
    el('h4', { style: 'margin-top:0', text: 'Consumo específico del mes' }),
    tabla(['Generador', 'Litros', 'Horas', 'kWh', 'L/kWh', 'L/h', 'Factor de carga'],
      filas, { num: [1, 2, 3, 5, 6] }),
    el('p', { class: 'ayuda', text:
      'Un grupo diésel sano gasta entre 0,20 y 0,35 L por kWh. Fuera de esa banda, o falta ' +
      'una lectura de horómetro/kWh del mes, o hay litros cargados a un equipo equivocado. ' +
      'Las horas y el kWh salen de los movimientos de tipo "Lectura": si en el mes hay una sola, la columna queda vacía.' })
  ]);
}

/* ===================================================================
   CÓDIGOS QR
   Dos familias de código, porque el punto y el medidor son cosas
   distintas: el punto se queda, el equipo se cambia.
     CM-P-<id>  · punto de medición  (etiqueta pegada en la estructura)
     CM-E-<id>  · equipo / medidor   (etiqueta pegada en el instrumento)
   Se escanean por separado: primero dónde estoy, después con qué mido.
   Una sola foto con los dos códigos suena cómodo, pero obliga a pegarlos
   juntos y a acertar el encuadre; y si el medidor se cambia, la etiqueta
   del punto se va con él.
   =================================================================== */
const codigoPunto  = id => 'CM-P-' + id;
const codigoEquipo = id => 'CM-E-' + id;

function leerCodigo(txt) {
  if (!txt) return null;
  const m = String(txt).trim().toUpperCase().match(/CM-([PE])-(\d+)/);
  if (!m) return null;
  return { clase: m[1] === 'P' ? 'punto' : 'equipo', id: Number(m[2]) };
}

// Android lee QR de forma nativa. iOS no: ahí se carga jsQR, que pesa y
// por eso solo se baja cuando de verdad hace falta.
let _jsqr = null;
async function cargarJsQR() {
  if (_jsqr) return _jsqr;
  if (window.jsQR) return (_jsqr = window.jsQR);
  await new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'jsqr.js'; s.onload = ok; s.onerror = mal;
    document.head.append(s);
  });
  return (_jsqr = window.jsQR);
}

// Devuelve el texto leído, o null si la persona cancela.
function escanear(titulo = 'Escanear código') {
  return new Promise(async resolve => {
    // El modal es uno solo. Si el escáner se abre desde otro modal (la captura,
    // por ejemplo), hay que devolverlo tal como estaba al cerrarse; si no, la
    // lectura a medio escribir desaparece al escanear el medidor.
    const habiaModal = !$('#modal').hidden;
    const tituloPrevio = $('#modal-titulo').textContent;
    const hijosPrevios = habiaModal ? [...$('#modal-cuerpo').childNodes] : null;

    const video = el('video', { playsinline: '', muted: '', autoplay: '' });
    const estado = el('p', { class: 'ayuda', text: 'Apunta al código. Se lee solo.' });
    const manual = el('input', { type: 'text', placeholder: 'o escribe el código: CM-P-12' });
    let vivo = true, flujo = null;

    const terminar = valor => {
      if (!vivo) return;
      vivo = false;
      flujo && flujo.getTracks().forEach(t => t.stop());
      if (habiaModal) {
        $('#modal-titulo').textContent = tituloPrevio;
        $('#modal-cuerpo').replaceChildren(...hijosPrevios);
      } else {
        cerrarModal();
      }
      resolve(valor);
    };

    modal(titulo, el('div', {}, [
      el('div', { class: 'escaner' }, [video, el('div', { class: 'mira' })]),
      estado,
      el('label', { text: 'Sin cámara' }, [manual]),
      el('div', { class: 'fila' }, [
        el('button', { class: 'btn primario', text: 'Usar el código escrito',
          onclick: () => manual.value.trim() && terminar(manual.value.trim()) }),
        el('button', { class: 'btn', text: 'Cancelar', onclick: () => terminar(null) })
      ])
    ]));
    $('#modal-cerrar').addEventListener('click', () => terminar(null), { once: true });

    try {
      flujo = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = flujo;
      await video.play();
    } catch (e) {
      estado.className = 'banda warn';
      estado.textContent = 'No se pudo abrir la cámara (' + (e.name || e.message) +
        '). Escribe el código a mano: está impreso debajo del QR.';
      return;
    }

    let detector = null;
    if ('BarcodeDetector' in window) {
      try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { }
    }
    const lienzo = document.createElement('canvas');
    let lector = null;
    if (!detector) {
      estado.textContent = 'Preparando el lector…';
      try { lector = await cargarJsQR(); estado.textContent = 'Apunta al código. Se lee solo.'; }
      catch {
        estado.className = 'banda warn';
        estado.textContent = 'Este navegador no puede leer QR. Escribe el código a mano.';
        return;
      }
    }

    const mirar = async () => {
      if (!vivo) return;
      try {
        if (detector) {
          const r = await detector.detect(video);
          if (r.length) return terminar(r[0].rawValue);
        } else if (video.videoWidth) {
          lienzo.width = video.videoWidth; lienzo.height = video.videoHeight;
          const cx = lienzo.getContext('2d', { willReadFrequently: true });
          cx.drawImage(video, 0, 0);
          const d = cx.getImageData(0, 0, lienzo.width, lienzo.height);
          const r = lector(d.data, d.width, d.height);
          if (r && r.data) return terminar(r.data);
        }
      } catch { /* un cuadro fallido no interrumpe la lectura */ }
      setTimeout(mirar, detector ? 220 : 400);
    };
    mirar();
  });
}

// Del código al punto: acepta el del punto y el del medidor.
function resolverCodigo(codigo) {
  const c = leerCodigo(codigo);
  if (!c) return { error: 'Ese código no es de Cierre de Mes. Los nuestros empiezan por CM-P- o CM-E-.' };

  if (c.clase === 'punto') {
    const vs = S.catalogo.variables.filter(v => v.punto.id === c.id);
    if (!vs.length) return { error: `El punto ${codigoPunto(c.id)} no está entre los que puedes tomar.` };
    return { punto: vs[0].punto, variables: vs };
  }

  const vs = S.catalogo.variables.filter(v => v.punto.equipo && v.punto.equipo.equipo_id === c.id);
  if (!vs.length) return { error: `El medidor ${codigoEquipo(c.id)} no está instalado en ninguno de tus puntos. ` +
    'Si lo acaban de instalar, avisa al supervisor para que lo asigne.' };
  return { punto: vs[0].punto, variables: vs, equipoId: c.id };
}

async function escanearYAbrir() {
  const txt = await escanear('Escanear punto o medidor');
  if (!txt) return;
  const r = resolverCodigo(txt);
  if (r.error) return toast(r.error, true);
  if (r.variables.length === 1) return abrirCaptura(r.variables[0]);
  // Un punto con varias variables (kWh importada y exportada, por ejemplo)
  modal(r.punto.nombre, el('div', {}, [
    el('p', { class: 'ayuda', text: 'Este punto tiene más de una variable. ¿Cuál vas a tomar?' }),
    ...r.variables.map(v => el('button', { class: 'btn grande', style: 'width:100%;margin-bottom:8px',
      text: `${v.nombre} (${UNIDAD[v.unidad_reporte] || v.unidad_reporte})`,
      onclick: () => { cerrarModal(); abrirCaptura(v); } }))
  ]));
}

// Dentro de la captura: confirmar que el medidor que tengo enfrente es el
// que la base cree que está instalado en este punto.
async function verificarMedidor(v, zona) {
  // El resultado reemplaza al botón, así que siempre se vuelve a ofrecer:
  // en terreno es normal escanear dos veces hasta acertar la etiqueta.
  const otraVez = () => el('button', { class: 'btn chico', text: 'Escanear otra vez',
    onclick: () => verificarMedidor(v, zona) });
  const decir = (...nodos) => poner(zona, ...nodos, otraVez());

  const txt = await escanear('Escanear el medidor');
  if (!txt) return;
  const c = leerCodigo(txt);
  if (!c) return toast('Ese código no es de Cierre de Mes.', true);
  if (c.clase === 'punto') {
    return decir(el('p', { class: 'banda warn', text:
      'Ese es el código del punto, no el del medidor. El del medidor va pegado en el instrumento y empieza por CM-E-.' }));
  }
  const instalado = v.punto.equipo?.equipo_id || null;
  if (instalado && instalado === c.id) {
    return decir(el('p', { class: 'banda ok', text:
      `Medidor correcto: ${codigoEquipo(c.id)}${v.punto.equipo.tag ? ' · ' + v.punto.equipo.tag : ''}.` }));
  }
  decir(
    el('p', { class: 'banda bad', text: instalado
      ? `El medidor instalado en este punto es ${codigoEquipo(instalado)}` +
        `${v.punto.equipo.tag ? ' (' + v.punto.equipo.tag + ')' : ''}, y escaneaste ${codigoEquipo(c.id)}. ` +
        'Toma la lectura igual: el dato del display es el dato. Pero deja el aviso para que el supervisor ' +
        'corrija la asignación, porque si no el consumo se va a comparar contra el histórico del medidor viejo.'
      : `Este punto no tiene medidor asignado y escaneaste ${codigoEquipo(c.id)}. Deja el aviso para que lo asignen.` }),
    el('button', { class: 'btn', text: 'Dejar aviso de medidor cambiado',
      onclick: () => abrirAviso(v.punto, `Se escaneó ${codigoEquipo(c.id)} en este punto` +
        (instalado ? `, pero la asignación vigente es ${codigoEquipo(instalado)}.` : ', que no tiene medidor asignado.')) })
  );
}

/* ---------------- hoja de etiquetas imprimible ---------------- */
async function vistaEtiquetas(c) {
  const sitios = S.catalogo.sitios;
  const selSitio = el('select', {}, [el('option', { value: '', text: 'Todos los sitios' }),
    ...sitios.map(s => el('option', { value: s.id, text: s.nombre }))]);
  const selGrupo = el('select', {}, [el('option', { value: '', text: 'Todos los grupos' }),
    ...[...S.catalogo.grupos].sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
        .map(g => el('option', { value: g.id, text: g.nombre }))]);
  const cuales = el('select', {}, [
    el('option', { value: 'ambos', text: 'Punto y medidor (dos etiquetas)' }),
    el('option', { value: 'punto', text: 'Solo los puntos' }),
    el('option', { value: 'equipo', text: 'Solo los medidores' })
  ]);
  const zona = el('div');

  const refrescar = () => {
    const puntos = new Map();
    for (const v of S.catalogo.variables) {
      if (selSitio.value && String(v.punto.sitio.id) !== selSitio.value) continue;
      if (selGrupo.value && String(v.grupo_id) !== selGrupo.value) continue;
      puntos.set(v.punto.id, v.punto);
    }
    const lista = [...puntos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    const etiquetas = [];
    for (const p of lista) {
      // La etiqueta del PUNTO no menciona al medidor: el medidor se cambia y la
      // etiqueta quedaría mintiendo pegada en la estructura durante años.
      if (cuales.value !== 'equipo')
        etiquetas.push({ codigo: codigoPunto(p.id), titulo: p.nombre,
                         pie: p.sitio.nombre, clase: 'punto' });
      // Y la del EQUIPO no menciona al punto, por lo mismo al revés: el equipo
      // se traslada y se lleva su etiqueta puesta.
      if (cuales.value !== 'punto' && p.equipo?.equipo_id)
        etiquetas.push({ codigo: codigoEquipo(p.equipo.equipo_id),
                         titulo: p.equipo.tag || ('Medidor ' + p.equipo.equipo_id),
                         pie: [p.equipo.marca, p.equipo.modelo,
                               p.equipo.n_serie ? 'serie ' + p.equipo.n_serie : null]
                              .filter(Boolean).join(' · ') || 'Medidor', clase: 'equipo' });
    }
    poner(zona,
      el('p', { class: 'ayuda', text:
        `${etiquetas.length} etiquetas · ${lista.length} puntos. Entran unas 21 por hoja A4 (3 por fila): ${Math.ceil(etiquetas.length / 21)} hojas aprox.` }),
      el('div', { class: 'fila' }, [
        el('button', { class: 'btn primario', disabled: !etiquetas.length || null,
          text: 'Imprimir las etiquetas', onclick: () => imprimirEtiquetas(etiquetas) }),
        el('button', { class: 'btn', disabled: !etiquetas.length || null,
          text: 'Descargar los QR como imágenes', onclick: e => descargarQR(etiquetas, e.target) })
      ]),
      el('p', { class: 'ayuda', id: 'qr-paso' }),
      el('div', { class: 'etiquetas vista-previa' }, etiquetas.slice(0, 12).map(dibujarEtiqueta)),
      etiquetas.length > 12 ? el('p', { class: 'ayuda', text:
        `Vista previa de 12 de ${etiquetas.length}; se imprimen todas, 24 por hoja.` }) : null
    );
  };
  for (const s of [selSitio, selGrupo, cuales]) s.addEventListener('change', refrescar);

  c.append(
    el('p', { class: 'ayuda', text:
      'Dos etiquetas por punto: una para la estructura (CM-P-…) y otra para el instrumento (CM-E-…). ' +
      'Se escanean por separado, así que si mañana cambian el medidor solo se reemplaza su etiqueta. ' +
      'Imprímelas en papel adhesivo y protégelas con cinta transparente: en la pampa el sol borra la tinta.' }),
    el('div', { class: 'fila seccion' }, [
      el('label', { class: 'crece', text: 'Sitio' }, [selSitio]),
      el('label', { class: 'crece', text: 'Grupo' }, [selGrupo]),
      el('label', { class: 'crece', text: 'Qué imprimir' }, [cuales])
    ]),
    zona);
  refrescar();
}

// Un PNG por código, para pegarlos en la plantilla de autoadhesivos que ya se
// usa en faena. El QR se dibuja en un canvas a mano: convertir el SVG a PNG en
// el navegador es más frágil (tamaños distintos según el motor).
async function descargarQR(etiquetas, boton) {
  const paso = t => { const n = $('#qr-paso'); if (n) n.textContent = t; };
  boton.disabled = true;
  try {
    if (typeof JSZip === 'undefined') {
      paso('Cargando el compresor…');
      await new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = 'jszip.js'; s.onload = ok; s.onerror = mal;
        document.head.append(s);
      });
    }
    const zip = new JSZip();
    const L = window.RESPALDO.limpio;
    for (let i = 0; i < etiquetas.length; i++) {
      const e = etiquetas[i];
      paso(`Dibujando ${i + 1} de ${etiquetas.length}…`);
      const q = qrcode(0, 'M'); q.addData(e.codigo); q.make();
      const n = q.getModuleCount();
      const escala = Math.max(2, Math.floor(560 / (n + 8)));   // margen de 4 módulos
      const lado = (n + 8) * escala;
      const cv = document.createElement('canvas');
      cv.width = cv.height = lado;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, lado, lado);
      cx.fillStyle = '#000';
      for (let f = 0; f < n; f++)
        for (let c = 0; c < n; c++)
          if (q.isDark(f, c))
            cx.fillRect((c + 4) * escala, (f + 4) * escala, escala, escala);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      zip.file(`${e.clase === 'punto' ? 'puntos' : 'medidores'}/${e.codigo}_${L(e.titulo.replace(/³/g, '3'))}.png`, blob);
      if (i % 10 === 0) await new Promise(r => setTimeout(r));   // no congelar la pantalla
    }
    zip.file('leeme.txt',
      'Un PNG por código. El nombre del archivo es el código y el nombre del punto o del medidor.\n' +
      'Para pegarlos en la plantilla de etiquetas: Insertar → Imagen → Este dispositivo.\n' +
      'Imprímelos a 2,5 cm de lado o más; por debajo de eso la cámara del celular sufre.\n');
    paso('Comprimiendo…');
    descargar(await zip.generateAsync({ type: 'blob' }), `QR_Cierre_de_Mes_${new Date().toISOString().slice(0,10)}.zip`);
    paso('');
    toast(`${etiquetas.length} imágenes listas`);
  } catch (err) {
    paso('');
    toast('No se pudieron generar las imágenes: ' + (err.message || err), true);
  } finally { boton.disabled = false; }
}

function dibujarEtiqueta(e) {
  const q = qrcode(0, 'M');
  q.addData(e.codigo);
  q.make();
  return el('div', { class: 'etiqueta ' + e.clase }, [
    el('div', { class: 'qr', html: q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }) }),
    el('div', { class: 'txt' }, [
      // En terreno hay que distinguir de un vistazo cuál etiqueta es cuál,
      // porque van pegadas a medio metro una de otra.
      el('span', { class: 'que', text: e.clase === 'punto' ? 'PUNTO' : 'MEDIDOR' }),
      el('strong', { text: e.titulo }),
      el('span', { class: 'cod', text: e.codigo }),
      el('span', { class: 'pie', text: e.pie })
    ])
  ]);
}

function imprimirEtiquetas(etiquetas) {
  // Una sola rejilla continua: el navegador corta donde corresponde según el
  // papel y los márgenes de cada impresora. Partirla en hojas fijas hace que
  // sobre o falte una fila apenas cambia el margen.
  const cont = document.getElementById('impresion');
  cont.replaceChildren(el('div', { class: 'hoja hoja-etiquetas' }, [
    el('div', { class: 'etiquetas' }, etiquetas.map(dibujarEtiqueta))
  ]));
  document.body.classList.add('imprimiendo');
  const limpiar = () => {
    document.body.classList.remove('imprimiendo');
    cont.replaceChildren();
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);
  setTimeout(() => window.print(), 120);
}

/* ===================================================================
   Service worker + arranque
   =================================================================== */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') location.reload(); });
arrancar();
})();

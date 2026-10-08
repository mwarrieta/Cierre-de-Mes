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
  filtro: '',
  soloPendientes: false,   // en terreno, ver solo lo que falta
  agrupar: 'grupo'         // los puntos se agrupan solo por grupo (el sitio se eliminó)
};

// ------------------------------------------------------------------ utilidades
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, hijos = []) => {
  const n = document.createElement(tag);
  let valor;
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    // Un <textarea> ignora el atributo value: hay que asignar la propiedad. Sin esto,
    // al editar un aviso o un punto el texto guardado aparecía vacío y se borraba al guardar.
    else if (k === 'value' && (tag === 'textarea' || tag === 'select')) valor = v;
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const h of [].concat(hijos)) if (h) n.append(h);
  if (valor !== undefined && valor !== null) n.value = valor;
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
  // Una fecha sola (2025-03-01) se lee como medianoche UTC: en Chile salía el día anterior.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(+m[1], m[2] - 1, +m[3]) : new Date(iso);
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

/* El modal es uno solo. Opciones:
   - completo: ocupa toda la pantalla (la captura en terreno).
   - subtitulo: segunda línea bajo el título.
   - alPedirCerrar: qué hacer cuando la persona toca ✕, el fondo o Escape. Sirve para
     preguntar antes de perder lo escrito. Sin esta opción, se cierra directo. */
let _modalOpts = {};
function modal(titulo, nodo, opts = {}) {
  _modalOpts = opts || {};
  $('#modal-titulo').textContent = titulo;
  const sub = $('#modal-subtitulo');
  sub.textContent = _modalOpts.subtitulo || '';
  sub.hidden = !_modalOpts.subtitulo;
  $('#modal').classList.toggle('completo', !!_modalOpts.completo);
  $('#modal').classList.toggle('titulo-grande', !!_modalOpts.tituloGrande);
  $('#modal-cuerpo').replaceChildren(...[].concat(nodo));
  $('#modal').hidden = false;
  document.body.classList.add('con-modal');
}
function cerrarModal() {
  _modalOpts = {};
  $('#modal').hidden = true;
  $('#modal').classList.remove('completo');
  $('#modal').classList.remove('titulo-grande');
  $('#modal-cuerpo').replaceChildren();
  document.body.classList.remove('con-modal');
}
function pedirCerrarModal() {
  if ($('#modal').hidden) return;
  const f = _modalOpts.alPedirCerrar;
  if (f) f(); else cerrarModal();
}

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

// El sitio se eliminó: un punto se describe por sus grupos de reporte.
const gruposDe = p => (p?.grupos && p.grupos.length ? [...p.grupos].sort(compararGrupos) : []);
const gruposTexto = p => gruposDe(p).join(' · ') || 'Sin grupo';

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
// recuperacion = viene del link del correo "¿Olvidaste tu contraseña?".
$('#btn-clave').addEventListener('click', () => abrirCambioClave());
function abrirCambioClave({ recuperacion = false } = {}) {
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
      toast(recuperacion ? 'Listo: contraseña nueva guardada. Ya estás dentro.'
                         : 'Contraseña cambiada. Se usa la nueva la próxima vez que entres.');
    } });

  modal(recuperacion ? 'Crea tu contraseña nueva' : 'Cambiar mi contraseña', el('div', {}, [
    recuperacion ? el('p', { class: 'banda acento', text:
      'Entraste con el enlace del correo. Escribe una contraseña nueva para tu cuenta.' }) : null,
    el('p', { class: 'ayuda', text: `Cuenta: ${S.usuario?.correo || ''}` }),
    el('label', { text: 'Contraseña nueva' }, [nueva]),
    el('label', { text: 'Repítela' }, [otra]),
    aviso,
    boton,
    el('p', { class: 'ayuda', text:
      'Al menos 8 caracteres, con letras y números. La sesión abierta sigue funcionando; ' +
      'la contraseña nueva se usa la próxima vez que entres.' })
  ]));
}

// ¿Olvidaste tu contraseña? · Supabase manda un correo con un enlace que vuelve
// a ESTA página (redirectTo) y abre el formulario de contraseña nueva.
// Para que el enlace no termine en otra app, la URL de esta página tiene que estar
// en Supabase → Authentication → URL Configuration → Redirect URLs.
$('#btn-olvide').addEventListener('click', () => {
  const correo = el('input', { type: 'email', autocomplete: 'username', value: $('#login-correo').value.trim() });
  const aviso = el('p', { class: 'banda warn', hidden: true });
  const boton = el('button', { class: 'btn primario grande', text: 'Enviarme el enlace', onclick: async () => {
    const c = correo.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(c)) { aviso.textContent = 'Escribe el correo con el que entras a la app.'; aviso.hidden = false; return; }
    if (!navigator.onLine) { aviso.textContent = 'Necesitas señal para pedir el enlace.'; aviso.hidden = false; return; }
    boton.disabled = true; boton.textContent = 'Enviando…';
    const volver = location.origin + location.pathname.replace(/index\.html$/, '');
    const { error } = await sb.auth.resetPasswordForEmail(c, { redirectTo: volver });
    boton.disabled = false; boton.textContent = 'Enviarme el enlace';
    if (error) {
      aviso.textContent = /rate|seconds/i.test(error.message)
        ? 'Ya se pidió un enlace hace poco. Espera un minuto y vuelve a intentarlo.' : error.message;
      aviso.hidden = false; return;
    }
    // Mismo mensaje exista o no la cuenta: no se revela qué correos están registrados.
    modal('Revisa tu correo', el('div', {}, [
      el('p', { text: `Si ${c} tiene cuenta en Cierre de Mes, te llegará un correo con un enlace para crear una contraseña nueva.` }),
      el('p', { class: 'ayuda', text: 'Ábrelo en este mismo teléfono o computador. El enlace sirve una sola vez y vence en una hora. Si no llega en unos minutos, revisa la carpeta de spam.' }),
      el('button', { class: 'btn grande', text: 'Entendido', onclick: cerrarModal })
    ]));
  } });
  modal('Recuperar contraseña', el('div', {}, [
    el('p', { class: 'ayuda', text: 'Te mandamos un enlace al correo para que crees una contraseña nueva.' }),
    el('label', { text: 'Correo' }, [correo]),
    aviso, boton
  ]));
});

// Enlace del correo vencido o ya usado: se avisa en el login en vez de fallar callado.
if (window.__errorEnlace) {
  $('#login-error').textContent = 'El enlace para recuperar la contraseña venció o ya se usó. ' +
    'Pide uno nuevo con "¿Olvidaste tu contraseña?".';
  $('#login-error').hidden = false;
  history.replaceState(null, '', location.pathname + location.search);
}

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

  // Viene del enlace "recuperar contraseña": ya hay sesión, falta la clave nueva.
  if (window.__recuperacion) {
    window.__recuperacion = false;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => abrirCambioClave({ recuperacion: true }), 0);
  }

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
  construirNavInferior();

  // En iOS, Safari borra el almacenamiento tras unos días sin usar el sitio.
  // Pedir persistencia lo evita, y solo se concede si la app está instalada.
  DB.pedirPersistencia();
  // Las bandas esperadas se refrescan solas, sin que nadie las espere.
  DB.refrescarBandas();

  await refrescarDatos();
  await actualizarConexion();
  revisarVersion();
  // Al abrir la app se muestra una portada sin datos; se navega desde el menú.
  ir('inicio');
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
  const r = await DB.sincronizar(null, !silencioso);   // a mano se reintenta todo
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
/* Dos formas de navegar según el aparato (los cortes son los mismos que en el CSS):
   · ≥900px (PC, tablet horizontal): barra lateral con secciones plegables.
   · <900px (celular, tablet vertical): barra inferior; al tocar una sección se abre
     un panel con sus pantallas. El ☰ queda solo para la cuenta.
   Las pantallas y sus permisos salen de #menu: ahí se define qué ve cada rol. */
let hojaGrupo = null;          // sección cuyo panel está abierto en la barra inferior
let ultimaVistaNav = null;     // para abrir la sección solo cuando cambia la pantalla

function actualizarVelo() {
  $('#velo').hidden = !($('#menu').classList.contains('abierto') || hojaGrupo);
}
function menuAbierto(abrir) {
  if (abrir) cerrarHoja();
  $('#menu').classList.toggle('abierto', abrir);
  actualizarVelo();
}
function cerrarHoja() {
  hojaGrupo = null;
  $('#hoja').hidden = true;
  $$('#navinf .tab').forEach(t => t.setAttribute('aria-expanded', 'false'));
  actualizarVelo();
}
function abrirHoja(grupo) {
  $('#menu').classList.remove('abierto');
  hojaGrupo = grupo.dataset.grupo;
  const hoja = $('#hoja');
  $('#hoja-tit').textContent = $('.grupo-nombre', grupo).textContent;
  $('.panel-nav-lista', hoja).replaceChildren(...$$('.grupo-items button[data-vista]', grupo)
    .filter(b => !b.hidden)
    .map(b => el('button', {
      type: 'button', class: b.dataset.vista === S.vista ? 'sel' : null,
      text: b.textContent.trim(), onclick: () => ir(b.dataset.vista)
    })));
  hoja.hidden = false;
  $$('#navinf .tab').forEach(t =>
    t.setAttribute('aria-expanded', String(t.dataset.grupo === hojaGrupo)));
  actualizarVelo();
}

function ponerGrupo(g, abierto) {
  g.classList.toggle('abierto', abierto);
  $('.grupo-cab', g)?.setAttribute('aria-expanded', String(abierto));
}
// Una sección abierta a la vez en la barra lateral.
$$('#menu .grupo-cab:not([data-vista])').forEach(cab => cab.addEventListener('click', () => {
  const g = cab.closest('.menu-grupo');
  const abrir = !g.classList.contains('abierto');
  $$('#menu .menu-grupo.abierto').forEach(o => ponerGrupo(o, false));
  ponerGrupo(g, abrir);
}));

// Marca la pantalla actual en la barra lateral y en la inferior. Se llama desde
// render(), así que cubre todos los caminos (menú, escaneo, ficha de un punto).
function marcarNav() {
  let actual = null;
  $$('#menu button[data-vista]').forEach(b => {
    const sel = b.dataset.vista === S.vista;
    b.classList.toggle('sel', sel);
    if (sel) actual = b.closest('.menu-grupo');
  });
  $$('#menu .menu-grupo').forEach(g => g.classList.toggle('tiene-sel', g === actual));
  // La sección de la pantalla actual se abre sola, pero solo cuando la pantalla
  // cambia: si alguien abrió otra a mano, un refresco de datos no se la cierra.
  if (S.vista !== ultimaVistaNav) {
    ultimaVistaNav = S.vista;
    $$('#menu .menu-grupo').forEach(g =>
      ponerGrupo(g, g === actual && !$('.grupo-cab[data-vista]', g)));
  }
  $$('#navinf .tab').forEach(t =>
    t.classList.toggle('sel', !!actual && t.dataset.grupo === actual.dataset.grupo));
  document.body.classList.toggle('ficha-abierta', !!S.puntoAbierto);
  if (S.puntoAbierto) cerrarHoja();
}

// Se arma después de filtrar #menu por rol: cada usuario ve solo sus secciones.
// Con una sola sección visible no hay nada que elegir y la barra no aparece.
function construirNavInferior() {
  const grupos = $$('#menu .menu-grupo').filter(g => !g.hidden);
  const nav = $('#navinf');
  ultimaVistaNav = null;
  nav.replaceChildren(...grupos.map(g => {
    const directo = $('.grupo-cab[data-vista]', g);
    return el('button', {
      type: 'button', class: 'tab', 'data-grupo': g.dataset.grupo, 'aria-expanded': 'false',
      onclick: () => directo ? ir(directo.dataset.vista)
                  : hojaGrupo === g.dataset.grupo ? cerrarHoja() : abrirHoja(g)
    }, [$('svg.ico', g).cloneNode(true), el('span', { text: g.dataset.corto })]);
  }));
  const hay = grupos.length >= 2;
  nav.hidden = !hay;
  document.body.classList.toggle('con-navinf', hay);
  marcarNav();
}

$('#btn-menu').addEventListener('click', () => menuAbierto(!$('#menu').classList.contains('abierto')));
$('#velo').addEventListener('click', () => { menuAbierto(false); cerrarHoja(); });
$('#hoja-cerrar').addEventListener('click', cerrarHoja);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { menuAbierto(false); cerrarHoja(); } });
// Si la tablet se gira a horizontal con un panel abierto, se cierra.
window.matchMedia('(min-width:900px)').addEventListener?.('change', e => {
  if (e.matches) { menuAbierto(false); cerrarHoja(); }
});
$('#modal-cerrar').addEventListener('click', pedirCerrarModal);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') pedirCerrarModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') pedirCerrarModal(); });

// Sin zoom con los dedos: la app se usa en terreno y una pantalla ampliada por
// accidente es difícil de volver a su tamaño. iOS ignora user-scalable=no del
// viewport, por eso además se cortan los gestos de pellizco aquí.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, e => e.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', e => {
  if (e.touches && e.touches.length > 1) e.preventDefault();
}, { passive: false });

// ------------------------------------------------------------------ tema claro / oscuro
const TEMAS = {
  light: { nombre: 'Claro', desc: 'Fondo claro con verde azulado.', meta: '#0f2226', mues: ['#f2f4f3', '#ffffff', '#0e6f68'] },
  dark:  { nombre: 'Oscuro', desc: 'Para poca luz.', meta: '#0b1517', mues: ['#0b1517', '#122124', '#4fbdaf'] },
  clean: { nombre: 'Limpio', desc: 'Grises, blanco y negro: plano y de alto contraste.', meta: '#e9e9e6', mues: ['#e9e9e6', '#ffffff', '#111111'] }
};

function esTemaOscuroActivo() {
  const m = document.documentElement.getAttribute('data-modo');
  if (m === 'dark') return true;
  if (m === 'light' || m === 'clean') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
const temaActual = () => {
  const m = document.documentElement.getAttribute('data-modo');
  return TEMAS[m] ? m : (esTemaOscuroActivo() ? 'dark' : 'light');
};

function fijarTema(modo) {
  if (!TEMAS[modo]) modo = 'light';
  document.documentElement.setAttribute('data-modo', modo);
  try { localStorage.setItem('cierre_mes_modo', modo); } catch (e) {}
  const metaTheme = $('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', TEMAS[modo].meta);
}

// Un toque abre las tres opciones y otro toque elige.
function elegirTema() {
  const actual = temaActual();
  const lista = Object.entries(TEMAS).map(([k, t]) => el('button', {
    type: 'button', class: 'tema-op' + (k === actual ? ' sel' : ''), 'aria-pressed': k === actual ? 'true' : 'false',
    onclick: () => { fijarTema(k); cerrarModal(); }
  }, [
    el('span', { class: 'tema-mues' }, t.mues.map(c => el('i', { style: `background:${c}` }))),
    el('span', { class: 'tema-txt' }, [el('b', { text: t.nombre }), el('small', { text: t.desc })]),
    k === actual ? el('span', { class: 'tema-ok', text: '✓' }) : null
  ]));
  modal('Tema de colores', el('div', { class: 'tema-lista' }, lista));
}

// Sincronizar theme-color inicial
const metaTheme = $('meta[name="theme-color"]');
if (metaTheme) metaTheme.setAttribute('content', TEMAS[temaActual()].meta);

$('#btn-tema')?.addEventListener('click', elegirTema);
$('#btn-tema-login')?.addEventListener('click', elegirTema);

$$('#menu button[data-vista]').forEach(b =>
  b.addEventListener('click', () => ir(b.dataset.vista)));

// Pantallas que solo ve el administrador: además de ocultarse del menú, aquí se cierra la puerta.
const SOLO_ADMIN = ['usuarios', 'auditoria', 'sugerencias'];
function ir(vista) {
  if (SOLO_ADMIN.includes(vista) && !esAdmin()) vista = null;
  if (!TITULOS[vista]) vista = esSupervisor() ? 'consumos' : 'terreno';
  if (S.puntoAbierto && S.fichaSucia && !confirm('Hay cambios sin guardar en este punto. ¿Salir igual?')) return;
  S.puntoAbierto = null; S.fichaSucia = false; S.puntoEnHistorial = false;
  S.vista = vista;
  S.filtro = '';
  menuAbierto(false);
  cerrarHoja();
  render();
}

const TITULOS = {
  inicio: 'Cierre de Mes',
  terreno: 'Terreno', cierrecf: 'Cierre de generadores',
  consumos: 'Consumos e informes', avisos: 'Avisos', equipos: 'Equipos',
  dispositivo: 'Este dispositivo',
  puntos: 'Puntos de medición', grupos: 'Grupos', respaldo: 'Respaldo',
  usuarios: 'Usuarios', sugerencias: 'Sugerencias y fallas', auditoria: 'Auditoría',
  generadores: 'Casa de Fuerza · Generadores', recargas: 'Casa de Fuerza · Combustible',
  etiquetas: 'Etiquetas QR'
};

// replaceChildren(...) convierte cualquier argumento que no sea un nodo en texto:
// un null intermedio termina impreso como la palabra "null" en pantalla.
function poner(cont, ...hijos) {
  cont.replaceChildren(...hijos.flat().filter(Boolean));
}

// Iconos de línea: heredan el color del botón y se ven igual en todos los teléfonos
// (los emojis cambian de dibujo según el sistema).
const ICONO = (() => {
  const svg = d => `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  return {
    camara: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    galeria: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
    qr: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>' +
            '<rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>')
  };
})();
const conIcono = (ico, texto) => `${ico}<span>${esc(texto)}</span>`;

/* Energía: importada = kWh+ (lo que entra), exportada = kWh- (lo que sale).
   El signo va en el nombre de la variable (base de datos), así aparece en todos los
   informes, y además junto a la unidad en el campo de captura. */
const signoEnergia = v => /importada/i.test(v?.nombre || '') ? '+'
                        : /exportada/i.test(v?.nombre || '') ? '-' : '';
// En terreno siempre se carga en el mismo orden, aunque la principal sea la exportada:
// importada primero, exportada después, el resto al final (la principal antes).
const rangoVar = v => /importada|generada/i.test(v.nombre || '') ? 0 : /exportada/i.test(v.nombre || '') ? 1 : 2;
const ordenVariables = (a, b) => rangoVar(a) - rangoVar(b) ||
  (b.principal === true) - (a.principal === true) || a.id - b.id;

// Las fotos de una lectura, en el orden en que se sacaron (Foto 1, 2, 3).
const fotosOrdenadas = l => [...(l.fotos || [])]
  .sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99) || a.id - b.id);

// Leyenda amarilla al pie de cada vista: abre el formulario para contar una falla o una idea.
const avisoBeta = () => el('button', { type: 'button', class: 'aviso-beta',
  text: 'Versión beta · ¿Algo falla o se puede mejorar? Cuéntanos', onclick: () => formSugerencia() });

function render() {
  marcarNav();
  $('#titulo-vista').textContent = TITULOS[S.vista] || '';
  $('#subtitulo-vista').textContent =
    ['inicio','sugerencias','equipos','puntos','grupos','respaldo','usuarios','auditoria','avisos','consumos','dispositivo','generadores','etiquetas','cierrecf'].includes(S.vista) ? ''
      : S.vista === 'recargas' ? ''
      : S.vista === 'terreno' ? nombreCampana(S.periodo)
      : nombrePeriodo(S.vista === 'consumos' ? S.periodoConsumo : S.periodo);
  // Cada vista escribe en SU propio contenedor. Si una consulta lenta termina
  // después de que el usuario cambió de sección, escribe en un nodo ya desechado
  // en vez de pisar la vista nueva.
  const c = el('div');
  // Consumos usa todo el ancho de la pantalla: la tabla es lo principal.
  $('#contenido').classList.toggle('ancho', ['consumos', 'auditoria'].includes(S.vista));
  $('#contenido').replaceChildren(c, avisoBeta());
  ({
    inicio: vistaInicio,
    terreno: vistaTerreno, cierrecf: vistaCierreCF,
    consumos: vistaConsumos, avisos: vistaAvisos, equipos: vistaEquipos,
    dispositivo: vistaDispositivo,
    puntos: vistaPuntos, grupos: vistaGrupos, respaldo: vistaRespaldo,
    usuarios: vistaUsuarios, sugerencias: vistaSugerencias, auditoria: vistaAuditoria,
    generadores: vistaGeneradores, recargas: vistaRecargas,
    etiquetas: vistaEtiquetas
  }[S.vista] || vistaPuntosSiInstalaciones())(c);
}

// ------------------------------------------------------------------ portada
// Pantalla de bienvenida: no muestra ningún dato; se sale de ella con el menú.
function vistaInicio(c) {
  const nombre = String(S.usuario?.nombre || '').trim().split(/\s+/)[0];
  c.append(el('section', { class: 'portada' }, [
    el('img', { src: 'icon-192.png', alt: '', width: 72, height: 72 }),
    el('h2', { text: nombre ? `Bienvenido, ${nombre}` : 'Bienvenido' }),
    el('p', { class: 'ayuda', text: 'Cierre de Mes · Lecturas de energía, agua y gas' })
  ]));
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
      type: 'search', placeholder: 'Buscar por TAG, punto o grupo…', value: S.filtro,
      oninput: e => { S.filtro = e.target.value.toLowerCase(); pintarLista(); }
    })
  ]);
  const cabecera = el('div', { class: 'fila entre seccion' }, [
    selectorPeriodo(),
    el('button', { class: 'btn primario grande', text: 'Escanear código',
      onclick: () => escanearYAbrir() })
  ]);
  // La confusión clásica: creer que la toma del 1 de septiembre "es" septiembre.
  // Una línea a la vista y el detalle plegado: el párrafo entero empujaba la lista.
  const explicacion = el('details', { class: 'explica-periodo' }, [
    el('summary', { text: `Cierra el consumo de ${nombrePeriodo(mesAnterior(S.periodo))}` }),
    el('p', { class: 'ayuda', text:
      `El totalizador de hoy menos el del mes pasado da el consumo de ` +
      `${nombrePeriodo(mesAnterior(S.periodo))}. Puedes adelantar la toma los últimos días ` +
      'del mes; la app guarda la fecha real en que la tomaste.' })
  ]);
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
  const enCola = new Set();
  // clave ('p'+punto o 'v'+variable) → fotos esperando envío. El prefijo evita que
  // el id de un punto se confunda con el de una variable.
  const enColaFoto = new Map();
  const sumarFotos = (k, n) => { if (n) enColaFoto.set(k, (enColaFoto.get(k) || 0) + n); };
  for (const it of cola) {
    const nf = (it.fotoIds && it.fotoIds.length) ? it.fotoIds.length : (it.fotoId ? 1 : 0);
    if (it.tipo === 'captura') {
      (it.lecturas || []).forEach(l => enCola.add(l.variable_id));
      if (it.punto_id) sumarFotos('p' + it.punto_id, nf);
    } else if (it.tipo === 'foto') {
      if (it.variable_id) sumarFotos('v' + it.variable_id, nf);
    } else if (it.variable_id) {
      enCola.add(it.variable_id);
    }
  }
  const tomada = v => S.lecturas.some(l => l.variable_id === v.id) || enCola.has(v.id);
  const sinDato = v => {
    const l = S.lecturas.find(x => x.variable_id === v.id);
    return !!(l && l.sin_dato);
  };

  // Un PUNTO es lo que se recorre en terreno, no una variable: el mismo display
  // puede mostrar importada, exportada y horas, y se toman de una sola vez.
  const porPunto = new Map();
  for (const v of S.catalogo.variables) {
    if (!porPunto.has(v.punto.id)) porPunto.set(v.punto.id, { punto: v.punto, vars: [] });
    porPunto.get(v.punto.id).vars.push(v);
  }
  let puntos = [...porPunto.values()];
  for (const p of puntos) {
    p.vars.sort(ordenVariables);
    p.obligatorias = p.vars.filter(v => !v.opcional);
    p.faltan = p.obligatorias.filter(v => !tomada(v));
    p.sinDato = p.vars.filter(sinDato);
    p.enCola = p.vars.some(v => enCola.has(v.id));
    p.opcPendientes = p.vars.filter(v => v.opcional && !tomada(v));

    const lecturasPunto = p.vars.map(v => S.lecturas.find(l => l.variable_id === v.id)).filter(Boolean);
    let nFotos = lecturasPunto.reduce((acc, l) => acc + (l.fotos?.length || 0), 0);
    nFotos += (enColaFoto.get('p' + p.punto.id) || 0)
            + p.vars.reduce((n, v) => n + (enColaFoto.get('v' + v.id) || 0), 0);
    p.nFotos = nFotos;
    p.tieneFoto = nFotos > 0;
    p.conDato = p.vars.some(tomada);
    p.sinFoto = p.conDato && !p.tieneFoto;
  }

  const f = S.filtro;
  if (f) puntos = puntos.filter(p => {
    const eq = p.punto.equipo?.tag || '';
    return `${p.punto.nombre} ${gruposTexto(p.punto)} ${eq} ${p.vars.map(v => v.nombre).join(' ')}`
      .toLowerCase().includes(f);
  });

  const total = puntos.length;
  const pend = puntos.filter(p => p.faltan.length).length;
  const nSinDato = puntos.filter(p => p.sinDato.length).length;
  const nOpc = puntos.filter(p => !p.faltan.length && p.opcPendientes.length).length;
  const nSinFoto = puntos.filter(p => p.sinFoto).length;

  S.filtrosEstados = S.filtrosEstados || new Set();

  let items = puntos;
  if (S.filtrosEstados.size > 0) {
    items = items.filter(p => {
      if (S.filtrosEstados.has('pendientes') && p.faltan.length) return true;
      if (S.filtrosEstados.has('sindato') && p.sinDato.length) return true;
      if (S.filtrosEstados.has('opcionales') && p.opcPendientes.length) return true;
      if (S.filtrosEstados.has('sinfoto') && p.sinFoto) return true;
      return false;
    });
  }

  cont.replaceChildren();

  const chip = (texto, activo, alTocar) => el('button', {
    class: 'chip-filtro' + (activo ? ' sel' : ''), text: texto, onclick: alTocar });
    
  const toggleFiltro = (f) => {
    if (S.filtrosEstados.has(f)) S.filtrosEstados.delete(f);
    else S.filtrosEstados.add(f);
    pintarLista();
  };

  // Cuánto falta, de un vistazo.
  const hechos = total - pend;
  const nCola = puntos.filter(p => p.enCola).length;
  cont.append(el('div', { class: 'avance' }, [
    el('div', { class: 'avance-txt' }, [
      el('b', { text: pend ? `Faltan ${pend} de ${total}` : `Todo tomado · ${total} puntos` }),
      nCola ? el('span', { class: 'pill acento', text: `${nCola} por enviar` }) : null
    ]),
    el('div', { class: 'avance-barra' }, [
      el('span', { style: `width:${total ? Math.round(100 * hechos / total) : 0}%` })
    ])
  ]));

  cont.append(el('div', { class: 'filtros-terreno' }, [
    chip(`Todos · ${total}`, S.filtrosEstados.size === 0,
      () => { S.filtrosEstados.clear(); pintarLista(); }),
    chip(`Pendientes · ${pend}`, S.filtrosEstados.has('pendientes'),
      () => toggleFiltro('pendientes')),
    // "No se pudo leer" no es pendiente ni es dato: es su propia cola de trabajo.
    nSinDato ? chip(`No se pudo leer · ${nSinDato}`, S.filtrosEstados.has('sindato'),
      () => toggleFiltro('sindato')) : null,
    nOpc && nOpc < total ? chip(`Con opcional sin cargar · ${nOpc}`, S.filtrosEstados.has('opcionales'),
      () => toggleFiltro('opcionales')) : null,
    chip(`Sin foto · ${nSinFoto}`, S.filtrosEstados.has('sinfoto'),
      () => toggleFiltro('sinfoto')),
  ].filter(Boolean)));

  if (!items.length) {
    cont.append(el('p', { class: 'vacio', text: S.filtrosEstados.size > 0 && total
      ? 'No queda nada con este filtro. Buen trabajo.'
      : 'Nada coincide con la búsqueda.' }));
    return;
  }

  // Un punto puede estar en varios grupos, pero en terreno se toma UNA vez: se
  // lista en su primer grupo y los demás se nombran en el detalle.
  const secciones = {};
  for (const p of items) {
    const gs = p.punto.grupos && p.punto.grupos.length ? p.punto.grupos : ['Sin grupo'];
    const clave = [...gs].sort(compararGrupos)[0];
    (secciones[clave] ||= []).push(p);
  }
  const orden = Object.keys(secciones).sort(compararGrupos);

  for (const seccion of orden) {
    const lista = secciones[seccion];
    const faltan = lista.filter(p => p.faltan.length).length;
    const sd = lista.filter(p => p.sinDato.length).length;
    cont.append(el('div', { class: 'grupo-sitio' }, [
      el('span', { text: seccion }),
      el('span', { class: 'cuenta-seccion', text:
        faltan ? `faltan ${faltan}` : sd ? `${sd} sin poder leer` : 'completo' })
    ]));

    for (const p of lista.sort((a, b) => a.punto.nombre.localeCompare(b.punto.nombre))) {
      const tag = p.punto.equipo?.tag;
      const detalle = [
        tag,
        p.vars.map(v => v.nombre + (v.opcional ? ' (opc.)' : '')).join(' + '),
        (p.punto.grupos || []).length > 1 && S.agrupar === 'grupo'
          ? 'también en ' + [...p.punto.grupos].sort(compararGrupos).slice(1).join(', ') : null
      ].filter(Boolean).join(' · ');

      // El valor que se muestra es el de la lectura principal: es la que manda.
      const ppal = p.vars.find(v => v.principal) || p.vars[0];
      const lp = S.lecturas.find(l => l.variable_id === ppal.id);
      const clase = p.enCola ? 'cola' : p.faltan.length ? 'pendiente' : 'lista';

      cont.append(el('button', { class: 'item ' + clase, onclick: () => abrirCaptura(p.punto) }, [
        el('span', { class: 'txt' }, [
          el('span', { class: 'n' }, [
            el('span', { class: 'n-nom', text: p.punto.nombre }),
            p.tieneFoto ? el('span', {
              class: 'badge-foto',
              title: `${p.nFotos} foto(s) registrada(s)`,
              html: `<svg class="mini-camara" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>${p.nFotos > 1 ? `<span class="n-fotos">${p.nFotos}</span>` : ''}`
            }) : null
          ]),
          el('span', { class: 'd', text: detalle })
        ]),
        el('span', { class: 'val', html: p.enCola
          ? '<span class="pill acento">por enviar</span>'
          : p.faltan.length
            ? (p.sinDato.length ? '<span class="pill warn">no se pudo leer</span>'
                                : '<span class="pill neutro">pendiente</span>')
            : (lp && lp.sin_dato
                ? `<span class="pill warn">no se pudo leer</span><small>${esc(quien(lp))}</small>`
                : lp ? `${num(lp.valor)}<small>${esc(quien(lp))}</small>`
                     : '<span class="pill ok">cargado</span>') })
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


/* ---------------- borrar cosas de configuración ----------------
   El servidor solo borra lo que está vacío: si tiene historia, se niega y
   explica qué lo retiene. Acá solo se pide confirmación y se muestra la razón. */
async function eliminarCosa({ rpc, id, nombre, que, alTerminar, desactivar }) {
  if (!confirm(`Eliminar ${que} "${nombre}"?\n\nSi tiene datos cargados, la app te lo va a decir y no se borra nada.`)) return;
  const { data, error } = await sb.rpc(rpc, id);
  if (error) {
    const puedeApagar = /tiene .* (lectura|movimiento|punto|asignad|instalado)/i.test(error.message) && desactivar;
    if (puedeApagar && confirm(error.message + '\n\n¿Lo desactivo en su lugar?')) {
      const e2 = await desactivar();
      if (e2) return toast(e2.message || e2, true);
      toast('Desactivado'); return alTerminar && alTerminar();
    }
    return toast(error.message, true);
  }
  cerrarModal();
  toast(data || 'Eliminado');
  await DB.descargarCatalogo().catch(() => {});
  S.catalogo = await DB.catalogo();
  alTerminar ? alTerminar() : render();
}

/* ---------------- captura de un punto ----------------
   En terreno el gesto es uno solo: me paro frente al display, anoto TODO lo que
   muestra (importada, exportada, horas), saco UNA foto y dejo los avisos que
   correspondan. Antes había una pantalla por variable, y eso obligaba a una
   foto por número y a perder lo escrito al abrir un aviso. */
async function abrirCaptura(entrada) {
  // Acepta un punto o una variable (el escáner de QR entrega una variable).
  const punto = entrada.punto || entrada;
  const vars = S.catalogo.variables
    .filter(x => x.punto.id === punto.id)
    .sort(ordenVariables);
  if (!vars.length) return toast('Este punto no tiene lecturas configuradas', true);
  const equipo = punto.equipo || {};

  let bandas = {};
  try { bandas = await DB.bandasCache(); } catch { /* sin bandas */ }

  /* ---- fotos: hasta 3 por lectura, en el orden en que se sacan ----
     La pantalla de un partidor suave, un variador o un generador rara vez cabe
     en una sola imagen (las horas en un menú, la energía en otro). El orden en
     que se sacan es el orden en que se guardan y se descargan: Foto 1, 2 y 3. */
  const MAX_FOTOS = C.FOTOS_MAX || 3;
  const nuevasFotos = [];   // { blob, url }, en orden de captura
  let procesandoFotos = false;
  const cajaFoto = el('div', { class: 'foto-caja' });
  const galeriaFotos = el('div', { class: 'fotos-nuevas' });
  const textoFoto =
    (punto.foto_obligatoria ? 'Foto obligatoria' : 'Foto opcional') + ` · hasta ${C.FOTOS_MAX || 3}` +
    (punto.foto_calidad === 'alta' ? ' · calidad alta' : '');
  const pesoFoto = el('p', { class: 'ayuda', text: textoFoto });
  // Las ya guardadas en la lectura que recibirá las nuevas también cuentan para el tope.
  const yaGuardadas = () => {
    const destino = campos.find(c => c.yaHay);
    return destino ? (destino.yaHay.fotos?.length || 0) : 0;
  };
  const cupoFotos = () => Math.max(0, MAX_FOTOS - yaGuardadas() - nuevasFotos.length);
  const inputCamara = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const inputGaleria = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const btnCamara = el('button', { class: 'btn primario', html: conIcono(ICONO.camara, 'Tomar foto'),
    onclick: () => inputCamara.click() });
  const btnGaleria = el('button', { class: 'btn', html: conIcono(ICONO.galeria, 'Galería'),
    title: 'Elegir fotos guardadas en el teléfono', onclick: () => inputGaleria.click() });

  function pintarFotos() {
    const base = yaGuardadas();
    poner(galeriaFotos, nuevasFotos.map((f, i) => el('figure', { class: 'foto-nueva' }, [
      el('img', { src: f.url, alt: `Foto ${base + i + 1} del medidor` }),
      el('figcaption', { text: `Foto ${base + i + 1} · ${Math.round(f.blob.size / 1024)} KB` }),
      el('div', { class: 'foto-acciones' }, [
        i > 0 ? el('button', { class: 'btn chico', text: '◀', title: 'Pasar antes', onclick: () => moverFoto(i, -1) }) : null,
        i < nuevasFotos.length - 1 ? el('button', { class: 'btn chico', text: '▶', title: 'Pasar después', onclick: () => moverFoto(i, 1) }) : null,
        el('button', { class: 'btn chico peligro', text: 'Quitar', onclick: () => quitarFoto(i) })
      ])
    ])));
    const caben = cupoFotos();
    btnCamara.innerHTML = conIcono(ICONO.camara, nuevasFotos.length ? 'Tomar otra' : 'Tomar foto');
    btnCamara.disabled = btnGaleria.disabled = caben === 0;
    pesoFoto.textContent = nuevasFotos.length
      ? `${base + nuevasFotos.length} de ${MAX_FOTOS} fotos · ${caben ? `caben ${caben} más` : 'máximo alcanzado'}`
      : textoFoto + (base ? ` · ya tiene ${base} guardada${base === 1 ? '' : 's'}` : '');
  }
  function quitarFoto(i) {
    URL.revokeObjectURL(nuevasFotos[i].url);
    nuevasFotos.splice(i, 1);
    pintarFotos();
  }
  function moverFoto(i, d) {
    [nuevasFotos[i], nuevasFotos[i + d]] = [nuevasFotos[i + d], nuevasFotos[i]];
    pintarFotos();
  }
  async function agregarFotos(archivos) {
    if (procesandoFotos || !archivos.length) return;
    procesandoFotos = true;
    try {
      const caben = cupoFotos();
      if (archivos.length > caben) toast(`Solo caben ${MAX_FOTOS} fotos por lectura`, true);
      pesoFoto.textContent = 'Preparando la foto…';
      for (const a of archivos.slice(0, caben)) {
        const blob = await DB.comprimirFoto(a, punto.foto_calidad || 'normal');
        nuevasFotos.push({ blob, url: URL.createObjectURL(blob) });
      }
    } finally {
      procesandoFotos = false;
      pintarFotos();
    }
    // Primera foto lista: el paso siguiente es escribir la lectura.
    const primero = campos[0] && (campos[0].doble ? campos[0].mwh : campos[0].valor);
    if (primero && primero.value === '' && !primero.disabled) {
      primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => primero.focus({ preventScroll: true }), 350);
    }
  }
  // Se copia la lista ANTES de vaciar el input: así se puede volver a elegir el mismo archivo.
  for (const input of [inputCamara, inputGaleria]) {
    input.addEventListener('change', e => { const l = [...e.target.files]; e.target.value = ''; agregarFotos(l); });
  }
  // Cámara (lo normal en terreno) ancha; galería al lado, más chica. El texto de ayuda, abajo y en una línea.
  cajaFoto.append(
    el('div', { class: 'foto-botones' }, [btnCamara, btnGaleria]),
    inputCamara, inputGaleria, galeriaFotos, pesoFoto);

  /* ---- un bloque de campos por cada lectura del punto ---- */
  const campos = [];        // { v, doble, valor, mwh, kwh, banda, yaHay, valorActual() }
  const zonaLecturas = el('div');

  for (const v of vars) {
    const doble = v.formato_lectura === 'doble_mwh_kwh';
    const anterior = S.ultimas.find(u => u.variable_id === v.id);
    const yaHay = S.lecturas.find(l => l.variable_id === v.id);
    const u = UNIDAD[v.unidad_reporte] || v.unidad_reporte;
    const ud = UNIDAD[v.unidad_display] || v.unidad_display;
    const avisoBanda = el('div', { class: 'banda ok', hidden: true });

    const c = { v, doble, banda: avisoBanda, yaHay };
    const evaluar = () => evaluarCampo(c);
    const paso = v.decimales_display > 0 ? '0.' + '0'.repeat(v.decimales_display - 1) + '1' : '1';

    // Sin "0" de ejemplo: se confundía con un cero escrito y el campo quedaba vacío.
    // Si la lectura es cero, hay que escribir el 0.
    c.valor = doble ? null : el('input', { type: 'number', inputmode: 'decimal',
      class: 'dato-grande', step: paso, placeholder: 'Escribir lectura', oninput: evaluar });
    c.mwh = doble ? el('input', { type: 'number', inputmode: 'numeric', class: 'dato-grande',
      placeholder: 'Escribir', oninput: evaluar }) : null;
    c.kwh = doble ? el('input', { type: 'number', inputmode: 'numeric', class: 'dato-grande',
      placeholder: 'Escribir', oninput: evaluar }) : null;

    c.sinDato = el('input', { type: 'checkbox', onchange: e => {
      const off = e.target.checked;
      [c.valor, c.mwh, c.kwh].forEach(x => { if (x) { x.disabled = off; x.value = ''; } });
      evaluar();
    } });

    c.valorActual = () => {
      if (c.sinDato.checked) return null;
      if (doble) {
        if (c.mwh.value === '' && c.kwh.value === '') return null;
        return (Number(c.mwh.value || 0) * 1000) + Number(c.kwh.value || 0);
      }
      if (c.valor.value === '') return null;
      const bruto = Number(c.valor.value);
      return v.unidad_display === 'MWh' && v.unidad_reporte === 'kWh' ? bruto * 1000 : bruto;
    };
    c.anterior = anterior;

    if (yaHay) {
      if (!doble && yaHay.valor_display != null) c.valor.value = yaHay.valor_display;
      if (doble) { c.mwh.value = yaHay.valor_mwh ?? ''; c.kwh.value = yaHay.valor_kwh ?? ''; }
      if (yaHay.sin_dato) { c.sinDato.checked = true; c.sinDato.dispatchEvent(new Event('change')); }
    }

    const etiqueta = vars.length === 1 ? `Lectura del display · ${ud}` : `${v.nombre} · ${ud}`;
    const rol = vars.length === 1 ? null
      : ((v.en_informe ?? v.principal) ? 'va al informe' : 'solo se registra') + (v.opcional ? ' · opcional' : '');

    // Compacto: nombre y lectura anterior en una línea, la unidad dentro del campo.
    const conUnidad = (input, unidad) => el('div', { class: 'campo-num' },
      [input, el('span', { class: 'unidad', text: unidad })]);
    zonaLecturas.append(el('div', { class: 'lectura-bloque' }, [
      el('div', { class: 'lectura-cab' }, [
        el('div', { class: 'lectura-nombre' }, [
          el('b', { text: vars.length === 1 ? 'Lectura del display' : v.nombre }),
          rol ? el('small', { text: rol }) : null
        ]),
        el('div', { class: 'lectura-anterior', html: anterior
          ? `<small>Anterior · ${fechaCorta(anterior.fecha_lectura)}</small><b>${num(anterior.valor)} ${esc(u)}</b>`
          : '<small>Sin lectura anterior</small>' })
      ]),
      yaHay ? el('p', { class: 'ayuda', text:
        `Ya cargada este mes: ${yaHay.sin_dato ? 'sin dato' : num(yaHay.valor) + ' ' + u} · ${quien(yaHay)}.` +
        (yaHay.tomada_por === S.usuario.id ? ' Si cambias el número, se corrige.'
                                           : ' La tomó otra persona; cambiarla pide motivo.') }) : null,
      doble
        ? el('div', { class: 'doble' }, [conUnidad(c.mwh, 'MWh' + signoEnergia(v)), conUnidad(c.kwh, 'kWh' + signoEnergia(v))])
        : conUnidad(c.valor, ud + signoEnergia(v)),
      avisoBanda,
      el('label', { class: 'fila sin-dato' },
        [c.sinDato, el('span', { text: 'No se pudo leer · dejar sin dato' })])
    ]));
    campos.push(c);
  }

  function evaluarCampo(c) {
    const b = c.banda;
    if (c.sinDato.checked) { b.hidden = true; return; }
    const val = c.valorActual();
    if (val === null || Number.isNaN(val)) { b.hidden = true; return; }
    // La potencia del momento (kW) no es un totalizador: no se compara con la anterior.
    if (/^potencia/i.test(c.v.nombre || '')) { b.hidden = true; return; }
    const alertas = [];
    if (c.anterior && val < Number(c.anterior.valor)) {
      alertas.push(['bad', `Esta lectura (${num(val)}) es MENOR que la anterior (${num(c.anterior.valor)}). ` +
        'Puede ser un reinicio del totalizador o un dígito de menos.']);
    }
    const bd = bandas[c.v.id];
    if (bd && c.anterior && val >= Number(c.anterior.valor)) {
      const cons = val - Number(c.anterior.valor);
      const j = juzgarConsumo({ consumo: cons, media: bd.media, sigma: bd.sigma }, bd);
      if (j) alertas.push([j.nivel, j.texto]);
    }
    if (!alertas.length) { b.hidden = true; return; }
    b.hidden = false;
    b.className = 'banda ' + (alertas.some(a => a[0] === 'bad') ? 'bad' : 'warn');
    b.textContent = alertas.map(a => a[1]).join(' ');
  }

  /* ---- avisos: se acumulan acá mismo, sin salir de la pantalla ---- */
  const avisos = [];
  const listaAvisos = el('div', { class: 'avisos-captura' });
  const pintarAvisos = () => {
    poner(listaAvisos, ...(avisos.length
      ? avisos.map((a, i) => el('div', { class: 'aviso-chip' }, [
          el('span', { class: 'txt' }, [
            el('b', { text: a.categoriaTexto }),
            a.descripcion ? el('small', { text: ' · ' + a.descripcion }) : null
          ].filter(Boolean)),
          el('button', { class: 'btn chico', text: 'Quitar',
            onclick: () => { avisos.splice(i, 1); pintarAvisos(); if (typeof pintarResumenExtras === 'function') pintarResumenExtras(); } })
        ]))
      : [el('p', { class: 'ayuda', text: 'Sin avisos. Puedes agregar los que necesites.' })]));
  };
  pintarAvisos();

  // "Otra" va primero y elegida: lo normal es describir lo que se vio con palabras.
  const selAviso = el('select');
  selAviso.append(el('option', { value: 'otra', text: 'Otra · la describo abajo', selected: '' }));
  for (const a of S.catalogo.catalogoAvisos) {
    if (/^Otro/i.test(a.categoria)) continue;
    selAviso.append(el('option', { value: a.id, text: a.categoria }));
  }
  selAviso.value = 'otra';
  const txtAviso = el('textarea', { placeholder: 'Qué viste. Esto queda como descripción del aviso.' });
  const avisoAMedias = () => !!txtAviso.value.trim() || selAviso.value !== 'otra';
  const agregarAviso = () => {
    const texto = txtAviso.value.trim();
    if (selAviso.value === 'otra' && !texto) return toast('Escribe qué pasó: elegiste "Otra"', true);
    const otra = S.catalogo.catalogoAvisos.find(a => /^Otro/i.test(a.categoria));
    avisos.push({
      categoria_id: selAviso.value === 'otra' ? (otra ? otra.id : null) : Number(selAviso.value),
      categoriaTexto: selAviso.selectedOptions[0].text,
      descripcion: texto || null
    });
    selAviso.value = 'otra'; txtAviso.value = '';
    pintarAvisos();
    toast('Aviso agregado · se envía junto con la lectura');
  };

  // La "observación de la visita" se eliminó: era lo mismo que un aviso de categoría
  // "Otra". Las observaciones antiguas se siguen viendo (abajo y en Avisos).
  const yaConObs = campos.find(c => c.yaHay && c.yaHay.observacion);

  /* ---- fotos ya guardadas de este punto ---- */
  const zonaExistente = el('div');
  const guardadas = campos.filter(c => c.yaHay).map(c => c.yaHay);
  const conFoto = guardadas.filter(l => l.fotos && l.fotos.length);
  if (conFoto.length) {
    const fotos = el('div', { class: 'fila', style: 'flex-wrap:wrap' });
    zonaExistente.append(el('p', { class: 'ayuda', text: 'Fotos ya guardadas de este punto:' }), fotos);
    if (navigator.onLine) {
      (async () => {
        for (const l of conFoto) for (const f of fotosOrdenadas(l)) {
          const { data } = await sb.storage.from(C.BUCKET).createSignedUrl(f.storage_path, 600);
          if (data?.signedUrl) fotos.append(el('a', { href: data.signedUrl, target: '_blank', rel: 'noopener' },
            [el('img', { class: 'miniatura', src: data.signedUrl, alt: 'Foto guardada de esta lectura' })]));
        }
      })();
    } else {
      fotos.append(el('span', { class: 'ayuda', text: `${conFoto.reduce((n, l) => n + l.fotos.length, 0)} foto(s).` }));
    }
  }

  /* ---- verificación del medidor por QR ---- */
  const zonaMedidor = el('div', { class: 'zona-medidor' });
  poner(zonaMedidor, el('button', { class: 'btn btn-qr', html: conIcono(ICONO.qr, 'Verificar medidor con QR'),
    onclick: () => verificarMedidor(vars[0], zonaMedidor) }));

  /* ---- orden en terreno: 1 foto · 2 lecturas · 3 (si hace falta) avisos ----
     Avisos y observación van plegados: casi nunca se usan y ocupaban media pantalla. */
  const resumenExtras = el('span', { class: 'contador' });
  const pintarResumenExtras = () => {
    resumenExtras.textContent = avisos.length ? String(avisos.length) : '';
    resumenExtras.hidden = !avisos.length;
  };
  const extras = el('details', { class: 'plegable' }, [
    el('summary', {}, [el('span', { text: 'Avisos de este punto' }), resumenExtras]),
    listaAvisos,
    el('label', { text: 'Categoría' }, [selAviso]),
    el('label', { text: 'Descripción' }, [txtAviso]),
    el('button', { class: 'btn', text: '＋ Agregar este aviso',
      onclick: () => { agregarAviso(); pintarResumenExtras(); } }),
    el('p', { class: 'ayuda', text:
      'Puedes agregar varios. Si escribiste uno y no lo agregaste, se agrega solo al guardar.' }),
    yaConObs ? el('p', { class: 'ayuda', html:
      '<b>Nota anterior de esta lectura:</b> ' + esc(yaConObs.yaHay.observacion) }) : null
  ]);

  const cuerpo = el('div', { class: 'captura' }, [
    punto.instruccion_lectura
      ? el('p', { class: 'banda acento', text: punto.instruccion_lectura })
      : null,
    el('h3', { class: 'paso', text: '1 · Foto' }),
    cajaFoto,
    zonaExistente,
    el('h3', { class: 'paso', text: vars.length > 1 ? `2 · Lecturas (${vars.length})` : '2 · Lectura' }),
    zonaLecturas,
    zonaMedidor,
    extras,
    el('div', { class: 'acciones-fijas dos' }, [
      el('button', { class: 'btn cancelar', text: 'Cancelar', onclick: () => salir(true) }),
      el('button', { class: 'btn guardar', text: 'Guardar todo', onclick: guardar })
    ])
  ]);

  async function guardar() {
    // Un aviso escrito y no agregado se pierde en silencio: mejor agregarlo.
    if (avisoAMedias()) {
      const antes = avisos.length;
      agregarAviso();
      if (avisos.length === antes) return;   // faltaba la descripción: ya se avisó
    }

    const conValor = campos.filter(c => c.valorActual() !== null || c.sinDato.checked);
    const obligatoriasVacias = campos.filter(c => !c.v.opcional && !c.sinDato.checked
                                                  && c.valorActual() === null && !c.yaHay);
    if (!conValor.length && !avisos.length) {
      return toast('Escribe alguna lectura, marca "no se pudo leer" o agrega un aviso', true);
    }
    if (obligatoriasVacias.length && !avisos.length) {
      return toast(`Falta ${obligatoriasVacias.map(c => c.v.nombre).join(' y ')}`, true);
    }
    const algunDato = conValor.some(c => !c.sinDato.checked);
    if (punto.foto_obligatoria && !nuevasFotos.length && !conFoto.length && algunDato) {
      return toast('Este punto exige foto', true);
    }

    // Las que ya existen y cambiaron se corrigen aparte: corregir_lectura pide
    // motivo y no se puede hacer sin señal.
    const nuevas = [], correcciones = [];
    for (const c of conValor) {
      const val = c.valorActual();
      const fila = {
        variable_id: c.v.id,
        valor_display: c.doble ? null : (c.valor.value === '' ? null : Number(c.valor.value)),
        valor_mwh: c.doble ? Number(c.mwh.value || 0) : null,
        valor_kwh: c.doble ? Number(c.kwh.value || 0) : null,
        sin_dato: c.sinDato.checked
      };
      if (c.yaHay) {
        const cambio = !c.sinDato.checked && val !== null && Number(c.yaHay.valor) !== Number(val);
        if (cambio) correcciones.push({ c, fila, val });
      } else {
        nuevas.push(fila);
      }
    }

    if (correcciones.length) {
      if (!navigator.onLine) return toast('Corregir una lectura ya guardada necesita señal.', true);
      for (const { c, fila } of correcciones) {
        const mia = c.yaHay.tomada_por === S.usuario.id;
        let motivo = 'corrección del propio autor';
        if (!mia) {
          motivo = (prompt(`¿Por qué cambia la lectura de "${c.v.nombre}"? (queda en la auditoría)`) || '').trim();
          if (!motivo) return toast('Sin motivo no se corrige', true);
        }
        const { error } = await sb.rpc('corregir_lectura', {
          p_id: c.yaHay.id, p_valor_display: fila.valor_display, p_motivo: motivo,
          p_valor_mwh: fila.valor_mwh, p_valor_kwh: fila.valor_kwh
        });
        if (error) return toast(error.message, true);
      }
    }

    // Las fotos de una lectura que ya existe se suben solas, una tras otra y en
    // orden; las de una nueva viajan con la captura y se cuelgan cuando el servidor
    // devuelve el id.
    const yaGuardada = campos.find(c => c.yaHay);
    if (nuevasFotos.length && !nuevas.length && yaGuardada) {
      const datos = { lectura_id: yaGuardada.yaHay.id, periodo: S.periodo, variable_id: yaGuardada.v.id };
      // Cada foto que sube sale de la lista: si la segunda falla, al reintentar no se repite la primera.
      while (nuevasFotos.length) {
        const f = nuevasFotos[0];
        if (navigator.onLine) {
          try { await DB.subirFotoALectura({ ...datos, blob: f.blob }); }
          catch (e) { pintarFotos(); return toast('No se pudo subir la foto: ' + e.message, true); }
        } else {
          await DB.encolar({ tipo: 'foto', ...datos }, f.blob);
        }
        quitarFoto(0);
      }
    }

    if (nuevas.length || avisos.length) {
      await DB.encolar({
        tipo: 'captura',
        punto_id: punto.id,
        periodo: S.periodo,
        fecha_lectura: new Date().toISOString(),
        lecturas: nuevas,
        avisos: avisos.map(a => ({ categoria_id: a.categoria_id, descripcion: a.descripcion })),
        observacion: null,
        dispositivo: navigator.userAgent.slice(0, 120)
      }, nuevasFotos.map(f => f.blob));
    }

    cerrarModal();
    const partes = [];
    if (nuevas.length) partes.push(nuevas.length === 1 ? '1 lectura' : `${nuevas.length} lecturas`);
    if (correcciones.length) partes.push(`${correcciones.length} corregida(s)`);
    if (avisos.length) partes.push(avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`);
    toast(partes.length ? partes.join(' · ') + ' guardado en el dispositivo' : 'Foto agregada');

    await refrescarDatos();
    await actualizarConexion();
    await pintarLista();
    if (navigator.onLine) sincronizar(true);
  }

  pintarFotos();
  pintarResumenExtras();

  // Lo que había al abrir: si nada cambió, salir no pregunta nada.
  const huella = () => campos.map(c =>
    [c.valor?.value, c.mwh?.value, c.kwh?.value, c.sinDato.checked].join('|')).join('§');
  const huellaInicial = huella();
  const sucio = () => nuevasFotos.length > 0 || avisos.length > 0 || avisoAMedias() ||
    huella() !== huellaInicial;
  // El botón Cancelar siempre pregunta; la ✕ solo si hay algo escrito.
  function salir(desdeCancelar = false) {
    const hayAlgo = sucio();
    if ((hayAlgo || desdeCancelar) && !confirm(hayAlgo
        ? '¿Cancelar sin guardar?\nSe pierde lo que escribiste en este punto, incluidas las fotos.'
        : '¿Cancelar y volver a la lista?')) return;
    nuevasFotos.forEach(f => URL.revokeObjectURL(f.url));
    cerrarModal();
  }

  modal(punto.nombre, cuerpo, {
    completo: true,
    subtitulo: [equipo.tag, gruposDe(punto)[0]].filter(Boolean).join(' · ') +
      (vars.length > 1 ? ` · ${vars.length} lecturas en el mismo display` : ''),
    alPedirCerrar: salir
  });
  // Sin foco automático: el teclado tapaba el botón de la foto, que es el primer paso.
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

function kpi(v, k, clase = '') {
  return el('div', { class: 'kpi ' + clase }, [
    el('div', { class: 'v', text: String(v) }), el('div', { class: 'k', text: k })
  ]);
}
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
      el('h4', { style: 'margin-top:0', text: 'Catálogo del dispositivo' }),
      el('p', { class: 'ayuda', text:
        `Puntos, grupos y equipos se bajaron ${S.catalogo?.bajadoEn
          ? 'el ' + fechaHora(new Date(S.catalogo.bajadoEn).toISOString())
          : 'en algún momento'}. Se refrescan solos cada 6 horas: si alguien cambió un grupo o ` +
        'agregó un punto hace un rato, puede que este dispositivo todavía no lo vea.' }),
      el('button', { class: 'btn', text: 'Actualizar el catálogo ahora', onclick: async e => {
        e.target.disabled = true;
        try {
          S.catalogo = await DB.descargarCatalogo();
          await DB.descargarBandas();
          toast('Catálogo actualizado');
        } catch (err) { toast('No se pudo: ' + (err.message || err), true); }
        e.target.disabled = false;
        render();
      } })
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
                  que = v ? `${v.punto.nombre} · ${v.nombre}` : 'variable ' + x.variable_id;
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
    tabla(['Punto', 'Variable', 'Lecturas', ''],
      data.map(d => [
        d.punto, d.variable,
        el('span', { class: 'pill warn', text: d.n_lecturas + ' lecturas' }),
        el('button', { class: 'btn chico', text: 'Resolver', onclick: () => resolverDuplicado(d) })
      ]), { num: [2] })
  ]);
}

async function resolverDuplicado(d) {
  const { data: lects } = await sb.from('lecturas')
    .select('id, valor, fecha_lectura, observacion, estado, tomada_por, sin_dato, fotos(id, storage_path, orden)')
    .in('id', d.lecturas).order('fecha_lectura');
  const v = S.catalogo.variables.find(x => x.id === d.variable_id);
  const u = v ? (UNIDAD[v.unidad_reporte] || v.unidad_reporte) : '';

  const motivo = el('input', { placeholder: 'Por qué te quedas con una y descartas la otra' });
  const tarjetas = [];
  for (const l of (lects || [])) {
    const foto = el('div');
    if (l.fotos?.length) {
      for (const ft of fotosOrdenadas(l)) {
        const { data: url } = await sb.storage.from(C.BUCKET).createSignedUrl(ft.storage_path, 600);
        if (url?.signedUrl) foto.append(el('img', { src: url.signedUrl, alt: 'Foto del medidor' }));
      }
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
/* ===================================================================
   ANÁLISIS DE UN PUNTO (Consumos e informes, cuando el filtro de puntos tiene uno solo)
   Un gráfico por lectura del punto, con métricas y capas para mirar el comportamiento
   desde varios ángulos: consumo, promedio diario, acumulado, totalizador o variación.
   Siempre UN eje: cambiar de métrica cambia el gráfico, no se superponen escalas.
   =================================================================== */
// Cómo se llama la fila "Consumo del mes" según el grupo: en la Red MT es una
// transferencia de energía y en los generadores, lo que generaron.
const normGrupo = g => String(g || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
function filaConsumoTxt(grupo) {
  const g = normGrupo(grupo);
  if (g.startsWith('red mt')) return 'Transferencia del mes';
  if (g === 'generadores') return 'Generado en el mes';
  return 'Consumo del mes';
}

const METRICAS_PUNTO = {
  consumo:   { t: g => filaConsumoTxt(g), u: u => u },
  diario:    { t: () => 'Promedio diario', u: u => u + '/día' },
  acumulado: { t: () => 'Acumulado en el periodo', u: u => u },
  totaliz:   { t: () => 'Totalizador al cierre', u: u => u },
  variacion: { t: () => 'Variación vs mes anterior', u: () => '%' }
};
const CAPAS_PUNTO = { promedio: 'Promedio', banda: 'Banda ±1σ', tendencia: 'Tendencia', movil: 'Media móvil 3 meses' };

// Serie de una lectura según la métrica elegida. Devuelve [{mes, v}] con v = null si falta.
function seriePunto(filasVar, meses, metrica, totalizadores) {
  const porMes = new Map(filasVar.map(f => [f.mes, f]));
  let acum = 0;
  return meses.map((m, i) => {
    const f = porMes.get(m), c = f ? Number(f.consumo) : null;
    let v = null;
    if (metrica === 'consumo') v = c;
    else if (metrica === 'diario') v = c !== null && f.dias_asignados ? c / Number(f.dias_asignados) : null;
    else if (metrica === 'acumulado') { if (c !== null) acum += c; v = c !== null ? acum : null; }
    else if (metrica === 'totaliz') { const t = totalizadores?.get(filasVar[0]?.variable_id + '|' + mesSiguiente(m)); v = t ?? null; }
    else if (metrica === 'variacion') {
      const a = i > 0 ? porMes.get(meses[i - 1]) : null;
      v = a && f && Number(a.consumo) ? 100 * (c - Number(a.consumo)) / Number(a.consumo) : null;
    }
    return { mes: m, v };
  });
}

// Estadística descriptiva de una serie (solo los meses con dato).
function estadisticas(serie) {
  const xs = serie.map((p, i) => ({ i, v: p.v, mes: p.mes })).filter(p => p.v !== null && isFinite(p.v));
  if (!xs.length) return null;
  const vs = xs.map(p => p.v), n = vs.length;
  const suma = vs.reduce((a, b) => a + b, 0), media = suma / n;
  const orden = [...vs].sort((a, b) => a - b);
  const mediana = n % 2 ? orden[(n - 1) / 2] : (orden[n / 2 - 1] + orden[n / 2]) / 2;
  const sigma = n > 1 ? Math.sqrt(vs.reduce((a, b) => a + (b - media) ** 2, 0) / (n - 1)) : 0;
  const max = xs.reduce((a, b) => b.v > a.v ? b : a), min = xs.reduce((a, b) => b.v < a.v ? b : a);
  // Regresión lineal sobre el índice del mes: pendiente por mes.
  let pend = 0, orig = media;
  if (n > 1) {
    const mx = xs.reduce((a, p) => a + p.i, 0) / n;
    const sxx = xs.reduce((a, p) => a + (p.i - mx) ** 2, 0);
    pend = sxx ? xs.reduce((a, p) => a + (p.i - mx) * (p.v - media), 0) / sxx : 0;
    orig = media - pend * mx;
  }
  const ultimo = xs[xs.length - 1];
  return { n, suma, media, mediana, sigma, cv: media ? 100 * sigma / Math.abs(media) : 0, max, min, pend, orig, ultimo };
}

// Gráfico SVG interactivo de una serie. opciones: tipo 'barras'|'linea', capas {promedio, banda, tendencia, movil}.
function graficoSerie(serie, { titulo, unidad, tipo = 'barras', capas = {}, est, etiquetaMes, imprimir = false }) {
  // En pantallas angostas se dibuja con menos ancho lógico: así letras y barras no quedan diminutas.
  const angosto = !imprimir && window.innerWidth < 700;
  const W = angosto ? 520 : 1000, H = imprimir ? 280 : angosto ? 340 : 320, mI = angosto ? 58 : 78, mD = angosto ? 76 : 120, mA = 24, mB = 34;
  const aU = W - mI - mD, hU = H - mA - mB;
  const ns = (t, at, txt) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', t);
    for (const [k, v] of Object.entries(at)) if (v !== null && v !== undefined) n.setAttribute(k, v);
    if (txt !== undefined) n.textContent = txt;
    return n;
  };
  const vals = serie.map(p => p.v).filter(v => v !== null && isFinite(v));
  const svg = ns('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'grafico graf-punto' });
  if (!vals.length) return el('p', { class: 'vacio', text: 'No hay datos para graficar con esta métrica.' });

  // Dominio: incluye la banda si está activa, y el cero salvo en el totalizador.
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (est && capas.banda) { lo = Math.min(lo, est.media - est.sigma); hi = Math.max(hi, est.media + est.sigma); }
  if (tipo === 'barras' || lo > 0 && lo < hi * 0.6) lo = Math.min(lo, 0);
  if (hi === lo) hi = lo + 1;
  const paso10 = Math.pow(10, Math.floor(Math.log10(hi - lo || 1)));
  const tickP = [1, 2, 2.5, 5, 10].map(k => k * paso10).find(s => (hi - lo) / s <= 5) || paso10 * 10;
  lo = Math.floor(lo / tickP) * tickP; hi = Math.ceil(hi / tickP) * tickP;
  const y = v => mA + hU - (v - lo) / (hi - lo) * hU;
  const paso = aU / serie.length;
  const cx = i => mI + i * paso + paso / 2;
  const fmt = v => unidad === '%' ? (v > 0 ? '+' : '') + num(v, 1) + '%' : numCorto(v);

  for (let t = lo; t <= hi + 1e-9; t += tickP) {
    svg.append(ns('line', { x1: mI, x2: W - mD, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(ns('text', { x: mI - 10, y: y(t) + 4, class: 'ejeY' }, fmt(t)));
  }
  if (lo < 0 && hi > 0) svg.append(ns('line', { x1: mI, x2: W - mD, y1: y(0), y2: y(0), class: 'base' }));

  // Banda ±1σ detrás de todo.
  if (est && capas.banda && est.sigma)
    svg.append(ns('rect', { x: mI, width: aU, y: y(est.media + est.sigma), height: Math.max(0, y(est.media - est.sigma) - y(est.media + est.sigma)), class: 'banda-sigma' }));

  // Marcas de datos.
  const anchoB = Math.min(paso - 8, 48);
  if (tipo === 'barras') {
    serie.forEach((p, i) => {
      if (p.v === null) return;
      const y0 = y(Math.max(0, lo)), y1 = y(p.v);
      svg.append(ns('rect', { x: cx(i) - anchoB / 2, y: Math.min(y0, y1), width: anchoB,
        height: Math.max(Math.abs(y0 - y1), p.v ? 2 : 0), rx: 3, class: 'marca' + (p.v < 0 ? ' neg' : '') }));
    });
  } else {
    let d = '', abierto = false;
    serie.forEach((p, i) => {
      if (p.v === null) { abierto = false; return; }
      d += (abierto ? 'L' : 'M') + cx(i) + ',' + y(p.v) + ' '; abierto = true;
    });
    svg.append(ns('path', { d: d.trim(), class: 'linea-serie' }));
    serie.forEach((p, i) => { if (p.v !== null) svg.append(ns('circle', { cx: cx(i), cy: y(p.v), r: 4.5, class: 'punto-serie' })); });
  }

  // Capas de análisis, con etiqueta directa a la derecha (sin leyenda aparte).
  const etiquetaDer = (yy, txt, cl) => svg.append(ns('text', { x: W - mD + 8, y: yy + 4, class: 'etq-capa ' + cl }, txt));
  if (est && capas.promedio) {
    svg.append(ns('line', { x1: mI, x2: W - mD, y1: y(est.media), y2: y(est.media), class: 'capa-prom' }));
    etiquetaDer(y(est.media), 'Prom. ' + fmt(est.media), 'prom');
  }
  if (est && capas.tendencia && est.n > 1) {
    const i0 = serie.findIndex(p => p.v !== null), i1 = serie.length - 1 - [...serie].reverse().findIndex(p => p.v !== null);
    const yy = i => est.orig + est.pend * i;
    svg.append(ns('line', { x1: cx(i0), x2: cx(i1), y1: y(yy(i0)), y2: y(yy(i1)), class: 'capa-tend' }));
    etiquetaDer(y(yy(i1)) + (capas.promedio && Math.abs(y(yy(i1)) - y(est.media)) < 14 ? 14 : 0), 'Tendencia', 'tend');
  }
  if (capas.movil) {
    let d = '', ult = null;
    serie.forEach((p, i) => {
      const ventana = serie.slice(Math.max(0, i - 2), i + 1).map(q => q.v).filter(v => v !== null);
      if (i < 2 || ventana.length < 3) return;
      const m = ventana.reduce((a, b) => a + b, 0) / 3;
      d += (d ? 'L' : 'M') + cx(i) + ',' + y(m); ult = m;
    });
    if (d) { svg.append(ns('path', { d, class: 'capa-movil' })); if (ult !== null && !capas.promedio && !capas.tendencia) etiquetaDer(y(ult), 'Media 3m', 'movil'); }
  }

  // Ejes X y etiqueta directa del máximo.
  serie.forEach((p, i) => svg.append(ns('text', { x: cx(i), y: H - 12, class: 'ejeX' }, etiquetaMes(p.mes))));
  if (est && tipo === 'barras' && unidad !== '%') svg.append(ns('text', { x: cx(serie.findIndex(p => p.mes === est.max.mes)), y: y(est.max.v) - 7, class: 'valorMax' }, numCorto(est.max.v)));

  // Hover: una franja por mes con tooltip (no en impresión).
  const fig = el('figure', { class: 'figura fig-punto' }, [el('figcaption', { text: `${titulo} · ${unidad}` }), svg]);
  if (!imprimir) {
    const tip = el('div', { class: 'tip-graf', hidden: true });
    fig.append(tip);
    const guia = ns('line', { y1: mA, y2: mA + hU, class: 'guia', visibility: 'hidden' });
    svg.append(guia);
    serie.forEach((p, i) => {
      const z = ns('rect', { x: mI + i * paso, y: mA, width: paso, height: hU, class: 'zona' });
      const mostrar = () => {
        guia.setAttribute('x1', cx(i)); guia.setAttribute('x2', cx(i)); guia.setAttribute('visibility', 'visible');
        const prev = i > 0 ? serie[i - 1].v : null;
        tip.replaceChildren(
          el('b', { text: nombrePeriodo(p.mes) }),
          el('div', { text: p.v === null ? 'Sin dato' : `${unidad === '%' ? fmt(p.v) : num(p.v, Math.abs(p.v) < 100 ? 2 : 0) + ' ' + unidad}` }),
          est && p.v !== null && unidad !== '%' && est.media ? el('small', { text: `${p.v >= est.media ? '+' : ''}${num(100 * (p.v - est.media) / est.media, 1)}% vs promedio` }) : null,
          prev && p.v !== null && unidad !== '%' ? el('small', { text: `${p.v >= prev ? '+' : ''}${num(100 * (p.v - prev) / prev, 1)}% vs mes anterior` }) : null);
        tip.hidden = false;
        const r = svg.getBoundingClientRect(), fx = (cx(i) / W) * r.width;
        tip.style.left = Math.min(Math.max(fx + 12, 0), r.width - 180) + 'px';
        tip.style.top = ((p.v === null ? mA + hU / 2 : y(p.v)) / H * r.height) + 'px';
      };
      z.addEventListener('mouseenter', mostrar); z.addEventListener('click', mostrar);
      z.addEventListener('mouseleave', () => { tip.hidden = true; guia.setAttribute('visibility', 'hidden'); });
      svg.append(z);
    });
  }
  return fig;
}

// Panel completo para un punto: selectores, cifras clave y gráfico.
// cfg = S.rep.graf (se recuerda entre repintados y lo usa la vista para imprimir).
function panelAnalisisPunto(data, meses, { totalizadores, cfg, alCambiar, imprimir = false }) {
  const porVar = new Map();
  for (const f of data) (porVar.get(f.variable_id) || porVar.set(f.variable_id, []).get(f.variable_id)).push(f);
  const vars = [...porVar.values()].map(fs => fs[0]).sort(ordenFilaInforme);
  if (!vars.length) return null;
  if (!porVar.has(cfg.variable)) cfg.variable = vars[0].variable_id;
  const fs = porVar.get(cfg.variable), f0 = fs[0];
  const u = UNIDAD[f0.unidad_reporte] || f0.unidad_reporte;
  const met = METRICAS_PUNTO[cfg.metrica] ? cfg.metrica : 'consumo';
  const unidad = METRICAS_PUNTO[met].u(u);
  const serie = seriePunto(fs, meses, met, totalizadores);
  const est = estadisticas(serie);
  const variosAnios = new Set(meses.map(m => m.slice(0, 4))).size > 1;
  const etiquetaMes = m => { const t = nombrePeriodo(m).split(' ')[0].slice(0, 3); return variosAnios ? `${t}-${m.slice(2, 4)}` : t; };
  const titulo = `${f0.punto} · ${METRICAS_PUNTO[met].t(f0.grupo)}`;

  const dec = v => Math.abs(v) < 100 ? 2 : 0;
  const cifra = (v, k, extra = '', cl = '') => el('div', { class: 'cifra ' + cl }, [
    el('div', { class: 'v', text: v }), el('div', { class: 'k', text: k }), extra ? el('div', { class: 's', text: extra }) : null]);
  const fx = v => unidad === '%' ? (v > 0 ? '+' : '') + num(v, 1) + '%' : num(v, dec(v));
  const cifras = est ? el('div', { class: 'cifras-punto' }, [
    met === 'consumo' ? cifra(fx(est.suma), 'Total del periodo', `${est.n} ${est.n === 1 ? 'mes' : 'meses'} con dato`) : null,
    cifra(fx(est.media), 'Promedio mensual', 'Mediana ' + fx(est.mediana)),
    cifra(fx(est.max.v), 'Máximo', nombrePeriodo(est.max.mes)),
    cifra(fx(est.min.v), 'Mínimo', nombrePeriodo(est.min.mes)),
    unidad !== '%' ? cifra(num(est.cv, 0) + '%', 'Variabilidad (CV)', 'Desv. estándar ' + fx(est.sigma),
      est.cv > 30 ? 'alerta' : '') : null,
    est.n > 1 && unidad !== '%' && est.media ? cifra((est.pend >= 0 ? '+' : '') + num(100 * est.pend / est.media, 1) + '%', 'Tendencia por mes',
      est.pend >= 0 ? 'al alza' : 'a la baja') : null,
    unidad !== '%' && est.media ? cifra((est.ultimo.v >= est.media ? '+' : '') + num(100 * (est.ultimo.v - est.media) / est.media, 1) + '%',
      'Último vs promedio', nombrePeriodo(est.ultimo.mes)) : null
  ]) : null;

  const grafico = graficoSerie(serie, { titulo, unidad, tipo: cfg.tipo, capas: cfg.capas, est, etiquetaMes, imprimir });
  if (imprimir) return el('div', { class: 'analisis-punto imp' }, [cifras, grafico]);

  const sel = (opts, v, f) => {
    const s = el('select', { onchange: e => f(e.target.value) });
    for (const [k, t] of opts) s.append(el('option', { value: k, text: t, selected: String(k) === String(v) || null }));
    return s;
  };
  const controles = el('div', { class: 'controles-punto' }, [
    vars.length > 1 ? el('label', { text: 'Lectura' }, [sel(vars.map(v => [v.variable_id, `${v.variable} (${UNIDAD[v.unidad_reporte] || v.unidad_reporte})`]),
      cfg.variable, x => { cfg.variable = Number(x); alCambiar(); })]) : null,
    el('label', { text: 'Métrica' }, [sel(Object.entries(METRICAS_PUNTO).map(([k, m]) => [k, m.t(f0.grupo)]), met,
      x => { cfg.metrica = x; alCambiar(x === 'totaliz'); })]),
    el('label', { text: 'Gráfico' }, [sel([['barras', 'Barras'], ['linea', 'Línea']], cfg.tipo, x => { cfg.tipo = x; alCambiar(); })]),
    el('div', { class: 'capas-punto' }, [el('span', { class: 'seg-tit', text: 'Mostrar' }),
      el('div', { class: 'capas-ops' }, Object.entries(CAPAS_PUNTO).map(([k, t]) => el('label', { class: 'check-linea' }, [
        el('input', { type: 'checkbox', checked: cfg.capas[k] || null, onchange: e => { cfg.capas[k] = e.target.checked; alCambiar(); } }),
        el('span', { text: ' ' + t })])))])
  ]);
  return el('section', { class: 'analisis-punto seccion' }, [
    el('div', { class: 'analisis-cab' }, [el('h3', { text: 'Análisis · ' + f0.punto }),
      el('span', { class: 'ayuda', text: 'Pasa el cursor (o toca) sobre un mes para ver el detalle.' })]),
    controles, cifras, grafico]);
}

const MODOS = { mes: 'Un mes', anio: 'Un año', rango: 'Un rango' };

async function vistaConsumos(c) {
  S.rep = S.rep || {
    vista: 'totales',
    modo: 'anio',
    mes: S.periodoConsumo,
    anio: String(new Date().getFullYear()),
    desde: primerDiaDelMes(new Date(new Date().getFullYear(), 0, 1)),
    hasta: S.periodoConsumo,
    // Al abrir, el grupo de todos los días: ANSA - Servicios (si el usuario lo ve).
    grupo: (S.catalogo.grupos.find(g => normGrupo(g.nombre).replace(/[^a-z]/g, '') === 'ansaservicios') || {}).nombre || '',
    puntos: []
  };
  const R = S.rep;
  R.puntos = R.puntos || [];
  R.graf = R.graf || { variable: null, metrica: 'consumo', tipo: 'barras', capas: { promedio: true, tendencia: true } };

  const selModo = el('select', { onchange: e => { R.modo = e.target.value; pintarFiltros(); cargar(); } });
  for (const [k, v] of Object.entries(MODOS))
    selModo.append(el('option', { value: k, selected: R.modo === k || null, text: v }));

  const gruposVisibles = new Set(S.catalogo.variables.flatMap(v => v.punto.grupos || []));
  const selGrupo = el('select', { onchange: e => { R.grupo = e.target.value; R.puntos = []; textoPuntos(); cargar(); } });
  for (const g of S.catalogo.grupos.filter(g => gruposVisibles.has(g.nombre))
                                   .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999)))
    selGrupo.append(el('option', { value: g.nombre, selected: R.grupo === g.nombre || null, text: g.nombre }));
  selGrupo.append(el('option', { value: '', selected: !R.grupo || null, text: 'Todos los grupos' }));
  if (R.grupo && !gruposVisibles.has(R.grupo)) { R.grupo = ''; selGrupo.value = ''; }

  // ---- filtro de puntos: uno, varios o todos (los del grupo elegido) ----
  const puntosDelGrupo = () => {
    const m = new Map();
    for (const v of S.catalogo.variables)
      if ((v.en_informe ?? v.principal) && (!R.grupo || (v.punto.grupos || []).includes(R.grupo))) m.set(v.punto.id, v.punto);
    return [...m.values()].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  };
  const btnPuntos = el('button', { type: 'button', class: 'sel-multi', 'aria-haspopup': 'true', onclick: () => abrirPuntos() });
  const cajaPuntos = el('div', { class: 'multi-caja' }, [btnPuntos]);
  function textoPuntos() {
    const ps = puntosDelGrupo(), n = R.puntos.length;
    btnPuntos.textContent = !n ? `Todos los puntos (${ps.length})`
      : n === 1 ? (ps.find(p => p.id === R.puntos[0])?.nombre || '1 punto') : `${n} puntos`;
    btnPuntos.classList.toggle('activo', n > 0);
  }
  function abrirPuntos() {
    const viejo = $('.pop-puntos', cajaPuntos); if (viejo) { viejo.remove(); return; }
    const ps = puntosDelGrupo(), elegidos = new Set(R.puntos.length ? R.puntos : ps.map(p => p.id));
    const lista = el('div', { class: 'pop-lista' });
    const buscar = el('input', { type: 'search', placeholder: 'Buscar punto…', oninput: () => pintarLista() });
    const aplicar = ids => {
      R.puntos = ids.length === ps.length ? [] : ids;
      pop.remove(); document.removeEventListener('click', fuera, true); textoPuntos(); cargar();
    };
    function pintarLista() {
      const t = buscar.value.trim().toLowerCase();
      lista.replaceChildren(...ps.filter(p => !t || String(p.nombre).toLowerCase().includes(t)).map(p => el('div', { class: 'pop-fila' }, [
        el('label', { class: 'check-linea' }, [el('input', { type: 'checkbox', checked: elegidos.has(p.id) || null,
          onchange: e => { e.target.checked ? elegidos.add(p.id) : elegidos.delete(p.id); } }), el('span', { text: ' ' + p.nombre })]),
        el('button', { type: 'button', class: 'btn-texto chico', text: 'solo este', title: 'Ver solo este punto, con su gráfico',
          onclick: () => aplicar([p.id]) })])));
    }
    const pop = el('div', { class: 'pop-puntos', role: 'dialog' }, [
      buscar,
      el('div', { class: 'fila' }, [
        el('button', { type: 'button', class: 'btn chico', text: 'Marcar todos', onclick: () => { ps.forEach(p => elegidos.add(p.id)); pintarLista(); } }),
        el('button', { type: 'button', class: 'btn chico', text: 'Desmarcar todos', onclick: () => { elegidos.clear(); pintarLista(); } })]),
      lista,
      el('div', { class: 'fila entre' }, [
        el('span', { class: 'ayuda', text: 'Con un solo punto se muestra su gráfico.' }),
        el('button', { type: 'button', class: 'btn primario chico', text: 'Aplicar', onclick: () => {
          if (!elegidos.size) return toast('Marca al menos un punto', true);
          aplicar(ps.filter(p => elegidos.has(p.id)).map(p => p.id)); } })])
    ]);
    const fuera = e => { if (!cajaPuntos.contains(e.target)) { pop.remove(); document.removeEventListener('click', fuera, true); } };
    cajaPuntos.append(pop); pintarLista(); buscar.focus();
    setTimeout(() => document.addEventListener('click', fuera, true), 0);
  }
  textoPuntos();

  const zonaFiltros = el('div', { class: 'fila crece' });
  R.vista = R.vista || 'totales';
  const segVista = el('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de tabla' },
    [['totales', 'Totales'], ['detalle', 'Detalle mensual']].map(([k, t]) =>
      el('button', { type: 'button', class: 'seg-op' + (R.vista === k ? ' sel' : ''), 'data-vista': k,
        'aria-pressed': R.vista === k ? 'true' : 'false', text: t,
        onclick: () => {
          R.vista = k;
          $$('.seg-op', segVista).forEach(b => {
            const on = b.dataset.vista === k;
            b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          pintar();
        } })));
  const barra = el('div', { class: 'fila seccion' }, [
    el('label', { text: 'Ver' }, [selModo]),
    zonaFiltros,
    el('div', { class: 'col-grupo' }, [
      el('label', { text: 'Grupo' }, [selGrupo]),
      el('div', { class: 'lbl-multi' }, [el('span', { class: 'lbl-txt', text: 'Puntos' }), cajaPuntos])]),
    el('div', { class: 'seg-caja' }, [el('span', { class: 'seg-tit', text: 'Tabla' }), segVista])
  ]);
  const acciones = el('div', { class: 'fila entre seccion acciones-rep' }, [
    el('p', { class: 'ayuda crece', id: 'resumen-rango' }),
    el('span', { class: 'ayuda', id: 'planilla-paso' }),
    el('button', { class: 'btn', text: 'Descargar Excel', onclick: async e => {
      const b = e.target; b.disabled = true;
      const [d, h] = limites();
      try { await descargarPlanilla(d, h, { grupo: R.grupo }); }
      catch (err) { toast('No se pudo armar la planilla: ' + (err.message || err), true); }
      finally { b.disabled = false; $('#planilla-paso').textContent = ''; }
    } }),
    el('button', { class: 'btn', text: 'Todo el histórico en Excel', onclick: async e => {
      const b = e.target; b.disabled = true;
      try {
        const { data } = await sb.from('v_consumos').select('mes').order('mes').limit(1);
        const primero = data && data.length ? data[0].mes : primerDiaDelMes(new Date());
        await descargarPlanilla(primero, primerDiaDelMes(new Date()),
          { grupo: R.grupo });
      } catch (err) { toast('No se pudo armar la planilla: ' + (err.message || err), true); }
      finally { b.disabled = false; $('#planilla-paso').textContent = ''; }
    } }),
    el('button', { class: 'btn', text: 'Vista para imprimir', onclick: () => imprimirInforme() })
  ]);
  const zona = el('div');
  c.append(barra, acciones, zona);
  // Puntos que dos personas tomaron en la toma actual: antes se resolvían en
  // Tablero y Validación, que se retiraron.
  bloqueDuplicados(S.periodo).then(d => { if (d && zona.isConnected) c.insertBefore(d, zona); }).catch(() => {});

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
              .order('punto');
    if (R.grupo) q = q.contains('grupos', [R.grupo]);
    q = q.eq('en_informe', true);
    const r0 = await q;
    if (r0.error) { zona.replaceChildren(el('p', { class: 'error', text: r0.error.message })); return; }
    const filtroPuntos = R.puntos.length ? new Set(R.puntos) : null;
    const data = r0.data.filter(f => !filtroPuntos || filtroPuntos.has(f.punto_id)).sort(ordenFilaInforme);

    // Un punto que no se midió es información, no un hueco: se lista aparte.
    const enAlcance = S.catalogo.variables.filter(v =>
      (v.en_informe ?? v.principal) &&
      (!R.grupo || (v.punto.grupos || []).includes(R.grupo)) &&
      (!filtroPuntos || filtroPuntos.has(v.punto.id)));
    const conDato = new Set(data.map(f => f.variable_id));
    // Un punto que se visitó y no se pudo leer no es lo mismo que uno donde nadie
    // fue: el primero tiene una explicación y el segundo es una tarea sin hacer.
    let sinPoderLeer = new Set();
    try {
      const r = await sb.from('lecturas').select('variable_id')
        .eq('sin_dato', true).gte('periodo', desde).lte('periodo', hasta);
      sinPoderLeer = new Set((r.data || []).map(x => x.variable_id));
    } catch { /* si falla, se listan todos juntos */ }
    const faltantes = enAlcance.filter(v => !conDato.has(v.id) && !sinPoderLeer.has(v.id));
    const noLeidos = enAlcance.filter(v => !conDato.has(v.id) && sinPoderLeer.has(v.id));

    let avisos = [];
    try {
      const ids = [...new Set(enAlcance.map(v => v.punto.id))];
      const r = await sb.from('avisos')
        .select('id, punto_id, descripcion, severidad, abierto_en, categoria:catalogo_avisos(categoria)')
        .neq('estado', 'resuelto').in('punto_id', ids.slice(0, 300));
      avisos = r.data || [];
    } catch { /* sin avisos, el informe igual sirve */ }

    // Lo que ya se revisó (corregido o desestimado) deja de contar como pendiente.
    const revisiones = new Map();
    try {
      const r = await sb.from('revisiones_consumo').select('*').gte('mes', desde).lte('mes', hasta);
      for (const x of (r.data || [])) revisiones.set(x.variable_id + '|' + x.mes, x);
    } catch { /* sin revisiones, todo lo marcado sigue por revisar */ }

    // Registros con foto: la foto de un mes cuelga de la lectura de cierre (periodo del mes siguiente).
    const conFoto = new Set();
    try {
      const fl = await traerTodo(() => sb.from('lecturas').select('variable_id, periodo, fotos!inner(id)')
        .gte('periodo', mesSiguiente(desde)).lte('periodo', mesSiguiente(hasta)).neq('estado', 'descartada')
        .order('id'));
      for (const x of fl) conFoto.add(x.variable_id + '|' + x.periodo);
    } catch { /* sin el indicador de fotos, la tabla igual sirve */ }

    const bandas = await DB.bandasCache().catch(() => ({}));
    S.repDatos = { filas: data, desde, hasta, faltantes, noLeidos, avisos, bandas, revisiones };
    const ctx = { filas: data, hasta, avisos, bandas, revisiones, conFoto, alCambiar: cargar, repintar: () => pintar() };
    ultimo = { data, desde, hasta, extra: {
      enAlcance, faltantes, noLeidos, avisos, bandas, revisiones, conFoto,
      abrir: clave => verConsumo(clave, ctx),
      alCaja: k => { R.caja = k; pintar(); acciones.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    } };
    pintar();
    const r = $('#resumen-rango');
    if (r) r.textContent = data.length
      ? `${new Set(data.map(f => f.punto_id)).size} puntos · ${data.length} valores calculados`
      : '';
  }

  // Pinta lo ya consultado: abrir una caja o volver no repite la consulta.
  let ultimo = null;
  async function pintar() {
    if (!ultimo || !zona.isConnected) return;
    const actual = ultimo;
    // El detalle mensual necesita el totalizador de cada mes: se trae solo cuando se pide.
    const unPunto = R.puntos.length === 1 && !R.caja;
    if ((R.vista === 'detalle' || (unPunto && R.graf.metrica === 'totaliz')) && !R.caja && !actual.extra.totalizadores) {
      zona.replaceChildren(el('p', { class: 'cargando', text: 'Cargando totalizadores…' }));
      try { actual.extra.totalizadores = await traerTotalizadores(actual.data); }
      catch (e) { toast('No se pudieron traer los totalizadores: ' + (e.message || e), true); actual.extra.totalizadores = new Map(); }
      if (S.repDatos && S.repDatos.filas === actual.data) S.repDatos.totalizadores = actual.extra.totalizadores;
      if (actual !== ultimo || !zona.isConnected) return;
    }
    const meses = [...new Set(actual.data.map(f => f.mes))].sort();
    const panel = unPunto && actual.data.length
      ? panelAnalisisPunto(actual.data, meses, { totalizadores: actual.extra.totalizadores, cfg: R.graf, alCambiar: () => pintar() })
      : null;
    poner(zona, panel, ...armarInforme(actual.data, actual.desde, actual.hasta,
      { ...actual.extra, caja: R.caja || null, vista: R.vista }));
  }

  pintarFiltros();
  cargar();
}

/* ---------- mediciones del informe ----------
   Qué lecturas van al informe se decide en cada punto ("Va al informe", en_informe):
   un medidor puede mandar kWh+ y kWh-, un variador kWh+ y horas, un FIT m³.
   Las sumas de grupo se hacen POR MEDICIÓN: sumar kWh+ con kWh- (o kWh con horas)
   daría un número sin significado. */
const MEDICIONES = [
  { k: 'imp',   etiqueta: 'Energía importada (kWh+)', corto: 'kWh+' },
  { k: 'exp',   etiqueta: 'Energía exportada (kWh-)', corto: 'kWh-' },
  { k: 'gen',   etiqueta: 'Energía generada (kWh)',   corto: 'kWh gen.' },
  { k: 'kw',    etiqueta: 'Potencia (kW)',            corto: 'kW' },
  { k: 'hrs',   etiqueta: 'Horas de marcha',          corto: 'Horas' },
  { k: 'agua',  etiqueta: 'Volumen de agua (m³)',     corto: 'Agua m³' },
  { k: 'gas',   etiqueta: 'Volumen de gas (m³)',      corto: 'Gas m³' },
  { k: 'lt',    etiqueta: 'Litros (L)',               corto: 'Litros' },
  { k: 'otras', etiqueta: 'Otras lecturas',           corto: 'Otras' }
];
function medicionDe(nombre, unidad) {
  const v = { nombre: nombre || '', unidad_reporte: unidad };
  const t = TIPOS_LECTURA.find(x => x.es(v));
  return t ? t.k : 'otras';
}
// Nombre del bloque de suma: la medición, o la variable con su unidad si es "otra".
function claveSuma(variable, unidad) {
  const k = medicionDe(variable, unidad);
  return k === 'otras' ? `${variable} · ${UNIDAD[unidad] || unidad}` : MEDICIONES.find(m => m.k === k).etiqueta;
}
// Orden dentro de un punto: importada, exportada, el resto.
const rangoNombre = nombre => rangoVar({ nombre });
const ordenFilaInforme = (a, b) => compararGrupos(a.grupo, b.grupo) ||
  String(a.punto).localeCompare(String(b.punto)) ||
  rangoNombre(a.variable) - rangoNombre(b.variable) || String(a.variable).localeCompare(String(b.variable));

// Lo que se ve en la columna Variable: solo la unidad. El nombre completo va en el tooltip.
const SIGLA_MEDICION = { imp: 'kWh+', exp: 'kWh-', gen: 'kWh', kw: 'kW', hrs: 'h', agua: 'm³', gas: 'm³', lt: 'L' };
const siglaDe = (variable, unidad) =>
  SIGLA_MEDICION[medicionDe(variable, unidad)] || UNIDAD[unidad] || unidad || '—';

// Tooltip flotante propio: el atributo title no sirve en tablet y un tooltip dentro de la
// tabla quedaría recortado por su scroll. Con mouse aparece al pasar; con el dedo, al tocar.
let _tipNodo, _tipTimer;
function ponerTip(nodo, texto) {
  const ocultar = () => { clearTimeout(_tipTimer); if (_tipNodo) _tipNodo.hidden = true; };
  const mostrar = () => {
    if (!_tipNodo) {
      _tipNodo = el('div', { class: 'tip-flotante', role: 'tooltip', hidden: '' });
      document.body.append(_tipNodo);
      document.addEventListener('pointerdown', e => { if (!e.target.closest?.('.chip-var')) ocultar(); }, true);
      window.addEventListener('scroll', ocultar, true);
    }
    _tipNodo.textContent = texto; _tipNodo.hidden = false;
    _tipNodo.style.left = '0px'; _tipNodo.style.top = '0px';
    const r = nodo.getBoundingClientRect(), w = _tipNodo.offsetWidth, h = _tipNodo.offsetHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const y = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
    _tipNodo.style.left = x + 'px'; _tipNodo.style.top = y + 'px';
  };
  nodo.addEventListener('mouseenter', mostrar);
  nodo.addEventListener('mouseleave', ocultar);
  nodo.addEventListener('focus', mostrar);
  nodo.addEventListener('blur', ocultar);
  nodo.addEventListener('click', () => { mostrar(); clearTimeout(_tipTimer); _tipTimer = setTimeout(ocultar, 3000); });
}
const chipVar = f => {
  const b = el('button', { type: 'button', class: 'chip-var', 'aria-label': f.variable,
    text: siglaDe(f.variable, f.unidad_reporte) });
  ponerTip(b, f.variable);
  return b;
};

// Totalizador de cada mes = la lectura del mes siguiente (misma regla que la planilla).
async function traerTotalizadores(data) {
  const out = new Map();
  const ids = [...new Set(data.map(f => f.variable_id))];
  const periodos = [...new Set(data.map(f => mesSiguiente(f.mes)))];
  if (!ids.length) return out;
  const filas = await traerTodo(() => sb.from('lecturas').select('id, variable_id, periodo, valor')
    .in('variable_id', ids).in('periodo', periodos).neq('estado', 'descartada').order('id'));
  for (const l of filas) if (l.valor !== null && l.valor !== undefined) out.set(l.variable_id + '|' + l.periodo, Number(l.valor));
  return out;
}

// Variables con el detalle de "Revisar" desplegado: sobrevive a los repintados.
const revAbiertas = new Set();
const ICONO_FOTO = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';

/* ---------- armado del informe (se reutiliza en pantalla y al imprimir) ---------- */
// Fuera de rango: se compara contra la banda EWMA que ya está en el dispositivo.
// Devuelve null si no hay banda (menos de 4 meses de historia) o si está dentro.
function juzgarConsumo(f, bandas) {
  const v = Number(f.consumo);
  if (v < 0) return { nivel: 'bad', texto: 'negativo' };
  if (v === 0) return { nivel: 'warn', texto: 'en cero' };
  const b = bandas[f.variable_id];
  if (!b || !b.sigma) return null;
  const z = (v - b.media) / b.sigma;
  if (Math.abs(z) > 3) return { nivel: 'bad', texto: (z > 0 ? 'muy alto' : 'muy bajo') };
  if (Math.abs(z) > 1.5) return { nivel: 'warn', texto: (z > 0 ? 'alto' : 'bajo') };
  return null;
}

/* Las cajas de Consumos e informes. Cada una cuenta algo y, al tocarla, abre la
   lista de los puntos o registros que cuenta. Tocarla de nuevo o "Volver" regresa
   a la tabla principal. */
const CAJAS_REP = {
  puntos:    { titulo: 'Cantidad de puntos', clase: '',
               ayuda: 'Todos los puntos que van al informe con el filtro elegido, y en qué estado está cada lectura.' },
  noleidos:  { titulo: 'No se pudo leer', clase: 'aviso',
               ayuda: 'Alguien fue al punto y dejó constancia de que no se pudo tomar la lectura: display apagado, tablero cerrado, equipo retirado. No es lo mismo que un punto sin visitar.' },
  fuera:     { titulo: 'Fuera de rango', clase: 'alerta',
               ayuda: 'Consumos negativos o muy lejos de lo habitual del punto. Siguen aquí hasta que se corrijan o desestimen.' },
  revisar:   { titulo: 'Para revisar', clase: 'aviso',
               ayuda: 'Consumos en cero, altos o bajos, meses sin dato y puntos con aviso abierto. Siguen aquí hasta que se corrijan o desestimen.' },
  revisados: { titulo: 'Revisados', clase: 'ok',
               ayuda: 'Valores que ya se corrigieron o desestimaron, con su motivo.' }
};

// Tabla del informe: filas agrupadas bajo una franja con el nombre del grupo.
// "clases" marca cada columna para que en el celular la fila se arme como tarjeta.
function tablaInforme(cab, grupos, clases = []) {
  const thead = el('thead', {}, [el('tr', {}, cab.map((h, j) => el('th', { text: h, class: clases[j] || '' })))]);
  const tb = el('tbody');
  for (const g of grupos) {
    tb.append(el('tr', { class: 'fila-grupo' }, [
      el('td', { colspan: String(cab.length) }, [el('span', { text: `${g.nombre} · ${g.filas.length}` })])]));
    for (const f of g.filas)
      tb.append(el('tr', {}, f.map((celda, j) => {
        const props = { 'data-col': cab[j] || '', class: clases[j] || '' };
        if (celda instanceof Node) return el('td', props, [celda]);
        props.text = String(celda ?? '—');
        return el('td', props);
      })));
  }
  return el('div', { class: 'tabla-caja tabla-informe' }, [el('table', {}, [thead, tb])]);
}

function armarInforme(data, desde, hasta, extra = {}) {
  const { enAlcance = [], faltantes = [], noLeidos = [], avisos = [], bandas = {},
          revisiones = new Map(), conFoto = new Set(), abrir, alCaja, caja = null,
          vista = 'totales', totalizadores = new Map() } = extra;
  const meses = [...new Set(data.map(f => f.mes))].sort();
  const partes = [];

  const avisosDe = new Map();
  for (const a of avisos) (avisosDe.get(a.punto_id) || avisosDe.set(a.punto_id, []).get(a.punto_id)).push(a);
  const juicios = new Map();
  for (const f of data) { const j = juzgarConsumo(f, bandas); if (j) juicios.set(f.variable_id + '|' + f.mes, j); }
  // Un mes sin valor dentro del periodo, para una lectura que sí tiene otros meses,
  // también es algo que revisar: falta una de las dos tomas que lo forman.
  const conValor = new Set(data.map(f => f.variable_id + '|' + f.mes));
  for (const id of new Set(data.map(f => f.variable_id)))
    for (const m of meses)
      if (!conValor.has(id + '|' + m)) juicios.set(id + '|' + m, { nivel: 'warn', texto: 'sin dato', sinDato: true });
  // Pendiente = marcado y todavía sin corregir ni desestimar.
  const pend = [...juicios.keys()].filter(k => !revisiones.has(k));
  const mesCorto = m => nombrePeriodo(m).split(' ')[0].slice(0, 3);
  const nombreTipo = { corregido: 'corregido', desestimado: 'desestimado', validado: 'validado' };

  // Datos de una lectura, venga del informe o del catálogo (si no tiene consumo).
  const porId = new Map();
  for (const f of data) if (!porId.has(f.variable_id)) porId.set(f.variable_id, f);
  const catId = new Map(S.catalogo.variables.map(v => [v.id, v]));
  const info = id => {
    const f = porId.get(id);
    if (f) return { grupo: f.grupo || 'Sin grupo', punto: f.punto, tag: f.tag || '—', variable: f.variable,
                    unidad: UNIDAD[f.unidad_reporte] || f.unidad_reporte, punto_id: f.punto_id };
    const v = catId.get(id);
    if (v) return { grupo: gruposTexto(v.punto), punto: v.punto.nombre, tag: v.punto.equipo?.tag || '—',
                    variable: v.nombre, unidad: UNIDAD[v.unidad_reporte] || v.unidad_reporte, punto_id: v.punto.id };
    return { grupo: '—', punto: '—', tag: '—', variable: '—', unidad: '', punto_id: null };
  };
  const idDeClave = k => { const x = k.split('|')[0]; return porId.has(Number(x)) || catId.has(Number(x)) ? Number(x) : x; };
  const mesDeClave = k => k.split('|')[1];
  const consumoDe = new Map(data.map(f => [f.variable_id + '|' + f.mes, f]));

  // ---- lo que cuenta cada caja ----
  const idsAlcance = new Set([...enAlcance.map(v => v.id), ...data.map(f => f.variable_id)]);
  const noLeidosIds = new Set(noLeidos.map(v => v.id));
  const faltantesIds = new Set(faltantes.map(v => v.id));
  const fuera = pend.filter(k => juicios.get(k).nivel === 'bad');
  const revisar = pend.filter(k => juicios.get(k).nivel === 'warn');
  const revisados = [...revisiones.keys()].filter(k => idsAlcance.has(idDeClave(k)));
  const cuenta = {
    puntos: new Set([...idsAlcance].map(id => info(id).punto_id).filter(x => x != null)).size,
    noleidos: noLeidos.length,
    fuera: fuera.length,
    revisar: revisar.length + avisosDe.size,
    revisados: revisados.length
  };

  partes.push(el('div', { class: 'kpis cajas-rep' }, Object.entries(CAJAS_REP).map(([k, c]) =>
    el('button', {
      type: 'button', class: `kpi kpi-btn ${c.clase}${caja === k ? ' sel' : ''}`,
      'aria-pressed': caja === k ? 'true' : 'false',
      title: caja === k ? 'Volver a la tabla' : 'Ver ' + c.titulo.toLowerCase(),
      onclick: () => alCaja && alCaja(caja === k ? null : k)
    }, [el('div', { class: 'v', text: String(cuenta[k]) }), el('div', { class: 'k', text: c.titulo })]))));

  // ---- detalle de una caja ----
  if (caja && CAJAS_REP[caja]) {
    const ver = (id, mes, texto = 'ver', clase = 'neutro') => abrir
      ? el('button', { class: 'pill ' + clase, text: texto, onclick: () => abrir({ variable_id: id, mes }) }) : '—';
    const ordenar = (x, y) => compararGrupos(x.i.grupo, y.i.grupo) ||
      String(x.i.punto).localeCompare(String(y.i.punto)) || String(x.i.variable).localeCompare(String(y.i.variable)) ||
      String(x.mes || '').localeCompare(String(y.mes || ''));
    let cab = [], filas = [];

    if (caja === 'puntos') {
      const estado = id => porId.has(id) ? ['con dato', 'ok'] : noLeidosIds.has(id) ? ['no se pudo leer', 'warn']
                         : faltantesIds.has(id) ? ['sin visitar', 'bad'] : ['sin dato', 'neutro'];
      const ultimoMes = id => { const ms = data.filter(f => f.variable_id === id).map(f => f.mes).sort(); return ms.length ? ms[ms.length - 1] : hasta; };
      cab = ['Grupo', 'Punto', 'TAG', 'Variable', 'Unidad', 'Estado', 'Aviso', ''];
      filas = [...idsAlcance].map(id => ({ id, i: info(id) })).sort(ordenar).map(({ id, i }) => {
        const [t, cl] = estado(id);
        return [i.grupo, i.punto, i.tag, i.variable, i.unidad, el('span', { class: 'pill ' + cl, text: t }),
                avisosDe.has(i.punto_id) ? el('span', { class: 'pill warn', text: 'abierto' }) : '—',
                ver(id, ultimoMes(id))];
      });
    } else if (caja === 'noleidos') {
      cab = ['Grupo', 'Punto', 'Variable', 'Unidad', 'Aviso abierto', 'Revisión'];
      filas = noLeidos.map(v => ({ id: v.id, i: info(v.id) })).sort(ordenar).map(({ id, i }) => {
        const rev = revisiones.get(id + '|' + hasta);
        return [i.grupo, i.punto, i.variable, i.unidad,
                avisosDe.has(i.punto_id) ? el('span', { class: 'pill warn', text: 'sí' }) : '—',
                rev ? ver(id, hasta, nombreTipo[rev.tipo], 'ok') : ver(id, hasta, 'revisar')];
      });
    } else if (caja === 'fuera' || caja === 'revisar') {
      cab = ['Grupo', 'Punto', 'Variable', 'Mes', 'Consumo', 'Unidad', 'Motivo', ''];
      const lista = (caja === 'fuera' ? fuera : revisar).map(k => ({ k, id: idDeClave(k), mes: mesDeClave(k), i: info(idDeClave(k)) }));
      // Un punto con aviso abierto se lista una vez, con su primera lectura del informe.
      if (caja === 'revisar')
        for (const [pid, avs] of avisosDe) {
          const v = data.find(f => f.punto_id === pid)?.variable_id ?? enAlcance.find(x => x.punto.id === pid)?.id;
          if (v != null) lista.push({ aviso: avs[0], id: v, mes: null, i: info(v) });
        }
      filas = lista.sort(ordenar).map(x => {
        if (x.aviso) return [x.i.grupo, x.i.punto, x.i.variable, '—', '—', x.i.unidad,
          el('span', { class: 'pill warn', title: x.aviso.descripcion || '',
            text: 'aviso: ' + (x.aviso.categoria?.categoria || x.aviso.descripcion || 'abierto').slice(0, 40) }),
          ver(x.id, hasta)];
        const f = consumoDe.get(x.k), j = juicios.get(x.k);
        return [x.i.grupo, x.i.punto, x.i.variable, nombrePeriodo(x.mes), f ? num(f.consumo) : '—', x.i.unidad,
                el('span', { class: 'pill ' + j.nivel, text: j.texto }), ver(x.id, x.mes)];
      });
    } else if (caja === 'revisados') {
      cab = ['Grupo', 'Punto', 'Variable', 'Mes', 'Consumo', 'Revisión', 'Motivo', ''];
      filas = revisados.map(k => ({ k, id: idDeClave(k), mes: mesDeClave(k), i: info(idDeClave(k)) })).sort(ordenar).map(x => {
        const rev = revisiones.get(x.k), f = consumoDe.get(x.k);
        return [x.i.grupo, x.i.punto, x.i.variable, nombrePeriodo(x.mes), f ? num(f.consumo) : '—',
                el('span', { class: 'pill ok', text: nombreTipo[rev.tipo] || rev.tipo }), rev.motivo || '—', ver(x.id, x.mes)];
      });
    }

    partes.push(el('div', { class: 'detalle-cab' }, [
      el('button', { class: 'btn', type: 'button', text: '← Volver a Consumos e informes', onclick: () => alCaja && alCaja(null) }),
      el('h3', { text: caja === 'puntos'
        ? `${CAJAS_REP[caja].titulo}: ${cuenta.puntos} · ${filas.length} lecturas`
        : `${CAJAS_REP[caja].titulo} (${filas.length})` })
    ]));
    partes.push(el('p', { class: 'ayuda seccion', text: CAJAS_REP[caja].ayuda }));
    partes.push(filas.length ? tabla(cab, filas)
      : el('p', { class: 'vacio', text: 'No hay registros en esta caja con el filtro elegido.' }));
    return partes;
  }

  // ---- tabla principal ----
  if (!data.length) {
    partes.push(el('p', { class: 'vacio', html:
      'No hay consumos calculados en ese periodo.<br>' +
      'Un mes se puede calcular recién cuando existe la lectura del mes siguiente.' }));
    return partes;
  }
  if (abrir) partes.push(el('p', { class: 'ayuda pista-rep', text:
    'Toca un valor para ver sus lecturas, fotos y avisos. El círculo de Revisar cuenta lo pendiente: tócalo para ver qué es. ' +
    'Toca la unidad para ver el nombre completo de la lectura.' }));

  // Un valor de la tabla: botón que abre la ficha, con el color de su estado.
  const celda = (f, m, texto) => {
    const k = f.variable_id + '|' + m;
    const rev = revisiones.get(k), j = juicios.get(k);
    if (!abrir) return texto;
    return el('button', {
      class: 'celda-cons' + (rev ? ' rev' : j && !j.sinDato ? ' ' + j.nivel : '') + (texto === '—' ? (rev ? ' falta' : ' falta pend') : ''),
      title: rev ? `${nombreTipo[rev.tipo]}: ${rev.motivo}` : j ? j.texto : 'Ver lecturas',
      onclick: () => abrir({ variable_id: f.variable_id, mes: m })
    }, [el('span', { text: texto }),
        rev ? el('span', { class: 'marca-rev', title: 'Registro ' + (nombreTipo[rev.tipo] || 'revisado'), text: ' ✓' }) : null,
        conFoto.has(f.variable_id + '|' + mesSiguiente(m)) ? el('span', { class: 'ico-foto', title: 'Tiene registro fotográfico', html: ICONO_FOTO }) : null]);
  };
  // La columna Revisar dice QUÉ pasa y en qué mes; cada marca abre su ficha.
  const marcas = (f, mesesFila, conMes) => {
    const out = [];
    for (const m of mesesFila) {
      const k = f.variable_id + '|' + m;
      const rev = revisiones.get(k), j = juicios.get(k);
      const pre = conMes ? mesCorto(m) + ': ' : '';
      if (rev)
        out.push(el(abrir ? 'button' : 'span', { class: 'pill ok', title: rev.motivo,
          onclick: abrir ? () => abrir({ variable_id: f.variable_id, mes: m }) : null, text: pre + nombreTipo[rev.tipo] }));
      else if (j)
        out.push(el(abrir ? 'button' : 'span', { class: 'pill ' + j.nivel,
          onclick: abrir ? () => abrir({ variable_id: f.variable_id, mes: m }) : null, text: pre + j.texto }));
    }
    for (const a of (avisosDe.get(f.punto_id) || []).slice(0, 2))
      out.push(el(abrir ? 'button' : 'span', { class: 'pill warn', title: a.descripcion || '',
        onclick: abrir ? () => abrir({ variable_id: f.variable_id, mes: mesesFila[mesesFila.length - 1] }) : null,
        text: 'aviso: ' + (a.categoria?.categoria || a.descripcion || 'abierto').slice(0, 28) }));
    return out.length ? el('div', { class: 'marcas' }, out) : el('span', { class: 'pill ok', text: 'ok' });
  };
  // Revisar: un círculo con el número de revisiones pendientes (consumos marcados sin revisar
  // + avisos abiertos del punto). Al tocarlo se despliega debajo de la fila el detalle.
  const pendientesDe = (f, mesesFila) => {
    let n = 0, nivel = 'warn';
    for (const m of mesesFila) {
      const k = f.variable_id + '|' + m, j = juicios.get(k);
      if (j && !revisiones.has(k)) { n++; if (j.nivel === 'bad') nivel = 'bad'; }
    }
    n += (avisosDe.get(f.punto_id) || []).length;
    return { n, nivel };
  };
  const alternarRev = (b, f, mesesFila, filasDebajo) => {
    let ancla = b.closest('tr');
    for (let i = 0; i < filasDebajo; i++) ancla = ancla.nextElementSibling || ancla;
    const sig = ancla.nextElementSibling;
    // Filas del punto (1 en Totales, 3 en Detalle): se marcan junto con el desplegable.
    const origen = [];
    for (let tr = b.closest('tr'); tr; tr = tr.nextElementSibling) { origen.push(tr); if (tr === ancla) break; }
    if (sig && sig.classList.contains('fila-rev') && sig.dataset.id === String(f.variable_id)) {
      sig.remove(); b.setAttribute('aria-expanded', 'false'); revAbiertas.delete(f.variable_id);
      origen.forEach(tr => tr.classList.remove('rev-origen')); return;
    }
    origen.forEach(tr => tr.classList.add('rev-origen'));
    const cols = ancla.closest('table').tHead.rows[0].cells.length;
    const det = el('tr', { class: 'fila-rev', 'data-id': String(f.variable_id) }, [
      el('td', { colspan: String(cols) }, [el('div', { class: 'rev-cont' }, [
        el('strong', { text: `${f.punto} · ${siglaDe(f.variable, f.unidad_reporte)}` }),
        marcas(f, mesesFila, mesesFila.length > 1)])])]);
    ancla.after(det); b.setAttribute('aria-expanded', 'true'); revAbiertas.add(f.variable_id);
  };
  const circuloRev = (f, mesesFila, filasDebajo = 0) => {
    const { n, nivel } = pendientesDe(f, mesesFila);
    const b = el('button', { type: 'button', class: 'rev-circulo ' + (n ? nivel : 'ok'),
      'data-id': String(f.variable_id), 'aria-expanded': 'false',
      title: n ? `${n} por revisar · toca para ver` : 'Sin pendientes · toca para ver el historial',
      'aria-label': n ? `${n} por revisar` : 'Sin pendientes', text: n ? String(n) : '✓' });
    b.addEventListener('click', () => alternarRev(b, f, mesesFila, filasDebajo));
    return b;
  };
  // Tras armar una tabla, vuelve a abrir los detalles que estaban abiertos.
  const empujar = t => {
    for (const b of t.querySelectorAll('button.rev-circulo'))
      if (revAbiertas.has(Number(b.dataset.id))) b.click();
    partes.push(t);
  };
  const variosAnios = new Set(meses.map(m => m.slice(0, 4))).size > 1;
  const cabMes = m => variosAnios ? `${mesCorto(m)}-${m.slice(2, 4)}` : mesCorto(m);

  // Agrupa las filas bajo su grupo, en el orden de los grupos.
  const agrupar = filas => {
    const g = new Map();
    for (const x of filas) (g.get(x.grupo) || g.set(x.grupo, []).get(x.grupo)).push(x.celdas);
    return [...g].map(([nombre, filas]) => ({ nombre, filas }));
  };

  if (vista === 'detalle') {
    // Como la hoja "Detalle mensual" del Excel: por cada lectura, totalizador, consumo y variación.
    const claves = new Map();
    for (const f of data) {
      if (!claves.has(f.variable_id)) claves.set(f.variable_id, { f, cons: {} });
      claves.get(f.variable_id).cons[f.mes] = Number(f.consumo);
    }
    const bloques = [...claves.values()].sort((a, b) => ordenFilaInforme(a.f, b.f));
    const porGrupo = new Map();
    for (const b of bloques) {
      const g = b.f.grupo || 'Sin grupo';
      if (!porGrupo.has(g)) porGrupo.set(g, new Map());
      const pm = porGrupo.get(g);
      if (!pm.has(b.f.punto_id)) pm.set(b.f.punto_id, []);
      pm.get(b.f.punto_id).push(b);
    }
    const ncols = 3 + meses.length + 2;
    const thead = el('thead', {}, [el('tr', {}, [
      el('th', { class: 'd-punto', text: 'Punto' }), el('th', { class: 'd-var', text: 'Variable' }), el('th', { text: '' }),
      ...meses.map(m => el('th', { class: 'num', text: cabMes(m) })),
      el('th', { class: 'num', text: 'Total' }), el('th', { text: 'Revisar' })])]);
    const tb = el('tbody');
    for (const [gNombre, puntos] of porGrupo) {
      tb.append(el('tr', { class: 'fila-grupo' }, [
        el('td', { colspan: String(ncols) }, [el('span', { text: `${gNombre} · ${puntos.size}` })])]));
      let gris = false;
      for (const vars of puntos.values()) {
        gris = !gris;
        vars.forEach((b, vi) => {
          const f = b.f, mm = b.cons;
          const total = meses.reduce((s2, m) => s2 + (mm[m] || 0), 0);
          const cl = (x = '') => 'd-fila-tr' + (gris ? ' gris' : '') + x;
          const vacio = c => el('td', { class: c });
          tb.append(
            el('tr', { class: cl() }, [
              el('td', { class: 'd-punto' }, vi === 0 ? [el('b', { text: f.punto }), f.tag ? el('small', { text: f.tag }) : null] : []),
              el('td', { class: 'd-var' }, [chipVar(f)]),
              el('td', { class: 'd-fila', text: 'Totalizador' }),
              ...meses.map(m => {
                const t = totalizadores.get(f.variable_id + '|' + mesSiguiente(m));
                return el('td', { class: 'num d-tot', text: t === undefined ? '—' : num(t) });
              }),
              vacio('num'),
              el('td', { class: 'd-rev' }, [circuloRev(f, meses, 2)])]),
            el('tr', { class: cl(' d-cons') }, [
              vacio('d-punto'), vacio('d-var'), el('td', { class: 'd-fila', text: filaConsumoTxt(f.grupo) }),
              ...meses.map(m => el('td', { class: 'num' }, [celda(f, m, mm[m] === undefined ? '—' : num(mm[m]))])),
              el('td', { class: 'num', text: num(total) }), vacio('d-rev')]),
            el('tr', { class: cl(' fin') }, [
              vacio('d-punto'), vacio('d-var'), el('td', { class: 'd-fila', text: 'Var. % vs mes anterior' }),
              ...meses.map((m, i) => {
                const a = i > 0 ? mm[meses[i - 1]] : undefined, c2 = mm[m];
                if (!a || !c2) return el('td', { class: 'num', text: '' });
                const p = 100 * (c2 - a) / a;
                return el('td', { class: 'num d-var-pct', text: (p > 0 ? '+' : '') + num(p, 1) + '%' });
              }),
              vacio('num'), vacio('d-rev')]));
        });
      }
    }
    empujar(el('div', { class: 'tabla-caja tabla-detalle' }, [el('table', {}, [thead, tb])]));
  } else if (meses.length === 1) {
    const filas = data.map(f => ({ grupo: f.grupo || 'Sin grupo', celdas: [
      f.punto, f.tag || '—', chipVar(f),
      celda(f, f.mes, num(f.consumo)), f.dias_asignados,
      circuloRev(f, [f.mes]),
      el('span', { class: 'pill ' + (f.completo ? 'ok' : 'warn'), text: f.completo ? 'cerrado' : 'provisional' })] }));
    empujar(tablaInforme(
      ['Punto', 'TAG', 'Variable', 'Consumo', 'Días', 'Revisar', 'Estado'], agrupar(filas),
      ['c-punto c-ancha', 'c-tag', 'c-var', 'num c-mes', 'num c-mes', 'c-rev', 'c-est']));
  } else {
    // pivote: una fila por punto·variable, una columna por mes
    const claves = new Map();
    for (const f of data) {
      if (!claves.has(f.variable_id)) claves.set(f.variable_id, { f, meses: {} });
      claves.get(f.variable_id).meses[f.mes] = Number(f.consumo);
    }
    const filas = [...claves.values()].sort((a, b) => ordenFilaInforme(a.f, b.f)).map(({ f, meses: mm }) => {
      const vals = meses.map(m => mm[m]);
      const total = vals.reduce((a, v) => a + (v || 0), 0);
      return { grupo: f.grupo || 'Sin grupo', celdas: [
        f.punto, f.tag || '—', chipVar(f),
        ...meses.map((m, i) => celda(f, m, vals[i] === undefined ? '—' : num(vals[i]))),
        num(total), circuloRev(f, meses)] };
    });
    empujar(tablaInforme(
      ['Punto', 'TAG', 'Variable', ...meses.map(cabMes), 'Total', 'Revisar'], agrupar(filas),
      ['c-punto c-ancha', 'c-tag', 'c-var', ...meses.map(() => 'num c-mes'), 'num c-mes c-total', 'c-rev']));
  }
  return partes;
}

/* ---------- ficha de un consumo (punto · variable · mes) ----------
   Lo que hay detrás de un número del informe: las dos lecturas que lo forman (la
   toma que abre el mes y la que lo cierra), con foto y autor, el rango habitual,
   los avisos abiertos del punto y lo que ya se hizo con él. Desde acá se corrige
   una lectura, se carga la que faltó o se desestima la alerta con su motivo. */
async function verConsumo({ variable_id, mes }, ctx) {
  const v = S.catalogo.variables.find(x => x.id === variable_id);
  let f = ctx.filas.find(x => x.variable_id === variable_id && x.mes === mes);
  if (!v && !f) return toast('Esta lectura ya no está en el catálogo', true);
  const puntoNombre = v ? v.punto.nombre : f.punto;
  const varNombre = v ? v.nombre : f.variable;
  const uRep = UNIDAD[(v || f).unidad_reporte] || (v || f).unidad_reporte;
  const uDisp = v ? (UNIDAD[v.unidad_display] || v.unidad_display) : uRep;
  const dec = v ? (v.decimales_display || 0) : 0;
  const doble = v && v.formato_lectura === 'doble_mwh_kwh';
  const puedo = ['admin', 'supervisor'].includes(S.usuario.rol);
  const k = variable_id + '|' + mes;
  const b = ctx.bandas[variable_id];
  const ant = mesAnterior(mes), sig = mesSiguiente(mes);
  const cap = t => t.replace(/^./, c => c.toUpperCase());
  const nMes = cap(nombrePeriodo(mes)), nAnt = cap(nombrePeriodo(ant)), nSig = cap(nombrePeriodo(sig));
  const diaToma = `1 de ${nombrePeriodo(sig).split(' ')[0]}`;
  const gente = S.catalogo?.gente || {};
  const tipoTxt = { corregido: 'Corregido', desestimado: 'Desestimado', validado: 'Validado' };

  const cuerpo = el('div', { class: 'ficha-consumo' });
  const opcionesModal = { subtitulo: `${puntoNombre} · ${varNombre}`, completo: true, tituloGrande: true };
  modal('Registro de ' + nMes, el('p', { class: 'cargando', text: 'Cargando lecturas…' }), opcionesModal);

  // Si se llegó desde otro mes (p. ej. "ir al registro anterior"), el consumo y su revisión
  // pueden no estar en lo que ya trajo la pantalla: se piden aquí.
  if (!f) {
    try {
      const r = await sb.from('v_consumos').select('*').eq('variable_id', variable_id).eq('mes', mes).maybeSingle();
      if (r.data) f = r.data;
    } catch { /* sin consumo calculado */ }
  }
  let rev = ctx.revisiones.get(k);
  if (!rev) {
    try {
      const r = await sb.from('revisiones_consumo').select('*').eq('variable_id', variable_id).eq('mes', mes).maybeSingle();
      if (r.data) rev = r.data;
    } catch { /* sin revisión */ }
  }
  const j = f ? juzgarConsumo(f, ctx.bandas) : null;

  const registrar = async (tipo, motivo) => {
    const { error } = await sb.from('revisiones_consumo').upsert(
      { variable_id, mes, tipo, motivo, por: S.usuario.id, en: new Date().toISOString() },
      { onConflict: 'variable_id,mes' });
    if (error) throw error;
  };
  const terminar = async texto => { cerrarModal(); toast(texto); await ctx.alCambiar(); };

  // ---- las dos lecturas que forman el consumo ----
  const { data: lects, error } = await sb.from('lecturas')
    .select('id, periodo, valor, valor_display, valor_mwh, valor_kwh, fecha_lectura, observacion, estado, tomada_por, origen, sin_dato, es_reset, fotos(id, storage_path, orden)')
    .eq('variable_id', variable_id).in('periodo', [mes, sig]).neq('estado', 'descartada').order('fecha_lectura');
  if (error) { cuerpo.append(el('p', { class: 'error', text: error.message })); }

  // ---- 1 · el resultado, lo primero que se ve ----
  const rango = b && b.sigma
    ? `Rango habitual: ${num(Math.max(0, b.media - 1.5 * b.sigma))} – ${num(b.media + 1.5 * b.sigma)} ${uRep} (promedio ${num(b.media)})`
    : 'Todavía no hay historia suficiente para un rango habitual (hacen falta 4 meses).';
  cuerpo.append(el('div', { class: 'ficha-resultado' + (j ? ' ' + j.nivel : '') }, [
    el('div', { class: 'res-et', text: 'Total del mes calculado' }),
    f ? el('div', { class: 'res-valor', text: `${num(f.consumo)} ${uRep}` })
      : el('div', { class: 'res-valor falta', text: 'Sin calcular' }),
    f ? el('div', { class: 'res-formula', text: `= lectura de ${nMes} − lectura de ${nAnt}` }) : null,
    el('div', { class: 'fila' }, [
      j ? el('span', { class: 'pill ' + j.nivel, text: j.texto }) : (f ? el('span', { class: 'pill ok', text: 'dentro de rango' }) : null),
      f ? el('span', { class: 'pill ' + (f.completo ? 'ok' : 'warn'), text: f.completo ? 'cerrado' : 'provisional' }) : null,
      f ? el('span', { class: 'pill neutro', text: f.metodo }) : null,
      rev ? el('span', { class: 'pill ok', text: tipoTxt[rev.tipo] }) : null
    ]),
    el('p', { class: 'ayuda', text: f ? rango
      : `Falta una de las dos lecturas: la de ${nAnt} o la de ${nMes}.` })
  ]));

  const campoValor = (valores = {}) => doble
    ? { mwh: el('input', { type: 'number', step: 'any', value: valores.mwh ?? '', placeholder: 'MWh' }),
        kwh: el('input', { type: 'number', step: 'any', value: valores.kwh ?? '', placeholder: 'kWh' }) }
    : { val: el('input', { type: 'number', step: dec > 0 ? '0.' + '0'.repeat(dec - 1) + '1' : '1',
                           value: valores.val ?? '', placeholder: `Valor en ${uDisp}`, inputmode: 'decimal' }) };
  const nodosValor = c => doble
    ? [el('label', { text: 'MWh' }, [c.mwh]), el('label', { text: 'kWh' }, [c.kwh])]
    : [el('label', { text: `Valor del display (${uDisp})` }, [c.val])];
  const leerValor = c => doble
    ? (c.mwh.value === '' && c.kwh.value === '' ? null : { valor_display: null, valor_mwh: Number(c.mwh.value || 0), valor_kwh: Number(c.kwh.value || 0) })
    : (c.val.value === '' ? null : { valor_display: Number(c.val.value), valor_mwh: null, valor_kwh: null });

  // Fotos de una lectura: miniaturas que abren la imagen completa.
  const pintarFotos = async (cont, lista) => {
    if (!lista.length) { cont.replaceChildren(el('p', { class: 'ayuda', text: 'Sin foto todavía' })); return; }
    const nodos = await Promise.all(lista.map(async ft => {
      const { data } = await sb.storage.from(C.BUCKET).createSignedUrl(ft.storage_path, 600);
      return data?.signedUrl ? el('a', { href: data.signedUrl, target: '_blank', rel: 'noopener' },
        [el('img', { src: data.signedUrl, alt: 'Foto del medidor' })]) : null;
    }));
    cont.replaceChildren(...nodos.filter(Boolean));
  };

  // editable = la lectura de ESTE mes. La del mes anterior solo se mira.
  const tarjetaLectura = (l, editable) => {
    const valorTxt = l.sin_dato ? 'No se pudo leer'
      : doble ? `${num(l.valor_mwh)} MWh + ${num(l.valor_kwh)} kWh`
      : `${num(l.valor_display ?? l.valor, dec)} ${uDisp}`;
    const fotos = el('div', { class: 'ficha-fotos' });
    pintarFotos(fotos, fotosOrdenadas(l));

    const zonaCorregir = el('div');
    const abrirCorreccion = () => {
      const c = campoValor({ val: l.valor_display, mwh: l.valor_mwh, kwh: l.valor_kwh });
      const motivo = el('input', { type: 'text', placeholder: 'Motivo del cambio (queda en la auditoría)' });
      zonaCorregir.replaceChildren(el('div', { class: 'ficha-form' }, [
        ...nodosValor(c),
        el('label', { text: 'Motivo del cambio' }, [motivo]),
        el('div', { class: 'fila' }, [
          el('button', { class: 'btn ok', text: 'Guardar corrección', onclick: async e => {
            const nv = leerValor(c);
            if (!nv) return toast('Escribe el valor', true);
            if (!motivo.value.trim()) return toast('Escribe el motivo', true);
            e.target.disabled = true;
            try {
              const r = await sb.rpc('corregir_lectura', { p_id: l.id, p_valor_display: nv.valor_display,
                p_motivo: motivo.value.trim(), p_valor_mwh: nv.valor_mwh, p_valor_kwh: nv.valor_kwh });
              if (r.error) throw r.error;
              await registrar('corregido', `Lectura del ${fechaHora(l.fecha_lectura)}: ${valorTxt} → ` +
                `${doble ? `${nv.valor_mwh} MWh + ${nv.valor_kwh} kWh` : `${nv.valor_display} ${uDisp}`}. ${motivo.value.trim()}`);
              await terminar('Lectura corregida');
            } catch (err) { e.target.disabled = false; toast(err.message || String(err), true); }
          } }),
          el('button', { class: 'btn', text: 'Cancelar', onclick: () => zonaCorregir.replaceChildren() })
        ])
      ]));
    };

    // Agregar fotos de este mes, una o varias, sin pedir ninguna nota.
    const inputFoto = el('input', { type: 'file', accept: 'image/*', multiple: '', hidden: '' });
    const btnFoto = el('button', { type: 'button', class: 'btn chico', text: '+ Agregar foto', onclick: () => {
      if (!navigator.onLine) return toast('Sin señal: la foto necesita conexión para subirse', true);
      inputFoto.click();
    } });
    inputFoto.addEventListener('change', async () => {
      const archivos = [...inputFoto.files]; inputFoto.value = '';
      if (!archivos.length) return;
      btnFoto.disabled = true; btnFoto.textContent = 'Subiendo…';
      let ok = 0;
      try {
        for (const a of archivos) {
          const blob = await DB.comprimirFoto(a, (v && v.punto.foto_calidad) || 'normal');
          // la fecha del archivo es lo más parecido a cuándo se sacó la foto
          const cuando = a.lastModified && a.lastModified <= Date.now() ? new Date(a.lastModified).toISOString() : l.fecha_lectura;
          await DB.subirFotoALectura({ lectura_id: l.id, periodo: l.periodo, variable_id, blob, tomada_en: cuando });
          ok++;
        }
        toast(ok === 1 ? 'Foto agregada' : `${ok} fotos agregadas`);
        if (ok && ctx.conFoto) { ctx.conFoto.add(variable_id + '|' + mes); if (ctx.repintar) ctx.repintar(); }
      } catch (err) {
        toast(`${ok ? ok + ' subida(s). ' : ''}No se pudo subir la foto: ${err.message || err}`, true);
      } finally {
        btnFoto.disabled = false; btnFoto.textContent = '+ Agregar foto';
        const r = await sb.from('fotos').select('id, storage_path, orden').eq('lectura_id', l.id).order('orden').order('id');
        pintarFotos(fotos, r.data || []);
      }
    });

    return el('div', { class: 'ficha-lectura' }, [
      el('div', { class: 'ficha-lectura-valor', text: valorTxt }),
      el('p', { class: 'ayuda', text:
        `Tomada el ${fechaHora(l.fecha_lectura)} · ${gente[l.tomada_por] || (l.origen === 'importacion' ? 'Importado' : 'sin autor')} · ${l.estado}` +
        (l.es_reset ? ' · reinicio del totalizador' : '') }),
      l.observacion ? el('p', { class: 'ayuda', html: '<b>Observación:</b> ' + esc(l.observacion) }) : null,
      fotos,
      editable && puedo ? el('div', { class: 'fila' }, [
        el('button', { class: 'btn chico', text: 'Corregir valor', onclick: abrirCorreccion }), btnFoto, inputFoto]) : null,
      zonaCorregir
    ]);
  };

  const formularioAtrasada = (periodo, zona) => {
    const c = campoValor();
    const fecha = el('input', { type: 'date', value: periodo, max: new Date().toISOString().slice(0, 10) });
    const obs = el('input', { type: 'text', placeholder: 'Por qué se carga ahora (queda en la auditoría)' });
    const foto = el('input', { type: 'file', accept: 'image/*' });
    zona.replaceChildren(el('div', { class: 'ficha-form' }, [
      ...nodosValor(c),
      el('label', { text: 'Fecha en que se tomó' }, [fecha]),
      el('label', { text: 'Foto (opcional)' }, [foto]),
      el('label', { text: 'Motivo' }, [obs]),
      el('div', { class: 'fila' }, [
        el('button', { class: 'btn ok', text: 'Guardar lectura', onclick: async e => {
          const nv = leerValor(c);
          if (!nv) return toast('Escribe el valor', true);
          if (!obs.value.trim()) return toast('Escribe el motivo', true);
          if (!fecha.value) return toast('Indica la fecha', true);
          e.target.disabled = true;
          try {
            const iso = new Date(fecha.value + 'T12:00:00').toISOString();
            const r = await sb.rpc('guardar_captura', {
              p_punto_id: v.punto.id, p_periodo: periodo, p_fecha_lectura: iso,
              p_lecturas: [{ variable_id, ...nv, sin_dato: false }], p_avisos: [],
              p_observacion: obs.value.trim(), p_dispositivo: 'Consumos e informes · lectura atrasada' });
            if (r.error) throw r.error;
            const nueva = (r.data?.lecturas || []).find(x => x.variable_id === variable_id);
            if (foto.files[0] && nueva) {
              const blob = await DB.comprimirFoto(foto.files[0], v.punto.foto_calidad || 'normal');
              await DB.subirFotoALectura({ lectura_id: nueva.lectura_id, periodo, variable_id, blob, tomada_en: iso });
            }
            await registrar('corregido', `Lectura atrasada de la toma de ${nombrePeriodo(periodo)} cargada: ` +
              `${doble ? `${nv.valor_mwh} MWh + ${nv.valor_kwh} kWh` : `${nv.valor_display} ${uDisp}`}. ${obs.value.trim()}`);
            await terminar('Lectura cargada');
          } catch (err) { e.target.disabled = false; toast(err.message || String(err), true); }
        } }),
        el('button', { class: 'btn', text: 'Cancelar', onclick: () => zona.replaceChildren() })
      ])
    ]));
  };

  // ---- 2 · las dos lecturas: la del mes anterior (solo lectura) y la de este mes (editable) ----
  const delPeriodo = p => (lects || []).filter(l => l.periodo === p);
  const irAlAnterior = () => verConsumo({ variable_id, mes: ant }, ctx);

  const deAnt = delPeriodo(mes);
  const colAnterior = el('div', { class: 'ficha-col anterior' }, [
    el('div', { class: 'col-cab' }, [el('h4', { text: 'Lectura del mes anterior' }), el('span', { class: 'pill neutro', text: 'Solo lectura' })]),
    el('p', { class: 'ayuda', text: `Totalizador al cierre de ${nAnt}` }),
    ...(deAnt.length ? deAnt.map(l => tarjetaLectura(l, false))
      : [el('p', { class: 'banda warn', text: `No hay lectura de cierre de ${nAnt}.` })]),
    el('p', { class: 'ayuda', text: `No se modifica desde aquí: es el cierre de ${nAnt}.` }),
    el('button', { class: 'btn chico', text: `Ir al registro de ${nAnt}`, onclick: irAlAnterior })
  ]);

  const deEste = delPeriodo(sig);
  const zonaNueva = el('div');
  const colEste = el('div', { class: 'ficha-col actual' }, [
    el('div', { class: 'col-cab' }, [el('h4', { text: `Lectura de ${nMes}` }), el('span', { class: 'pill acento', text: 'Editable' })]),
    el('p', { class: 'ayuda', text: `Totalizador al cierre de ${nMes} · se toma el ${diaToma}` }),
    ...(deEste.length ? deEste.map(l => tarjetaLectura(l, true)) : [
      el('p', { class: 'banda warn', text: `Todavía no hay lectura de cierre de ${nMes}.` }),
      puedo && v ? el('button', { class: 'btn chico', text: 'Cargar lectura atrasada',
        onclick: () => formularioAtrasada(sig, zonaNueva) }) : null,
      zonaNueva])
  ]);
  cuerpo.append(el('div', { class: 'grid2 ficha-lecturas' }, [colAnterior, colEste]));

  // ---- 3 · la alerta de este registro ----
  const caja = el('div', { class: 'card ficha-revision' });
  if (rev) {
    caja.append(
      el('h4', { style: 'margin-top:0', text: 'Revisión hecha' }),
      el('p', { html: `<b>${tipoTxt[rev.tipo]}</b> por ${esc(gente[rev.por] || '—')} el ${fechaHora(rev.en)}` }),
      el('p', { class: 'ayuda', text: rev.motivo }),
      puedo ? el('button', { class: 'btn chico peligro', text: rev.tipo === 'validado' ? 'Quitar validación' : 'Quitar la marca (vuelve a por revisar)', onclick: async () => {
        const { error: e3 } = await sb.from('revisiones_consumo').delete().eq('id', rev.id);
        if (e3) return toast(e3.message, true);
        await terminar(rev.tipo === 'validado' ? 'Validación quitada' : 'Marca quitada');
      } }) : null);
  } else if (puedo && (j || !f || f)) {
    if (f) caja.append(
      el('h4', { style: 'margin-top:0', text: '¿El registro está bien?' }),
      el('p', { class: 'ayuda', text: 'Márcalo como validado y aparecerá con ✓ en la tabla. No pide nota.' }),
      el('button', { class: 'btn', text: '✓ Registro validado', onclick: async e => {
        e.target.disabled = true;
        try { await registrar('validado', 'Validado'); await terminar('Registro validado'); }
        catch (err) { e.target.disabled = false; toast(err.message || String(err), true); }
      } }));
  }
  if (!rev && puedo && (j || !f)) {
    const motivo = el('textarea', { placeholder: f
      ? 'Por qué el valor está bien aunque salga del rango (obligatorio)'
      : 'Por qué no hay dato este mes (obligatorio)' });
    caja.append(
      el('h4', { style: 'margin-top:0', text: f ? `Alerta: el valor está ${j.texto}` : 'Falta el dato de este mes' }),
      el('p', { class: 'ayuda', text: f ? 'Si el valor es correcto, déjalo como está y desestima la alerta con su motivo. Si no, corrige la lectura de arriba.'
                                        : 'No se carga nada; queda constancia del motivo y pasa a "desestimado".' }),
      motivo,
      el('button', { class: 'btn', text: f ? 'Desestimar alerta' : 'Justificar la falta de dato', onclick: async e => {
        if (!motivo.value.trim()) return toast('Escribe el motivo', true);
        e.target.disabled = true;
        try { await registrar('desestimado', motivo.value.trim()); await terminar('Marcado como desestimado'); }
        catch (err) { e.target.disabled = false; toast(err.message || String(err), true); }
      } }));
  }
  if (caja.childNodes.length) cuerpo.append(caja);

  // ---- 4 · avisos abiertos del punto ----
  const pid = v ? v.punto.id : f.punto_id;
  const suyos = (ctx.avisos || []).filter(a => a.punto_id === pid);
  if (suyos.length) {
    cuerpo.append(el('h4', { text: `Avisos abiertos del punto (${suyos.length})` }),
      ...suyos.map(a => el('div', { class: 'fila entre aviso-linea' }, [
        el('span', {}, [
          el('span', { class: 'pill ' + ({ alta: 'bad', media: 'warn' }[a.severidad] || 'neutro'), text: a.severidad }),
          el('span', { text: ` ${a.categoria?.categoria || ''} · ${a.descripcion || ''}` })]),
        el('button', { class: 'btn chico', text: 'Abrir aviso', onclick: async () => {
          const { data, error: e2 } = await sb.from('v_avisos').select('*').eq('id', a.id).single();
          if (e2) return toast(e2.message, true);
          verDetalleAviso(data, () => ctx.alCambiar());
        } })
      ])));
  }

  modal('Registro de ' + nMes, cuerpo, opcionesModal);
}

/* ---------- informe imprimible ----------
   Blanco y negro, formato de planilla: los puntos en las filas y los meses en
   las columnas. Nada de tarjetas ni botones: esto se manda por correo y se
   archiva, y tiene que leerse como una tabla, no como una foto de la pantalla. */
async function imprimirInforme() {
  if (!S.repDatos || !S.repDatos.filas.length) return toast('No hay datos para imprimir', true);
  const { filas, desde, hasta, bandas = {} } = S.repDatos;
  const R = S.rep;
  // Imprime lo mismo que hay en pantalla: la tabla elegida (Totales o Detalle mensual),
  // con el periodo (un mes, un año o un rango) y el grupo del filtro.
  const detalle = R.vista === 'detalle';
  const unPunto = (R.puntos || []).length === 1;
  let totalizadores = S.repDatos.totalizadores;
  if ((detalle || (unPunto && R.graf?.metrica === 'totaliz')) && !totalizadores) {
    try { totalizadores = S.repDatos.totalizadores = await traerTotalizadores(filas); }
    catch (e) { return toast('No se pudieron traer los totalizadores: ' + (e.message || e), true); }
  }

  const meses = [...new Set(filas.map(f => f.mes))].sort();
  const nMes = m => nombrePeriodo(m).split(' ')[0].slice(0, 3);
  const variosAnios = new Set(meses.map(m => m.slice(0, 4))).size > 1;
  const cabMes = m => variosAnios ? `${nMes(m)}-${m.slice(2, 4)}` : nMes(m);
  const conTotal = meses.length > 1;

  const titulo = unPunto ? (filas[0]?.punto || 'Punto') + (R.grupo ? ' · ' + R.grupo : '') : (R.grupo || 'Todos los grupos');
  const periodo = R.modo === 'anio' ? `Año ${R.anio}`
    : desde === hasta ? 'Mes de ' + nombrePeriodo(desde)
    : `Desde ${nombrePeriodo(desde)} hasta ${nombrePeriodo(hasta)}`;
  const tablaTxt = detalle ? 'Detalle mensual' : 'Totales';

  // una fila por variable, ordenada por grupo y punto
  const porVar = new Map();
  for (const f of filas) {
    if (!porVar.has(f.variable_id)) porVar.set(f.variable_id, { f, m: {} });
    porVar.get(f.variable_id).m[f.mes] = Number(f.consumo);
  }
  const orden = [...porVar.values()].sort((a, b) => ordenFilaInforme(a.f, b.f));
  const grupos = new Map();
  for (const x of orden) {
    const g = x.f.grupo || 'Sin grupo';
    (grupos.get(g) || grupos.set(g, []).get(g)).push(x);
  }

  const fueraDeRango = ({ f, m }) => meses.some(x =>
    juzgarConsumo({ consumo: m[x] ?? 0, variable_id: f.variable_id }, bandas)?.nivel === 'bad');
  const marcados = orden.filter(fueraDeRango).length;

  const cabecera = () => el('table', { class: 'cab-informe' }, [el('tbody', {}, [el('tr', {}, [
    el('td', {}, [
      el('h1', { text: 'Consumos · ' + titulo }),
      el('p', { text: `${tablaTxt} · ${periodo}` })
    ]),
    el('td', { class: 'num', html:
      `Algorta Norte<br>${esc(S.usuario.nombre)}<br>${fechaCorta(new Date().toISOString())}` })
  ])])]);

  // ---- Totales: una fila por lectura, con suma referencial por medición al pie del grupo ----
  const tablaTotales = (gNombre, items) => {
    const acum = {};
    const cuerpo = items.map(({ f, m }) => {
      const kb = claveSuma(f.variable, f.unidad_reporte);
      acum[kb] ||= {};
      meses.forEach(x => { acum[kb][x] = (acum[kb][x] || 0) + (m[x] || 0); });
      const total = meses.reduce((s2, x) => s2 + (m[x] || 0), 0);
      const marca = fueraDeRango({ f, m }) ? ' *' : '';
      return el('tr', {}, [
        el('td', { text: f.punto }), el('td', { text: f.tag || '' }), el('td', { text: f.variable }),
        el('td', { text: UNIDAD[f.unidad_reporte] || f.unidad_reporte }),
        ...meses.map((x, i) => el('td', { class: 'num', text: (m[x] === undefined ? '—' : num(m[x])) + (!conTotal && i === 0 ? marca : '') })),
        conTotal ? el('td', { class: 'num total', text: num(total) + marca }) : null
      ]);
    });
    for (const [u, a] of Object.entries(acum))
      cuerpo.push(el('tr', { class: 'suma' }, [
        el('td', { colspan: 4, text: `Suma de ${gNombre} · ${u} (referencial)` }),
        ...meses.map(x => el('td', { class: 'num', text: num(a[x] || 0) })),
        conTotal ? el('td', { class: 'num', text: num(meses.reduce((s2, x) => s2 + (a[x] || 0), 0)) }) : null
      ]));
    return el('table', { class: 'planilla' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Punto' }), el('th', { text: 'TAG' }), el('th', { text: 'Variable' }), el('th', { text: 'Un.' }),
        ...meses.map(m => el('th', { class: 'num', text: cabMes(m) })),
        conTotal ? el('th', { class: 'num', text: 'Total' }) : null
      ])]),
      el('tbody', {}, cuerpo)
    ]);
  };

  // ---- Detalle mensual: totalizador, consumo y variación por lectura (como en pantalla) ----
  const tablaDetalle = items => {
    const cuerpo = [];
    for (const { f, m } of items) {
      const total = meses.reduce((s2, x) => s2 + (m[x] || 0), 0);
      const marca = fueraDeRango({ f, m }) ? ' *' : '';
      const nombre = el('td', { class: 'd-nom', rowspan: '3' }, [
        el('b', { text: f.punto }), el('br'),
        el('span', { text: [f.tag, f.variable, UNIDAD[f.unidad_reporte] || f.unidad_reporte].filter(Boolean).join(' · ') })]);
      // Cada lectura en su propio <tbody>: así sus tres filas no se parten entre dos hojas.
      cuerpo.push(el('tbody', { class: 'd-bloque' }, [
        el('tr', { class: 'd-ini' }, [nombre, el('td', { class: 'd-fila', text: 'Totalizador' }),
          ...meses.map(x => { const t = totalizadores.get(f.variable_id + '|' + mesSiguiente(x));
            return el('td', { class: 'num', text: t === undefined ? '—' : num(t) }); }),
          conTotal ? el('td', { class: 'num' }) : null]),
        el('tr', { class: 'd-cons' }, [el('td', { class: 'd-fila', text: filaConsumoTxt(f.grupo) }),
          ...meses.map(x => el('td', { class: 'num', text: m[x] === undefined ? '—' : num(m[x]) })),
          conTotal ? el('td', { class: 'num total', text: num(total) + marca }) : null]),
        el('tr', { class: 'd-fin' }, [el('td', { class: 'd-fila', text: 'Var. % vs mes anterior' }),
          ...meses.map((x, i) => {
            const a = i > 0 ? m[meses[i - 1]] : undefined, c2 = m[x];
            return el('td', { class: 'num', text: a && c2 ? (c2 > a ? '+' : '') + num(100 * (c2 - a) / a, 1) + '%' : '' });
          }),
          conTotal ? el('td', { class: 'num' }) : null])]));
    }
    return el('table', { class: 'planilla detalle-imp' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Punto · variable' }), el('th', { text: '' }),
        ...meses.map(m => el('th', { class: 'num', text: cabMes(m) })),
        conTotal ? el('th', { class: 'num', text: 'Total' }) : null
      ])]),
      ...cuerpo
    ]);
  };

  // Un grupo por página: cada grupo arranca en una hoja nueva, con su encabezado.
  const secciones = [...grupos].map(([g, items], i) => el('section', { class: 'grupo-imp' + (i ? ' salto' : '') }, [
    cabecera(),
    unPunto ? panelAnalisisPunto(filas, meses, { totalizadores, cfg: R.graf, imprimir: true })
            : el('h2', { class: 'grupo-imp-tit', text: `${g} · ${new Set(items.map(x => x.f.punto_id)).size} puntos` }),
    detalle ? tablaDetalle(items) : tablaTotales(g, items)
  ]));

  const hoja = el('div', { class: 'hoja hoja-informe' }, [
    ...secciones,
    el('div', { class: 'pie-informe' }, [
      el('p', { text:
        'El consumo de cada mes se calcula repartiendo lo medido entre dos lecturas sobre los días ' +
        'de calendario que cubren. Un mes queda cerrado cuando existe la lectura del mes siguiente.' }),
      detalle ? el('p', { text: 'Totalizador: lo que marca el medidor al cerrar el mes (lectura del día 1 del mes siguiente).' })
              : el('p', { text:
        'Las sumas por grupo son referenciales: los puntos tienen naturalezas distintas y algunos ' +
        'miden tramos en serie del mismo circuito, así que no constituyen un total de energía.' }),
      marcados ? el('p', { text:
        `(*) ${marcados} lectura(s) con al menos un mes fuera del rango habitual. Revisar antes de usar el dato.` }) : null
    ])
  ]);

  // Carta horizontal solo para este informe: se agrega el tamaño de página al imprimir
  // y se quita al terminar, para no cambiar las etiquetas QR ni el informe de avisos.
  const pagina = el('style', { id: 'pagina-informe', text: '@page{size:letter landscape;margin:9mm 10mm}' });
  document.head.append(pagina);
  const cont = document.getElementById('impresion');
  cont.replaceChildren(hoja);
  document.body.classList.add('imprimiendo');
  const limpiar = () => {
    document.body.classList.remove('imprimiendo');
    cont.replaceChildren();
    pagina.remove();
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);
  setTimeout(() => window.print(), 120);
}

/* ===================================================================
   PLANILLA ANUAL EN EXCEL
   Tres hojas, cada una como Tabla de Excel con filtros:
   · Resumen anual  → una fila por punto y lectura, con totales filtrables y gráfico.
   · Detalle mensual → totalizador, consumo y variación, para revisar.
   · Lecturas        → cada lectura tal como se tomó.
   El grupo se filtra dentro de la Tabla (o al descargar), ya no hay una hoja por grupo.
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
              .order('mes').order('punto');
    if (filtros.grupo) q = q.contains('grupos', [filtros.grupo]);
    return q.eq('en_informe', true);
  });
  if (!cons.length) { paso(''); return toast('No hay consumos en ese periodo', true); }

  paso('Consultando lecturas…');
  // El totalizador de un mes es la lectura del mes siguiente, así que hay que
  // pedir un mes más para que la última columna no quede vacía.
  const lect = await traerTodo(() => {
    let q = sb.from('v_respaldo').select('*')
             .gte('periodo', desde).lte('periodo', mesSiguiente(hasta))
             .order('periodo').order('lectura_id').order('foto_n');
    if (filtros.grupo) q = q.contains('grupos', [filtros.grupo]);
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
      tag: c.tag || '', grupo: c.grupo || 'Sin grupo', punto: c.punto,
      variable: c.variable, unidad: c.unidad_reporte, grupos: c.grupos || [],
      bloque: claveSuma(c.variable, c.unidad_reporte),
      principal: c.principal !== false, cons: {}, estado: {}, metodo: {}, lect: {}
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
  const filasVar = [...porVar.values()].sort(ordenFilaInforme);

  const totalFila = v => meses.reduce((s, m) => s + (v.cons[m] || 0), 0);

  const rango = desde.slice(0, 7) === hasta.slice(0, 7) ? nombrePeriodo(desde)
              : `${nombrePeriodo(desde)} a ${nombrePeriodo(hasta)}`;
  // fecha y hora de Chile, en 24 h y sin "a. m.": se lee y se ordena mejor en Excel
  const fechaExcel = iso => new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
  const colMes0 = 5;                                // TAG, Grupo, Punto, Variable, Unidad, meses…

  // ---- 1 · Resumen anual: una fila por punto y lectura, en Tabla con filtros ----
  // Sin filas de subtotal intercaladas: romperían los filtros. La fila "Total filtrado"
  // usa SUBTOTAL, así suma solo lo que queda visible al filtrar.
  const resumen = [['TAG', 'Grupo', 'Punto', 'Variable', 'Unidad', ...cabMeses, 'TOTAL']];
  for (const v of filasVar)
    resumen.push([v.tag, (v.grupos.length ? v.grupos : [v.grupo]).join(' · '), v.punto, v.variable,
      UNIDAD[v.unidad] || v.unidad, ...meses.map(m => redondear(v.cons[m])), redondear(totalFila(v))]);

  // ---- 2 · Detalle mensual: totalizador, consumo y variación ----
  // TAG, grupo, punto y unidad se VEN una vez por punto, y la variable una vez por
  // bloque de tres filas. El valor sigue en todas las celdas (oculto con formato ;;;)
  // para que filtrar por punto o variable no deje filas huérfanas. Cada punto
  // alterna fondo blanco / gris claro, así se lee como un bloque.
  const detalle = [['TAG', 'Grupo', 'Punto', 'Variable', 'Unidad', 'Fila', ...cabMeses, 'TOTAL']];
  let puntoPrev = null, uPrev = null, gris = true;
  for (const v of filasVar) {
    const nuevoPunto = v.punto !== puntoPrev;
    if (nuevoPunto) { gris = !gris; puntoPrev = v.punto; }
    const u = UNIDAD[v.unidad] || v.unidad;
    const filasBloque = [
      ['Totalizador', ...meses.map(m => redondear(v.lect[mesSiguiente(m)])), ''],
      [filaConsumoTxt(v.grupo), ...meses.map(m => redondear(v.cons[m])), redondear(totalFila(v))],
      ['Var. % vs mes anterior', ...meses.map((m, i) => {
        if (i === 0) return '';
        const a = v.cons[meses[i - 1]], b = v.cons[m];
        return (a && b) ? { v: Number((100 * (b - a) / a).toFixed(1)), s: 'pct' } : '';   // en puntos %
      }), '']
    ];
    filasBloque.forEach((resto, k) => {
      const verPunto = nuevoPunto && k === 0;
      const fila = [
        { v: v.tag, oculto: !verPunto }, { v: v.grupo, oculto: !verPunto }, { v: v.punto, oculto: !verPunto },
        { v: v.variable, oculto: k !== 0 },
        // una vez por punto (o si cambia dentro del punto); la Var. % va en %, no en kWh
        { v: u, oculto: !(k === 0 && (verPunto || u !== uPrev)) },
        ...resto];
      fila.gris = gris;
      if (k === 1) fila.fuente = 'cons';      // el consumo del mes resalta, sutil
      detalle.push(fila);
    });
    uPrev = u;
  }

  // ---- 3 · Lecturas: una fila por lectura, tal como se tomó ----
  const gente = S.catalogo?.gente || {};
  const lecturas = [['Periodo', 'Fecha de lectura', 'Grupo', 'Punto', 'TAG', 'Variable', 'Unidad',
                     'Valor', 'Observación', 'Fotos', 'Usuario']];
  // v_respaldo trae una fila por foto: acá basta una por lectura.
  for (const f of new Map(lect.map(f => [f.lectura_id, f])).values())
    lecturas.push([nombrePeriodo(f.periodo).replace(/^./, c => c.toUpperCase()), fechaExcel(f.fecha_lectura),
      f.grupo || '', f.punto, f.tag || '', f.variable, UNIDAD[f.unidad] || f.unidad,
      f.sin_dato ? 'sin dato' : (f.valor === null ? '' : Number(f.valor)),
      f.observacion || '', { v: Number(f.foto_total) || 0, s: 'ent' },
      // las cargadas desde la planilla histórica no tienen autor
      gente[f.tomada_por] || (f.origen === 'importacion' ? 'Importado' : (f.tomada_por ? 'Usuario eliminado' : ''))]);

  // ---- 4 · Avisos de los puntos de esta planilla ----
  // Entran los que siguen pendientes y los abiertos desde el inicio del periodo.
  paso('Consultando avisos…');
  const puntosPlanilla = new Set(cons.map(c => c.punto_id));
  const { data: avData, error: avErr } = await sb.from('v_avisos').select('*')
    .order('abierto_en', { ascending: false }).limit(2000);
  if (avErr) throw avErr;
  const finPeriodo = mesSiguiente(mesSiguiente(hasta));      // incluye la toma que cierra el último mes
  const avisos = (avData || []).filter(a => puntosPlanilla.has(a.punto_id) &&
    (a.estado !== 'resuelto' || (a.abierto_en >= desde && a.abierto_en < finPeriodo)) &&
    (a.abierto_en < finPeriodo));
  const mayus = t => t ? String(t).replace(/^./, c => c.toUpperCase()) : '';
  const hojaAvisos = [['N.º', 'Abierto', 'Grupo', 'Punto', 'Categoría', 'Descripción', 'Severidad',
                       'Estado', 'Abierto por', 'Resuelto', 'Resuelto por', 'Resolución']];
  for (const a of avisos)
    hojaAvisos.push([{ v: a.id, s: 'ent' }, fechaExcel(a.abierto_en), (a.grupos || []).join(' · '), a.punto,
      a.categoria || '', a.descripcion || '', mayus(a.severidad), mayus(a.estado), a.abierto_por_nombre || '',
      a.resuelto_en ? fechaExcel(a.resuelto_en) : '', a.resuelto_por_nombre || '', a.obs_resolucion || '']);

  const usados = new Set();
  // Cada hoja dice de qué grupo es: en el título y en el encabezado al imprimir.
  const grupoTxt = filtros.grupo || 'Todos los grupos';
  const nPuntos = new Set(cons.map(c => c.punto_id)).size;
  const portada = [
    [{ v: 'Cierre de Mes · Informe de consumos', fuente: 'nota' }],
    [{ v: grupoTxt, fuente: 'grande' }],
    [{ v: rango.replace(/^./, c => c.toUpperCase()), fuente: 'titulo' }],
    [],
    [{ v: 'Puntos incluidos', fuente: 'b' }, String(nPuntos)],
    [{ v: 'Generado', fuente: 'b' }, fechaExcel(new Date().toISOString())],
    [{ v: 'Por', fuente: 'b' }, S.usuario.nombre],
    [],
    [{ v: 'Contenido', fuente: 'titulo' }],
    [{ v: 'Resumen anual', fuente: 'b' }, 'Consumo de cada punto por mes, con totales filtrables y gráfico.'],
    [{ v: 'Detalle mensual', fuente: 'b' }, 'Totalizador, consumo del mes y variación de cada punto.'],
    [{ v: 'Lecturas', fuente: 'b' }, 'Cada lectura tomada en terreno, con fecha y autor.'],
    [{ v: 'Avisos', fuente: 'b' }, 'Avisos de los puntos de este informe.'],
    [],
    [{ v: `Generado con la app Cierre de Mes (versión ${C.VERSION || '—'}, beta).`, fuente: 'nota' }]
  ];
  const hojas = [
    { nombre: nombreHoja('Portada', usados), filas: portada, portada: true, anchos: [22, 70], encabezado: grupoTxt },
    { nombre: nombreHoja('Resumen anual', usados), filas: resumen, encabezado: grupoTxt,
      intro: [`${grupoTxt} · Resumen anual · ${rango}`,
        'Consumo de cada mes = lectura que cierra el mes − lectura anterior.',
        'Total filtrado y gráfico suman solo las filas visibles: filtra una sola Unidad.',
        `Generado el ${fechaExcel(new Date().toISOString())} por ${S.usuario.nombre}.`],
      tabla: { nombre: 'Resumen', totales: { etiqueta: 'Total filtrado', desde: colMes0 } },
      grafico: { titulo: 'Consumo mensual (filas filtradas)', desde: colMes0, hasta: colMes0 + meses.length - 1 } },
    { nombre: nombreHoja('Detalle mensual', usados), filas: detalle, encabezado: grupoTxt,
      intro: [`${grupoTxt} · Detalle mensual · ${rango}`,
        'Totalizador: lo que marca el medidor al cerrar el mes. Consumo: diferencia con el mes anterior. Var. %: cambio del consumo.'],
      tabla: { nombre: 'Detalle', franjas: false } },
    { nombre: nombreHoja('Lecturas', usados), filas: lecturas, encabezado: grupoTxt,
      intro: [`${grupoTxt} · Lecturas tomadas en terreno`,
        'Una fila por lectura. El periodo es el mes de la toma: la lectura de octubre cierra septiembre.'],
      tabla: { nombre: 'Lecturas', anchoMax: 50 } },
    { nombre: nombreHoja('Avisos', usados), filas: hojaAvisos.length > 1 ? hojaAvisos
        : [...hojaAvisos, ['', '', '', '', '', 'Sin avisos para estos puntos en el periodo']],
      encabezado: grupoTxt,
      intro: [`${grupoTxt} · Avisos de los puntos · ${rango}`,
        'Pendientes y los abiertos dentro del periodo.'],
      tabla: { nombre: 'Avisos', anchoMax: 60 } }
  ];

  paso('Escribiendo el archivo…');
  const blob = await window.RESPALDO.construirExcel(hojas);
  const alcance = filtros.grupo ? '_' + window.RESPALDO.limpio(filtros.grupo) : '';
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
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando…' })]);
  const selVista = el('select', { onchange: pintar }, [
    el('option', { value: 'avisos', text: 'Avisos' }),
    el('option', { value: 'observaciones', text: 'Observaciones de terreno' }),
    el('option', { value: 'informe', text: 'Informe ejecutivo' })
  ]);
  const selEstado = el('select', { onchange: pintar }, [
    el('option', { value: 'abiertos', text: 'Solo abiertos' }),
    el('option', { value: '', text: 'Todos' }),
    el('option', { value: 'resuelto', text: 'Solo resueltos' })
  ]);
  const buscar = el('input', { type: 'search', placeholder: 'Buscar punto, categoría o texto…',
    oninput: () => pintar() });
  // El grupo filtra la lista y define de qué grupo sale el PDF (para adjuntarlo a su informe).
  const selGrupo = el('select', { onchange: pintar }, [el('option', { value: '', text: 'Todos los grupos' })]);
  for (const g of [...(S.catalogo.grupos || [])].sort((a, b) => compararGrupos(a.nombre, b.nombre)))
    selGrupo.append(el('option', { value: g.nombre, text: g.nombre }));

  // Dos filas: qué ver y en qué estado; luego el grupo con su PDF al lado.
  const btnPdf = el('button', { class: 'btn primario', text: '📄 PDF',
    title: 'PDF en blanco y negro con los avisos sin resolver del grupo elegido',
    onclick: () => pdfAvisosPendientes(selGrupo.value) });
  c.append(
    el('div', { class: 'filtros-avisos' }, [selVista, selEstado]),
    el('div', { class: 'filtros-avisos grupo-pdf' }, [selGrupo, btnPdf]),
    buscar, zona);
  pintar();

  async function pintar() {
    poner(zona, el('p', { class: 'cargando', text: 'Cargando…' }));
    selEstado.hidden = selVista.value === 'observaciones';
    selGrupo.hidden = btnPdf.hidden = selVista.value === 'observaciones';
    const q = (buscar.value || '').toLowerCase();

    if (selVista.value === 'observaciones') {
      const { data, error } = await sb.from('v_observaciones').select('*')
        .order('fecha_lectura', { ascending: false }).limit(1000);
      if (error) return poner(zona, el('p', { class: 'error', text: error.message }));
      const filas = (data || []).filter(o =>
        !q || `${o.punto} ${gruposTexto(o)} ${o.variable} ${o.observacion}`.toLowerCase().includes(q));
      if (!filas.length) return poner(zona, el('p', { class: 'vacio', text: 'No hay observaciones.' }));

      const listaObs = el('div', { class: 'lista-compacta' },
        filas.map(o => el('div', {
          class: 'fila-compacta',
          onclick: () => verDetalleObservacion(o)
        }, [
          el('div', { class: 'info-principal' }, [
            el('div', { class: 'fila-titulo' }, [
              el('strong', { text: o.punto }),
              el('span', { class: 'categoria-tag', text: o.variable })
            ]),
            el('p', { class: 'descripcion-corta', text: o.observacion || 'Sin texto de observación' }),
            el('span', { class: 'texto-secundario', text: `${nombrePeriodo(o.periodo)} · por ${o.tomada_por_nombre || '—'}` })
          ]),
          el('div', { class: 'info-secundaria' }, [
            o.sin_dato ? el('span', { class: 'pill warn', text: 'sin dato' }) : el('span', { class: 'num', text: num(o.valor_display) }),
            o.fotos ? el('span', { class: 'pill neutro', text: `${o.fotos} 📷` }) : null
          ].filter(Boolean))
        ]))
      );

      return poner(zona,
        el('p', { class: 'ayuda', text: `${filas.length} observación(es) escritas en terreno.` }),
        listaObs);
    }

    const { data, error } = await sb.from('v_avisos').select('*')
      .order('abierto_en', { ascending: false }).limit(1000);
    if (error) return poner(zona, el('p', { class: 'error', text: error.message }));
    let avisos = data || [];
    if (selEstado.value === 'abiertos') avisos = avisos.filter(a => a.estado !== 'resuelto');
    if (selEstado.value === 'resuelto') avisos = avisos.filter(a => a.estado === 'resuelto');
    if (selGrupo.value) avisos = avisos.filter(a => (a.grupos || []).includes(selGrupo.value));
    if (q) avisos = avisos.filter(a =>
      `${a.punto} ${gruposTexto(a)} ${a.categoria} ${a.descripcion || ''}`.toLowerCase().includes(q));

    if (selVista.value === 'informe') return informeAvisos(zona, avisos, selGrupo.value);

    if (!avisos.length) return poner(zona, el('p', { class: 'vacio', text: 'No hay avisos con este filtro.' }));

    const listaAvisos = el('div', { class: 'lista-compacta' },
      avisos.map(a => {
        const sevClase = { alta: 'bad', media: 'warn', baja: 'neutro' }[a.severidad] || 'neutro';
        const estClase = a.estado === 'resuelto' ? 'ok' : 'warn';
        const sevBorder = a.severidad === 'alta' ? ' error' : (a.severidad === 'media' ? ' alerta' : '');

        return el('div', {
          class: 'fila-compacta' + (a.estado === 'resuelto' ? ' resuelto' : sevBorder),
          onclick: () => verDetalleAviso(a, pintar)
        }, [
          el('div', { class: 'info-principal' }, [
            el('div', { class: 'fila-titulo' }, [
              el('strong', { text: `${a.punto}` }),
              // "Otro" no dice nada: en ese caso manda la descripción.
              esOtroAviso(a.categoria) ? null : el('span', { class: 'categoria-tag', text: a.categoria || 'Aviso' })
            ]),
            // Si la descripción solo repite la categoría, no se escribe dos veces.
            descripcionUtil(a) ? el('p', { class: 'descripcion-corta', text: descripcionUtil(a) }) : null,
            el('span', { class: 'texto-secundario', text:
              `${gruposTexto(a)} · ${a.estado === 'resuelto' ? 'resuelto ' + fechaCorta(a.resuelto_en) : haceDias(a)}` +
              ` · ${a.abierto_por_nombre || '—'}` })
          ]),
          el('div', { class: 'info-secundaria' }, [
            el('span', { class: 'pill ' + sevClase, text: a.severidad }),
            el('span', { class: 'pill ' + estClase, text: a.estado.replace('_', ' ') })
          ])
        ]);
      })
    );

    poner(zona,
      el('p', { class: 'ayuda', text:
        `${avisos.filter(a => a.estado !== 'resuelto').length} sin resolver de ${avisos.length} mostrados.` }),
      listaAvisos);
  }
}

const esOtroAviso = cat => /^Otro/i.test(cat || '');
const diasAbierto = a => Math.max(0, Math.floor((Date.now() - new Date(a.abierto_en)) / 86400e3));
const haceDias = a => { const d = diasAbierto(a); return d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`; };
const descripcionUtil = a => {
  const d = (a.descripcion || '').trim();
  if (!d) return esOtroAviso(a.categoria) ? 'Sin descripción' : '';
  return d.replace(/[.\s]+$/, '').toLowerCase() === String(a.categoria || '').toLowerCase() ? '' : d;
};

/* ---------------- PDF de avisos pendientes ----------------
   Blanco y negro, A4, para adjuntar a los informes por grupo. Lo arma el navegador
   con "Guardar como PDF" (igual que el informe de consumos). Pendiente = abierto o en
   gestión. Orden: grupo → severidad (alta primero) → antigüedad (el más viejo primero).
   El N.º es el id del aviso: sirve para referirse a él en el seguimiento. */
async function pdfAvisosPendientes(grupo = '') {
  if (!navigator.onLine) return toast('El PDF necesita señal para traer los avisos', true);
  const { data, error } = await sb.from('v_avisos').select('*').neq('estado', 'resuelto')
    .order('abierto_en').limit(2000);
  if (error) return toast(error.message, true);
  let avisos = data || [];
  if (grupo) avisos = avisos.filter(a => (a.grupos || []).includes(grupo));
  if (!avisos.length) return toast('No hay avisos pendientes' + (grupo ? ` en ${grupo}` : ''));

  const SEV = { alta: 0, media: 1, baja: 2 };
  const secciones = new Map();
  for (const a of avisos) {
    // Un punto puede estar en varios grupos: en "Todos" se lista una vez, en su primer grupo.
    const g = grupo || ((a.grupos && a.grupos.length) ? [...a.grupos].sort(compararGrupos)[0] : 'Sin grupo');
    if (!secciones.has(g)) secciones.set(g, []);
    secciones.get(g).push(a);
  }
  const filas = [];
  for (const g of [...secciones.keys()].sort(compararGrupos)) {
    const lista = secciones.get(g).sort((x, y) =>
      (SEV[x.severidad] ?? 3) - (SEV[y.severidad] ?? 3) ||
      new Date(x.abierto_en) - new Date(y.abierto_en) ||
      String(x.punto).localeCompare(String(y.punto)));
    if (!grupo) filas.push(el('tr', { class: 'grupo-av' }, [
      el('td', { colspan: '6', text: `${g} · ${lista.length} pendiente${lista.length === 1 ? '' : 's'}` })]));
    for (const a of lista) {
      const otro = esOtroAviso(a.categoria);
      // "Sin equipo instalado" + "Sin equipo instalado." no se repite dos veces.
      const repite = !otro && a.descripcion && a.categoria &&
        a.descripcion.trim().replace(/[.\s]+$/, '').toLowerCase() === a.categoria.toLowerCase();
      filas.push(el('tr', {}, [
        el('td', { class: 'num', text: '#' + a.id }),
        el('td', {}, [el('b', { text: a.punto }), a.tag ? el('br') : null, a.tag ? el('span', { class: 'tenue', text: a.tag }) : null]),
        el('td', {}, [
          otro ? null : el('b', { text: a.categoria || 'Aviso' }),
          otro || repite || !a.descripcion ? null : el('br'),
          repite ? null : el('span', { text: a.descripcion || (otro ? 'Sin descripción' : '') }),
          a.estado === 'en_gestion' ? el('span', { class: 'tenue', text: ' (en gestión)' }) : null
        ]),
        el('td', { text: a.severidad === 'alta' ? 'ALTA' : a.severidad }),
        el('td', { class: 'num', text: `${fechaCorta(a.abierto_en)}\n${diasAbierto(a)} d` }),
        el('td', { text: a.abierto_por_nombre || '—' })
      ]));
    }
  }

  const altas = avisos.filter(a => a.severidad === 'alta').length;
  const masViejo = Math.max(...avisos.map(diasAbierto));
  const titulo = grupo || 'Todos los grupos';
  const hoy = new Date();
  const hoja = el('div', { class: 'hoja hoja-informe hoja-avisos' }, [
    el('table', { class: 'cab-informe' }, [el('tbody', {}, [el('tr', {}, [
      el('td', {}, [
        el('h1', { text: 'Avisos pendientes · ' + titulo }),
        el('p', { text: `${avisos.length} sin resolver · ${altas} de severidad alta · ` +
          `${new Set(avisos.map(a => a.punto_id)).size} punto(s) · el más antiguo lleva ${masViejo} día(s) abierto` })
      ]),
      el('td', { class: 'num', html:
        `Algorta Norte<br>${esc(S.usuario.nombre)}<br>${fechaCorta(hoy.toISOString())}` })
    ])])]),
    el('table', { class: 'planilla' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { class: 'num', text: 'N.º' }), el('th', { text: 'Punto' }),
        el('th', { text: 'Aviso' }), el('th', { text: 'Sev.' }),
        el('th', { class: 'num', text: 'Abierto' }), el('th', { text: 'Reportó' })])]),
      el('tbody', {}, filas)
    ]),
    el('div', { class: 'pie-informe' }, [
      el('p', { text: 'Avisos sin resolver (abiertos o en gestión) a la fecha de emisión, ordenados por ' +
        'severidad y antigüedad. El N.º identifica el aviso en la app Cierre de Mes.' })
    ])
  ]);

  // El nombre del PDF lo toma el navegador del título de la página.
  const tituloPrevio = document.title;
  document.title = `Avisos pendientes - ${titulo} - ${hoy.toISOString().slice(0, 10)}`;
  const cont = document.getElementById('impresion');
  cont.replaceChildren(hoja);
  document.body.classList.add('imprimiendo');
  const limpiar = () => {
    document.body.classList.remove('imprimiendo');
    cont.replaceChildren();
    document.title = tituloPrevio;
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);
  setTimeout(() => window.print(), 120);
}

function verDetalleAviso(a, alGuardar) {
  const puedo = S.usuario.rol === 'admin' || S.usuario.rol === 'supervisor'
              || (a.abierto_por === S.usuario.id && a.estado !== 'resuelto');
  const sevClase = { alta: 'bad', media: 'warn', baja: 'neutro' }[a.severidad] || 'neutro';
  const estClase = a.estado === 'resuelto' ? 'ok' : 'warn';

  // Fotos sacadas junto con este aviso (hasta 3), en el orden en que se sacaron.
  const zonaFotosAviso = el('div', { class: 'fotos-aviso' });
  if (navigator.onLine) {
    (async () => {
      const { data } = await sb.from('fotos').select('id, storage_path, orden')
        .eq('aviso_id', a.id).order('orden');
      for (const f of (data || [])) {
        const { data: url } = await sb.storage.from(C.BUCKET).createSignedUrl(f.storage_path, 600);
        if (url?.signedUrl) zonaFotosAviso.append(el('img', { src: url.signedUrl, alt: `Foto ${f.orden} del aviso` }));
      }
    })().catch(() => {});
  }

  const contenido = el('div', {}, [
    el('div', { class: 'anterior', style: 'margin-bottom:12px' }, [
      el('span', { html: `<b>${esc(a.punto)}</b><br><small>${esc(esOtroAviso(a.categoria) ? 'Aviso general' : (a.categoria || 'Aviso'))}</small>` }),
      el('span', { html: `<span class="pill ${sevClase}">${esc(a.severidad)}</span> <span class="pill ${estClase}">${esc(a.estado)}</span>` })
    ]),
    el('p', { class: 'ayuda', text: `Abierto por ${a.abierto_por_nombre || '—'} el ${fechaHora(a.abierto_en)}` }),
    a.descripcion ? el('div', { class: 'card', style: 'margin:12px 0; padding:12px; font-size:14px; background:var(--ground)' }, [
      el('strong', { text: 'Descripción:' }),
      el('p', { style: 'margin:6px 0 0; white-space:pre-wrap', text: a.descripcion })
    ]) : el('p', { class: 'ayuda', text: 'Sin descripción detallada.' }),
    a.estado === 'resuelto' ? el('div', { class: 'card', style: 'margin:12px 0; padding:12px; font-size:14px; background:var(--ok-bg)' }, [
      el('strong', { text: `Resuelto por ${a.resuelto_por_nombre || '—'} · ${fechaHora(a.resuelto_en)}` }),
      a.obs_resolucion ? el('p', { style: 'margin:6px 0 0', text: a.obs_resolucion }) : null
    ]) : null,
    zonaFotosAviso,
    el('div', { class: 'fila', style: 'margin-top:16px; gap:8px; flex-wrap:wrap' }, [
      a.estado !== 'resuelto' ? el('button', { class: 'btn ok crece', text: 'Resolver aviso', onclick: () => { cerrarModal(); resolverAviso(a, alGuardar); } }) : null,
      puedo ? el('button', { class: 'btn chico', text: 'Editar', onclick: () => { cerrarModal(); editarAviso(a, alGuardar); } }) : null,
      puedo ? el('button', { class: 'btn chico peligro', text: 'Borrar', onclick: () => { cerrarModal(); borrarAviso(a, alGuardar); } }) : null
    ].filter(Boolean))
  ]);

  modal('Detalle del aviso', contenido);
}

function verDetalleObservacion(o) {
  const contenido = el('div', {}, [
    el('div', { class: 'anterior', style: 'margin-bottom:12px' }, [
      el('span', { html: `<b>${esc(o.punto)}</b><br><small>${esc(o.variable)}</small>` }),
      el('span', { html: `<b>${o.sin_dato ? 'Sin dato' : num(o.valor_display)}</b><br><small>${nombrePeriodo(o.periodo)}</small>` })
    ]),
    el('p', { class: 'ayuda', text: `Registrado por ${o.tomada_por_nombre || '—'} el ${fechaHora(o.fecha_lectura)}` }),
    o.observacion ? el('div', { class: 'card', style: 'margin:12px 0; padding:12px; font-size:14px; background:var(--ground)' }, [
      el('strong', { text: 'Observación:' }),
      el('p', { style: 'margin:6px 0 0; white-space:pre-wrap', text: o.observacion })
    ]) : null
  ]);

  modal('Observación de terreno', contenido);
}

// Lo que un jefe quiere ver de un vistazo: dónde se concentran y qué lleva
// abierto demasiado tiempo.
function informeAvisos(zona, avisos, grupo = '') {
  if (!avisos.length) return poner(zona, el('p', { class: 'vacio', text: 'No hay avisos con este filtro.' }));
  const abiertos = avisos.filter(a => a.estado !== 'resuelto');
  const dias = a => Math.floor((Date.now() - new Date(a.abierto_en)) / 86400e3);
  const viejos = abiertos.filter(a => dias(a) > 30).sort((x, y) => dias(y) - dias(x));

  const contar = (arr, clave) => {
    const m = new Map();
    for (const a of arr) m.set(a[clave] || '—', (m.get(a[clave] || '—') || 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  };
  const kpi = (n, t) => el('div', { class: 'kpi' }, [el('b', { text: String(n) }), el('span', { text: t })]);

  poner(zona,
    el('div', { class: 'kpis' }, [
      kpi(abiertos.length, 'avisos abiertos'),
      kpi(abiertos.filter(a => a.severidad === 'alta').length, 'de severidad alta'),
      kpi(viejos.length, 'abiertos hace más de 30 días'),
      kpi(new Set(abiertos.map(a => a.punto_id)).size, 'puntos afectados')
    ]),

    el('h3', { text: 'Por categoría', style: 'margin-top:22px' }),
    tabla(['Categoría', 'Abiertos', 'Total'],
      contar(abiertos, 'categoria').map(([k, n]) =>
        [k, String(n), String(avisos.filter(a => (a.categoria || '—') === k).length)])),

    el('h3', { text: 'Por grupo', style: 'margin-top:22px' }),
    // un aviso cuenta en cada grupo de su punto (un punto puede estar en varios)
    tabla(['Grupo', 'Abiertos'], contar(abiertos.flatMap(a =>
      (gruposDe(a).length ? gruposDe(a) : ['Sin grupo']).map(g => ({ g }))), 'g')
      .sort((x, y) => compararGrupos(x[0], y[0])).map(([k, n]) => [k, String(n)])),

    el('h3', { text: 'Puntos con más avisos abiertos', style: 'margin-top:22px' }),
    tabla(['Punto', 'Grupos', 'Abiertos'],
      contar(abiertos, 'punto').slice(0, 15).map(([k, n]) =>
        [k, gruposTexto(abiertos.find(a => a.punto === k)), String(n)])),

    viejos.length ? el('h3', { text: 'Los que llevan más tiempo abiertos', style: 'margin-top:22px' }) : null,
    viejos.length ? tabla(['Días', 'Punto', 'Categoría', 'Severidad', 'Descripción'],
      viejos.slice(0, 20).map(a => [
        String(dias(a)), a.punto, a.categoria || '—',
        el('span', { class: 'pill ' + ({ alta: 'bad', media: 'warn', baja: 'neutro' }[a.severidad] || 'neutro'),
                     text: a.severidad }),
        a.descripcion || '—'])) : null,

    // (El botón "Imprimir" de antes mandaba una hoja en blanco: imprimía #impresion vacío.)
    el('div', { class: 'fila', style: 'margin-top:20px' }, [
      el('button', { class: 'btn', text: '📄 PDF de avisos pendientes', onclick: () => pdfAvisosPendientes(grupo) })
    ]));
}

function editarAviso(a, alGuardar) {
  const sel = el('select');
  for (const cat of S.catalogo.catalogoAvisos)
    sel.append(el('option', { value: cat.id, selected: cat.id === a.categoria_id || null, text: cat.categoria }));
  const sev = el('select');
  for (const sv of ['baja', 'media', 'alta'])
    sev.append(el('option', { value: sv, selected: sv === a.severidad || null, text: sv }));
  const txt = el('textarea', { value: a.descripcion || '' });

  modal('Editar aviso', el('div', {}, [
    el('p', { class: 'ayuda', text: `${a.punto} · abierto ${fechaCorta(a.abierto_en)} por ${a.abierto_por_nombre || '—'}` }),
    el('label', { text: 'Categoría' }, [sel]),
    el('label', { text: 'Severidad' }, [sev]),
    el('label', { text: 'Descripción' }, [txt]),
    el('button', { class: 'btn guardar grande', style: 'margin-top:14px', text: 'Guardar',
      onclick: async e => {
        e.target.disabled = true;
        const { error } = await sb.rpc('editar_aviso', {
          p_id: a.id, p_categoria_id: Number(sel.value),
          p_descripcion: txt.value.trim() || null, p_severidad: sev.value
        });
        e.target.disabled = false;
        if (error) return toast(error.message, true);
        cerrarModal(); toast('Aviso actualizado'); alGuardar && alGuardar();
      } })
  ]));
}

async function borrarAviso(a, alGuardar) {
  if (!confirm(`Borrar el aviso "${a.categoria}" de ${a.punto}? No se puede deshacer.`)) return;
  const { error } = await sb.rpc('borrar_aviso', { p_id: a.id, p_motivo: 'borrado desde Avisos' });
  if (error) return toast(error.message, true);
  toast('Aviso borrado'); alGuardar && alGuardar();
}

function resolverAviso(a, alGuardar) {
  const obs = el('textarea', { placeholder: 'Qué se hizo para resolverlo' });
  modal('Resolver aviso', el('div', {}, [
    el('p', { class: 'ayuda', text: `${a.punto} · ${a.categoria || ''}` }),
    el('label', { text: 'Observación de la solución' }, [obs]),
    el('button', { class: 'btn primario grande', text: 'Marcar como resuelto', onclick: async () => {
      const { error } = await sb.from('avisos').update({
        estado: 'resuelto', resuelto_por: S.usuario.id,
        resuelto_en: new Date().toISOString(), obs_resolucion: obs.value.trim() || null
      }).eq('id', a.id);
      if (error) return toast(error.message, true);
      cerrarModal(); toast('Aviso resuelto');
      if (alGuardar) alGuardar(); else render();
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
      (!f || `${e.tag} ${e.marca} ${e.modelo} ${e.n_serie} ${e.punto_actual}`.toLowerCase().includes(f)));

    const filas = lista.map(e => [
      e.tag || el('span', { class: 'pill warn', text: 'sin TAG' }),
      e.marca || '—',
      e.modelo || '—',
      e.n_serie || el('span', { class: 'pill warn', text: 'falta' }),
      e.tipo || '—',
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
      tabla(['TAG', 'Marca', 'Modelo', 'Serie', 'Tipo', 'Instalado en', 'Estado', 'Cert.', ''],
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
    tipo:  el('select'),
    cert:  el('input', { type: 'checkbox', checked: eq?.certificado || null }),
    ncert: el('input', { value: eq?.n_certificado || '' }),
    vence: el('input', { type: 'date', value: eq?.vence_certificado || '' })
  };
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
    el('label', { text: 'Tipo de equipo' }, [f.tipo]),
    el('label', { class: 'fila' }, [f.cert, el('span', { text: 'Certificado' })]),
    el('label', { text: 'N° de certificado' }, [f.ncert]),
    el('label', { text: 'Vence el' }, [f.vence]),
    el('button', { class: 'btn guardar grande', style: 'margin-top:14px', text: 'Guardar', onclick: guardar })
  ]);

  // --- instalación y su historial ---
  if (!nuevo) {
    const zonaHist = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando historial…' })]);
    cuerpo.append(el('h3', { text: 'Dónde está instalado', style: 'margin-top:26px' }), zonaHist);

    const { data: hist } = await sb.from('asignaciones')
      .select('id, desde, hasta, motivo, punto:puntos(id, nombre)')
      .eq('equipo_id', eq.id).order('desde', { ascending: false });

    const selPunto = el('select');
    selPunto.append(el('option', { value: '', text: '— elegir punto —' }));
    const puntosOrdenados = [...new Map(S.catalogo.variables.map(v => [v.punto.id, v.punto])).values()]
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    for (const p of puntosOrdenados)
      selPunto.append(el('option', { value: p.id,
        text: p.nombre + (p.equipo?.tag ? ` (hoy: ${p.equipo.tag})` : ' (sin equipo)') }));
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
              a.punto?.nombre || '—',
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

  if (!nuevo && S.usuario.rol !== 'colaborador') cuerpo.append(
    el('button', { class: 'btn peligro', style: 'margin-top:18px', text: 'Eliminar este equipo',
      onclick: () => eliminarCosa({
        rpc: 'eliminar_equipo', id: { p_id: eq.id }, nombre: eq.tag || 'equipo', que: 'el equipo',
        desactivar: async () => (await sb.from('equipos').update({ activo: false, estado: 'baja' }).eq('id', eq.id)).error
      }) }));
  modal(nuevo ? 'Equipo nuevo' : (eq.tag || 'Equipo'), cuerpo);
}

/* ===================================================================
   CONFIGURACIÓN · PUNTOS DE MEDICIÓN
   =================================================================== */
// "Instalaciones" se unió a Puntos de medición: un enlace viejo cae en Puntos.
function vistaPuntosSiInstalaciones() { return S.vista === 'instalaciones' ? vistaPuntos : vistaTerreno; }

/* ===================================================================
   PUNTOS DE MEDICIÓN · lista compacta + ficha en página completa
   La lista muestra solo lo necesario para encontrar un punto; el resto vive
   en la ficha, que es una página y no un popup (en el teléfono el popup
   quedaba largo y apretado, y en el PC angosto).
   Los puntos dados de baja (activo = false) no se mezclan con los activos:
   antes salían como "sin lecturas" y parecían datos perdidos.
   =================================================================== */
function etiquetaLectura(v) {
  if (/exportada/i.test(v.nombre)) return 'kWh−';
  if (/importada/i.test(v.nombre)) return 'kWh+';
  if (/^horas/i.test(v.nombre)) return 'horas';
  return UNIDAD[v.unidad_reporte] || v.unidad_reporte;
}

async function vistaPuntos(c) {
  if (S.puntoAbierto) return fichaPunto(c, S.puntoAbierto);
  c.append(
    el('div', { class: 'fila entre puntos-cab' }, [
      el('p', { class: 'ayuda crece', text: 'El lugar donde se mide. La serie histórica cuelga del punto aunque se cambie el equipo.' }),
      el('button', { class: 'btn', text: '+ Punto nuevo', onclick: () => editarPunto(null) })
    ]),
    el('div', { class: 'buscador' }, [
      el('input', { type: 'search', placeholder: 'Buscar punto, grupo, tipo o TAG…', value: S.filtro || '',
        oninput: e => { S.filtro = e.target.value.toLowerCase(); pintar(); } })
    ])
  );
  const zonaChips = el('div', { class: 'filtros-terreno' });
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando puntos…' })]);
  c.append(zonaChips, zona);

  const [{ data, error }, { data: gp }] = await Promise.all([
    sb.from('v_puntos').select('*').order('nombre'),
    sb.from('v_grupos_punto').select('punto_id, grupos')
  ]);
  if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }
  const gruposPorPunto = Object.fromEntries((gp || []).map(x => [x.punto_id, x.grupos || []]));
  for (const p of data) p.grupos = gruposPorPunto[p.id] || [];
  const varsPorPunto = {};
  for (const v of (S.catalogo?.variables || [])) (varsPorPunto[v.punto.id] = varsPorPunto[v.punto.id] || []).push(v);

  const hoy = new Date().toISOString().slice(0, 10);
  const en60 = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
  const vencido = p => p.certificado && p.vence_certificado && p.vence_certificado < hoy;
  const porVencer = p => p.certificado && p.vence_certificado && p.vence_certificado >= hoy && p.vence_certificado <= en60;
  // [texto, condición, se muestra siempre]. Los demás chips aparecen solo si hay algo.
  const FILTROS = {
    activos:  ['Activos', p => p.activo, true],
    sin:      ['Sin equipo', p => p.activo && !p.equipo_id, true],
    singrupo: ['Sin grupo', p => p.activo && !p.grupos.length, true],
    cert:     ['Certificado vencido o por vencer', p => p.activo && (vencido(p) || porVencer(p))],
    sinlect:  ['Sin nada que leer', p => p.activo && !p.n_variables],
    baja:     ['Dados de baja', p => !p.activo, true]
  };
  if (!FILTROS[S.filtroPuntos]) S.filtroPuntos = 'activos';

  function fila(p) {
    const vs = (varsPorPunto[p.id] || []).slice().sort((a, b) => b.principal - a.principal);
    const grupos = gruposDe(p);
    const lee = vs.length ? [...new Set(vs.map(etiquetaLectura))].join(' · ')
      : p.n_variables ? `${p.n_variables} lecturas` : 'nada que leer';
    const der = [];
    if (!p.activo) der.push(el('span', { class: 'pill neutro', text: 'dado de baja' }));
    else if (p.tag) der.push(el('b', { class: 'tag', text: p.tag }));
    else der.push(el('span', { class: 'pill warn', text: 'sin equipo' }));
    if (p.activo && vencido(p)) der.push(el('span', { class: 'pill bad', text: 'cert. vencido' }));
    else if (p.activo && porVencer(p)) der.push(el('span', { class: 'pill warn', text: 'cert. por vencer' }));
    return el('button', { class: 'item punto-fila' + (p.activo ? '' : ' baja'), onclick: () => editarPunto(p) }, [
      el('span', { class: 'txt' }, [
        el('span', { class: 'n' }, [el('span', { class: 'n-nom', text: p.nombre })]),
        el('span', { class: 'd', text: [p.tipo, lee,
          grupos.length > 1 ? 'también en ' + grupos.slice(1).join(', ') : null].filter(Boolean).join(' · ') })
      ]),
      el('span', { class: 'der' }, der),
      el('span', { class: 'chev', text: '›', 'aria-hidden': 'true' })
    ]);
  }

  function pintar() {
    const f = S.filtro || '';
    poner(zonaChips, Object.entries(FILTROS)
      .filter(([k, [, fn, siempre]]) => siempre || k === S.filtroPuntos || data.some(fn))
      .map(([k, [txt, fn]]) => el('button', { class: 'chip-filtro' + (S.filtroPuntos === k ? ' sel' : ''),
        text: `${txt} · ${data.filter(fn).length}`, onclick: () => { S.filtroPuntos = k; pintar(); } })));
    const lista = data.filter(p => FILTROS[S.filtroPuntos][1](p) && (!f ||
      `${p.nombre} ${gruposTexto(p)} ${p.tipo || ''} ${p.tag || ''} ${p.marca || ''} ${p.n_serie || ''}`.toLowerCase().includes(f)));
    // Ordenados como el informe: por su primer grupo. Un punto en varios grupos sale una vez.
    const porGrupo = new Map();
    for (const p of lista) {
      const g = gruposDe(p)[0] || null;
      if (!porGrupo.has(g)) porGrupo.set(g, []);
      porGrupo.get(g).push(p);
    }
    const activos = data.filter(p => p.activo);
    poner(zona,
      el('p', { class: 'ayuda', text: S.filtroPuntos === 'baja'
        ? `${lista.length} puntos dados de baja. No se piden en terreno y su historia se conserva; se pueden reactivar desde su ficha.`
        : `${lista.length} de ${activos.length} puntos activos · ${activos.filter(p => !p.equipo_id).length} sin equipo instalado` }),
      lista.length
        ? [...porGrupo.keys()].sort(compararGrupos).flatMap(g => [
            el('h3', { class: 'grupo-sitio', text: `${g || 'Sin grupo'} · ${porGrupo.get(g).length}` }),
            el('div', { class: 'lista-puntos' },
              porGrupo.get(g).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(fila))
          ])
        : el('p', { class: 'vacio', text: f ? 'Ningún punto calza con la búsqueda.' : 'No hay puntos en este filtro.' })
    );
  }
  pintar();
  if (S.scrollPuntos != null) { window.scrollTo(0, S.scrollPuntos); S.scrollPuntos = null; }
}

/* ---------------- Lecturas de un punto, con preguntas simples ----------------
   En vez de "unidad del display / unidad de informe / formato / decimales", tres
   preguntas: qué se lee, cómo lo muestra el display y cuál va al informe.
   Una lectura que se desmarca no se borra (tiene historia): queda inactiva.
   Las lecturas que no calzan con un tipo estándar quedan en "Otras" y se editan
   con el formulario avanzado. */
const TIPOS_LECTURA = [
  { k: 'imp', etiqueta: 'Energía importada (kWh+)', nombre: 'Energía activa importada (kWh+)', reporte: 'kWh', energia: true,
    es: v => /importada/i.test(v.nombre) },
  { k: 'exp', etiqueta: 'Energía exportada (kWh-)', nombre: 'Energía activa exportada (kWh-)', reporte: 'kWh', energia: true,
    es: v => /exportada/i.test(v.nombre), opcionalPorDefecto: true },
  { k: 'gen', etiqueta: 'Energía generada (kWh)', nombre: 'Energía generada (kWh)', reporte: 'kWh', energia: true,
    es: v => /generada/i.test(v.nombre) },
  { k: 'hrs', etiqueta: 'Horas de marcha', nombre: 'Horas de marcha', reporte: 'Hrs', es: v => /^horas/i.test(v.nombre) },
  { k: 'kw', etiqueta: 'Potencia del momento (kW)', nombre: 'Potencia (kW)', reporte: 'kW',
    es: v => /^potencia/i.test(v.nombre), opcionalPorDefecto: true },
  { k: 'agua', etiqueta: 'Volumen de agua (m³)', nombre: 'Volumen', reporte: 'm3',
    es: v => v.nombre === 'Volumen' && v.unidad_reporte === 'm3' },
  { k: 'gas', etiqueta: 'Volumen de gas (m³)', nombre: 'Volumen gas', reporte: 'm3', es: v => /^volumen gas$/i.test(v.nombre) },
  { k: 'lt', etiqueta: 'Litros (L)', nombre: 'Volumen', reporte: 'L',
    es: v => v.nombre === 'Volumen' && v.unidad_reporte === 'L' }
];
const DISPLAY_ENERGIA = [['kWh', 'kWh'], ['MWh', 'MWh'], ['doble', 'MWh y kWh (dos campos)']];
const displayDe = v => v.formato_lectura === 'doble_mwh_kwh' ? 'doble' : (v.unidad_display === 'MWh' ? 'MWh' : 'kWh');
const displayA = d => d === 'doble' ? { unidad_display: 'MWh', formato_lectura: 'doble_mwh_kwh' }
                    : { unidad_display: d, formato_lectura: 'simple' };

function armarConfigLecturas(existentes, punto) {
  existentes = existentes || [];
  const usadas = new Set();
  const filas = TIPOS_LECTURA.map(t => {
    // Preferir la activa si hay varias que calzan.
    const cand = existentes.filter(v => !usadas.has(v.id) && t.es(v)).sort((a, b) => b.activo - a.activo);
    const ex = cand[0] || null;
    if (ex) usadas.add(ex.id);
    return {
      t, ex,
      quiere: !!(ex && ex.activo),
      display: ex ? displayDe(ex) : 'kWh',
      informe: ex ? !!ex.en_informe : !t.opcionalPorDefecto,
      opcional: ex ? !!ex.opcional : !!t.opcionalPorDefecto
    };
  });
  const otras = existentes.filter(v => !usadas.has(v.id));
  const nuevo = !existentes.length;
  // Punto nuevo: lo más común es un medidor de energía con importada.
  if (nuevo) { filas[0].quiere = true; filas[0].informe = true; }

  const zona = el('div', { class: 'config-lecturas' });
  function pintar() {
    poner(zona,
      el('p', { class: 'ayuda', text: 'Marca lo que se lee en este punto y, de eso, lo que va al informe (puede ser más de una: por ejemplo kWh+ y horas en un variador). El informe queda en kWh, m³, L u horas: si el display muestra MWh, la app convierte sola.' }),
      ...filas.map(r => {
        const chk = el('input', { type: 'checkbox', checked: r.quiere || null,
          onchange: e => { r.quiere = e.target.checked; pintar(); } });
        const extra = [];
        if (r.quiere && r.t.energia) {
          const sel = el('select', { onchange: e => { r.display = e.target.value; } });
          for (const [v, txt] of DISPLAY_ENERGIA) sel.append(el('option', { value: v, selected: r.display === v || null, text: txt }));
          extra.push(el('label', { class: 'mini', text: 'El display muestra' }, [sel]));
        }
        if (r.quiere) extra.push(el('label', { class: 'fila mini' }, [
          el('input', { type: 'checkbox', checked: r.informe || null, onchange: e => { r.informe = e.target.checked; } }),
          el('span', { text: 'Va al informe' })]));
        if (r.quiere) extra.push(el('label', { class: 'fila mini' }, [
          el('input', { type: 'checkbox', checked: r.opcional || null, onchange: e => { r.opcional = e.target.checked; } }),
          el('span', { text: 'Opcional', title: 'No cuenta como pendiente del mes' })]));
        return el('div', { class: 'tipo-lectura' + (r.quiere ? ' sel' : '') }, [
          el('label', { class: 'fila' }, [chk, el('b', { text: r.t.etiqueta }),
            r.ex && !r.ex.activo ? el('small', { class: 'tenue-b', text: ' (estaba desactivada)' }) : null]),
          extra.length ? el('div', { class: 'tipo-extra' }, extra) : null
        ]);
      }),
      (otras.length || punto) ? el('details', { class: 'plegable', open: otras.length ? '' : null }, [
        el('summary', { text: `Otras lecturas (avanzado)${otras.length ? ' · ' + otras.length : ''}` }),
        otras.length ? tabla(['Lectura', 'Display', 'Informe', ''], otras.map(x => [
          x.nombre + (x.activo ? '' : ' (inactiva)'),
          UNIDAD[x.unidad_display] || x.unidad_display, UNIDAD[x.unidad_reporte] || x.unidad_reporte,
          punto ? el('button', { class: 'btn chico', text: 'Editar',
            onclick: () => editarVariable(x, punto, () => editarPunto(punto)) }) : ''
        ])) : el('p', { class: 'ayuda', text: 'Para algo que no está en la lista (otra unidad, otro nombre).' }),
        punto ? el('button', { class: 'btn chico', style: 'margin-top:8px', text: '+ Otra lectura',
          onclick: () => editarVariable(null, punto, () => editarPunto(punto)) }) : null
      ]) : null
    );
  }
  pintar();

  return {
    nodo: zona,
    hayAlguna: () => filas.some(r => r.quiere) || otras.some(v => v.activo),
    // "Va al informe" (en_informe) lo decide la persona y puede haber varias.
    // "Principal" es interno: una por unidad, la que se muestra en la lista de terreno
    // y a la que se cuelgan fotos y avisos. Se calcula sola: la primera que va al
    // informe en cada unidad (importada antes que exportada).
    // Se aplica en un orden que respeta "una principal por unidad": primero lo que se
    // apaga o deja de ser principal, después el resto.
    async aplicar(puntoId) {
      const ops = [];
      const principalPorUnidad = {};
      for (const v of otras) if (v.activo && v.principal) principalPorUnidad[v.unidad_reporte] = true;
      for (const pasada of [true, false]) {
        for (const r of filas) {
          if (!r.quiere || r.principalFinal !== undefined && r.principalFinal) continue;
          if (pasada && !r.informe) continue;
          r.principalFinal = !principalPorUnidad[r.t.reporte];
          if (r.principalFinal) principalPorUnidad[r.t.reporte] = true;
        }
      }
      for (const r of filas) {
        const d = r.t.energia ? displayA(r.display) : { unidad_display: r.t.reporte, formato_lectura: 'simple' };
        if (!r.quiere) {
          if (r.ex && r.ex.activo) ops.push({ orden: 0, args: { ...base(r.ex), p_principal: false, p_activo: false }, informe: false });
          continue;
        }
        const args = {
          p_id: r.ex ? r.ex.id : null, p_punto_id: puntoId,
          p_nombre: r.ex ? r.ex.nombre : r.t.nombre,
          p_unidad_display: d.unidad_display, p_unidad_reporte: r.t.reporte,
          p_decimales: r.ex ? (r.ex.decimales_display ?? 0) : 0, p_formato: d.formato_lectura,
          p_principal: r.principalFinal, p_activo: true, p_opcional: r.opcional
        };
        if (r.ex) {
          const igual = r.ex.activo && r.ex.unidad_display === d.unidad_display && r.ex.formato_lectura === d.formato_lectura &&
            !!r.ex.principal === r.principalFinal && !!r.ex.opcional === r.opcional;
          if (igual) {
            if (!!r.ex.en_informe !== r.informe) ops.push({ orden: 4, soloInforme: r.ex.id, informe: r.informe });
            continue;
          }
          ops.push({ orden: r.principalFinal ? 2 : 1, args, informe: r.informe });
        } else ops.push({ orden: 3, args, informe: r.informe });
      }
      for (const o of ops.sort((a, b) => a.orden - b.orden)) {
        let id = o.soloInforme;
        if (!id) {
          const { data, error } = await sb.rpc('guardar_variable', o.args);
          if (error) throw new Error(/variables_una_principal_por_unidad/.test(error.message)
            ? 'Hay dos lecturas principales en la misma unidad: revisa las "Otras lecturas" de este punto.' : error.message);
          id = data || o.args.p_id;
        }
        if (id) {
          const { error: e2 } = await sb.from('variables').update({ en_informe: o.informe }).eq('id', id);
          if (e2) throw e2;
        }
      }
      return ops.length;
      function base(v) {
        return { p_id: v.id, p_punto_id: puntoId, p_nombre: v.nombre, p_unidad_display: v.unidad_display,
                 p_unidad_reporte: v.unidad_reporte, p_decimales: v.decimales_display ?? 0,
                 p_formato: v.formato_lectura, p_opcional: v.opcional };
      }
    }
  };
}

/* ---------------- Ficha del punto (página, no popup) ----------------
   Orden: equipo instalado (lo que más se toca en terreno), datos del punto,
   grupos y qué se lee; al final, dar de baja o eliminar. En el PC va en dos
   columnas: configuración a la izquierda, equipo a la derecha.
   Los datos, grupos y lecturas se guardan con la barra de abajo; el equipo
   tiene sus propios botones porque cada cambio queda en el historial.
   Se lee la fila completa de `puntos`: v_puntos no trae la instrucción de lectura,
   y guardar desde ahí la borraba sin aviso. */
function editarPunto(puntoLista) {
  S.vista = 'puntos';
  if (!S.puntoAbierto) {
    S.scrollPuntos = window.scrollY;
    // El botón "atrás" del teléfono o del navegador vuelve a la lista, no sale de la app.
    try { history.pushState({ fichaPunto: true }, ''); S.puntoEnHistorial = true; } catch (_) {}
  }
  S.puntoAbierto = puntoLista || { nuevo: true };
  S.fichaSucia = false;
  if (!$('#modal').hidden) cerrarModal();
  render();
  window.scrollTo(0, 0);
}
function cerrarFicha(forzar) {
  if (!forzar && S.fichaSucia && !confirm('Hay cambios sin guardar en este punto. ¿Salir igual?')) return;
  S.puntoAbierto = null; S.fichaSucia = false;
  if (S.puntoEnHistorial) { S.puntoEnHistorial = false; try { history.back(); } catch (_) {} }
  render();
}
window.addEventListener('popstate', () => {
  if (!S.puntoAbierto) return;
  if (S.fichaSucia && !confirm('Hay cambios sin guardar en este punto. ¿Salir igual?')) {
    try { history.pushState({ fichaPunto: true }, ''); } catch (_) {}
    return;
  }
  S.puntoEnHistorial = false;
  cerrarFicha(true);
});

async function fichaPunto(c, puntoLista) {
  const nuevo = !!puntoLista.nuevo;
  c.append(el('p', { class: 'cargando', text: nuevo ? 'Preparando…' : 'Cargando el punto…' }));
  const [{ data: fila }, { data: vp }, { data: tiposDb }, { data: misGrupos }, { data: vars }] = await Promise.all([
    nuevo ? Promise.resolve({ data: null }) : sb.from('puntos').select('*').eq('id', puntoLista.id).maybeSingle(),
    nuevo ? Promise.resolve({ data: null }) : sb.from('v_puntos').select('*').eq('id', puntoLista.id).maybeSingle(),
    sb.from('tipos_equipo').select('id, nombre').order('nombre'),
    nuevo ? Promise.resolve({ data: [] }) : sb.from('grupo_puntos').select('grupo_id').eq('punto_id', puntoLista.id),
    nuevo ? Promise.resolve({ data: [] }) : sb.from('variables')
      .select('id, nombre, unidad_display, unidad_reporte, decimales_display, formato_lectura, principal, activo, opcional, en_informe')
      .eq('punto_id', puntoLista.id).order('id')
  ]);
  if (!c.isConnected) return;
  const volver = el('button', { class: 'btn chico volver', text: '‹ Puntos', onclick: () => cerrarFicha() });
  if (!nuevo && !fila) {
    poner(c, el('div', { class: 'ficha-cab' }, [volver]),
      el('p', { class: 'error', text: 'No se encontró el punto, o tu cuenta no tiene acceso a él.' }));
    return;
  }
  const punto = nuevo ? null : { ...puntoLista, ...(vp || {}), ...fila };
  const cfgLecturas = armarConfigLecturas(vars || [], punto);

  const f = {
    nombre: el('input', { value: punto?.nombre || '', placeholder: 'Ej.: Agua Mar 1' }),
    tipo:   el('select'),
    foto:   el('input', { type: 'checkbox', checked: punto?.foto_obligatoria || null }),
    calidad: el('select'),
    instruccion: el('textarea', { rows: 2, value: punto?.instruccion_lectura || '',
      placeholder: 'Horas de marcha: menú 730 · Energía: menú 732' })
  };
  const tipos = (tiposDb && tiposDb.length) ? tiposDb
    : [...new Map(S.catalogo.variables.map(v => [v.punto.tipo.id, v.punto.tipo])).values()];
  for (const t of tipos)
    f.tipo.append(el('option', { value: t.id, selected: punto?.tipo_equipo_id == t.id || null, text: t.nombre }));
  for (const [v_, t] of [['normal', 'Normal · ~300 KB'], ['alta', 'Alta · ~500 KB']])
    f.calidad.append(el('option', { value: v_, selected: (punto?.foto_calidad || 'normal') === v_ || null, text: t }));

  // Grupos de reporte: también al crear. Un punto puede estar en varios.
  const enGrupo = new Set((misGrupos || []).map(x => x.grupo_id));
  const zonaGrupos = el('div', { class: 'grupos-check' });
  for (const g of [...S.catalogo.grupos].sort((a, b) => compararGrupos(a.nombre, b.nombre))) {
    const chk = el('input', { type: 'checkbox', checked: enGrupo.has(g.id) || null,
      onchange: e => { e.target.checked ? enGrupo.add(g.id) : enGrupo.delete(g.id); } });
    zonaGrupos.append(el('label', { class: 'fila' }, [chk, el('span', { text: g.nombre })]));
  }
  const nombresGrupos = () => [...S.catalogo.grupos].filter(g => enGrupo.has(g.id))
    .sort((a, b) => compararGrupos(a.nombre, b.nombre)).map(g => g.nombre);

  const tarjeta = (clase, titulo, ayuda, ...hijos) => el('section', { class: 'ficha-card ' + clase },
    [el('h3', { text: titulo }), ayuda ? el('p', { class: 'ayuda intro', text: ayuda }) : null, ...hijos.flat()]);

  const colCfg = el('div', { class: 'ficha-cfg' }, [
    tarjeta('', 'Datos del punto', null,
      el('div', { class: 'par' }, [
        el('label', { text: 'Nombre del punto' }, [f.nombre]),
        el('label', { text: 'Tipo de equipo que va acá' }, [f.tipo])
      ]),
      el('label', { text: 'Cómo se toma la lectura (opcional)' }, [f.instruccion,
        el('span', { class: 'ayuda', text: 'Aparece arriba al abrir el punto en terreno: de qué menú sale cada valor.' })]),
      el('div', { class: 'par' }, [
        el('label', { class: 'fila', style: 'align-self:center' }, [f.foto, el('span', { text: 'La foto es obligatoria' })]),
        el('label', { text: 'Calidad de la foto' }, [f.calidad])
      ]),
      el('p', { class: 'ayuda', style: 'margin-top:-6px', text: 'Normal alcanza para leer un display. Alta: solo para puntos de facturación o del reporte de la Ley 21.305.' })
    ),
    tarjeta('', 'Grupos de reporte', 'El punto sale en el informe de cada grupo que marques. Puede estar en varios.', zonaGrupos),
    tarjeta('', 'Qué se lee en este punto', null, cfgLecturas.nodo)
  ]);

  const estado = el('span', { class: 'estado', text: nuevo ? '' : 'Sin cambios' });
  const btnGuardar = el('button', { class: 'btn guardar', text: nuevo ? 'Crear el punto' : 'Guardar cambios', onclick: guardar });
  const barra = el('div', { class: 'ficha-barra' }, [estado,
    el('button', { class: 'btn', text: nuevo ? 'Cancelar' : 'Volver', onclick: () => cerrarFicha() }), btnGuardar]);
  const marcarSucio = () => {
    if (S.fichaSucia) return;
    S.fichaSucia = true; barra.classList.add('sucia'); estado.textContent = 'Cambios sin guardar';
  };
  colCfg.addEventListener('input', marcarSucio);
  colCfg.addEventListener('change', marcarSucio);

  async function guardarGrupos(idPunto) {
    const del = await sb.from('grupo_puntos').delete().eq('punto_id', idPunto);
    if (del.error) throw del.error;
    if (enGrupo.size) {
      const ins = await sb.from('grupo_puntos')
        .insert([...enGrupo].map(grupo_id => ({ grupo_id, punto_id: idPunto })));
      if (ins.error) throw ins.error;
    }
  }

  async function guardar() {
    const datos = {
      nombre: f.nombre.value.trim(),
      tipo_equipo_id: Number(f.tipo.value),
      foto_obligatoria: f.foto.checked,
      foto_calidad: f.calidad.value,
      instruccion_lectura: f.instruccion.value.trim() || null
    };
    if (!datos.nombre) return toast('El punto necesita un nombre', true);
    if (punto?.activo !== false && !cfgLecturas.hayAlguna())
      return toast('Marca al menos una lectura: sin lecturas el punto no aparece en terreno', true);
    if (!enGrupo.size && !confirm('El punto no está en ningún grupo: no va a salir en los informes por grupo. ¿Guardar igual?')) return;
    btnGuardar.disabled = true;
    try {
      const r = nuevo
        ? await sb.from('puntos').insert(datos).select('id').single()
        : await sb.from('puntos').update(datos).eq('id', punto.id);
      if (r.error) throw r.error;
      const idPunto = nuevo ? r.data.id : punto.id;
      await guardarGrupos(idPunto);
      await cfgLecturas.aplicar(idPunto);
      S.catalogo = await DB.descargarCatalogo();
      S.fichaSucia = false;
      const { data: fresco } = await sb.from('v_puntos').select('*').eq('id', idPunto).maybeSingle();
      toast(nuevo ? 'Punto creado. Si ya tiene medidor, instálalo en "Equipo instalado".' : 'Guardado');
      editarPunto(fresco || { id: idPunto, nombre: datos.nombre });
    } catch (err) {
      toast(err.message || String(err), true);
    } finally { btnGuardar.disabled = false; }
  }

  const cab = el('div', { class: 'ficha-cab' }, [
    volver,
    el('div', { class: 'ficha-tit' }, [
      el('h2', { text: nuevo ? 'Punto nuevo' : punto.nombre }),
      nuevo ? null : el('p', { class: 'ayuda', text:
        [punto.tipo, nombresGrupos().join(' · ') || 'sin grupo'].filter(Boolean).join(' · ') })
    ])
  ]);

  let colEq = null, colZona = null, avisoBaja = null;
  if (!nuevo) {
    const zonaEq = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando…' })]);
    colEq = tarjeta('ficha-eq', 'Equipo instalado', null, zonaEq);
    pintarEquipoDelPunto(punto, zonaEq);

    const darDeBaja = async () => {
      if (!confirm(`¿Dar de baja "${punto.nombre}"?\n\nDeja de pedirse en terreno y sale de la lista de activos. Su historia se conserva y se puede reactivar.`)) return;
      // Se apagan también sus lecturas: si no, el punto seguiría saliendo pendiente en terreno.
      const e1 = (await sb.from('variables').update({ activo: false }).eq('punto_id', punto.id).eq('activo', true)).error;
      const e2 = e1 || (await sb.from('puntos').update({ activo: false }).eq('id', punto.id)).error;
      if (e2) return toast(e2.message, true);
      S.catalogo = await DB.descargarCatalogo().catch(() => S.catalogo);
      toast('Punto dado de baja');
      cerrarFicha(true);
    };
    const reactivar = async () => {
      const { error } = await sb.from('puntos').update({ activo: true }).eq('id', punto.id);
      if (error) return toast(error.message, true);
      S.catalogo = await DB.descargarCatalogo().catch(() => S.catalogo);
      toast('Punto reactivado. Revisa qué se lee en él y guarda.');
      editarPunto({ ...punto, activo: true });
    };
    if (punto.activo === false) avisoBaja = el('div', { class: 'banda warn ficha-baja' }, [
      el('span', { text: 'Este punto está dado de baja: no se pide en terreno ni sale en la lista de activos. Su historia se conserva.' }),
      S.usuario.rol !== 'colaborador' ? el('button', { class: 'btn chico', text: 'Reactivar', onclick: reactivar }) : null
    ]);
    if (S.usuario.rol !== 'colaborador') colZona = tarjeta('ficha-zona', 'Dar de baja o eliminar',
      'Dar de baja lo saca de terreno y de los activos, pero conserva su historia. Eliminar solo funciona si el punto nunca tuvo lecturas.',
      el('div', { class: 'fila' }, [
        punto.activo === false
          ? el('button', { class: 'btn', text: 'Reactivar el punto', onclick: reactivar })
          : el('button', { class: 'btn', text: 'Dar de baja el punto', onclick: darDeBaja }),
        el('button', { class: 'btn peligro', text: 'Eliminar', onclick: () => eliminarCosa({
          rpc: 'eliminar_punto', id: { p_id: punto.id }, nombre: punto.nombre, que: 'el punto',
          alTerminar: () => cerrarFicha(true),
          desactivar: async () => {
            const e1 = (await sb.from('variables').update({ activo: false }).eq('punto_id', punto.id).eq('activo', true)).error;
            return e1 || (await sb.from('puntos').update({ activo: false }).eq('id', punto.id)).error;
          } }) })
      ]));
  }

  poner(c, cab, avisoBaja,
    el('div', { class: 'ficha-grid' + (nuevo ? ' nuevo' : '') }, [colEq, colCfg, colZona].filter(Boolean)),
    barra);
}

/* El cruce punto ↔ equipo, en un solo lugar. Tres acciones visibles:
   reemplazar (el anterior vuelve a bodega), instalar si no hay, y retirar SIN
   reemplazo eligiendo a dónde va el equipo: bodega, reparación o baja. Antes el
   retiro estaba escondido dentro de "Cambiar" y solo mandaba a bodega. */
async function pintarEquipoDelPunto(punto, zona, alCambiar) {
  const [{ data: hist }, { data: libres }, { data: actual }, { data: varsPunto }] = await Promise.all([
    sb.from('asignaciones').select('id, desde, hasta, motivo, equipo:equipos(id, tag, marca, modelo, n_serie)')
      .eq('punto_id', punto.id).order('desde', { ascending: false }),
    sb.from('v_equipos').select('id, tag, marca, modelo, tipo, tipo_equipo_id, estado')
      .is('punto_actual_id', null).eq('activo', true).order('tag'),
    sb.from('v_puntos').select('equipo_id, tag, marca, modelo, n_serie, certificado, vence_certificado, equipo_desde, tipo_equipo_id')
      .eq('id', punto.id).maybeSingle(),
    sb.from('variables').select('id, nombre, unidad_display, unidad_reporte, decimales_display, formato_lectura, principal, activo, opcional, en_informe')
      .eq('punto_id', punto.id).eq('activo', true)
  ]);
  if (!zona.isConnected) return;
  // La unidad del display es del MEDIDOR: si el nuevo muestra MWh y el viejo kWh y
  // nadie lo cambia, la lectura siguiente sale mil veces más chica y el consumo, absurdo.
  const energia = (varsPunto || []).filter(v => v.unidad_reporte === 'kWh');
  const displayActual = energia.length ? displayDe(energia[0]) : null;
  const selDisplay = el('select');
  for (const [v, txt] of DISPLAY_ENERGIA) selDisplay.append(el('option', { value: v, selected: displayActual === v || null, text: txt }));
  async function ajustarDisplay() {
    if (!energia.length || selDisplay.value === displayActual) return false;
    const d = displayA(selDisplay.value);
    for (const v of energia) {
      const { error } = await sb.rpc('guardar_variable', {
        p_id: v.id, p_punto_id: punto.id, p_nombre: v.nombre, p_unidad_display: d.unidad_display,
        p_unidad_reporte: v.unidad_reporte, p_decimales: v.decimales_display ?? 0, p_formato: d.formato_lectura,
        p_principal: v.principal, p_activo: true, p_opcional: v.opcional });
      if (error) throw error;
    }
    return true;
  }
  const a = actual || {};
  const despues = async (msg) => {
    toast(msg);
    S.catalogo = await DB.descargarCatalogo().catch(() => S.catalogo);
    pintarEquipoDelPunto(punto, zona, alCambiar);
    alCambiar && alCambiar();
  };
  // Fecha local: toISOString() da la de UTC y después de las 21:00 en Chile ya es mañana.
  const _h = new Date();
  const hoyISO = `${_h.getFullYear()}-${String(_h.getMonth() + 1).padStart(2, '0')}-${String(_h.getDate()).padStart(2, '0')}`;

  // Equipos libres: los del mismo tipo primero. Los que están en reparación no se ofrecen.
  const libresOrd = (libres || []).filter(e => e.estado !== 'en_reparacion').sort((x, y) =>
    (y.tipo_equipo_id === a.tipo_equipo_id) - (x.tipo_equipo_id === a.tipo_equipo_id) ||
    String(x.tag || '').localeCompare(String(y.tag || '')));
  const selEquipo = el('select');
  selEquipo.append(el('option', { value: '', text: '— elegir equipo en bodega —' }));
  for (const e of libresOrd)
    selEquipo.append(el('option', { value: e.id,
      text: [e.tag || 'sin TAG', e.marca, e.modelo, e.tipo].filter(Boolean).join(' · ') }));
  const fechaC = el('input', { type: 'date', value: hoyISO });
  const motivoC = el('input', { placeholder: a.equipo_id ? 'Ej.: reemplazo por daño del display' : 'Ej.: instalación inicial' });

  const panelCambiar = el('div', { class: 'panel-equipo', hidden: '' }, libresOrd.length ? [
    el('label', { text: a.equipo_id ? 'Reemplazar por' : 'Equipo a instalar' }, [selEquipo]),
    el('div', { class: 'par' }, [
      el('label', { text: 'Fecha' }, [fechaC]),
      el('label', { text: 'Motivo' }, [motivoC])
    ]),
    energia.length ? el('label', { text: '¿Cómo muestra la energía el equipo nuevo?' }, [selDisplay]) : null,
    a.equipo_id ? el('p', { class: 'ayuda', text: `${a.tag || 'El equipo actual'} vuelve a bodega. Si está dañado, mejor usa "Retirar sin reemplazo" y elige "Se da de baja".` }) : null,
    el('button', { class: 'btn guardar', text: a.equipo_id ? 'Reemplazar' : 'Instalar', onclick: async ev => {
      if (!selEquipo.value) return toast('Elige un equipo', true);
      ev.target.disabled = true;
      const r = await sb.rpc('asignar_equipo', {
        p_equipo_id: Number(selEquipo.value), p_punto_id: punto.id,
        p_desde: fechaC.value, p_motivo: motivoC.value.trim() || null });
      ev.target.disabled = false;
      if (r.error) return toast(r.error.message, true);
      let cambio = false;
      try { cambio = await ajustarDisplay(); }
      catch (err) { return toast('El equipo quedó instalado, pero no se pudo cambiar la unidad: ' + err.message, true); }
      despues((a.equipo_id ? 'Equipo reemplazado; el anterior quedó en bodega' : 'Equipo instalado') +
              (cambio ? ' · las lecturas ahora se toman en ' + DISPLAY_ENERGIA.find(x => x[0] === selDisplay.value)[1] : ''));
    } })
  ] : [
    el('p', { class: 'banda warn', text: 'No hay equipos libres en bodega.' }),
    el('p', { class: 'ayuda', text: 'Para instalar uno, primero dalo de alta en Configuración → Equipos (o retíralo del punto donde está). ' +
      (a.equipo_id ? 'Si este equipo hay que sacarlo igual, usa "Retirar sin reemplazo".' : '') })
  ]);

  const fechaR = el('input', { type: 'date', value: hoyISO });
  const motivoR = el('input', { placeholder: 'Ej.: display quemado, se llevó a revisión…' });
  const nombreRadio = 'destino-' + punto.id;
  const destinos = [
    ['bodega', 'Vuelve a bodega', 'Queda libre para instalarlo en otro punto.'],
    ['en_reparacion', 'Va a reparación', 'No se ofrece para instalar hasta que vuelva.'],
    ['baja', 'Se da de baja', 'Dañado, perdido o descartado. No se usa más.']
  ];
  const panelRetirar = el('div', { class: 'panel-equipo', hidden: '' }, [
    el('p', { class: 'ayuda', style: 'margin:0 0 10px', text: '¿Qué pasa con el equipo?' }),
    el('div', { class: 'destinos' }, destinos.map(([v, t, d], i) => el('label', { class: 'fila opcion' }, [
      el('input', { type: 'radio', name: nombreRadio, value: v, checked: i === 0 || null }),
      el('span', {}, [el('b', { text: t }), el('small', { text: d })])
    ]))),
    el('div', { class: 'par' }, [
      el('label', { text: 'Fecha del retiro' }, [fechaR]),
      el('label', { text: 'Motivo (obligatorio)' }, [motivoR])
    ]),
    el('p', { class: 'ayuda', text: 'El punto queda sin equipo y se sigue pidiendo en terreno. Mientras no tenga, márcalo como "No se pudo leer" en la toma del mes.' }),
    el('button', { class: 'btn cancelar', text: 'Retirar ' + (a.tag || 'el equipo'), onclick: async ev => {
      const est = zona.querySelector(`input[name="${nombreRadio}"]:checked`)?.value || 'bodega';
      if (!motivoR.value.trim()) return toast('Escribe el motivo del retiro', true);
      const txt = { bodega: 'y devolverlo a bodega', en_reparacion: 'y mandarlo a reparación', baja: 'y DARLO DE BAJA' }[est];
      if (!confirm(`¿Retirar ${a.tag || 'el equipo'} de "${punto.nombre}" ${txt}?\n\nEl punto queda sin equipo.`)) return;
      ev.target.disabled = true;
      const r = await sb.rpc('retirar_equipo', {
        p_equipo_id: a.equipo_id, p_hasta: fechaR.value, p_estado: est, p_motivo: motivoR.value.trim() });
      ev.target.disabled = false;
      if (r.error) return toast(r.error.message, true);
      despues({ bodega: 'Equipo retirado a bodega', en_reparacion: 'Equipo retirado a reparación', baja: 'Equipo retirado y dado de baja' }[est]);
    } })
  ]);

  const botones = [];
  const alternar = (panel, boton) => {
    const abrir = panel.hidden;
    panelCambiar.hidden = true; panelRetirar.hidden = true;
    botones.forEach(b => b.classList.remove('sel'));
    if (abrir) { panel.hidden = false; boton.classList.add('sel'); }
  };
  const bCambiar = el('button', { class: 'btn', text: a.equipo_id ? 'Reemplazar' : 'Instalar un equipo',
    onclick: () => alternar(panelCambiar, bCambiar) });
  botones.push(bCambiar);
  if (a.equipo_id) {
    const bRetirar = el('button', { class: 'btn', text: 'Retirar sin reemplazo', onclick: () => alternar(panelRetirar, bRetirar) });
    botones.push(bRetirar);
  }
  const vencido = a.certificado && a.vence_certificado && a.vence_certificado < hoyISO;

  poner(zona,
    a.equipo_id
      ? el('div', { class: 'equipo-actual' }, [
          el('div', {}, [
            el('b', { text: a.tag || 'sin TAG' }),
            el('small', { text: [a.marca, a.modelo, a.n_serie ? 'serie ' + a.n_serie : null].filter(Boolean).join(' · ') || '—' })
          ]),
          el('div', { class: 'der' }, [
            el('small', { text: 'instalado desde' }), el('b', { text: fechaCorta(a.equipo_desde) }),
            a.certificado ? el('span', { class: 'pill ' + (vencido ? 'bad' : 'ok'),
              text: vencido ? 'certificado vencido' : 'certificado al ' + fechaCorta(a.vence_certificado) }) : null
          ])
        ])
      : el('p', { class: 'banda warn', style: 'margin-top:0', text: 'Este punto no tiene equipo instalado.' }),
    el('div', { class: 'fila acciones-equipo' }, botones),
    panelCambiar,
    a.equipo_id ? panelRetirar : null,
    (hist && hist.length) ? el('details', { class: 'plegable historial-eq' }, [
      el('summary', { text: `Historial de equipos en este punto · ${hist.length}` }),
      el('ul', { class: 'lista-hist' }, hist.map(h => el('li', {}, [
        el('div', { class: 'fila entre' }, [
          el('b', { text: [h.equipo?.tag || 'sin TAG', h.equipo?.marca].filter(Boolean).join(' · ') }),
          h.hasta ? el('small', { text: `${fechaCorta(h.desde)} → ${fechaCorta(h.hasta)}` })
                  : el('span', { class: 'pill ok', text: 'instalado desde ' + fechaCorta(h.desde) })
        ]),
        h.motivo ? el('small', { class: 'tenue-b', text: h.motivo.replace(/^ · /, '') }) : null
      ])))
    ]) : null
  );
}

// Un medidor puede mostrar MWh y el informe necesita kWh: eso se declara acá,
// una vez, y el cálculo convierte solo.
const UNIDADES = ['kWh', 'MWh', 'm3', 'L', 'Hrs'];
function editarVariable(x, punto, alGuardar) {
  const nuevo = !x;
  const f = {
    nombre: el('input', { value: x?.nombre || '', placeholder: 'Energía activa exportada (kWh-)' }),
    display: el('select'), reporte: el('select'),
    dec: el('input', { type: 'number', min: '0', max: '3', value: String(x?.decimales_display ?? 0) }),
    formato: el('select'),
    principal: el('input', { type: 'checkbox', checked: (x ? x.principal : true) || null }),
    informe: el('input', { type: 'checkbox', checked: (x ? x.en_informe : true) || null }),
    opcional: el('input', { type: 'checkbox', checked: (x ? x.opcional : false) || null }),
    activo: el('input', { type: 'checkbox', checked: (x ? x.activo : true) || null })
  };
  for (const u of UNIDADES) {
    f.display.append(el('option', { value: u, selected: (x?.unidad_display || 'kWh') === u || null,
      text: UNIDAD[u] || u }));
    f.reporte.append(el('option', { value: u, selected: (x?.unidad_reporte || 'kWh') === u || null,
      text: UNIDAD[u] || u }));
  }
  for (const [v_, t] of [['simple', 'Un solo número'], ['doble_mwh_kwh', 'Dos campos: MWh y kWh']])
    f.formato.append(el('option', { value: v_, selected: (x?.formato_lectura || 'simple') === v_ || null, text: t }));

  modal(nuevo ? 'Nueva lectura del punto' : x.nombre, el('div', {}, [
    el('p', { class: 'ayuda', text: punto.nombre }),
    el('label', { text: 'Nombre de la lectura' }, [f.nombre]),
    el('label', { text: 'Unidad que muestra el display' }, [f.display]),
    el('label', { text: 'Unidad en la que se informa' }, [f.reporte]),
    el('p', { class: 'ayuda', text:
      'Si el display muestra MWh y el informe va en kWh, la app convierte sola: en terreno se ' +
      'escribe tal cual se lee en el equipo.' }),
    el('label', { text: 'Decimales del display' }, [f.dec]),
    el('label', { text: 'Formato de la lectura' }, [f.formato]),
    el('label', { class: 'fila' }, [f.informe,
      el('span', { text: 'Va al informe (puede haber varias por punto)' })]),
    el('label', { class: 'fila' }, [f.principal,
      el('span', { text: 'Es la principal de su unidad (la que se muestra en la lista de terreno)' })]),
    el('label', { class: 'fila' }, [f.opcional,
      el('span', { text: 'Opcional (se puede cargar, pero no cuenta como pendiente del mes)' })]),
    el('label', { class: 'fila' }, [f.activo,
      el('span', { text: 'Activa (se pide en terreno)' })]),
    el('button', { class: 'btn primario grande', style: 'margin-top:14px',
      text: nuevo ? 'Crear la lectura' : 'Guardar', onclick: async e => {
        if (!f.nombre.value.trim()) return toast('Ponle un nombre', true);
        e.target.disabled = true;
        const { data: idVar, error } = await sb.rpc('guardar_variable', {
          p_id: x?.id ?? null, p_punto_id: punto.id, p_nombre: f.nombre.value.trim(),
          p_unidad_display: f.display.value, p_unidad_reporte: f.reporte.value,
          p_decimales: Number(f.dec.value || 0), p_formato: f.formato.value,
          p_principal: f.principal.checked, p_activo: f.activo.checked,
          p_opcional: f.opcional.checked
        });
        e.target.disabled = false;
        if (error) {
          return toast(/variables_una_principal_por_unidad/.test(error.message)
            ? 'Ya hay otra lectura principal en esa unidad para este punto. Desmarca "principal" aquí (puede ir igual al informe), o cambia la otra.'
            : error.message, true);
        }
        const { error: e2 } = await sb.from('variables').update({ en_informe: f.informe.checked }).eq('id', idVar || x?.id);
        if (e2) return toast(e2.message, true);
        cerrarModal();
        await DB.descargarCatalogo().catch(() => {});
        S.catalogo = await DB.catalogo();
        toast('Lectura guardada');
        alGuardar && alGuardar();
      } })
  ]));
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

  // Mover un grupo cambia el orden en que sale en TODOS lados: informes y Excel.
  // Por eso se edita acá y no en cada pantalla.
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
      'El orden de esta lista es el orden en que salen los grupos en los informes y en el Excel.' }),
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
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    const lista = el('div', { style: 'max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:10px' });
    const contador = el('p', { class: 'ayuda' });
    const buscar = el('input', { type: 'search', placeholder: 'Filtrar puntos…', oninput: pintarPuntos });

    function pintarPuntos() {
      const q = buscar.value.toLowerCase();
      lista.replaceChildren();
      for (const p of puntos) {
        if (q && !`${p.nombre} ${gruposTexto(p)}`.toLowerCase().includes(q)) continue;
        const chk = el('input', { type: 'checkbox', checked: dentro.has(p.id) || null,
          onchange: e => { e.target.checked ? dentro.add(p.id) : dentro.delete(p.id); actualizar(); } });
        lista.append(el('label', { class: 'fila', style: 'margin-bottom:6px' },
          [chk, el('span', {}, [el('span', { text: p.nombre }),
            el('small', { class: 'tenue-b', text: (p.grupos || []).length ? '  · ' + gruposTexto(p) : '' })])]));
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

  if (!nuevo && S.usuario.rol !== 'colaborador') cuerpo.append(
    el('button', { class: 'btn peligro', style: 'margin-top:18px', text: 'Eliminar este grupo',
      onclick: () => eliminarCosa({
        rpc: 'eliminar_grupo', id: { p_id: g.id }, nombre: g.nombre, que: 'el grupo' }) }));
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
        if (tipo === 'nuevo') q = q.or('respaldado_en.is.null,and(foto_id.not.is.null,foto_respaldado_en.is.null)');
        if (desde) q = q.gte('periodo', desde);
        if (hasta) q = q.lte('periodo', hasta);
        return q.order('periodo').order('punto').order('lectura_id').order('foto_n');
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
        sb.from('avisos').select('id, descripcion, severidad, estado, abierto_en, resuelto_en, obs_resolucion, punto:puntos(nombre), categoria:catalogo_avisos(categoria)'),
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

      // ---- fotos, en Año / Mes / Grupo ----
      // En un respaldo "nuevo" no se repiten las fotos que ya se descargaron antes.
      const conFoto = filas.filter(f => f.storage_path && !(tipo === 'nuevo' && f.foto_respaldado_en));
      const idsFoto = [];
      const nombresUsados = new Set();
      const indice = [['Ruta dentro del respaldo', 'Año', 'Mes', 'Grupo', 'Punto', 'TAG',
                       'Variable', 'Unidad', 'Fecha de lectura', 'Valor', 'Estado', 'Tomada por', 'Foto']];
      for (let i = 0; i < conFoto.length; i++) {
        const f = conFoto[i];
        paso(`Descargando fotos… ${i + 1} de ${conFoto.length}`);
        const { data: url } = await sb.storage.from(C.BUCKET).createSignedUrl(f.storage_path, 900);
        if (!url?.signedUrl) continue;
        const blob = await (await fetch(url.signedUrl)).blob();
        // Año / Mes / Grupo, y el archivo con el nombre del PUNTO: el TAG es del
        // medidor y el medidor se cambia; el punto es lo que se queda.
        const d = new Date(f.periodo);
        const carpeta = [
          d.getUTCFullYear(),
          R.MESES_N[d.getUTCMonth()],
          R.limpio(f.grupo || 'Sin grupo')
        ].join('/');
        const varias = (f.variable && !/^energ[ií]a activa importada\b/i.test(f.variable))
          ? '_' + R.limpio(f.variable) : '';
        // Varias fotos de una misma lectura se distinguen por su número, en el orden en
        // que se sacaron: ..._foto1.jpg, ..._foto2.jpg. Con una sola, el nombre no cambia.
        const sufijo = Number(f.foto_total) > 1 ? `_foto${f.foto_n}` : '';
        let nombre = `${String(f.fecha_dia).slice(0,10)}_${R.limpio(f.punto)}${varias}_${f.valor ?? 'sd'}${sufijo}.jpg`;
        // Dos lecturas distintas con el mismo punto, fecha y valor no deben pisarse en el zip.
        if (nombresUsados.has(`${carpeta}/${nombre}`)) nombre = nombre.replace(/\.jpg$/, `_l${f.lectura_id}.jpg`);
        nombresUsados.add(`${carpeta}/${nombre}`);
        zip.file(`${carpeta}/${nombre}`, blob);
        idsFoto.push(f.foto_id);
        indice.push([`${carpeta}/${nombre}`, d.getUTCFullYear(), R.MESES_N[d.getUTCMonth()],
          f.grupo || 'Sin grupo', f.punto, f.tag || '', f.variable, f.unidad,
          String(f.fecha_lectura).slice(0, 19).replace('T', ' '),
          f.valor === null ? '' : Number(f.valor), f.estado,
          S.catalogo.gente?.[f.tomada_por] || '', `${f.foto_n} de ${f.foto_total}`]);
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
        estructura: 'Año / Mes / Grupo / fecha_Punto_lectura[_fotoN].jpg',
        fotos_por_lectura: 'Hasta 3. Se numeran en el orden en que se sacaron (_foto1, _foto2, _foto3); una lectura con una sola foto no lleva sufijo.',
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
  const planilla = [['TAG', 'Grupo', 'Punto', 'Variable', 'Unidad', 'Fila', ...mesesC.map(nMes)]];
  for (const { f, lect, cons } of porVar.values()) {
    planilla.push([f.tag || '', f.grupo || 'Sin grupo', f.punto, f.variable, f.unidad, 'Totalizador',
      ...mesesC.map(m => lect[sigMes(m)] ?? '')]);
    planilla.push(['', '', '', '', '', filaConsumoTxt(f.grupo),
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
      ['ID','Periodo','Fecha de lectura','Fecha estimada','Grupo','Punto','TAG','Variable','Unidad',
       'Valor','Sin dato','Reinicio','Consumo declarado','Estado','Origen','Tomada por','Validada por',
       'Observación','Obs. validación','Fotos'],
      // una fila por lectura (la vista trae una por foto)
      ...[...new Map(filas.map(f => [f.lectura_id, f])).values()].map(f => [f.lectura_id, f.periodo, String(f.fecha_lectura).slice(0,19).replace('T',' '),
        f.fecha_estimada ? 'sí' : 'no', f.grupo || '', f.punto, f.tag || '', f.variable, f.unidad,
        f.valor === null ? '' : Number(f.valor), f.sin_dato ? 'sí' : 'no',
        f.es_reset ? (f.tipo_reset || 'sí') : 'no',
        f.consumo_manual === null ? '' : Number(f.consumo_manual),
        f.estado, f.origen, f.tomada_por || '', f.validada_por || '',
        f.observacion || '', f.obs_validacion || '', Number(f.foto_total) || 0])
    ]},
    { nombre: 'Consumos', filas: [
      ['Mes','Grupo','Punto','TAG','Variable','Unidad','Consumo','Días','Método','Estado'],
      ...consumos.map(c => [c.mes, c.grupo || '', c.punto, c.tag || '', c.variable,
        c.unidad_reporte, Number(c.consumo), c.dias_asignados, c.metodo,
        c.completo ? 'cerrado' : 'provisional'])
    ]},
    { nombre: 'Inventario', filas: [
      ['Punto','Tipo','TAG','Marca','Modelo','Serie','Certificado','Vence','Variables','Equipos históricos'],
      ...inventario.map(p => [p.nombre, p.tipo, p.tag || '', p.marca || '',
        p.modelo || '', p.n_serie || '', p.certificado ? 'sí' : 'no', p.vence_certificado || '',
        p.n_variables, p.n_equipos_historicos])
    ]},
    { nombre: 'Avisos', filas: [
      ['Punto','Categoría','Severidad','Estado','Abierto','Resuelto','Descripción','Solución'],
      ...avisos.map(a => [a.punto?.nombre || '',
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
/* ===================================================================
   SUGERENCIAS Y FALLAS
   Cualquiera las envía desde la leyenda beta (pie de cada pantalla); solo el
   admin las lee. La sección viene preseleccionada con la pantalla de donde se tocó.
   =================================================================== */
function formSugerencia() {
  // Las secciones que esta persona realmente ve en el menú.
  const secciones = [];
  $$('#menu button[data-vista]').forEach(b => {
    if (b.closest('[hidden]') || b.hidden) return;
    const nombre = b.textContent.trim();
    if (nombre && !secciones.includes(nombre)) secciones.push(nombre);
  });
  secciones.push('General / otra cosa');
  // La sección preseleccionada es la del botón de menú de la pantalla actual.
  const btnActual = $(`#menu button[data-vista="${S.vista}"]`);
  const textoActual = btnActual ? btnActual.textContent.trim() : '';
  const coincide = secciones.includes(textoActual) ? textoActual : 'General / otra cosa';
  const selSec = el('select', {});
  for (const n of secciones) selSec.append(el('option', { value: n, selected: n === coincide || null, text: n }));

  let tipo = 'falla';
  const bFalla = el('button', { type: 'button', class: 'btn chico sel', text: 'Algo no funciona', onclick: () => marcar('falla') });
  const bMejora = el('button', { type: 'button', class: 'btn chico', text: 'Se puede mejorar', onclick: () => marcar('mejora') });
  function marcar(t) { tipo = t; bFalla.classList.toggle('sel', t === 'falla'); bMejora.classList.toggle('sel', t === 'mejora'); }

  const msg = el('textarea', { placeholder: '¿Qué pasó o qué mejorarías? Basta con una línea.', maxlength: 2000 });
  const enviar = el('button', { type: 'button', class: 'btn primario grande', text: 'Enviar', onclick: async () => {
    const texto = msg.value.trim();
    if (texto.length < 3) { msg.focus(); return toast('Escribe qué pasó', true); }
    if (!navigator.onLine) return toast('Sin señal: no se pudo enviar. Tu texto sigue aquí.', true);
    enviar.disabled = true;
    const { error } = await sb.from('sugerencias').insert({ seccion: selSec.value, tipo, mensaje: texto, version: C.VERSION || null });
    enviar.disabled = false;
    if (error) return toast('No se pudo enviar: ' + error.message, true);
    cerrarModal(); toast('Gracias, el aviso llegó');
  } });
  modal('Cuéntanos', el('div', { class: 'form-sugerencia' }, [
    el('div', { class: 'fila' }, [bFalla, bMejora]),
    el('label', { text: 'Sección' }, [selSec]),
    el('label', { text: 'Mensaje' }, [msg]),
    enviar
  ]));
  setTimeout(() => msg.focus(), 50);
}

async function vistaSugerencias(c) {
  let filtro = 'pendientes';
  const sel = el('select', { onchange: e => { filtro = e.target.value; cargar(); } });
  for (const [k, v] of [['pendientes', 'Por revisar'], ['resueltas', 'Resueltas'], ['todas', 'Todas']])
    sel.append(el('option', { value: k, text: v }));
  const zona = el('div');
  c.append(el('div', { class: 'fila entre seccion' }, [
    el('label', { text: 'Ver' }, [sel]),
    el('p', { class: 'ayuda crece', text: 'Lo que el equipo cuenta desde el pie de cada pantalla. Solo tú lo ves.' })
  ]), zona);

  async function cargar() {
    zona.replaceChildren(el('p', { class: 'cargando', text: 'Cargando…' }));
    let q = sb.from('sugerencias').select('*, usuarios(nombre)').order('creado_en', { ascending: false }).limit(500);
    if (filtro === 'pendientes') q = q.in('estado', ['nueva', 'vista']);
    else if (filtro === 'resueltas') q = q.eq('estado', 'resuelta');
    const { data, error } = await q;
    if (error) return zona.replaceChildren(el('p', { class: 'error', text: error.message }));
    if (!data.length) return zona.replaceChildren(el('p', { class: 'ayuda', text: 'No hay nada en esta lista.' }));
    const filas = data.map(r => {
      const estado = el('select', { onchange: async e => {
        const { error } = await sb.from('sugerencias').update({ estado: e.target.value }).eq('id', r.id);
        toast(error ? error.message : 'Actualizado', !!error);
      } });
      for (const [k, v] of [['nueva', 'Nueva'], ['vista', 'Vista'], ['resuelta', 'Resuelta']])
        estado.append(el('option', { value: k, selected: r.estado === k || null, text: v }));
      return [
        fechaCorta(r.creado_en), r.usuarios?.nombre || '—', r.seccion,
        el('span', { class: 'pill ' + (r.tipo === 'falla' ? 'bad' : 'warn'), text: r.tipo === 'falla' ? 'Falla' : 'Mejora' }),
        el('span', { class: 'msg-sugerencia', text: r.mensaje }),
        r.version || '—', estado,
        el('button', { class: 'btn chico peligro', text: 'Borrar', onclick: async () => {
          if (!confirm('¿Borrar este aviso?')) return;
          const { error } = await sb.from('sugerencias').delete().eq('id', r.id);
          if (error) toast(error.message, true); else cargar();
        } })
      ];
    });
    zona.replaceChildren(tabla(['Fecha', 'Quién', 'Sección', 'Tipo', 'Mensaje', 'Versión', 'Estado', ''], filas));
  }
  cargar();
}

async function vistaUsuarios(c) {
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando…' })]);
  c.append(el('div', { class: 'fila entre seccion' }, [
    el('p', { class: 'ayuda crece', text:
      'El rol define qué puede hacer cada persona; los grupos, qué puntos ve. ' +
      'El admin ve todo. Cualquier otro rol sin grupos ni puntos asignados no ve ningún punto.' }),
    el('button', { class: 'btn guardar', text: '+ Persona nueva', onclick: () => nuevoUsuario() })
  ]), zona);

  const [{ data, error }, { data: ug }, { data: up }] = await Promise.all([
    sb.from('usuarios').select('*').order('rol').order('nombre'),
    sb.from('usuario_grupos').select('usuario_id, grupo_id'),
    sb.from('usuario_puntos').select('usuario_id, punto_id')
  ]);
  if (error) { zona.replaceChildren(el('p', { class: 'error', text: error.message })); return; }
  const nombreGrupo = Object.fromEntries((S.catalogo.grupos || []).map(g => [g.id, g.nombre]));
  const gruposDeU = id => (ug || []).filter(x => x.usuario_id === id).map(x => nombreGrupo[x.grupo_id]).filter(Boolean);
  const puntosDeU = id => (up || []).filter(x => x.usuario_id === id).length;

  const ROLES = ['admin', 'supervisor', 'colaborador', 'casa_fuerza', 'visualizador'];
  const filas = data.map(u => {
    const sel = el('select', { onchange: async e => {
      const { error } = await sb.from('usuarios').update({ rol: e.target.value }).eq('id', u.id);
      toast(error ? error.message : `${u.nombre} ahora es ${e.target.value}`, !!error);
      if (!error) vistaUsuariosRefrescar();
    } });
    for (const r of ROLES) sel.append(el('option', { value: r, selected: r === u.rol || null, text: r }));
    const act = el('input', { type: 'checkbox', checked: u.activo || null, onchange: async e => {
      const { error } = await sb.from('usuarios').update({ activo: e.target.checked }).eq('id', u.id);
      toast(error ? error.message : 'Actualizado', !!error);
    } });
    // Qué puntos ve: lo que más se olvida al dar de alta a alguien.
    const gs = gruposDeU(u.id), np = puntosDeU(u.id);
    const acceso = u.rol === 'admin'
      ? el('span', { class: 'pill ok', text: 'todo (admin)' })
      : (gs.length || np)
        ? el('span', { text: [gs.join(' · '), np ? `${np} punto(s) suelto(s)` : null].filter(Boolean).join(' + ') })
        : el('span', { class: 'pill bad', text: 'sin acceso: no ve ningún punto' });
    const btnAcceso = u.rol === 'admin' ? null
      : el('button', { class: 'btn chico', text: 'Grupos', onclick: () => editarAccesoUsuario(u) });
    const borrar = (S.usuario.rol === 'admin' && u.id !== S.usuario.id)
      ? el('button', { class: 'btn chico peligro', text: 'Eliminar',
          onclick: () => eliminarCosa({
            rpc: 'eliminar_usuario', id: { p_id: u.id }, nombre: u.nombre, que: 'al usuario',
            alTerminar: () => render(),
            desactivar: async () => (await sb.from('usuarios').update({ activo: false }).eq('id', u.id)).error
          }) })
      : null;
    const clave = (S.usuario.rol === 'admin')
      ? el('button', { class: 'btn chico', text: 'Cambiar clave', onclick: () => cambiarClaveUsuario(u) })
      : null;
    return [u.nombre, u.correo, sel, el('div', { class: 'fila' }, [acceso, btnAcceso].filter(Boolean)),
            act, u.casa_fuerza ? 'sí' : 'no',
            el('div', { class: 'fila' }, [clave, borrar].filter(Boolean))];
  });
  const sinAcceso = data.filter(u => u.activo && u.rol !== 'admin' && !gruposDeU(u.id).length && !puntosDeU(u.id));
  zona.replaceChildren(
    sinAcceso.length ? el('p', { class: 'banda warn', text:
      `${sinAcceso.length} persona(s) activa(s) sin grupos ni puntos: entran a la app pero no ven ningún punto. ` +
      'Asígnales grupos con el botón "Grupos".' }) : '',
    tabla(['Nombre', 'Correo', 'Rol', 'Qué puntos ve', 'Activo', 'Casa de Fuerza', ''], filas, { etiquetas: true }));
}
const vistaUsuariosRefrescar = () => { if (S.vista === 'usuarios') render(); };

// Casillas de grupos (y, plegado, puntos sueltos) para dar acceso a una persona.
function selectorAcceso(gruposSel = new Set(), puntosSel = new Set()) {
  const cajaGrupos = el('div', { class: 'grupos-check' });
  for (const g of [...(S.catalogo.grupos || [])].sort((a, b) => compararGrupos(a.nombre, b.nombre))) {
    const n = new Set(S.catalogo.variables.filter(v => (v.punto.grupos || []).includes(g.nombre)).map(v => v.punto.id)).size;
    cajaGrupos.append(el('label', { class: 'fila' }, [
      el('input', { type: 'checkbox', checked: gruposSel.has(g.id) || null,
        onchange: e => { e.target.checked ? gruposSel.add(g.id) : gruposSel.delete(g.id); } }),
      el('span', { text: `${g.nombre}` }), el('small', { class: 'tenue-b', text: `${n} pts` })
    ]));
  }
  const puntos = [...new Map(S.catalogo.variables.map(v => [v.punto.id, v.punto])).values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const lista = el('div', { class: 'lista-puntos-acceso' });
  const buscar = el('input', { type: 'search', placeholder: 'Filtrar puntos…', oninput: () => pintar() });
  const pintar = () => {
    const q = buscar.value.toLowerCase();
    poner(lista, puntos.filter(p => !q || p.nombre.toLowerCase().includes(q)).map(p =>
      el('label', { class: 'fila' }, [
        el('input', { type: 'checkbox', checked: puntosSel.has(p.id) || null,
          onchange: e => { e.target.checked ? puntosSel.add(p.id) : puntosSel.delete(p.id); } }),
        el('span', { text: p.nombre })])));
  };
  pintar();
  return el('div', {}, [
    el('h3', { class: 'sub-form', text: 'Grupos que puede ver' }),
    el('p', { class: 'ayuda', text: 'Ve todos los puntos de los grupos marcados, también los que se agreguen al grupo más adelante.' }),
    cajaGrupos,
    el('details', { class: 'plegable', open: puntosSel.size ? '' : null }, [
      el('summary', { text: `Puntos sueltos (fuera de sus grupos)${puntosSel.size ? ' · ' + puntosSel.size : ''}` }),
      el('p', { class: 'ayuda', text: 'Solo si necesita uno o dos puntos de otro grupo sin ver el grupo entero.' }),
      buscar, lista
    ])
  ]);
}

async function editarAccesoUsuario(u) {
  const [{ data: g }, { data: p }] = await Promise.all([
    sb.from('usuario_grupos').select('grupo_id').eq('usuario_id', u.id),
    sb.from('usuario_puntos').select('punto_id').eq('usuario_id', u.id)
  ]);
  const gruposSel = new Set((g || []).map(x => x.grupo_id));
  const puntosSel = new Set((p || []).map(x => x.punto_id));
  modal(`Acceso · ${u.nombre}`, el('div', { class: 'form-punto' }, [
    el('p', { class: 'ayuda', text: `${u.correo} · rol ${u.rol}` }),
    selectorAcceso(gruposSel, puntosSel),
    el('button', { class: 'btn guardar grande', style: 'margin-top:16px', text: 'Guardar acceso', onclick: async e => {
      e.target.disabled = true;
      try {
        for (const [tabla, col, sel] of [['usuario_grupos', 'grupo_id', gruposSel], ['usuario_puntos', 'punto_id', puntosSel]]) {
          const del = await sb.from(tabla).delete().eq('usuario_id', u.id);
          if (del.error) throw del.error;
          if (sel.size) {
            const ins = await sb.from(tabla).insert([...sel].map(id => ({ usuario_id: u.id, [col]: id })));
            if (ins.error) throw ins.error;
          }
        }
        cerrarModal(); toast(`Acceso de ${u.nombre} actualizado`); render();
      } catch (err) { toast(err.message || String(err), true); }
      finally { e.target.disabled = false; }
    } })
  ]));
}

// Alta completa desde la app: cuenta, rol y grupos en un solo paso (función crear_usuario).
function nuevoUsuario() {
  const f = {
    nombre: el('input', { placeholder: 'Nombre y apellido' }),
    correo: el('input', { type: 'email', autocomplete: 'off', placeholder: 'correo@algortanorte.cl' }),
    clave: el('input', { type: 'text', autocomplete: 'off', placeholder: 'Mínimo 6 caracteres' }),
    rol: el('select'),
    cf: el('input', { type: 'checkbox' }),
    hist: el('input', { type: 'checkbox' })
  };
  const DESC = {
    colaborador: 'colaborador · toma lecturas en terreno',
    supervisor: 'supervisor · valida, ve informes y configura sus puntos',
    visualizador: 'visualizador · solo mira',
    casa_fuerza: 'casa_fuerza · generadores y recargas',
    admin: 'admin · todo, incluido usuarios'
  };
  for (const r of ['colaborador', 'supervisor', 'visualizador', 'casa_fuerza', 'admin'])
    f.rol.append(el('option', { value: r, text: DESC[r] }));
  const gruposSel = new Set(), puntosSel = new Set();
  const zonaAcceso = el('div', {}, [selectorAcceso(gruposSel, puntosSel)]);
  f.rol.addEventListener('change', () => { zonaAcceso.hidden = f.rol.value === 'admin'; });
  const err = el('p', { class: 'error', hidden: true });

  modal('Persona nueva', el('div', { class: 'form-punto' }, [
    el('label', { text: 'Nombre' }, [f.nombre]),
    el('label', { text: 'Correo' }, [f.correo]),
    el('label', { text: 'Clave inicial' }, [f.clave]),
    el('p', { class: 'ayuda', text: 'Se la entregas tú. Si el correo ya tiene cuenta en el proyecto (por la app de instrumentación), se usa esa cuenta y su clave no cambia.' }),
    el('label', { text: 'Rol' }, [f.rol]),
    el('label', { class: 'fila' }, [f.cf, el('span', { text: 'También trabaja en Casa de Fuerza' })]),
    el('label', { class: 'fila' }, [f.hist, el('span', { text: 'Puede ver meses anteriores (los supervisores siempre pueden)' })]),
    zonaAcceso,
    err,
    el('button', { class: 'btn guardar grande', style: 'margin-top:16px', text: 'Crear', onclick: async e => {
      err.hidden = true;
      const nombre = f.nombre.value.trim(), correo = f.correo.value.trim().toLowerCase();
      if (!nombre) { err.textContent = 'Falta el nombre.'; err.hidden = false; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { err.textContent = 'El correo no es válido.'; err.hidden = false; return; }
      if (f.rol.value !== 'admin' && !gruposSel.size && !puntosSel.size &&
          !confirm('No marcaste ningún grupo: la persona va a entrar pero no verá ningún punto. ¿Crear igual?')) return;
      e.target.disabled = true; e.target.textContent = 'Creando…';
      try {
        const { data, error } = await sb.functions.invoke('crear_usuario', { body: {
          nombre, correo, clave: f.clave.value, rol: f.rol.value,
          grupos: f.rol.value === 'admin' ? [] : [...gruposSel],
          puntos: f.rol.value === 'admin' ? [] : [...puntosSel],
          casa_fuerza: f.cf.checked, ver_historico: f.hist.checked } });
        if (error) {
          let msg = error.message || 'No se pudo crear.';
          try { const cuerpo = await error.context.json(); if (cuerpo?.error) msg = cuerpo.error; } catch {}
          throw new Error(msg);
        }
        if (data?.error) throw new Error(data.error);
        cerrarModal();
        toast(data?.cuenta_nueva ? `${nombre} creado. Entrégale su correo y la clave inicial.`
                                 : `${nombre} dado de alta con la cuenta que ya tenía (su clave no cambió).`);
        render();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        e.target.disabled = false; e.target.textContent = 'Crear';
      }
    } })
  ]));
}

function cambiarClaveUsuario(u) {
  const clave1 = el('input', { type: 'password', minlength: 6, autocomplete: 'new-password', placeholder: 'Mínimo 6 caracteres' });
  const clave2 = el('input', { type: 'password', minlength: 6, autocomplete: 'new-password', placeholder: 'Repetir la clave' });
  const err = el('p', { class: 'error', hidden: true });
  const btn = el('button', { class: 'btn primario', type: 'submit', text: 'Cambiar clave' });
  const form = el('form', { onsubmit: async e => {
    e.preventDefault();
    err.hidden = true;
    if (clave1.value.length < 6) { err.textContent = 'La clave debe tener al menos 6 caracteres.'; err.hidden = false; return; }
    if (clave1.value !== clave2.value) { err.textContent = 'Las claves no coinciden.'; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = 'Cambiando…';
    try {
      const { data, error } = await sb.functions.invoke('cambiar_clave', {
        body: { usuario_id: u.id, clave_nueva: clave1.value }
      });
      if (error) {
        // El error de una edge function no siempre trae el mensaje del cuerpo; intentamos leerlo.
        let msg = error.message || 'No se pudo cambiar la clave.';
        try { const cuerpo = await error.context.json(); if (cuerpo?.error) msg = cuerpo.error; } catch {}
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      toast(`Clave de ${data?.nombre || u.nombre} actualizada.`);
      cerrarModal();
    } catch (ex) {
      err.textContent = ex.message || 'No se pudo cambiar la clave.';
      err.hidden = false;
      btn.disabled = false; btn.textContent = 'Cambiar clave';
    }
  } }, [
    el('label', { text: 'Nueva clave' }, [clave1]),
    el('label', { text: 'Repetir clave' }, [clave2]),
    err,
    el('div', { class: 'fila fin' }, [btn])
  ]);
  modal(`Cambiar clave · ${u.nombre}`, form);
}

/* ===================================================================
   VISTA · AUDITORÍA
   =================================================================== */
/* ===================================================================
   VISTA · AUDITORÍA (Configuración)
   Para responder preguntas concretas sobre un dato:
   · ¿qué pasó con esta lectura? → historial del registro, valor por valor
   · ¿qué se cambió en tal mes o en tal hora? → filtros de "cuándo" y "mes del dato"
   · ¿cuántas veces se modificó? → vista "Por registro"
   Se lee de v_auditoria, que ya trae punto, lectura y mes del dato de cada cambio.
   =================================================================== */
const AUD_QUE = {
  lecturas: 'Lectura', variables: 'Config. de lectura', puntos: 'Punto', equipos: 'Equipo',
  avisos: 'Aviso', revisiones_consumo: 'Revisión de consumo', generadores: 'Generador',
  generador_movimientos: 'Mov. de generador', recargas: 'Recarga de combustible',
  grupos: 'Grupo', usuarios: 'Usuario', periodos: 'Periodo'
};
const AUD_ACCION = { INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Borró' };
const AUD_CAMPO = {
  valor: 'Valor', valor_display: 'Valor en display', valor_kwh: 'Valor kWh', valor_mwh: 'Valor MWh',
  estado: 'Estado', sin_dato: 'No se pudo leer', es_reset: 'Reinicio del medidor', tipo_reset: 'Tipo de reinicio',
  valor_apertura: 'Valor de apertura', observacion: 'Observación', fecha_dia: 'Fecha de toma',
  fecha_lectura: 'Fecha y hora de toma', fecha_estimada: 'Fecha estimada', periodo: 'Mes de la toma',
  consumo_manual: 'Consumo declarado', tomada_por: 'Tomada por', validada_por: 'Validada por',
  validada_en: 'Validada el', obs_validacion: 'Obs. de validación', origen: 'Origen', dispositivo: 'Dispositivo',
  nombre: 'Nombre', activo: 'Activo', principal: 'Principal', opcional: 'Opcional', en_informe: 'Va al informe',
  unidad_display: 'Unidad en display', unidad_reporte: 'Unidad de informe', decimales_display: 'Decimales',
  formato_lectura: 'Formato de lectura', tipo_acumulacion: 'Acumulación', descripcion: 'Descripción',
  severidad: 'Severidad', punto_id: 'Punto', variable_id: 'Lectura', mes: 'Mes', tipo: 'Tipo', motivo: 'Motivo',
  rol: 'Rol', correo: 'Correo', orden: 'Orden', tag: 'TAG', marca: 'Marca', modelo: 'Modelo', n_serie: 'N° serie',
  observaciones: 'Observaciones', categoria_id: 'Categoría', abierto_por: 'Abierto por', resuelto_por: 'Resuelto por',
  resuelto_en: 'Resuelto el', obs_resolucion: 'Obs. de resolución', por: 'Por', en: 'El', litros: 'Litros',
  horometro: 'Horómetro', kwh: 'kWh', fecha: 'Fecha', fecha_hora: 'Fecha y hora', ubicacion: 'Ubicación',
  potencia_nominal_kw: 'Potencia kW', n_equipo: 'Equipo', n_interno: 'N° interno', proveedor: 'Proveedor',
  instruccion_lectura: 'Instrucción de lectura', foto_obligatoria: 'Foto obligatoria', area: 'Área'
};
// Campos que cambian solos o que no dicen nada a quien revisa.
const AUD_RUIDO = new Set(['actualizado_en', 'creado_en', 'respaldado_en', 'id']);
// Un cambio que solo toca estos campos es una validación o una marca del sistema.
const AUD_VALIDACION = new Set(['estado', 'validada_en', 'validada_por', 'obs_validacion', 'respaldado_en', 'actualizado_en']);
// En un alta o una baja se muestran primero estos campos, si existen.
const AUD_CLAVE = ['valor', 'valor_display', 'sin_dato', 'consumo_manual', 'observacion', 'periodo', 'fecha_dia',
  'nombre', 'tag', 'descripcion', 'tipo', 'motivo', 'estado', 'litros', 'horometro', 'kwh', 'fecha', 'rol', 'correo'];

async function vistaAuditoria(c) {
  S.aud = S.aud || { rango: '30d', desde: '', hasta: '', que: '', accion: '', usuario: '', grupo: '',
                     mesDato: '', buscar: '', ocultarValid: true, vista: 'lista' };
  const A = S.aud;
  let filas = [], limite = 400;

  const { data: us } = await sb.from('usuarios').select('id, nombre').order('nombre');
  const nombreDe = {};
  for (const u of us || []) nombreDe[u.id] = u.nombre;
  const varPorId = new Map(S.catalogo.variables.map(v => [v.id, v]));
  const puntoPorId = new Map(S.catalogo.variables.map(v => [v.punto.id, v.punto]));

  // ---------------- filtros ----------------
  const sel = (opciones, valor, alCambiar) => {
    const s = el('select', { onchange: e => alCambiar(e.target.value) });
    for (const [v, t] of opciones) s.append(el('option', { value: v, text: t, selected: String(valor) === String(v) || null }));
    return s;
  };
  const RANGOS = [['1h', 'Última hora'], ['hoy', 'Hoy'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'],
                  ['mes', 'Este mes'], ['todo', 'Todo'], ['pers', 'Elegir fechas y horas…']];
  const inDesde = el('input', { type: 'datetime-local', value: A.desde, onchange: e => { A.desde = e.target.value; cargar(); } });
  const inHasta = el('input', { type: 'datetime-local', value: A.hasta, onchange: e => { A.hasta = e.target.value; cargar(); } });
  const zonaPers = el('div', { class: 'aud-pers' }, [
    el('label', { text: 'Desde' }, [inDesde]), el('label', { text: 'Hasta' }, [inHasta])]);
  zonaPers.hidden = A.rango !== 'pers';

  const meses = [];
  for (let i = -1; i < 24; i++) {
    const h = new Date(); const p = primerDiaDelMes(new Date(h.getFullYear(), h.getMonth() - i, 1));
    meses.push([p, nombrePeriodo(p)]);
  }
  const grupos = [...new Set(S.catalogo.variables.flatMap(v => v.punto.grupos || []))].sort(compararGrupos);

  const buscar = el('input', { type: 'search', value: A.buscar, placeholder: 'Punto, lectura, TAG, motivo, persona o N° de registro',
    oninput: e => { A.buscar = e.target.value; clearTimeout(buscar._t); buscar._t = setTimeout(pintar, 200); } });
  const chkValid = el('input', { type: 'checkbox', checked: A.ocultarValid || null,
    onchange: e => { A.ocultarValid = e.target.checked; pintar(); } });

  const segVista = el('div', { class: 'seg', role: 'group', 'aria-label': 'Cómo ver' },
    [['lista', 'Cada cambio'], ['registro', 'Por registro']].map(([k, t]) =>
      el('button', { type: 'button', class: 'seg-op' + (A.vista === k ? ' sel' : ''), 'data-v': k, text: t,
        'aria-pressed': A.vista === k ? 'true' : 'false',
        onclick: () => { A.vista = k; $$('.seg-op', segVista).forEach(b => {
          const on = b.dataset.v === k; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); pintar(); } })));

  const barra = el('div', { class: 'aud-filtros' }, [
    el('label', { text: 'Cuándo se hizo' }, [sel(RANGOS, A.rango, v => { A.rango = v; zonaPers.hidden = v !== 'pers'; if (v !== 'pers') cargar(); })]),
    zonaPers,
    el('label', { text: 'Mes del dato' }, [sel([['', 'Cualquiera'], ...meses], A.mesDato, v => { A.mesDato = v; cargar(); })]),
    el('label', { text: 'Qué' }, [sel([['', 'Todo'], ...Object.entries(AUD_QUE)], A.que, v => { A.que = v; cargar(); })]),
    el('label', { text: 'Acción' }, [sel([['', 'Todas'], ...Object.entries(AUD_ACCION)], A.accion, v => { A.accion = v; cargar(); })]),
    el('label', { text: 'Quién' }, [sel([['', 'Todos'], ['sistema', 'Sistema / importación'], ...(us || []).map(u => [u.id, u.nombre])], A.usuario, v => { A.usuario = v; cargar(); })]),
    el('label', { text: 'Grupo' }, [sel([['', 'Todos'], ...grupos.map(g => [g, g])], A.grupo, v => { A.grupo = v; pintar(); })]),
    el('label', { class: 'aud-buscar', text: 'Buscar' }, [buscar])
  ]);
  const barra2 = el('div', { class: 'aud-barra2' }, [
    el('label', { class: 'check-linea' }, [chkValid, el('span', { text: ' Ocultar validaciones y marcas automáticas' })]),
    el('div', { class: 'aud-der' }, [
      el('span', { class: 'seg-tit', text: 'Ver' }), segVista,
      el('button', { class: 'btn chico', text: 'Limpiar filtros', onclick: () => { delete S.aud; render(); } }),
      el('button', { class: 'btn chico', text: 'Descargar CSV', onclick: () => exportar() })])
  ]);
  const resumen = el('div', { class: 'aud-kpis' });
  const zona = el('div');
  c.append(barra, barra2, resumen, zona);

  // ---------------- consulta ----------------
  function rangoFechas() {
    const ahora = new Date();
    if (A.rango === '1h') return [new Date(ahora - 3600e3), null];
    if (A.rango === 'hoy') return [new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()), null];
    if (A.rango === '7d') return [new Date(ahora - 7 * 864e5), null];
    if (A.rango === '30d') return [new Date(ahora - 30 * 864e5), null];
    if (A.rango === 'mes') return [new Date(ahora.getFullYear(), ahora.getMonth(), 1), null];
    if (A.rango === 'pers') return [A.desde ? new Date(A.desde) : null, A.hasta ? new Date(A.hasta) : null];
    return [null, null];
  }
  async function cargar() {
    zona.replaceChildren(el('p', { class: 'cargando', text: 'Buscando cambios…' }));
    resumen.replaceChildren();
    const [d, h] = rangoFechas();
    try {
      filas = await traerTodo(() => {
        let q = sb.from('v_auditoria').select('id, ocurrido_en, usuario_id, usuario_nombre, tabla, accion, registro_id, ' +
          'campos_cambiados, datos_antes, datos_despues, motivo, variable_id, punto_id, punto_nombre, variable_nombre, ' +
          'generador, periodo_dato, etiqueta, veces_registro').order('ocurrido_en', { ascending: false }).order('id', { ascending: false });
        if (d) q = q.gte('ocurrido_en', d.toISOString());
        if (h) q = q.lte('ocurrido_en', h.toISOString());
        if (A.que) q = q.eq('tabla', A.que);
        if (A.accion) q = q.eq('accion', A.accion);
        if (A.usuario === 'sistema') q = q.is('usuario_id', null);
        else if (A.usuario) q = q.eq('usuario_id', A.usuario);
        if (A.mesDato) q = q.eq('periodo_dato', A.mesDato);
        return q;
      });
    } catch (e) { zona.replaceChildren(el('p', { class: 'error', text: e.message || String(e) })); return; }
    limite = 400;
    pintar();
  }

  // ---------------- filtros que se aplican en el navegador ----------------
  const esValidacion = a => a.accion === 'UPDATE' && (a.campos_cambiados || []).every(k => AUD_VALIDACION.has(k));
  const gruposDePunto = id => puntoPorId.get(id)?.grupos || [];
  const textoDe = a => [a.punto_nombre, a.variable_nombre, a.generador, a.etiqueta, a.motivo, a.usuario_nombre,
    a.registro_id, AUD_QUE[a.tabla], puntoPorId.get(a.punto_id)?.equipo?.tag].filter(Boolean).join(' ').toLowerCase();
  function visibles() {
    const t = A.buscar.trim().toLowerCase();
    return filas.filter(a =>
      (!A.ocultarValid || !esValidacion(a)) &&
      (!A.grupo || gruposDePunto(a.punto_id).includes(A.grupo)) &&
      (!t || textoDe(a).includes(t)));
  }

  // ---------------- piezas de presentación ----------------
  const nomCampo = k => AUD_CAMPO[k] || k.replace(/_/g, ' ');
  const esUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v);
  function valorTxt(k, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (esUuid(v)) return nombreDe[v] || 'otra persona';
    if (k === 'variable_id') { const x = varPorId.get(Number(v)); return x ? `${x.punto.nombre} · ${x.nombre}` : `#${v}`; }
    if (k === 'punto_id') return puntoPorId.get(Number(v))?.nombre || `#${v}`;
    if (k === 'periodo' || k === 'mes') return nombrePeriodo(String(v).slice(0, 10));
    if (typeof v === 'number') return num(v, Number.isInteger(v) ? 0 : 2);
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && /valor|kwh|mwh|litros|horometro|consumo/.test(k)) {
      const n = Number(v); return num(n, Number.isInteger(n) ? 0 : 2); }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fechaHora(v);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fechaCorta(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  const camposDe = a => a.accion === 'UPDATE'
    ? (a.campos_cambiados || []).filter(k => !AUD_RUIDO.has(k))
    : AUD_CLAVE.filter(k => (a.datos_despues || a.datos_antes || {})[k] !== undefined &&
                            (a.datos_despues || a.datos_antes)[k] !== null);
  // "Valor: 89.833 → 997.756"
  const diff = (a, k) => {
    const antes = a.datos_antes?.[k], desp = a.datos_despues?.[k];
    return el('div', { class: 'aud-diff' }, [
      el('span', { class: 'aud-campo', text: nomCampo(k) + ': ' }),
      a.accion !== 'INSERT' ? el('span', { class: 'aud-antes', text: valorTxt(k, antes) }) : null,
      a.accion === 'UPDATE' ? el('span', { class: 'aud-flecha', text: ' → ' }) : null,
      a.accion !== 'DELETE' ? el('span', { class: 'aud-desp', text: valorTxt(k, desp) }) : null]);
  };
  const resumenCambio = (a, max = 3) => {
    const ks = camposDe(a);
    if (!ks.length) return el('span', { class: 'ayuda', text: a.accion === 'UPDATE' ? 'solo campos internos' : '—' });
    const prior = [...ks].sort((x, y) => (AUD_CLAVE.indexOf(x) + 1 || 99) - (AUD_CLAVE.indexOf(y) + 1 || 99));
    return el('div', { class: 'aud-diffs' }, [...prior.slice(0, max).map(k => diff(a, k)),
      prior.length > max ? el('span', { class: 'ayuda', text: `+${prior.length - max} campo(s) más` }) : null]);
  };
  const queTxt = a => AUD_QUE[a.tabla] || a.tabla;
  const registroTxt = a => a.punto_nombre || a.generador || a.etiqueta || `#${a.registro_id}`;
  const lecturaTxt = a => a.variable_nombre || (a.tabla === 'generador_movimientos' || a.tabla === 'recargas' ? queTxt(a) : '');
  const pillAccion = a => el('span', { class: 'pill ' + ({ INSERT: 'ok', UPDATE: 'warn', DELETE: 'bad' }[a.accion] || ''),
    text: AUD_ACCION[a.accion] || a.accion });
  const quien = a => a.usuario_nombre || (a.usuario_id ? 'otra persona' : 'Sistema');
  const botonVeces = a => el('button', { class: 'aud-veces' + (a.veces_registro > 2 ? ' muchas' : ''), type: 'button',
    title: 'Ver todo el historial de este registro', text: `${a.veces_registro}×`,
    onclick: e => { e.stopPropagation(); historialRegistro(a); } });

  // ---------------- pintar ----------------
  function pintar() {
    const vis = visibles();
    const regs = new Set(vis.map(a => a.tabla + '|' + a.registro_id));
    const personas = new Set(vis.map(a => a.usuario_id || 'sistema'));
    const sinMotivo = vis.filter(a => a.accion !== 'INSERT' && !a.motivo && a.usuario_id).length;
    const cambiosValor = vis.filter(a => a.tabla === 'lecturas' && a.accion === 'UPDATE' && (a.campos_cambiados || []).includes('valor')).length;
    const ocultas = filas.length - filas.filter(a => !esValidacion(a)).length;
    resumen.replaceChildren(
      kpi(vis.length, 'cambios'), kpi(regs.size, 'registros distintos'), kpi(personas.size, 'personas'),
      kpi(cambiosValor, 'valores de lectura corregidos', cambiosValor ? 'aviso' : ''),
      kpi(sinMotivo, 'cambios sin motivo', sinMotivo ? 'alerta' : ''),
      A.ocultarValid && ocultas ? el('p', { class: 'ayuda aud-nota', text: `${ocultas} validaciones ocultas` }) : null);

    if (!vis.length) { zona.replaceChildren(el('p', { class: 'vacio', text: 'No hay cambios con esos filtros.' })); return; }
    if (A.vista === 'registro') return pintarPorRegistro(vis);

    const cab = ['Cuándo', 'Quién', 'Qué', 'Punto / registro', 'Lectura', 'Mes del dato', 'Acción', 'Cambio', 'Motivo', 'Veces'];
    const tb = el('tbody', {}, vis.slice(0, limite).map(a => el('tr', { class: 'aud-fila', onclick: () => historialRegistro(a) }, [
      el('td', { class: 'nowrap', text: fechaHora(a.ocurrido_en) }),
      el('td', { class: 'nowrap', text: quien(a) }),
      el('td', { class: 'nowrap', text: queTxt(a) }),
      el('td', {}, [el('b', { text: registroTxt(a) })]),
      el('td', { class: 'aud-lect', text: lecturaTxt(a) || '—' }),
      el('td', { class: 'nowrap', text: a.periodo_dato ? nombrePeriodo(a.periodo_dato) : '—' }),
      el('td', {}, [pillAccion(a)]),
      el('td', { class: 'aud-cambio' }, [resumenCambio(a)]),
      el('td', { class: 'aud-motivo', text: a.motivo || '—' }),
      el('td', { class: 'num' }, [botonVeces(a)])])));
    zona.replaceChildren(
      el('div', { class: 'tabla-caja tabla-aud' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, cab.map(h => el('th', { text: h })))]), tb])]),
      vis.length > limite ? el('div', { class: 'fila seccion' }, [
        el('p', { class: 'ayuda crece', text: `Se muestran ${limite} de ${vis.length}. Acota con los filtros o` }),
        el('button', { class: 'btn', text: 'Mostrar 400 más', onclick: () => { limite += 400; pintar(); } })]) : null,
      el('p', { class: 'ayuda', text: 'Toca una fila para ver el historial completo de ese registro, cambio por cambio.' }));
  }

  // Una fila por registro: cuántas veces se tocó, quiénes y cuándo.
  function pintarPorRegistro(vis) {
    const g = new Map();
    for (const a of vis) {
      const k = a.tabla + '|' + a.registro_id;
      if (!g.has(k)) g.set(k, { a, n: 0, personas: new Set(), primero: a.ocurrido_en, ultimo: a.ocurrido_en, valor: 0 });
      const x = g.get(k);
      x.n++; x.personas.add(quien(a));
      if (a.ocurrido_en < x.primero) x.primero = a.ocurrido_en;
      if (a.ocurrido_en > x.ultimo) { x.ultimo = a.ocurrido_en; x.a = a; }
      if ((a.campos_cambiados || []).includes('valor')) x.valor++;
    }
    const lista = [...g.values()].sort((x, y) => y.n - x.n || (y.ultimo > x.ultimo ? 1 : -1));
    const cab = ['Qué', 'Punto / registro', 'Lectura', 'Mes del dato', 'Cambios (filtro)', 'Cambios de valor', 'Total histórico', 'Personas', 'Primero', 'Último', ''];
    zona.replaceChildren(el('div', { class: 'tabla-caja tabla-aud' }, [el('table', {}, [
      el('thead', {}, [el('tr', {}, cab.map(h => el('th', { text: h })))]),
      el('tbody', {}, lista.slice(0, limite).map(x => el('tr', { class: 'aud-fila', onclick: () => historialRegistro(x.a) }, [
        el('td', { class: 'nowrap', text: queTxt(x.a) }),
        el('td', {}, [el('b', { text: registroTxt(x.a) })]),
        el('td', { class: 'aud-lect', text: lecturaTxt(x.a) || '—' }),
        el('td', { class: 'nowrap', text: x.a.periodo_dato ? nombrePeriodo(x.a.periodo_dato) : '—' }),
        el('td', { class: 'num' }, [el('b', { text: String(x.n) })]),
        el('td', { class: 'num', text: x.valor ? String(x.valor) : '—' }),
        el('td', { class: 'num' }, [botonVeces(x.a)]),
        el('td', { text: [...x.personas].join(', ') }),
        el('td', { class: 'nowrap', text: fechaHora(x.primero) }),
        el('td', { class: 'nowrap', text: fechaHora(x.ultimo) }),
        el('td', {}, [el('button', { class: 'btn chico', text: 'Historial', onclick: e => { e.stopPropagation(); historialRegistro(x.a); } })])])))])]),
      lista.length > limite ? el('button', { class: 'btn', text: 'Mostrar más', onclick: () => { limite += 400; pintar(); } }) : null);
  }

  // ---------------- historial de un registro ----------------
  async function historialRegistro(a) {
    modal(`${queTxt(a)} · ${registroTxt(a)}`, el('p', { class: 'cargando', text: 'Cargando historial…' }),
      { subtitulo: [lecturaTxt(a), a.periodo_dato ? nombrePeriodo(a.periodo_dato) : '', `registro #${a.registro_id}`].filter(Boolean).join(' · '), completo: true });
    const { data, error } = await sb.from('v_auditoria').select('*')
      .eq('tabla', a.tabla).eq('registro_id', a.registro_id).order('ocurrido_en').order('id');
    if (error) return poner($('#modal-cuerpo'), el('p', { class: 'error', text: error.message }));
    // Otras tomas del mismo punto y mes (una lectura borrada y vuelta a tomar, o un duplicado).
    let otras = [];
    if (a.tabla === 'lecturas' && a.variable_id && a.periodo_dato) {
      const r = await sb.from('v_auditoria').select('registro_id, accion, ocurrido_en, usuario_nombre')
        .eq('tabla', 'lecturas').eq('variable_id', a.variable_id).eq('periodo_dato', a.periodo_dato)
        .neq('registro_id', a.registro_id).order('ocurrido_en');
      otras = r.data || [];
    }
    const ev = data || [];
    const partes = [];

    // Evolución del valor: lo que más se pregunta de una lectura.
    if (a.tabla === 'lecturas') {
      const pasos = [];
      for (const e of ev) {
        const v = e.accion === 'DELETE' ? null : e.datos_despues?.valor;
        const sd = e.datos_despues?.sin_dato;
        if (e.accion === 'INSERT' || (e.campos_cambiados || []).some(k => ['valor', 'sin_dato'].includes(k)) || e.accion === 'DELETE')
          pasos.push({ e, txt: e.accion === 'DELETE' ? 'borrada' : sd ? 'no se pudo leer' : valorTxt('valor', v) });
      }
      if (pasos.length)
        partes.push(el('div', { class: 'aud-evolucion' }, [
          el('span', { class: 'aud-ev-tit', text: 'Evolución del valor' }),
          ...pasos.flatMap((p, i) => [i ? el('span', { class: 'aud-flecha', text: '→' }) : null,
            el('span', { class: 'aud-ev-paso' + (i === pasos.length - 1 ? ' actual' : ''), title: `${fechaHora(p.e.ocurrido_en)} · ${quien(p.e)}` }, [
              el('b', { text: p.txt }), el('small', { text: `${fechaHora(p.e.ocurrido_en)} · ${quien(p.e)}` })])])]));
    }
    partes.push(el('p', { class: 'ayuda', text: `${ev.length} evento(s) registrados para este registro, del más antiguo al más reciente.` }));

    for (const e of ev) {
      const ks = e.accion === 'UPDATE' ? (e.campos_cambiados || []).filter(k => !AUD_RUIDO.has(k))
        : Object.keys(e.datos_despues || e.datos_antes || {}).filter(k => !AUD_RUIDO.has(k));
      const orden = [...ks].sort((x, y) => (AUD_CLAVE.indexOf(x) + 1 || 99) - (AUD_CLAVE.indexOf(y) + 1 || 99));
      const filasT = orden.map(k => el('tr', {}, [
        el('td', { class: 'aud-campo', text: nomCampo(k) }),
        el('td', { class: 'aud-antes', text: e.accion === 'INSERT' ? '' : valorTxt(k, e.datos_antes?.[k]) }),
        el('td', { class: 'aud-desp', text: e.accion === 'DELETE' ? '' : valorTxt(k, e.datos_despues?.[k]) })]));
      partes.push(el('div', { class: 'aud-evento ' + e.accion.toLowerCase() + (e.id === a.id ? ' este' : '') }, [
        el('div', { class: 'aud-ev-cab' }, [
          pillAccion(e), el('b', { text: fechaHora(e.ocurrido_en) }), el('span', { text: quien(e) }),
          esValidacion(e) ? el('span', { class: 'pill neutro', text: 'validación' }) : null,
          e.id === a.id ? el('span', { class: 'pill acento', text: 'el que tocaste' }) : null]),
        e.motivo ? el('p', { class: 'aud-ev-motivo', text: 'Motivo: ' + e.motivo }) : null,
        filasT.length ? el('table', { class: 'aud-ev-tabla' }, [
          el('thead', {}, [el('tr', {}, [el('th', { text: 'Campo' }),
            el('th', { text: e.accion === 'INSERT' ? '' : 'Antes' }), el('th', { text: e.accion === 'DELETE' ? '' : 'Después' })])]),
          el('tbody', {}, filasT)]) : null]));
    }
    if (otras.length) {
      const regs = [...new Set(otras.map(o => o.registro_id))];
      partes.push(el('div', { class: 'banda warn' }, [
        el('b', { text: `Este punto tiene otras ${regs.length} toma(s) registradas para el mismo mes. ` }),
        el('span', { text: 'Puede ser una lectura que se borró y se volvió a tomar, o un duplicado.' }),
        el('div', { class: 'fila', style: 'margin-top:6px' }, regs.map(r => el('button', { class: 'btn chico', text: `Ver registro #${r}`,
          onclick: () => historialRegistro({ ...a, registro_id: r, id: null }) })))]));
    }
    poner($('#modal-cuerpo'), el('div', { class: 'hist-aud' }, partes));
  }

  // ---------------- CSV de lo filtrado ----------------
  function exportar() {
    const vis = visibles();
    if (!vis.length) return toast('No hay nada que descargar con esos filtros', true);
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lineas = [['Fecha y hora', 'Quién', 'Qué', 'Registro', 'Punto', 'Lectura', 'Mes del dato', 'Acción', 'Campo', 'Antes', 'Después', 'Motivo'].map(q).join(';')];
    for (const a of vis) {
      const ks = camposDe(a);
      for (const k of (ks.length ? ks : [''])) lineas.push([
        new Date(a.ocurrido_en).toLocaleString('es-CL'), quien(a), queTxt(a), a.registro_id, registroTxt(a), lecturaTxt(a),
        a.periodo_dato ? nombrePeriodo(a.periodo_dato) : '', AUD_ACCION[a.accion] || a.accion, k ? nomCampo(k) : '',
        k && a.accion !== 'INSERT' ? valorTxt(k, a.datos_antes?.[k]) : '', k && a.accion !== 'DELETE' ? valorTxt(k, a.datos_despues?.[k]) : '',
        a.motivo || ''].map(q).join(';'));
    }
    descargar(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
      `Auditoria_${new Date().toISOString().slice(0, 10)}.csv`);
  }

  cargar();
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

  const puedeAdmin = ['admin', 'supervisor', 'casa_fuerza'].includes(S.usuario.rol);

  const filas = [...gens].sort(ordenGen).map(g => [
    g.n_interno || '—', g.n_equipo,
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
      el('button', { class: 'btn chico', text: 'Ficha', onclick: () => fichaGenerador(g) }),
      el('button', { class: 'btn chico', text: 'Registrar', onclick: () => movimientoGenerador(g) }),
      el('button', { class: 'btn chico', text: 'Historial', onclick: () => historialGenerador(g) }),
      puedeAdmin ? el('button', { class: 'btn chico', text: 'Editar',
        onclick: () => editarGenerador(g) }) : null
    ].filter(Boolean))
  ]);

  poner(zona,
    puedeAdmin ? el('div', { class: 'fila entre seccion' }, [
      el('p', { class: 'ayuda crece', text: 'El parque de generadores en faena.' }),
      el('button', { class: 'btn primario', text: '＋ Generador nuevo',
        onclick: () => editarGenerador(null) })
    ]) : null,
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
    tabla(['N° int.', 'Equipo', 'Propiedad', 'kW', 'Estado', 'Combustible', 'Ingreso', 'Días',
           'Horas estadía', 'kWh estadía', 'Litros estadía', ''],
      filas, { num: [3, 7, 8, 9, 10] }),
    el('p', { class: 'ayuda', text:
      'La toma mensual (kWh, horómetro y kW) se hace desde Terreno, grupo "Generadores", escaneando el QR del equipo. ' +
      'Aquí se registran el ingreso y la devolución de cada equipo.' })
  );
}

/* ===================================================================
   CASA DE FUERZA · CIERRE DEL MES
   Reemplaza la hoja RESUMEN de la planilla de generadores. Cada generador es
   un punto de Terreno (grupo "Generadores") con tres lecturas: kWh generado,
   horas de marcha y potencia del momento. Así la toma usa el mismo QR, fotos
   y cola sin señal que los medidores, y el consumo del mes sale del mismo
   cálculo (la toma del día 1 cierra el mes anterior).
   =================================================================== */
const VAR_GEN = { kwh: /generada/i, horas: /^horas/i, kw: /^potencia/i };

async function datosGeneradores(meses) {
  const { data: gens, error } = await sb.from('generadores').select('*');
  if (error) throw error;
  const puntos = gens.filter(g => g.punto_id).map(g => g.punto_id);
  const { data: vars, error: e2 } = await sb.from('variables').select('id, punto_id, nombre, unidad_display, formato_lectura')
    .in('punto_id', puntos.length ? puntos : [0]);
  if (e2) throw e2;
  const idsDe = {};                       // generador → { kwh, horas, kw } (ids de variable)
  for (const g of gens) {
    const suyas = (vars || []).filter(v => v.punto_id === g.punto_id);
    idsDe[g.id] = Object.fromEntries(Object.entries(VAR_GEN).map(([k, re]) => [k, suyas.find(v => re.test(v.nombre))]));
  }
  const ids = (vars || []).map(v => v.id);
  const tomas = meses.map(mesSiguiente);
  const [cons, lects, recs] = await Promise.all([
    sb.from('v_consumos').select('variable_id, mes, consumo, completo').in('variable_id', ids.length ? ids : [0]).in('mes', meses),
    sb.from('lecturas').select('variable_id, periodo, valor, valor_display, valor_mwh, valor_kwh, fecha_lectura, sin_dato, es_reset, tomada_por, origen, observacion')
      .in('variable_id', ids.length ? ids : [0]).in('periodo', tomas).neq('estado', 'descartada'),
    sb.from('v_recargas').select('generador_id, periodo, litros').in('periodo', meses).eq('anulada', false)
  ]);
  for (const r of [cons, lects, recs]) if (r.error) throw r.error;
  return { gens, idsDe, cons: cons.data || [], lects: lects.data || [], recs: recs.data || [] };
}

// Lo de un generador en un mes de consumo (la toma que lo cierra es la del mes siguiente).
function resumenGenerador(g, mes, d) {
  const iv = d.idsDe[g.id] || {};
  const c = k => iv[k] && d.cons.find(x => x.variable_id === iv[k].id && x.mes === mes);
  const l = k => iv[k] && d.lects.find(x => x.variable_id === iv[k].id && x.periodo === mesSiguiente(mes));
  const kwhMes = c('kwh') ? Number(c('kwh').consumo) : null;
  const horasMes = c('horas') ? Number(c('horas').consumo) : null;
  const litros = d.recs.filter(r => r.generador_id === g.id && r.periodo === mes).reduce((a, r) => a + Number(r.litros), 0) || null;
  const lk = l('kwh'), lh = l('horas'), lw = l('kw');
  const kwMedio = kwhMes != null && horasMes > 0 ? kwhMes / horasMes : null;
  return {
    kwhMes, horasMes, litros, kwMedio,
    factor: kwMedio != null && g.potencia_nominal_kw ? 100 * kwMedio / Number(g.potencia_nominal_kw) : null,
    lPorKwh: litros && kwhMes > 0 ? litros / kwhMes : null,
    kwhAcum: lk && !lk.sin_dato ? Number(lk.valor) : null,
    horAcum: lh && !lh.sin_dato ? Number(lh.valor) : null,
    kw: lw && !lw.sin_dato ? Number(lw.valor) : null,
    toma: lk || lh || lw || null,
    tomado: !!(lk || lh)
  };
}

const genNombre = g => g.n_interno ? `${g.n_interno} · ${g.n_equipo}` : g.n_equipo;
const ordenGen = (a, b) => (a.propiedad === 'Propio' ? 0 : 1) - (b.propiedad === 'Propio' ? 0 : 1) ||
  String(a.n_interno || a.n_equipo).localeCompare(String(b.n_interno || b.n_equipo), 'es', { numeric: true });
const pillEstadoGen = e => el('span', { class: 'pill ' + (e === 'Operando' ? 'ok'
  : ['Devuelto', 'De baja'].includes(e) ? 'neutro' : ['Fuera de servicio', 'Para devolución'].includes(e) ? 'bad' : 'warn'), text: e || '—' });

async function vistaCierreCF(c) {
  S.mesCF = S.mesCF || S.periodoConsumo;
  S.modoCF = S.modoCF || 'anio';                         // por defecto: un año
  S.anioCF = S.anioCF || String(new Date().getFullYear());
  const hoy = new Date();
  const selModo = el('select', { onchange: e => { S.modoCF = e.target.value; pintarSel(); cargar(); } });
  for (const [k, v] of [['mes', 'Un mes'], ['anio', 'Un año']])
    selModo.append(el('option', { value: k, selected: S.modoCF === k || null, text: v }));
  const zonaSel = el('div', { class: 'fila' });
  function pintarSel() {
    zonaSel.replaceChildren();
    if (S.modoCF === 'anio') {
      const sel = el('select', { onchange: e => { S.anioCF = e.target.value; cargar(); } });
      for (let a = hoy.getFullYear(); a >= hoy.getFullYear() - 4; a--)
        sel.append(el('option', { value: String(a), selected: S.anioCF === String(a) || null, text: String(a) }));
      zonaSel.append(el('label', { text: 'Año' }, [sel]));
    } else {
      const sel = el('select', { onchange: e => { S.mesCF = e.target.value; cargar(); } });
      for (let i = 0; i < 24; i++) {
        const p = primerDiaDelMes(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1));
        sel.append(el('option', { value: p, selected: p === S.mesCF || null, text: nombrePeriodo(p) }));
      }
      zonaSel.append(el('label', { text: 'Mes' }, [sel]));
    }
    btnPdf.hidden = btnResp.hidden = S.modoCF === 'anio';   // PDF y respaldo son de un mes
    ayuda.textContent = S.modoCF === 'anio'
      ? 'Suma de los meses ya cerrados del año. Cada mes sale de la toma del día 1 del mes siguiente (diciembre cierra con la toma del 1 de enero).'
      : 'Energía y horas del mes salen de la toma del día 1 del mes siguiente. Toca un generador para ver su ficha.';
  }
  const zona = el('div');
  let ultimo = null;                     // lo último calculado, para el PDF y el respaldo
  const paso = el('span', { class: 'ayuda' });
  const ayuda = el('p', { class: 'ayuda crece' });
  const btnPdf = el('button', { class: 'btn', text: 'PDF del cierre', onclick: () => ultimo && imprimirCierreCF(S.mesCF, ultimo) });
  const btnResp = el('button', { class: 'btn', text: 'Respaldo del mes (fotos + Excel)', onclick: async e => {
    if (!ultimo) return;
    e.target.disabled = true;
    try { await respaldoCF(S.mesCF, ultimo, t => { paso.textContent = t; }); }
    catch (err) { toast('Falló el respaldo: ' + (err.message || err), true); }
    finally { e.target.disabled = false; paso.textContent = ''; }
  } });
  c.append(el('div', { class: 'fila entre seccion' }, [
    el('label', { text: 'Ver' }, [selModo]), zonaSel, ayuda, paso, btnPdf, btnResp
  ]), zona);
  pintarSel();

  // Vista anual: una fila por generador con lo acumulado de los 12 meses.
  async function cargarAnio() {
    zona.replaceChildren(el('p', { class: 'cargando', text: 'Calculando…' }));
    const meses = Array.from({ length: 12 }, (_, i) => `${S.anioCF}-${String(i + 1).padStart(2, '0')}-01`);
    let d;
    try { d = await datosGeneradores(meses); ultimo = null; }
    catch (e) { return zona.replaceChildren(el('p', { class: 'error', text: e.message || String(e) })); }
    const filas = d.gens.map(g => {
      const por = meses.map(m => resumenGenerador(g, m, d));
      const suma = k => por.reduce((a, r) => a + (r[k] || 0), 0);
      const kwh = suma('kwhMes'), horas = suma('horasMes'), litros = suma('litros');
      const kwhDiesel = por.filter(r => r.litros).reduce((a, r) => a + (r.kwhMes || 0), 0);
      const kwMedio = horas > 0 ? kwh / horas : null;
      return { g, por, kwh, horas, litros,
        factor: kwMedio != null && g.potencia_nominal_kw ? 100 * kwMedio / Number(g.potencia_nominal_kw) : null,
        lPorKwh: litros && kwhDiesel > 0 ? litros / kwhDiesel : null,
        nMeses: por.filter(r => r.kwhMes != null).length };
    }).filter(x => x.g.activo || x.nMeses || x.por.some(r => r.tomado))
      .sort((a, b) => ordenGen(a.g, b.g));
    const activos = filas.filter(x => x.g.activo);
    const tot = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
    const kwhTot = tot(filas, 'kwh'), litTot = tot(filas, 'litros');
    const kwhDiesel = filas.filter(x => x.litros).reduce((a, x) => a + x.kwh, 0);
    const kpis = el('div', { class: 'kpis seccion' }, [
      kpi(kwhTot >= 1e6 ? num(kwhTot / 1e6, 2) + ' GWh' : num(kwhTot / 1000) + ' MWh', 'energía generada en el año'),
      kpi(num(tot(filas, 'horas')), 'horas de marcha'),
      kpi(litTot ? num(litTot) + ' L' : '—', 'combustible cargado'),
      kpi(litTot && kwhDiesel ? num(litTot / kwhDiesel, 3) : '—', 'L/kWh (diésel)'),
      kpi(`${activos.filter(x => x.g.estado === 'Operando').length} / ${activos.length}`, 'operando')
    ]);
    const cab = ['N° int.', 'Equipo', 'Pot. nom.', 'kWh año', 'Horas año', 'Factor carga', 'Litros', 'L/kWh', 'Meses con dato', 'Estado'];
    const fila = x => [
      el('button', { class: 'celda-cons', text: x.g.n_interno || '—', onclick: () => fichaGenerador(x.g) }),
      el('button', { class: 'celda-cons', text: x.g.n_equipo, onclick: () => fichaGenerador(x.g) }),
      num(x.g.potencia_nominal_kw),
      x.nMeses ? el('b', { text: num(x.kwh) }) : '—',
      x.nMeses ? num(x.horas) : '—',
      x.factor != null ? el('span', { class: 'pill ' + (x.factor > 85 ? 'warn' : x.factor < 30 ? 'neutro' : 'ok'), text: num(x.factor) + '%' }) : '—',
      x.litros ? num(x.litros) : '—', x.lPorKwh != null ? num(x.lPorKwh, 3) : '—',
      `${x.nMeses} / 12`, pillEstadoGen(x.g.estado)
    ];
    const bloque = (titulo, arr) => arr.length ? el('div', { class: 'seccion' }, [
      el('h3', { text: `${titulo} (${arr.length})` }),
      tabla(cab, [...arr.map(fila), ['Total', '', '', el('b', { text: num(tot(arr, 'kwh')) }), num(tot(arr, 'horas')), '',
        tot(arr, 'litros') ? num(tot(arr, 'litros')) : '—', '', '', '']], { num: [2, 3, 4, 6, 7] })
    ]) : null;
    const matriz = filas.length ? el('div', { class: 'seccion' }, [
      el('h3', { text: `Energía generada por mes · ${S.anioCF} (kWh)` }),
      tabla(['N° int.', 'Equipo', ...MES_CORTO.map(m => m[0].toUpperCase() + m.slice(1)), 'Total'],
        [...filas.map(x => [x.g.n_interno || '—', x.g.n_equipo,
            ...x.por.map(r => r.kwhMes != null ? num(r.kwhMes) : '—'), el('b', { text: x.nMeses ? num(x.kwh) : '—' })]),
         ['Total', '', ...meses.map((m, i) => {
            const t = filas.reduce((a, x) => a + (x.por[i].kwhMes || 0), 0);
            return t ? num(t) : '—'; }), el('b', { text: num(kwhTot) })]],
        { num: Array.from({ length: 13 }, (_, i) => i + 2) })
    ]) : null;
    poner(zona, kpis,
      bloque('Generadores propios', filas.filter(x => x.g.propiedad === 'Propio')),
      bloque('Generadores de arriendo', filas.filter(x => x.g.propiedad !== 'Propio')),
      matriz,
      el('p', { class: 'ayuda', text: 'Factor de carga = kW medio del año (kWh ÷ horas) sobre la potencia nominal. ' +
        'L/kWh solo con los meses que tienen cargas de combustible registradas.' }));
  }

  async function cargar() {
    if (S.modoCF === 'anio') return cargarAnio();
    zona.replaceChildren(el('p', { class: 'cargando', text: 'Calculando…' }));
    let d;
    try { d = await datosGeneradores([S.mesCF]); ultimo = d; }
    catch (e) { return zona.replaceChildren(el('p', { class: 'error', text: e.message || String(e) })); }
    const mes = S.mesCF;
    const filas = d.gens.map(g => ({ g, r: resumenGenerador(g, mes, d) }))
      // los devueltos solo aparecen si tienen algo ese mes
      .filter(({ g, r }) => g.activo || r.kwhMes != null || r.tomado)
      .sort((a, b) => ordenGen(a.g, b.g));
    const activos = filas.filter(x => x.g.activo);
    const sinToma = activos.filter(x => !x.r.tomado);
    const suma = (arr, k) => arr.reduce((a, x) => a + (x.r[k] || 0), 0);
    const kwhTot = suma(filas, 'kwhMes'), litTot = suma(filas, 'litros');
    const kwhDiesel = filas.filter(x => x.r.litros).reduce((a, x) => a + (x.r.kwhMes || 0), 0);

    const kpis = el('div', { class: 'kpis seccion' }, [
      kpi(kwhTot >= 1e6 ? num(kwhTot / 1e6, 2) + ' GWh' : num(kwhTot / 1000) + ' MWh', 'energía generada'),
      kpi(num(suma(filas, 'horasMes')), 'horas de marcha'),
      kpi(litTot ? num(litTot) + ' L' : '—', 'combustible cargado'),
      kpi(litTot && kwhDiesel ? num(litTot / kwhDiesel, 3) : '—', 'L/kWh (diésel)'),
      kpi(`${activos.filter(x => x.g.estado === 'Operando').length} / ${activos.length}`, 'operando'),
      kpi(sinToma.length, 'sin toma de cierre', sinToma.length ? 'aviso' : 'ok')
    ]);

    const cab = ['N° int.', 'Equipo', 'Pot. nom.', 'kW toma', 'kWh acum.', 'kWh mes', 'Horómetro', 'Horas mes',
                 'Factor carga', 'Litros', 'L/kWh', 'Estado', 'Sincronismo', 'Ubicación', 'Obs.'];
    const fila = ({ g, r }) => [
      el('button', { class: 'celda-cons', text: g.n_interno || '—', onclick: () => fichaGenerador(g) }),
      el('button', { class: 'celda-cons', text: g.n_equipo, onclick: () => fichaGenerador(g) }),
      num(g.potencia_nominal_kw), r.kw != null ? num(r.kw) : '—',
      r.kwhAcum != null ? num(r.kwhAcum) : (g.activo ? el('span', { class: 'pill warn', text: 'sin toma' }) : '—'),
      r.kwhMes != null ? el('b', { text: num(r.kwhMes) }) : '—',
      r.horAcum != null ? num(r.horAcum) : '—', r.horasMes != null ? num(r.horasMes) : '—',
      r.factor != null ? el('span', { class: 'pill ' + (r.factor > 85 ? 'warn' : r.factor < 30 ? 'neutro' : 'ok'), text: num(r.factor) + '%' }) : '—',
      r.litros != null ? num(r.litros) : '—', r.lPorKwh != null ? num(r.lPorKwh, 3) : '—',
      pillEstadoGen(g.estado), g.sincronismo || '—', g.ubicacion || '—',
      g.observaciones ? el('span', { class: 'obs-corta', title: g.observaciones, text: g.observaciones }) : ''
    ];
    const bloque = (titulo, arr) => arr.length ? el('div', { class: 'seccion' }, [
      el('h3', { text: `${titulo} (${arr.length})` }),
      tabla(cab, [...arr.map(fila), ['Total', '', '', '', '', el('b', { text: num(suma(arr, 'kwhMes')) }), '',
        num(suma(arr, 'horasMes')), '', suma(arr, 'litros') ? num(suma(arr, 'litros')) : '—', '', '', '', '', '']],
        { num: [2, 3, 4, 5, 6, 7, 9, 10] })
    ]) : null;
    poner(zona, kpis,
      bloque('Generadores propios', filas.filter(x => x.g.propiedad === 'Propio')),
      bloque('Generadores de arriendo', filas.filter(x => x.g.propiedad !== 'Propio')),
      el('p', { class: 'ayuda', text: 'Factor de carga = kW medio del mes (kWh ÷ horas) sobre la potencia nominal. ' +
        'Litros: cargas de combustible del mes (Recargas). L/kWh solo para los que tienen cargas registradas.' }));
  }
  cargar();
}

/* ---------- ficha del generador ----------
   Reemplaza la hoja por equipo: datos, ingreso y devolución, la tabla mensual
   (kW, kWh y horómetro de cada toma, con lo generado en el mes) y el gráfico. */
async function fichaGenerador(g) {
  modal(genNombre(g), el('p', { class: 'cargando', text: 'Cargando…' }), { completo: true, subtitulo: `${g.propiedad || ''} · ${g.proveedor || ''}` });
  const hoy = new Date();
  const meses = [];
  for (let i = 12; i >= 1; i--) meses.push(primerDiaDelMes(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)));
  let d, movs = [];
  try {
    d = await datosGeneradores(meses);
    const r = await sb.from('generador_movimientos').select('*').eq('generador_id', g.id).order('fecha');
    movs = r.data || [];
  } catch (e) { return modal(genNombre(g), el('p', { class: 'error', text: e.message || String(e) })); }
  g = d.gens.find(x => x.id === g.id) || g;
  const gente = S.catalogo?.gente || {};
  const filas = meses.map(m => ({ m, r: resumenGenerador(g, m, d) }));
  const conDato = filas.filter(x => x.r.tomado || x.r.kwhMes != null);
  const dato = (k, v) => el('div', { class: 'dato-gen' }, [el('small', { text: k }), el('b', { text: v ?? '—' })]);
  const ingreso = movs.filter(m => m.tipo === 'ingreso').pop();
  const devol = movs.filter(m => m.tipo === 'devolucion').pop();
  const mov = (titulo, m) => el('div', { class: 'card' }, [
    el('h4', { style: 'margin-top:0', text: titulo }),
    m ? el('p', { class: 'ayuda', text: `${fechaCorta(m.fecha)} · horómetro ${m.horometro != null ? num(m.horometro) : '—'} · ${m.kwh != null ? num(m.kwh) + ' kWh' : 'kWh —'}` +
      (m.observaciones ? ` · ${m.observaciones}` : '') }) : el('p', { class: 'ayuda', text: 'Sin registro.' })
  ]);
  // Las importadas no tienen usuario: el responsable de la planilla viaja en la observación.
  const autor = l => l ? (gente[l.tomada_por] || (l.origen === 'importacion'
    ? ((l.observacion || '').split(' · ').find(t => t.startsWith('Responsable en planilla: '))?.slice(25) || 'Planilla')
    : '—')) : '—';

  const cuerpo = el('div', {}, [
    el('div', { class: 'datos-gen' }, [
      dato('N° interno', g.n_interno), dato('TAG / N° equipo', g.n_equipo), dato('Marca', g.proveedor),
      dato('Propiedad', g.propiedad), dato('Potencia nominal', g.potencia_nominal_kw ? num(g.potencia_nominal_kw) + ' kW' : null),
      dato('Carga base', g.carga_base_kw ? num(g.carga_base_kw) + ' kW' : null), dato('Ubicación', g.ubicacion),
      dato('Sincronismo', g.sincronismo), dato('Combustible', g.combustible), dato('Estado', g.estado)
    ]),
    g.observaciones ? el('p', { class: 'banda neutro', text: g.observaciones }) : null,
    el('div', { class: 'grid2' }, [mov('Ingreso a faena', ingreso), mov('Devolución', devol)]),
    graficoBarras(conDato.filter(x => x.r.kwhMes != null).map(x => ({ etiqueta: nombrePeriodo(x.m).split(' ')[0].slice(0, 3), valor: x.r.kwhMes })),
      { titulo: 'Energía generada por mes', unidad: 'kWh' }),
    tabla(['Mes', 'Toma', 'kW', 'kWh acumulado', 'kWh del mes', 'Horómetro', 'Horas del mes', 'Factor carga', 'Litros', 'L/kWh', 'Tomada por'],
      [...filas].reverse().map(({ m, r }) => [
        nombrePeriodo(m), r.toma ? fechaCorta(r.toma.fecha_lectura) : '—', r.kw != null ? num(r.kw) : '—',
        r.kwhAcum != null ? num(r.kwhAcum) : '—', r.kwhMes != null ? el('b', { text: num(r.kwhMes) }) : '—',
        r.horAcum != null ? num(r.horAcum) : '—', r.horasMes != null ? num(r.horasMes) : '—',
        r.factor != null ? num(r.factor) + '%' : '—', r.litros != null ? num(r.litros) : '—',
        r.lPorKwh != null ? num(r.lPorKwh, 3) : '—', autor(r.toma)]),
      { num: [2, 3, 4, 5, 6, 7, 8, 9] }),
    el('div', { class: 'fila', style: 'margin-top:12px' }, [
      el('button', { class: 'btn chico', text: 'PDF de la ficha', onclick: () => imprimirFichaGenerador(g, filas, ingreso, devol, autor) }),
      el('button', { class: 'btn chico', text: 'Registrar ingreso / devolución', onclick: () => movimientoGenerador(g) }),
      ['admin', 'supervisor', 'casa_fuerza'].includes(S.usuario.rol)
        ? el('button', { class: 'btn chico', text: 'Editar datos', onclick: () => editarGenerador(g) }) : null
    ])
  ]);
  modal(genNombre(g), cuerpo, { completo: true, subtitulo: `${g.propiedad || ''} · ${g.proveedor || ''}` });
}

/* ---------- PDF y respaldo de Casa de Fuerza ----------
   Mismo mecanismo que el informe de consumos: una hoja en blanco y negro que el
   navegador guarda como PDF. El cierre va en A4 horizontal (son muchas columnas). */
function imprimirHoja(hoja, horizontal = false) {
  const cont = document.getElementById('impresion');
  const pagina = horizontal ? el('style', { id: 'pagina-h', text: '@page{size:A4 landscape;margin:10mm}' }) : null;
  if (pagina) document.head.append(pagina);
  cont.replaceChildren(hoja);
  document.body.classList.add('imprimiendo');
  const limpiar = () => {
    document.body.classList.remove('imprimiendo');
    cont.replaceChildren();
    if (pagina) pagina.remove();
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);
  setTimeout(() => window.print(), 150);
}

const cabHoja = (titulo, sub) => el('table', { class: 'cab-informe' }, [el('tbody', {}, [el('tr', {}, [
  el('td', {}, [el('h1', { text: titulo }), el('p', { text: sub })]),
  el('td', { class: 'num', html: `Algorta Norte · Casa de Fuerza<br>${esc(S.usuario.nombre)}<br>${fechaCorta(new Date().toISOString())}` })
])])]);
const thx = (t, n) => el('th', { class: n ? 'num' : null, text: t });
const tdx = (t, n, cl) => el('td', { class: [n ? 'num' : '', cl || ''].join(' ').trim() || null, text: t ?? '—' });

async function imprimirCierreCF(mes, d) {
  const filas = d.gens.map(g => ({ g, r: resumenGenerador(g, mes, d) }))
    .filter(({ g, r }) => g.activo || r.kwhMes != null || r.tomado).sort((a, b) => ordenGen(a.g, b.g));
  const suma = (arr, k) => arr.reduce((a, x) => a + (x.r[k] || 0), 0);
  let avisos = [];
  try {
    const ids = d.gens.filter(g => g.punto_id).map(g => g.punto_id);
    const r = await sb.from('avisos').select('punto_id, descripcion, severidad, abierto_en, categoria:catalogo_avisos(categoria)')
      .neq('estado', 'resuelto').in('punto_id', ids.length ? ids : [0]);
    avisos = r.data || [];
  } catch { /* el PDF sale igual */ }
  const cuerpo = [];
  for (const [titulo, arr] of [['GENERADORES PROPIOS', filas.filter(x => x.g.propiedad === 'Propio')],
                               ['GENERADORES DE ARRIENDO', filas.filter(x => x.g.propiedad !== 'Propio')]]) {
    if (!arr.length) continue;
    cuerpo.push(el('tr', { class: 'grupo' }, [el('td', { colspan: 13, text: titulo })]));
    for (const { g, r } of arr) cuerpo.push(el('tr', {}, [
      tdx(g.n_interno || '—'), tdx(g.n_equipo), tdx(num(g.potencia_nominal_kw), 1), tdx(r.kw != null ? num(r.kw) : '—', 1),
      tdx(r.kwhAcum != null ? num(r.kwhAcum) : (g.activo ? 'sin toma' : '—'), 1),
      tdx(r.kwhMes != null ? num(r.kwhMes) : '—', 1, 'total'), tdx(r.horAcum != null ? num(r.horAcum) : '—', 1),
      tdx(r.horasMes != null ? num(r.horasMes) : '—', 1), tdx(r.factor != null ? num(r.factor) + '%' : '—', 1),
      tdx(r.litros != null ? num(r.litros) : '—', 1), tdx(r.lPorKwh != null ? num(r.lPorKwh, 3) : '—', 1),
      tdx(g.estado || '—'), tdx(g.ubicacion || '—')]));
    cuerpo.push(el('tr', { class: 'suma' }, [el('td', { colspan: 5, text: 'Subtotal' }), tdx(num(suma(arr, 'kwhMes')), 1),
      tdx(''), tdx(num(suma(arr, 'horasMes')), 1), tdx(''), tdx(suma(arr, 'litros') ? num(suma(arr, 'litros')) : '—', 1),
      el('td', { colspan: 3 })]));
  }
  const kwh = suma(filas, 'kwhMes'), lit = suma(filas, 'litros');
  const kwhD = filas.filter(x => x.r.litros).reduce((a, x) => a + (x.r.kwhMes || 0), 0);
  const nomGen = id => { const g = d.gens.find(x => x.punto_id === id); return g ? genNombre(g) : '—'; };
  const hoja = el('div', { class: 'hoja hoja-informe' }, [
    cabHoja('Casa de Fuerza · Cierre de generadores', nombrePeriodo(mes).replace(/^./, c => c.toUpperCase()) +
      ` · toma del ${fechaCorta(mesSiguiente(mes))}`),
    el('p', { style: 'margin-bottom:8px', html:
      `<b>Energía generada:</b> ${num(kwh)} kWh &nbsp;·&nbsp; <b>Horas de marcha:</b> ${num(suma(filas, 'horasMes'))} h &nbsp;·&nbsp; ` +
      `<b>Combustible:</b> ${lit ? num(lit) + ' L' : '—'} &nbsp;·&nbsp; <b>L/kWh (diésel):</b> ${lit && kwhD ? num(lit / kwhD, 3) : '—'}` }),
    el('table', { class: 'planilla' }, [
      el('thead', {}, [el('tr', {}, [thx('N° int.'), thx('Equipo'), thx('Pot. nom. kW', 1), thx('kW toma', 1), thx('kWh acumulado', 1),
        thx('kWh del mes', 1), thx('Horómetro', 1), thx('Horas mes', 1), thx('F. carga', 1), thx('Litros', 1), thx('L/kWh', 1),
        thx('Estado'), thx('Ubicación')])]),
      el('tbody', {}, cuerpo)
    ]),
    avisos.length ? el('div', {}, [el('h2', { text: `Avisos abiertos (${avisos.length})` }),
      el('table', { class: 'planilla' }, [
        el('thead', {}, [el('tr', {}, [thx('Generador'), thx('Categoría'), thx('Severidad'), thx('Abierto'), thx('Descripción')])]),
        el('tbody', {}, avisos.map(a => el('tr', {}, [tdx(nomGen(a.punto_id)), tdx(a.categoria?.categoria), tdx(a.severidad),
          tdx(fechaCorta(a.abierto_en)), tdx(a.descripcion)])))])]) : null,
    el('div', { class: 'pie-informe' }, [
      el('p', { text: 'kWh y horas del mes = toma del día 1 del mes siguiente − toma anterior. Factor de carga = kW medio (kWh ÷ horas) sobre la potencia nominal. ' +
        'Litros = cargas de combustible registradas en el mes.' }),
      el('p', { style: 'margin-top:18px', text: 'Revisado por: ______________________________     Firma: ____________________' })
    ])
  ]);
  imprimirHoja(hoja, true);
}

function imprimirFichaGenerador(g, filas, ingreso, devol, autor) {
  const dato = (k, v) => el('tr', {}, [el('th', { text: k }), el('td', { text: v ?? '—' })]);
  const mov = m => m ? `${fechaCorta(m.fecha)} · horómetro ${m.horometro != null ? num(m.horometro) : '—'} · ${m.kwh != null ? num(m.kwh) + ' kWh' : 'kWh —'}` : 'Sin registro';
  const conKwh = filas.filter(x => x.r.kwhMes != null);
  const hoja = el('div', { class: 'hoja hoja-informe' }, [
    cabHoja('Ficha del generador · ' + genNombre(g), `${g.propiedad || ''} · ${g.proveedor || ''}`),
    el('table', { class: 'planilla', style: 'width:60%' }, [el('tbody', {}, [
      dato('N° interno', g.n_interno), dato('TAG / N° equipo', g.n_equipo), dato('Marca', g.proveedor),
      dato('Potencia nominal', g.potencia_nominal_kw ? num(g.potencia_nominal_kw) + ' kW' : null),
      dato('Carga base', g.carga_base_kw ? num(g.carga_base_kw) + ' kW' : null), dato('Ubicación', g.ubicacion),
      dato('Sincronismo', g.sincronismo), dato('Combustible', g.combustible), dato('Estado', g.estado),
      dato('Ingreso a faena', mov(ingreso)), dato('Devolución', mov(devol)), dato('Observaciones', g.observaciones)])]),
    conKwh.length > 1 ? graficoBarras(conKwh.map(x => ({ etiqueta: nombrePeriodo(x.m).split(' ')[0].slice(0, 3), valor: x.r.kwhMes })),
      { titulo: 'Energía generada por mes', unidad: 'kWh', alto: 170 }) : null,
    el('h2', { text: 'Tomas mensuales' }),
    el('table', { class: 'planilla' }, [
      el('thead', {}, [el('tr', {}, [thx('Mes'), thx('Toma'), thx('kW', 1), thx('kWh acumulado', 1), thx('kWh del mes', 1),
        thx('Horómetro', 1), thx('Horas del mes', 1), thx('F. carga', 1), thx('Litros', 1), thx('L/kWh', 1), thx('Tomada por')])]),
      el('tbody', {}, [...filas].reverse().map(({ m, r }) => el('tr', {}, [
        tdx(nombrePeriodo(m)), tdx(r.toma ? fechaCorta(r.toma.fecha_lectura) : '—'), tdx(r.kw != null ? num(r.kw) : '—', 1),
        tdx(r.kwhAcum != null ? num(r.kwhAcum) : '—', 1), tdx(r.kwhMes != null ? num(r.kwhMes) : '—', 1, 'total'),
        tdx(r.horAcum != null ? num(r.horAcum) : '—', 1), tdx(r.horasMes != null ? num(r.horasMes) : '—', 1),
        tdx(r.factor != null ? num(r.factor) + '%' : '—', 1), tdx(r.litros != null ? num(r.litros) : '—', 1),
        tdx(r.lPorKwh != null ? num(r.lPorKwh, 3) : '—', 1), tdx(autor(r.toma))])))
    ]),
    el('div', { class: 'pie-informe' }, [el('p', { text: 'Generado con la app Cierre de Mes (beta).' })])
  ]);
  imprimirHoja(hoja, false);
}

// ZIP del mes: Excel (portada, cierre, lecturas, combustible, movimientos) y las
// fotos de la toma que cierra el mes, una carpeta por generador.
async function respaldoCF(mes, d, paso) {
  if (typeof JSZip === 'undefined') {
    paso('Cargando el compresor…');
    await new Promise((ok, mal) => { const sc = document.createElement('script'); sc.src = 'jszip.js'; sc.onload = ok; sc.onerror = mal; document.head.append(sc); });
  }
  const R = window.RESPALDO;
  const toma = mesSiguiente(mes);
  const ids = Object.values(d.idsDe).flatMap(x => Object.values(x).filter(Boolean).map(v => v.id));
  paso('Consultando lecturas y combustible…');
  const [lec, rec, mov] = await Promise.all([
    sb.from('lecturas').select('id, variable_id, periodo, valor, valor_display, valor_mwh, valor_kwh, fecha_lectura, sin_dato, es_reset, tomada_por, origen, observacion, fotos(id, storage_path, orden)')
      .in('variable_id', ids.length ? ids : [0]).eq('periodo', toma).neq('estado', 'descartada'),
    sb.from('v_recargas').select('*').eq('periodo', mes).order('fecha_hora'),
    sb.from('generador_movimientos').select('*, generador:generadores(n_equipo, n_interno)').order('fecha')
  ]);
  for (const r of [lec, rec, mov]) if (r.error) throw r.error;
  const genDeVar = {};
  for (const g of d.gens) for (const v of Object.values(d.idsDe[g.id] || {})) if (v) genDeVar[v.id] = { g, v };
  const gente = S.catalogo?.gente || {};
  const quien = l => gente[l.tomada_por] || (l.origen === 'importacion'
    ? ((l.observacion || '').split(' · ').find(t => t.startsWith('Responsable en planilla: '))?.slice(25) || 'Planilla') : '');
  const fecha = iso => new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');

  const filas = d.gens.map(g => ({ g, r: resumenGenerador(g, mes, d) }))
    .filter(({ g, r }) => g.activo || r.kwhMes != null || r.tomado).sort((a, b) => ordenGen(a.g, b.g));
  const nm = nombrePeriodo(mes);
  const hojas = [
    { nombre: 'Portada', portada: true, anchos: [24, 70], encabezado: 'Casa de Fuerza', filas: [
      [{ v: 'Cierre de Mes · Casa de Fuerza', fuente: 'nota' }], [{ v: 'Generadores', fuente: 'grande' }],
      [{ v: nm.replace(/^./, c => c.toUpperCase()) + ` · toma del ${fechaCorta(toma)}`, fuente: 'titulo' }], [],
      [{ v: 'Generado', fuente: 'b' }, fecha(new Date().toISOString())], [{ v: 'Por', fuente: 'b' }, S.usuario.nombre], [],
      [{ v: 'Contenido', fuente: 'titulo' }],
      [{ v: 'Cierre', fuente: 'b' }, 'Un generador por fila: kWh y horas del mes, factor de carga, litros y L/kWh.'],
      [{ v: 'Lecturas', fuente: 'b' }, 'La toma que cierra el mes, con quién la tomó.'],
      [{ v: 'Combustible', fuente: 'b' }, 'Cada carga del mes.'],
      [{ v: 'Movimientos', fuente: 'b' }, 'Ingresos, devoluciones y traslados de equipos.'],
      [{ v: 'Fotos/', fuente: 'b' }, 'Las fotos de la toma, una carpeta por generador.']] },
    { nombre: 'Cierre', encabezado: 'Casa de Fuerza', tabla: { nombre: 'Cierre', totales: { etiqueta: 'Total filtrado', desde: 5 } },
      intro: [`Casa de Fuerza · Cierre de generadores · ${nm}`, 'kWh y horas del mes = toma del día 1 del mes siguiente − toma anterior.'],
      filas: [['N° interno', 'Equipo', 'Propiedad', 'Marca', 'Pot. nominal kW', 'kWh del mes', 'Horas del mes', 'Litros',
               'kW toma', 'kWh acumulado', 'Horómetro', 'Factor de carga %', 'L/kWh', 'Estado', 'Sincronismo', 'Ubicación', 'Observaciones'],
        ...filas.map(({ g, r }) => [g.n_interno || '', g.n_equipo, g.propiedad || '', g.proveedor || '', Number(g.potencia_nominal_kw) || '',
          r.kwhMes ?? '', r.horasMes ?? '', r.litros ?? '', r.kw ?? '', r.kwhAcum ?? '', r.horAcum ?? '',
          r.factor != null ? { v: Math.round(r.factor * 10) / 10, s: 'pct' } : '', r.lPorKwh != null ? Math.round(r.lPorKwh * 1000) / 1000 : '',
          g.estado || '', g.sincronismo || '', g.ubicacion || '', g.observaciones || ''])] },
    { nombre: 'Lecturas', encabezado: 'Casa de Fuerza', tabla: { nombre: 'Lecturas' },
      intro: [`Casa de Fuerza · Toma del ${fechaCorta(toma)}`, 'Valores en kWh, horas y kW.'],
      filas: [['N° interno', 'Equipo', 'Lectura', 'Valor', 'Fecha', 'Tomada por', 'Fotos', 'Observación'],
        ...(lec.data || []).filter(l => genDeVar[l.variable_id]).map(l => {
          const { g, v } = genDeVar[l.variable_id];
          return [g.n_interno || '', g.n_equipo, v.nombre, l.sin_dato ? 'sin dato' : Number(l.valor), fecha(l.fecha_lectura),
            quien(l), { v: (l.fotos || []).length, s: 'ent' }, l.observacion || ''];
        })] },
    { nombre: 'Combustible', encabezado: 'Casa de Fuerza', tabla: { nombre: 'Combustible', totales: { etiqueta: 'Total', desde: 3 } },
      intro: [`Casa de Fuerza · Combustible de ${nm}`, 'Cada carga registrada en el mes.'],
      filas: [['Fecha', 'Generador', 'Combustible', 'Litros', 'Origen', 'Anotó', 'Registró'],
        ...(rec.data || []).filter(r => !r.anulada).map(r => [fecha(r.fecha_hora), r.n_equipo, r.combustible || '', Number(r.litros),
          r.origen || '', r.operador || '', r.registrado_por_nombre || ''])] },
    { nombre: 'Movimientos', encabezado: 'Casa de Fuerza', tabla: { nombre: 'Movimientos' },
      intro: ['Casa de Fuerza · Movimientos de equipos', 'Ingresos, devoluciones y traslados.'],
      filas: [['Fecha', 'Generador', 'Movimiento', 'Horómetro', 'kWh', 'Ubicación', 'Observaciones'],
        ...(mov.data || []).map(m => [m.fecha, m.generador ? (m.generador.n_interno ? m.generador.n_interno + ' · ' : '') + m.generador.n_equipo : '',
          m.tipo, m.horometro != null ? Number(m.horometro) : '', m.kwh != null ? Number(m.kwh) : '', m.ubicacion || '', m.observaciones || ''])] }
  ];
  if (hojas[2].filas.length === 1) hojas[2].filas.push(['', '', 'Sin lecturas de esta toma']);
  if (hojas[3].filas.length === 1) hojas[3].filas.push(['', 'Sin cargas en el mes', '', 0]);
  if (hojas[4].filas.length === 1) hojas[4].filas.push(['', 'Sin movimientos registrados']);

  const zip = new JSZip();
  paso('Armando el Excel…');
  zip.file(`Casa_de_Fuerza_${mes.slice(0, 7)}.xlsx`, await R.construirExcel(hojas));
  const conFoto = (lec.data || []).filter(l => genDeVar[l.variable_id] && (l.fotos || []).length);
  let n = 0, total = conFoto.reduce((a, l) => a + l.fotos.length, 0);
  for (const l of conFoto) {
    const { g, v } = genDeVar[l.variable_id];
    const carpeta = 'Fotos/' + R.limpio(genNombre(g));
    for (const [i, f] of fotosOrdenadas(l).entries()) {
      paso(`Descargando fotos… ${++n} de ${total}`);
      const { data: url } = await sb.storage.from(C.BUCKET).createSignedUrl(f.storage_path, 900);
      if (!url?.signedUrl) continue;
      const blob = await (await fetch(url.signedUrl)).blob();
      zip.file(`${carpeta}/${String(l.fecha_lectura).slice(0, 10)}_${R.limpio(v.nombre)}${l.fotos.length > 1 ? '_foto' + (i + 1) : ''}.jpg`, blob);
    }
  }
  paso('Comprimiendo…');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  descargar(blob, `Respaldo_Casa_de_Fuerza_${mes.slice(0, 7)}.zip`);
  toast(`Respaldo listo: ${filas.length} generadores y ${n} fotos`);
}

/* ---------------- alta, edición y baja de generadores ---------------- */
const PROPIEDAD_GEN = ['Arriendo', 'Propio'];
const COMBUSTIBLES_GEN = ['Diesel', 'GNL', 'Bunker'];

function editarGenerador(g) {
  const nuevo = !g;
  g = g || {};
  const f = {
    n_equipo: el('input', { value: g.n_equipo || '', placeholder: 'XCES 442' }),
    n_interno: el('input', { value: g.n_interno || '', placeholder: 'G-10' }),
    propiedad: el('select'),
    proveedor: el('input', { value: g.proveedor || '', placeholder: 'Aggreko, Enerfrost…' }),
    modelo: el('input', { value: g.modelo || '' }),
    potencia: el('input', { type: 'number', step: '1', inputmode: 'numeric',
      value: g.potencia_nominal_kw ?? '', placeholder: 'kW' }),
    ubicacion: el('input', { value: g.ubicacion || '', placeholder: 'CFA, Chancado, Poza Intermedia…' }),
    estado: el('select'),
    sincronismo: el('input', { value: g.sincronismo || '', placeholder: 'Carga Base, Load Sharing…' }),
    combustible: el('select'),
    recargas: el('input', { type: 'checkbox', checked: (nuevo ? true : g.registra_recargas) || null }),
    obs: el('textarea', { value: g.observaciones || '' }),
    activo: el('input', { type: 'checkbox', checked: (nuevo ? true : g.activo) || null })
  };
  for (const p of PROPIEDAD_GEN)
    f.propiedad.append(el('option', { value: p, selected: p === (g.propiedad || 'Arriendo') || null, text: p }));
  for (const e_ of ESTADOS_GEN)
    f.estado.append(el('option', { value: e_, selected: e_ === (g.estado || 'Disponible') || null, text: e_ }));
  for (const cb of COMBUSTIBLES_GEN)
    f.combustible.append(el('option', { value: cb, selected: cb === (g.combustible || 'Diesel') || null, text: cb }));

  const cuerpo = el('div', {}, [
    el('label', { text: 'Número de equipo' }, [f.n_equipo]),
    el('label', { text: 'Número interno' }, [f.n_interno]),
    el('label', { text: 'Propiedad' }, [f.propiedad]),
    el('label', { text: 'Proveedor' }, [f.proveedor]),
    el('label', { text: 'Modelo' }, [f.modelo]),
    el('label', { text: 'Potencia nominal (kW)' }, [f.potencia]),
    el('label', { text: 'Ubicación' }, [f.ubicacion]),
    el('label', { text: 'Estado' }, [f.estado]),
    el('label', { text: 'Sincronismo' }, [f.sincronismo]),
    el('label', { text: 'Combustible' }, [f.combustible]),
    el('label', { class: 'fila' }, [f.recargas, el('span', { text: 'Registra recargas de combustible' })]),
    el('label', { text: 'Observaciones' }, [f.obs]),
    el('label', { class: 'fila' }, [f.activo, el('span', { text: 'Activo (aparece en el parque)' })]),
    el('p', { class: 'ayuda', text:
      'El estado que se ve en el parque lo manda el último movimiento registrado. ' +
      'Acá se corrige la ficha del equipo, no su historia.' }),
    el('button', { class: 'btn guardar grande', style: 'margin-top:14px',
      text: nuevo ? 'Crear el generador' : 'Guardar', onclick: async e => {
        if (!f.n_equipo.value.trim()) return toast('Ponle el número de equipo', true);
        e.target.disabled = true;
        const { data: idGen, error } = await sb.rpc('guardar_generador', {
          p_id: g.id ?? null,
          p_n_equipo: f.n_equipo.value.trim(),
          p_n_interno: f.n_interno.value.trim() || null,
          p_propiedad: f.propiedad.value,
          p_proveedor: f.proveedor.value.trim() || null,
          p_modelo: f.modelo.value.trim() || null,
          p_potencia_kw: f.potencia.value === '' ? null : Number(f.potencia.value),
          p_ubicacion: f.ubicacion.value.trim() || null,
          p_estado: f.estado.value,
          p_sincronismo: f.sincronismo.value.trim() || null,
          p_combustible: f.combustible.value,
          p_registra_recargas: f.recargas.checked,
          p_obs: f.obs.value.trim() || null,
          p_activo: f.activo.checked
        });
        if (error) { e.target.disabled = false; return toast(error.message, true); }
        // Cada generador es un punto de Terreno: se crea si falta y se mantiene al día.
        try { await asegurarPuntoGenerador(idGen ?? g.id); }
        catch (err) { toast('Generador guardado, pero no se pudo preparar su punto de Terreno: ' + (err.message || err), true); }
        e.target.disabled = false;
        cerrarModal(); toast(nuevo ? 'Generador creado' : 'Generador actualizado'); render();
      } })
  ]);

  if (!nuevo) cuerpo.append(
    el('button', { class: 'btn peligro', style: 'margin-top:18px', text: 'Eliminar este generador',
      onclick: () => eliminarCosa({
        rpc: 'eliminar_generador', id: { p_id: g.id }, nombre: g.n_equipo, que: 'el generador',
        desactivar: async () => (await sb.rpc('guardar_generador',
          { p_id: g.id, p_n_equipo: g.n_equipo, p_activo: false, p_estado: 'De baja' })).error
      }) }));

  modal(nuevo ? 'Generador nuevo' : g.n_equipo, cuerpo);
}

// El punto de Terreno de un generador: nombre "N° interno · equipo", grupo
// Generadores y tres lecturas (kWh generado, horas de marcha, potencia del momento).
// Si ya existe, solo se pone al día el nombre, la ubicación y si está activo.
async function asegurarPuntoGenerador(id) {
  if (!id) return;
  const { data: g, error } = await sb.from('generadores').select('*').eq('id', id).single();
  if (error) throw error;
  const nombre = (g.n_interno ? g.n_interno + ' · ' : '') + g.n_equipo;
  if (g.punto_id) {
    const r = await sb.from('puntos').update({ nombre, area: g.ubicacion, activo: g.activo }).eq('id', g.punto_id);
    if (r.error) throw r.error;
    return;
  }
  const { data: p, error: e1 } = await sb.from('puntos').insert({
    nombre, sitio_id: 3, area: g.ubicacion, tipo_equipo_id: 4, foto_obligatoria: true, activo: g.activo,
    fuente_origen: 'Casa de Fuerza', instruccion_lectura: 'Anota el kWh acumulado, el horómetro y la potencia del momento. Foto del display.'
  }).select('id').single();
  if (e1) throw e1;
  const grupo = (S.catalogo.grupos || []).find(x => x.nombre === 'Generadores');
  if (grupo) await sb.from('grupo_puntos').insert({ grupo_id: grupo.id, punto_id: p.id });
  const doble = g.formato_lectura === 'doble_mwh_kwh';
  const vars = [
    { p_nombre: 'Energía generada (kWh)', p_unidad_display: doble ? 'MWh' : 'kWh', p_unidad_reporte: 'kWh', p_formato: doble ? 'doble_mwh_kwh' : 'simple', p_opcional: false, informe: true },
    { p_nombre: 'Horas de marcha', p_unidad_display: 'Hrs', p_unidad_reporte: 'Hrs', p_formato: 'simple', p_opcional: false, informe: true },
    { p_nombre: 'Potencia (kW)', p_unidad_display: 'kW', p_unidad_reporte: 'kW', p_formato: 'simple', p_opcional: true, informe: false }
  ];
  for (const { informe, ...v } of vars) {
    const { data: idVar, error: e2 } = await sb.rpc('guardar_variable', { p_id: null, p_punto_id: p.id, p_decimales: 0, p_principal: true, p_activo: true, ...v });
    if (e2) throw e2;
    await sb.from('variables').update({ en_informe: informe, ...(v.p_unidad_reporte === 'kW' ? { tipo_acumulacion: 'instantanea' } : {}) }).eq('id', idVar);
  }
  const r = await sb.from('generadores').update({ punto_id: p.id }).eq('id', id);
  if (r.error) throw r.error;
  await DB.descargarCatalogo().catch(() => {});
  S.catalogo = await DB.catalogo();
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

  const guardar = el('button', { class: 'btn guardar grande', text: 'Guardar movimiento',
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

/* ---------------- Combustible: la planilla del día ----------------
   Los operadores de Casa de Fuerza anotan a mano, cada día, los litros que le
   cargan a cada generador (una o varias veces). Esta pantalla es para pasar esa
   hoja de una vez: una fila por generador, una casilla por carga. Debajo, la
   grilla del mes (generador × día) para comparar contra el papel. */
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

async function vistaRecargas(c) {
  S.diaCF = S.diaCF || hoyISO();
  const dia = S.diaCF, mes = dia.slice(0, 7) + '-01';
  const inDia = el('input', { type: 'date', value: dia, max: hoyISO(), onchange: e => { if (e.target.value) { S.diaCF = e.target.value; render(); } } });
  const operador = el('input', { type: 'text', value: S.operadorCF || '', placeholder: 'Quién anotó la hoja (operador / turno)',
    oninput: e => { S.operadorCF = e.target.value; } });
  c.append(el('div', { class: 'fila entre seccion' }, [
    el('label', { text: 'Día de la planilla' }, [inDia]),
    el('label', { class: 'crece', text: 'Anotó' }, [operador]),
    el('button', { class: 'btn', text: 'Carga con guía o camión', onclick: () => nuevaRecarga() })
  ]));
  const zona = el('div', {}, [el('p', { class: 'cargando', text: 'Cargando…' })]);
  c.append(zona);

  const cola = (await DB.pendientes()).filter(x => x.tipo === 'recarga');
  let recargas = [], sinRed = false;
  try {
    const { data, error } = await sb.from('v_recargas').select('*').eq('periodo', mes).order('fecha_hora');
    if (error) throw error;
    recargas = (data || []).filter(r => !r.anulada);
  } catch { sinRed = true; }

  // Diésel: los de gas no se abastecen con esta planilla.
  const gens = (S.catalogo.generadores || [])
    .filter(g => g.activo !== false && !/gnl|gas/i.test(g.combustible || ''))
    .sort(ordenGen);
  const delDia = r => r.fecha_dia === dia;
  const horaDe = r => new Date(r.fecha_hora).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });

  // ---- planilla del día ----
  const entradas = new Map();          // generador → [{ litros, hora }]
  const casilla = (g, cont) => {
    const litros = el('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', placeholder: 'L', class: 'carga-l' });
    const hora = el('input', { type: 'time', class: 'carga-h', title: 'Hora (opcional)' });
    entradas.get(g.id).push({ litros, hora });
    cont.append(el('span', { class: 'carga' }, [litros, hora]));
    return litros;
  };
  const filas = gens.map(g => {
    entradas.set(g.id, []);
    const ya = recargas.filter(r => r.generador_id === g.id && delDia(r));
    const cont = el('div', { class: 'cargas' });
    casilla(g, cont);
    const totalYa = ya.reduce((a, r) => a + Number(r.litros), 0);
    return [
      el('span', { html: `<b>${esc(g.n_interno || '—')}</b> <small class="tenue-b">${esc(g.n_equipo)}</small>` }),
      ya.length ? el('div', { class: 'marcas' }, ya.map(r => el(esSupervisor() ? 'button' : 'span', {
        class: 'pill neutro', title: `${r.registrado_por_nombre || ''}${r.operador ? ' · anotó ' + r.operador : ''}`,
        text: `${num(r.litros)} L · ${horaDe(r)}`, onclick: esSupervisor() ? () => anularRecarga(r) : null }))) : '—',
      el('div', { class: 'fila' }, [cont, el('button', { class: 'btn chico', text: '+', title: 'Otra carga del mismo día',
        onclick: () => casilla(g, cont).focus() })]),
      totalYa ? num(totalYa) : '—'
    ];
  });

  const guardar = el('button', { class: 'btn guardar grande', text: 'Guardar planilla del día', onclick: async () => {
    const nuevas = [];
    for (const g of gens) {
      (entradas.get(g.id) || []).forEach((x, k) => {
        const l = Number(x.litros.value);
        if (!x.litros.value || !(l > 0)) return;
        // sin hora: 08:00, 08:01… así dos cargas iguales del mismo día no se toman por duplicado
        const hh = x.hora.value || `08:${String(k).padStart(2, '0')}`;
        nuevas.push({ tipo: 'recarga', generador_id: g.id, fecha_hora: new Date(`${dia}T${hh}:00`).toISOString(),
          litros: l, combustible: 'Diesel', origen: 'Planilla diaria', guia: null, camion: null, horometro: null,
          operador: operador.value.trim() || null, observaciones: null, dispositivo: 'Planilla diaria · ' + navigator.userAgent.slice(0, 90) });
      });
    }
    if (!nuevas.length) return toast('No hay litros escritos', true);
    guardar.disabled = true;
    let ok = 0, enCola = 0;
    for (const f of nuevas) {
      if (navigator.onLine) {
        const { error } = await sb.rpc('registrar_recarga', {
          p_generador_id: f.generador_id, p_fecha_hora: f.fecha_hora, p_litros: f.litros, p_combustible: f.combustible,
          p_origen: f.origen, p_guia: null, p_camion: null, p_horometro: null, p_operador: f.operador,
          p_obs: null, p_dispositivo: f.dispositivo });
        if (error) { await DB.encolar(f); enCola++; } else ok++;
      } else { await DB.encolar(f); enCola++; }
    }
    await actualizarConexion();
    toast(`${ok} carga(s) guardadas` + (enCola ? ` · ${enCola} en el dispositivo, se enviarán con señal` : ''));
    render();
  } });

  const totDia = recargas.filter(delDia).reduce((a, r) => a + Number(r.litros), 0);

  // ---- grilla del mes: generador × día ----
  const fin = new Date(mes.slice(0, 4), +mes.slice(5, 7), 0).getDate();
  const ultimo = mes.slice(0, 7) === hoyISO().slice(0, 7) ? +hoyISO().slice(8, 10) : fin;
  const dias = Array.from({ length: ultimo }, (_, i) => i + 1);
  const idsMes = new Set(recargas.map(r => r.generador_id));
  const gensMes = [...gens, ...(S.catalogo.generadores || []).filter(g => idsMes.has(g.id) && !gens.includes(g))];
  const celda = (gid, d) => recargas.filter(r => r.generador_id === gid && +r.fecha_dia.slice(8, 10) === d)
    .reduce((a, r) => a + Number(r.litros), 0);
  const cabDia = d => el('button', { class: 'celda-cons' + (d === +dia.slice(8, 10) ? ' rev' : ''), text: String(d),
    onclick: () => { S.diaCF = mes.slice(0, 8) + String(d).padStart(2, '0'); render(); } });
  const totalMes = recargas.reduce((a, r) => a + Number(r.litros), 0);
  const grilla = el('div', { class: 'tabla-caja grilla-mes' }, [el('table', {}, [
    el('thead', {}, [el('tr', {}, [el('th', { text: 'Generador' }), ...dias.map(d => el('th', {}, [cabDia(d)])), el('th', { text: 'Total' })])]),
    el('tbody', {}, [
      ...gensMes.map(g => el('tr', {}, [el('td', { text: g.n_interno || g.n_equipo }),
        ...dias.map(d => { const v = celda(g.id, d); return el('td', { class: 'num', text: v ? num(v) : '' }); }),
        el('td', { class: 'num' }, [el('b', { text: (t => t ? num(t) : '')(recargas.filter(r => r.generador_id === g.id).reduce((a, r) => a + Number(r.litros), 0)) })])])),
      el('tr', { class: 'fila-total' }, [el('td', { text: 'Total del día' }),
        ...dias.map(d => { const v = recargas.filter(r => +r.fecha_dia.slice(8, 10) === d).reduce((a, r) => a + Number(r.litros), 0);
          return el('td', { class: 'num', text: v ? num(v) : '' }); }),
        el('td', { class: 'num' }, [el('b', { text: num(totalMes) })])])
    ])
  ])]);

  poner(zona,
    cola.length ? el('p', { class: 'banda warn', text: `${cola.length} carga(s) guardadas en este dispositivo, todavía sin enviar.` }) : null,
    sinRed ? el('p', { class: 'banda warn', text: 'Sin señal: no se pudo traer lo ya enviado. Igual puedes anotar: se guarda en el dispositivo.' }) : null,
    el('div', { class: 'kpis seccion' }, [
      kpi(num(totDia) + ' L', 'cargados el ' + fechaCorta(dia)),
      kpi(num(totalMes) + ' L', 'en ' + nombrePeriodo(mes)),
      kpi(recargas.length, 'cargas del mes')
    ]),
    el('div', { class: 'card seccion' }, [
      el('h3', { style: 'margin-top:0', text: `Planilla del ${fechaCorta(dia)}` }),
      el('p', { class: 'ayuda', text: 'Escribe los litros de cada carga. Si un generador cargó más de una vez, toca + para otra casilla. ' +
        'La hora es opcional. Lo ya guardado aparece en gris' + (esSupervisor() ? ' (tócalo para anularlo).' : '.') }),
      tabla(['Generador', 'Ya guardado', 'Nuevas cargas (L)', 'Total del día'], filas, { num: [3] }),
      el('div', { class: 'fila', style: 'margin-top:12px' }, [guardar])
    ]),
    el('div', { class: 'seccion' }, [
      el('h3', { text: `Mes de ${nombrePeriodo(mes)} · litros por día` }),
      el('p', { class: 'ayuda', text: 'Para revisar contra las hojas de papel. Toca un día para abrir su planilla. ' +
        'Los L/kWh y el factor de carga están en Cierre del mes.' }),
      grilla
    ])
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
    const c = String(g?.combustible || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (g && g.combustible) selComb.value = /diesel/i.test(c) ? 'Diesel' : /gnl|gas/i.test(c) ? 'GNL' : /bunker/i.test(c) ? 'Bunker' : 'Otro';
  };
  selGen.addEventListener('change', sincronizarComb);
  sincronizarComb();

  const boton = el('button', { class: 'btn guardar grande', text: 'Guardar recarga', onclick: async () => {
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
    const optsPrevios = _modalOpts;
    const scrollPrevio = $('#modal-cuerpo').scrollTop;

    const video = el('video', { playsinline: '', muted: '', autoplay: '' });
    const estado = el('p', { class: 'ayuda', text: 'Apunta al código. Se lee solo.' });
    const manual = el('input', { type: 'text', placeholder: 'o escribe el código: CM-P-12' });
    let vivo = true, flujo = null;

    const terminar = valor => {
      if (!vivo) return;
      vivo = false;
      flujo && flujo.getTracks().forEach(t => t.stop());
      if (habiaModal) {
        modal(tituloPrevio, hijosPrevios, optsPrevios);
        $('#modal-cuerpo').scrollTop = scrollPrevio;
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
    ]), { completo: !!(habiaModal && optsPrevios.completo), alPedirCerrar: () => terminar(null) });

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
  // La captura es del punto completo: ya no hay que elegir variable.
  abrirCaptura(r.punto);
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
        'Toma la lectura igual: el dato del display es el dato. Y si el medidor se cambió, ' +
        'confírmalo aquí para que el consumo no se compare contra el histórico del medidor viejo.'
      : `Este punto no tiene medidor asignado y escaneaste ${codigoEquipo(c.id)}.` }),
    el('button', { class: 'btn', text: `Sí, ahora este punto tiene el ${codigoEquipo(c.id)}`,
      onclick: () => reasignarMedidor(v, c.id, zona) }),
    el('button', { class: 'btn chico', text: 'No estoy seguro, solo dejar aviso',
      onclick: () => abrirAviso(v.punto, `Se escaneó ${codigoEquipo(c.id)} en este punto` +
        (instalado ? `, pero la asignación vigente es ${codigoEquipo(instalado)}.` : ', que no tiene medidor asignado.')) })
  );
}

// El cambio se aplica directo, sin pasar por el supervisor: quien está parado
// frente al instrumento es quien sabe cuál está instalado. Queda en la cola
// como cualquier otro registro, así que funciona sin señal, y en la auditoría
// con el motivo "Reasignado en terreno por QR".
async function reasignarMedidor(v, equipoId, zona) {
  const anterior = v.punto.equipo?.equipo_id || null;
  if (!confirm(`Vas a dejar el medidor ${codigoEquipo(equipoId)} como el instalado en "${v.punto.nombre}"` +
      (anterior ? `, en reemplazo del ${codigoEquipo(anterior)}` : '') + '. ¿Confirmas?')) return;

  await DB.encolar({
    tipo: 'reasignacion',
    punto_id: v.punto.id,
    equipo_id: equipoId,
    motivo: 'Reasignado en terreno por QR',
    dispositivo: navigator.userAgent.slice(0, 120)
  });

  // El catálogo local se corrige de inmediato para que el resto de la jornada
  // no siga avisando de un cambio que ya se registró.
  // El TAG solo se conoce sin señal si ese medidor está asignado a otro punto
  // del catálogo; si no, queda en blanco hasta la próxima bajada del catálogo.
  const otro = S.catalogo.variables.find(x => x.punto.equipo && x.punto.equipo.equipo_id === equipoId);
  const nuevo = otro ? { ...otro.punto.equipo } : { equipo_id: equipoId, tag: null };
  S.catalogo.variables.forEach(x => {
    if (x.punto.id === v.punto.id) x.punto.equipo = nuevo;
    else if (x.punto.equipo && x.punto.equipo.equipo_id === equipoId) x.punto.equipo = null;
  });

  poner(zona, el('p', { class: 'banda ok', text:
    `Listo: este punto queda con el ${codigoEquipo(equipoId)}${nuevo.tag ? ' · ' + nuevo.tag : ''}. ` +
    'Se envía junto con la lectura.' }));
  if (navigator.onLine) sincronizar(true);
}

/* ---------------- hoja de etiquetas imprimible ---------------- */
async function vistaEtiquetas(c) {
  const selGrupo = el('select', {}, [el('option', { value: '', text: 'Todos los grupos' }),
    ...[...S.catalogo.grupos].sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
        .map(g => el('option', { value: g.nombre, text: g.nombre }))]);
  const cuales = el('select', {}, [
    el('option', { value: 'ambos', text: 'Punto y medidor (dos etiquetas)' }),
    el('option', { value: 'punto', text: 'Solo los puntos' }),
    el('option', { value: 'equipo', text: 'Solo los medidores' })
  ]);
  const zona = el('div');

  const refrescar = () => {
    const puntos = new Map();
    for (const v of S.catalogo.variables) {
      if (selGrupo.value && !(v.punto.grupos || []).includes(selGrupo.value)) continue;
      puntos.set(v.punto.id, v.punto);
    }
    const lista = [...puntos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    const etiquetas = [];
    for (const p of lista) {
      // La etiqueta del PUNTO no menciona al medidor: el medidor se cambia y la
      // etiqueta quedaría mintiendo pegada en la estructura durante años.
      if (cuales.value !== 'equipo')
        etiquetas.push({ codigo: codigoPunto(p.id), titulo: p.nombre,
                         pie: 'Punto de medición', clase: 'punto' });
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
  for (const s of [selGrupo, cuales]) s.addEventListener('change', refrescar);

  c.append(
    el('p', { class: 'ayuda', text:
      'Dos etiquetas por punto: una para la estructura (CM-P-…) y otra para el instrumento (CM-E-…). ' +
      'Se escanean por separado, así que si mañana cambian el medidor solo se reemplaza su etiqueta. ' +
      'Imprímelas en papel adhesivo y protégelas con cinta transparente: en la pampa el sol borra la tinta.' }),
    el('div', { class: 'fila seccion' }, [
      el('label', { class: 'crece', text: 'Grupo' }, [selGrupo]),
      el('label', { class: 'crece', text: 'Qué imprimir' }, [cuales])
    ]),
    zona);
  refrescar();
}

// Dos PNG por código: la etiqueta lista para pegar (QR + nombre + código) y el
// QR solo, para quien ya tiene su propia plantilla con el texto puesto.
// El QR se dibuja módulo a módulo en un canvas: convertir el SVG a PNG en el
// navegador da tamaños distintos según el motor.
function lienzoQR(codigo, lado) {
  const q = qrcode(0, 'M'); q.addData(codigo); q.make();
  const n = q.getModuleCount();
  const escala = Math.max(2, Math.floor(lado / (n + 8)));
  const px = (n + 8) * escala;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, px, px);
  cx.fillStyle = '#000';
  for (let f = 0; f < n; f++)
    for (let c = 0; c < n; c++)
      if (q.isDark(f, c)) cx.fillRect((c + 4) * escala, (f + 4) * escala, escala, escala);
  return cv;
}

// Parte el nombre en líneas que quepan, y baja el tamaño si aun así no cabe.
function acomodarTexto(cx, texto, ancho, maxLineas, desde, hasta) {
  for (let tam = desde; tam >= hasta; tam -= 2) {
    cx.font = `700 ${tam}px system-ui, "Segoe UI", Arial, sans-serif`;
    const lineas = [];
    let actual = '';
    for (const palabra of texto.split(' ')) {
      const prueba = actual ? actual + ' ' + palabra : palabra;
      if (cx.measureText(prueba).width <= ancho) { actual = prueba; }
      else { if (actual) lineas.push(actual); actual = palabra; }
    }
    if (actual) lineas.push(actual);
    if (lineas.length <= maxLineas && lineas.every(l => cx.measureText(l).width <= ancho))
      return { tam, lineas };
  }
  return { tam: hasta, lineas: [texto] };
}

function lienzoEtiqueta(e) {
  const A = 1080, AL = 420, M = 30;
  const qr = lienzoQR(e.codigo, 360);
  const cv = document.createElement('canvas');
  cv.width = A; cv.height = AL;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, A, AL);

  const ladoQR = AL - M * 2;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(qr, M, M, ladoQR, ladoQR);

  const x = M + ladoQR + 34;
  const ancho = A - x - M;
  cx.fillStyle = '#000';
  cx.textBaseline = 'top';

  const { tam, lineas } = acomodarTexto(cx, e.titulo, ancho, 3, 62, 30);
  const altoNombre = lineas.length * (tam + 8);
  const altoCodigo = 46;
  let y = Math.max(M, (AL - altoNombre - 18 - altoCodigo) / 2);

  cx.font = `700 ${tam}px system-ui, "Segoe UI", Arial, sans-serif`;
  for (const l of lineas) { cx.fillText(l, x, y); y += tam + 8; }

  y += 18;
  cx.font = '600 42px ui-monospace, Consolas, "Courier New", monospace';
  cx.fillStyle = '#333';
  cx.fillText(e.codigo, x, y);
  return cv;
}

const aBlob = cv => new Promise(r => cv.toBlob(r, 'image/png'));

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
      const carpeta = e.clase === 'punto' ? 'puntos' : 'medidores';
      const nombre = `${e.codigo}_${L(e.titulo.replace(/³/g, '3'))}.png`;
      zip.file(`etiquetas/${carpeta}/${nombre}`, await aBlob(lienzoEtiqueta(e)));
      zip.file(`solo-qr/${carpeta}/${nombre}`, await aBlob(lienzoQR(e.codigo, 560)));
      if (i % 8 === 0) await new Promise(r => setTimeout(r));   // no congelar la pantalla
    }
    zip.file('leeme.txt',
      'etiquetas/  · la etiqueta lista para pegar: QR + nombre + código (1080 x 420 px)\n' +
      'solo-qr/    · el QR solo, para plantillas que ya traen el texto\n\n' +
      'Imprime el QR a 2,5 cm de lado o más; por debajo de eso la cámara del celular sufre.\n' +
      'La etiqueta del punto no nombra al medidor y la del medidor no nombra al punto:\n' +
      'los equipos se cambian y la etiqueta quedaría mintiendo.\n');
    paso('Comprimiendo…');
    descargar(await zip.generateAsync({ type: 'blob' }), `QR_Cierre_de_Mes_${new Date().toISOString().slice(0,10)}.zip`);
    paso('');
    toast(`${etiquetas.length * 2} imágenes listas`);
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

/* En iPhone, una app agregada a la pantalla de inicio puede quedarse semanas
   con la versión vieja: el navegador revalida el service worker cuando quiere.
   Por eso la app pregunta ella misma, con una URL que ningún caché puede
   responder, y si hay algo nuevo lo dice y lo aplica a pedido del usuario. */
async function revisarVersion() {
  if (!navigator.onLine) return;
  try {
    const r = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = await r.json();
    if (!version || version === C.VERSION) return;

    const barra = el('div', { class: 'banner-version fila' }, [
      el('span', { class: 'crece', text: `Hay una versión nueva de la app (${version}).` }),
      el('button', { class: 'btn chico', text: 'Actualizar ahora', onclick: async e => {
        e.target.disabled = true;
        const pend = await DB.pendientes();
        if (pend.length && !confirm(
          `Tienes ${pend.length} registro(s) sin enviar. Se conservan en el dispositivo, ` +
          'pero conviene sincronizar antes. ¿Actualizar igual?')) { e.target.disabled = false; return; }
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          await reg?.update();
          // Se borra solo el caché de archivos; IndexedDB (las lecturas) no se toca.
          if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
          await reg?.unregister();
        } catch { /* si algo falla, la recarga igual trae lo nuevo */ }
        location.reload();
      } })
    ]);
    document.getElementById('app').prepend(barra);
  } catch { /* sin conexión o sin archivo: no pasa nada */ }
}
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') location.reload();
  // Respaldo por si el enlace llegó con otro formato y no se detectó al cargar.
  if (evento === 'PASSWORD_RECOVERY') window.__recuperacion = true;
});
arrancar();
})();

# Cierre de Mes

PWA para tomar las lecturas mensuales de energía, agua y gas en terreno, validarlas,
sacar los informes y descargar la planilla anual en Excel. Funciona sin señal y
sincroniza sola cuando vuelve la conexión.

Página publicada: `https://mwarrieta.github.io/Cierre-de-Mes/`

## Publicar una versión nueva

La carpeta `C:\Dev\Cierred de Mes\repo` es el clon de este repositorio.

1. Subir la versión en **los dos** archivos, con el mismo valor:
   - `version.json` → `{"version": "AAAA-MM-DD.N"}`
   - `config.js` → `VERSION: 'AAAA-MM-DD.N'`

   Si no coinciden, el aviso de versión nueva aparece siempre. Si no se cambian, nadie se
   entera de la versión nueva (un iPhone con la app instalada puede quedarse días con la vieja).
2. GitHub Desktop → revisar *Changes* → *Commit to main* → *Push origin*.
3. GitHub Pages publica en 30 s a 2 min. En cada teléfono aparece el banner
   **"Hay una versión nueva · Actualizar ahora"**. Actualizar no borra la cola de lecturas.

Los cambios no existen para nadie hasta el push.

**Saltos de línea:** si GitHub Desktop muestra `jsqr.js`, `jszip.js`, `manifest.webmanifest`
o `respaldo.js` como modificados sin que nadie los tocara, es un tema de saltos de línea
Windows/Linux: no hace falta subirlos.

**Si GitHub Desktop dice que `index.lock` existe:** borrar el archivo `.git/index.lock`
(queda cuando un comando de git se corta a la mitad).

## Probarla en el PC

```
cd "C:\Dev\Cierred de Mes\repo"
npx serve .
```

No compila nada, pero hay que servirla por HTTP. **Abrirla con doble clic (`file://`) no
funciona**: el navegador bloquea el manifest, `version.json`, el service worker, el login y
cualquier llamada a Supabase, y la consola se llena de errores de CORS que no son de la app.

## Usuarios y permisos

Todo se hace desde la app, en *Configuración → Usuarios* (solo administradores).

**Dar de alta a una persona:** botón **+ Persona nueva**. Se completan nombre, correo, clave
inicial, rol y los **grupos** que puede ver. La función `crear_usuario` crea la cuenta, la ficha
y los grupos en un solo paso. La clave inicial se la entrega el admin por fuera de la app.
Si el correo ya tiene cuenta en el proyecto (lo comparte con la app de instrumentación), se usa
esa cuenta y su clave no cambia.

**Qué ve cada uno:**

| Rol | Puede |
|---|---|
| `admin` | todo, incluida la configuración y los usuarios. Ve todos los puntos sin asignación. |
| `supervisor` | validar, informes, avisos y configurar puntos y equipos de sus grupos |
| `colaborador` | tomar lecturas en terreno |
| `visualizador` | solo mirar |
| `casa_fuerza` | generadores y recargas de combustible |

**El rol dice qué puede hacer; los grupos dicen qué puntos ve.** Cualquier rol que no sea
admin y no tenga grupos (ni puntos sueltos) asignados entra a la app pero no ve ningún punto.
La pantalla Usuarios lo marca en rojo: *"sin acceso: no ve ningún punto"*, y el botón
**Grupos** de cada persona permite cambiarlo. Al agregar un punto a un grupo, quienes ven ese
grupo lo ven automáticamente.

Otras acciones en Usuarios: cambiar el rol, activar/desactivar, **Cambiar clave** (función
`cambiar_clave`) y eliminar (solo si la persona nunca tomó lecturas; si tomó, se desactiva).

**Antes de usar la app con datos reales:**
- Dar de baja las cuentas de prueba `@cierre.test`.
- En Supabase (*Authentication → Providers → Email*): desactivar *Enable Sign Ups*. Las altas se
  hacen desde la app; con el registro abierto cualquiera podría crearse una cuenta.
- Activar *Leaked password protection* en Authentication.

La llave de `config.js` es la publicable: está pensada para vivir en el navegador. Lo que
protege los datos son las políticas RLS de la base.

## Cómo se organizan los puntos: grupos

**No hay sitios ni áreas** (se eliminaron el 03-oct-2026). Todo se organiza por **grupos de
reporte**:

- Un punto puede estar en **varios grupos** (por ejemplo, en su sector y en un grupo
  transversal como "Agua" o "Combustibles").
- Los grupos se crean en *Configuración → Grupos* y se asignan desde ahí o desde el formulario
  del punto.
- En terreno los puntos se listan por grupo. Un punto que está en varios aparece una sola vez,
  en su primer grupo según el orden definido en *Grupos*.
- Los informes, el Excel, el PDF de avisos y el respaldo filtran y ordenan por grupo.
- Las sumas por grupo son referenciales: no hay un total general.

**Pendiente:** las columnas `sitio_id` (puntos, equipos, generadores) y `area` (puntos) siguen
en la base pero ya nada las usa. Borrarlas cuando se confirme que nada falla, junto con las
tablas `sitios` y `usuario_sitios` y las funciones `mis_sitios` / `puede_ver_sitio`.

## Configuración

Dos pantallas, cada una responde una pregunta:

**Puntos de medición: "¿dónde se mide y qué se lee?"** Todo lo del lugar está en la ficha del
punto:

- Nombre, tipo de equipo, foto obligatoria y calidad de la foto.
- **Grupos de reporte** (puede estar en varios).
- **Qué se lee en este punto**, con casillas: energía importada (kWh+), energía exportada
  (kWh-), horas de marcha, volumen de agua (m³), volumen de gas (m³) y litros. Para la energía
  se elige cómo la muestra el display: *kWh*, *MWh* o *MWh y kWh en dos campos*. El informe
  siempre queda en kWh y la app convierte sola. Si hay importada y exportada, se marca cuál
  **va al informe**; la otra se guarda pero no suma. *Opcional* = aparece en terreno pero no
  cuenta como pendiente. Una lectura que se desmarca no se borra (tiene historia): queda
  inactiva. Lo que no calza en la lista se configura en *Otras lecturas (avanzado)*.
- Instrucción de lectura (aparece arriba al abrir el punto en terreno).
- **Equipo instalado**: el medidor vigente, su certificado, el historial de equipos que pasaron
  por el punto y el botón *Cambiar o retirar el equipo*. Al instalar o reemplazar, la app
  pregunta **cómo muestra la energía el equipo nuevo**: la unidad del display es del medidor,
  y si se cambia uno que muestra kWh por uno que muestra MWh sin ajustarla, la lectura sale mil
  veces más chica y el consumo del mes queda absurdo.

La lista de puntos tiene filtros: *Sin equipo*, *Certificado vencido o por vencer* (60 días) y
*Sin lecturas*.

**Equipos: "¿qué aparatos tengo?"** El inventario de medidores: TAG, marca, serie,
certificado, estado (en servicio, en bodega, en reparación, de baja) y dónde está instalado.
Desde la ficha del equipo también se puede mover a otro punto.

El punto es lo permanente: la serie histórica cuelga del punto, no del medidor.

**Etiquetas QR:** `CM-P-…` va en la estructura (el punto) y `CM-E-…` en el instrumento.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | estructura de la página |
| `styles.css` | estilos: alto contraste, botones grandes, claro/oscuro, CSS de impresión |
| `config.js` | URL y llave publicable de Supabase, y `VERSION` |
| `version.json` | versión publicada (debe coincidir con `config.js`) |
| `db.js` | cliente Supabase, caché offline en IndexedDB y cola de envío |
| `app.js` | todas las vistas |
| `respaldo.js` | genera los .xlsx en el propio navegador |
| `sw.js` | service worker: la app abre sin señal |
| `supabase.js`, `jszip.js`, `qr.js`, `jsqr.js` | librerías incluidas en el repo, para no depender de un CDN que la red de faena pueda bloquear |

## Cómo funciona el modo sin señal

1. Al entrar con conexión, la app baja el catálogo completo de puntos a IndexedDB.
2. En terreno, cada lectura, sus fotos (hasta 3) y sus avisos se guardan en una cola local.
   Nada se pierde si se cierra la app o se acaba la batería.
3. Cuando vuelve la señal, la cola se envía sola. Si una foto falla, el reintento sube solo las
   que faltan. El chip de la barra dice cuántos registros faltan y *Este dispositivo* los
   detalla (y permite descargarlos a un archivo si la cola no logra enviarse).
4. Las fotos se comprimen en el dispositivo (~250-350 KB).

## Qué hay adentro

- **Tomar lecturas:** lista por grupo con avance del mes, escaneo QR, captura a pantalla
  completa (foto primero, después las lecturas, avisos plegados), alertas cuando el número no
  cuadra con la historia del punto.
- **Validación:** fotos y dato lado a lado, corrección con motivo, auditoría completa.
- **Consumos e informes:** mes, año o rango por grupo; vista para imprimir y descarga en Excel.
- **Avisos:** lista por grupo y **PDF de avisos pendientes** en blanco y negro para adjuntar a
  los informes (lo genera el navegador con *Guardar como PDF*).
- **Casa de Fuerza:** generadores (con ubicación en texto libre) y recargas de combustible.
- **Respaldo:** incremental, con las fotos en Año / Mes / Grupo y un índice en Excel. Varias
  fotos de una lectura se numeran `_foto1`, `_foto2`, `_foto3`.

## Base de datos

Proyecto Supabase `Pampa_DB_Instrumentación` (ref `ofqnxkibomxibuhdxzvj`), esquema `cierre_mes`,
separado del esquema `public` de la app de instrumentación (comparten `auth.users`). La lógica
de cálculo y los permisos viven en Postgres:

- `mis_puntos()` decide qué puntos ve cada persona: todo si es admin; si no, los de sus grupos
  (`usuario_grupos`) y sus puntos sueltos (`usuario_puntos`).
- Las fotos tienen tope de 3 por lectura o por aviso y se numeran en el servidor.

**Edge Functions** (necesitan el bloque de CORS y responder al `OPTIONS`; sin eso el navegador
bloquea la llamada con *"No 'Access-Control-Allow-Origin' header"*):

| Función | Para qué |
|---|---|
| `cambiar_clave` | el admin cambia la clave de otra persona |
| `crear_usuario` | alta completa de una persona: cuenta, ficha, rol y grupos |

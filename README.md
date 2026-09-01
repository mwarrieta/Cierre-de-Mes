# Cierre de Mes

PWA para tomar las lecturas mensuales de energía, agua y gas en terreno, validarlas,
sacar los informes y descargar la planilla anual en Excel. Funciona sin señal y
sincroniza sola cuando vuelve la conexión.

## Publicarla en GitHub Pages

1. Sube **el contenido de esta carpeta** a la raíz del repositorio.
2. En GitHub: *Settings → Pages → Source: Deploy from a branch → main → / (root)*.
3. En un par de minutos queda en `https://<usuario>.github.io/<repositorio>/`.
4. Desde ese enlace, en Android: menú del navegador → "Agregar a la pantalla de inicio".
   En iPhone: Safari → Compartir → "Agregar a pantalla de inicio".

Todas las rutas son relativas, así que funciona igual en la raíz o en un subdirectorio.
GitHub Pages entrega HTTPS, que es lo que exigen la instalación de la PWA y la cámara del
escáner QR.

**Antes de publicar**, en el panel de Supabase (*Authentication → Providers → Email*):
desactivar el registro público (*Enable Sign Ups*). La llave que viaja en `config.js` es la
publicable — está pensada para vivir en el navegador y las políticas RLS son las que protegen
los datos — pero con el registro abierto cualquiera podría crearse una cuenta en el proyecto.

Al subir una versión nueva no hay que hacer nada más: el service worker responde desde el caché
para que la app abra al instante, y en paralelo se trae la versión nueva y la deja lista para el
próximo arranque. En la práctica, el dispositivo queda actualizado la segunda vez que se abre la
app con señal. (Si algún día hace falta forzarlo, se sube el número de `CACHE` en `sw.js`.)

## Probarla en el PC

```
cd "C:\Dev\Cierred de Mes\app"
npx serve .
```

No compila nada. Solo hay que servirla por HTTP: desde `file://` el navegador no permite
service workers ni login.

## Cuentas

Las cuentas de prueba (`@cierre.test`) son para desarrollo y **hay que darlas de baja antes de
usar la app con datos reales**. Las contraseñas no se escriben acá: se crean e informan por
fuera del repositorio.

Los usuarios se invitan desde el panel de Supabase y el rol se asigna en la sección *Usuarios*
de la app. Cada persona ve solo los puntos de su sitio, su grupo o los que se le asignen.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | estructura de la página |
| `styles.css` | estilos: alto contraste, botones de 44px, claro/oscuro, CSS de impresión |
| `config.js` | URL y llave publicable de Supabase — lo único que cambia entre entornos |
| `db.js` | cliente Supabase, caché offline en IndexedDB y cola de envío |
| `app.js` | todas las vistas |
| `respaldo.js` | genera los .xlsx en el propio navegador |
| `sw.js` | service worker: la app abre sin señal |
| `supabase.js`, `jszip.js`, `qr.js`, `jsqr.js` | librerías incluidas en el repo, para que la app no dependa de un CDN que la red de faena pueda bloquear |

## Cómo funciona el modo sin señal

1. Al entrar con conexión, la app baja el catálogo completo de puntos a IndexedDB.
2. En terreno, cada lectura y su foto se guardan en una cola local. Nada se pierde si se cierra
   la app o se acaba la batería.
3. Cuando vuelve la señal, la cola se envía sola. El chip de la barra dice en todo momento
   cuántos registros faltan por enviar, y la vista *Este dispositivo* los detalla.
4. Las fotos se comprimen en el dispositivo antes de guardarse (~250-350 KB).

## Qué hay adentro

- **Terreno**: lista por sitio, escaneo QR del punto y del medidor, captura con foto,
  alertas en vivo cuando el número no cuadra con la historia del punto.
- **Validación**: foto y dato lado a lado, corrección con motivo obligatorio, auditoría completa.
- **Consumos e informes**: mes, año o rango; vista para imprimir y **descarga en Excel**
  (resumen anual, detalle mensual, una hoja por grupo, lecturas y consumos en formato largo).
- **Casa de Fuerza**: ciclo de vida de los generadores y recargas de combustible.
- **Respaldo**: incremental, con las fotos ordenadas en Año / Mes / Grupo / TAG_Punto.

## Base de datos

Proyecto Supabase `Pampa_DB_Instrumentación`, esquema `cierre_mes`, separado del esquema
`public` que usa la app de instrumentación. Toda la lógica de cálculo y los permisos viven
en Postgres, no en el navegador.

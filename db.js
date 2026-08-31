/* ===================================================================
   db.js · cliente Supabase, caché offline (IndexedDB) y cola de envío
   =================================================================== */
(function () {
  const C = window.CONFIG;

  // ---------------- Supabase ----------------
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
    db: { schema: C.SCHEMA },
    auth: { persistSession: true, autoRefreshToken: true }
  });

  // ---------------- IndexedDB ----------------
  const DB_NOMBRE = 'cierre-mes';
  const DB_VER = 1;
  const ALMACENES = {
    catalogo:   { keyPath: 'clave' },              // puntos, sitios, grupos, catálogos
    lecturas:   { keyPath: 'id' },                 // últimas lecturas conocidas por variable
    cola:       { keyPath: 'id', auto: true },     // pendientes de enviar
    fotos:      { keyPath: 'id', auto: true }      // blobs pendientes
  };

  let _db = null;
  function abrir() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NOMBRE, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [n, cfg] of Object.entries(ALMACENES)) {
          if (!d.objectStoreNames.contains(n)) {
            d.createObjectStore(n, cfg.auto
              ? { keyPath: cfg.keyPath, autoIncrement: true }
              : { keyPath: cfg.keyPath });
          }
        }
      };
      req.onsuccess = () => { _db = req.result; res(_db); };
      req.onerror = () => rej(req.error);
    });
  }

  async function tx(almacen, modo, fn) {
    const d = await abrir();
    return new Promise((res, rej) => {
      const t = d.transaction(almacen, modo);
      const store = t.objectStore(almacen);
      let out;
      try { out = fn(store); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }

  const idb = {
    async guardar(almacen, valor) { return tx(almacen, 'readwrite', s => s.put(valor)); },
    async agregar(almacen, valor) { return tx(almacen, 'readwrite', s => s.add(valor)); },
    async leer(almacen, clave)    { return tx(almacen, 'readonly',  s => s.get(clave)); },
    async todos(almacen)          { return tx(almacen, 'readonly',  s => s.getAll()); },
    async borrar(almacen, clave)  { return tx(almacen, 'readwrite', s => s.delete(clave)); },
    async vaciar(almacen)         { return tx(almacen, 'readwrite', s => s.clear()); }
  };

  // ---------------- Fotos: compresión en el dispositivo ----------------
  async function comprimirFoto(file, calidad = 'normal') {
    const bitmap = await createImageBitmap(file);
    const max = calidad === 'alta' ? C.FOTO_MAX_PX_ALTA : C.FOTO_MAX_PX;
    let { width: w, height: h } = bitmap;
    if (Math.max(w, h) > max) {
      const f = max / Math.max(w, h);
      w = Math.round(w * f); h = Math.round(h * f);
    }
    const lienzo = document.createElement('canvas');
    lienzo.width = w; lienzo.height = h;
    lienzo.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return new Promise(res => lienzo.toBlob(res, 'image/jpeg',
      calidad === 'alta' ? C.FOTO_CALIDAD_ALTA : C.FOTO_CALIDAD));
  }

  // ---------------- Catálogo (se descarga con señal) ----------------
  async function descargarCatalogo() {
    const [puntos, sitios, grupos, avisos, generadores, instalados, gente] = await Promise.all([
      sb.from('variables').select(`
          id, nombre, unidad_display, unidad_reporte, decimales_display,
          formato_lectura, activo, grupo_id,
          punto:puntos!inner ( id, nombre, area, foto_obligatoria, foto_calidad, activo,
            sitio:sitios!inner ( id, nombre ),
            tipo:tipos_equipo!inner ( id, nombre )
          )`).eq('activo', true),
      sb.from('sitios').select('*').order('nombre'),
      sb.from('grupos').select('*').order('nombre'),
      sb.from('catalogo_avisos').select('*').eq('activo', true).order('categoria'),
      sb.from('generadores').select('*').eq('activo', true).order('n_equipo'),
      // el equipo ya no cuelga del punto: viene de la asignación vigente
      sb.from('v_puntos').select('id, equipo_id, tag, marca, modelo, n_serie, certificado, vence_certificado, equipo_desde'),
      sb.from('usuarios').select('id, nombre')
    ]);
    for (const r of [puntos, sitios, grupos, avisos, generadores, instalados]) if (r.error) throw r.error;

    const porPunto = {};
    for (const p of instalados.data) porPunto[p.id] = p.equipo_id ? p : null;
    for (const v of puntos.data) v.punto.equipo = porPunto[v.punto.id] || null;

    const datos = {
      variables: puntos.data, sitios: sitios.data, grupos: grupos.data,
      catalogoAvisos: avisos.data, generadores: generadores.data,
      gente: Object.fromEntries((gente.data || []).map(u => [u.id, u.nombre])),
      bajadoEn: Date.now()
    };
    await idb.guardar('catalogo', { clave: 'principal', datos });
    return datos;
  }

  async function catalogo({ forzar = false } = {}) {
    if (!forzar) {
      const local = await idb.leer('catalogo', 'principal');
      if (local && navigator.onLine === false) return local.datos;
      if (local && Date.now() - local.datos.bajadoEn < 6 * 3600e3) return local.datos;
    }
    try { return await descargarCatalogo(); }
    catch (e) {
      const local = await idb.leer('catalogo', 'principal');
      if (local) return local.datos;
      throw e;
    }
  }

  // ---------------- Lecturas del periodo ----------------
  async function lecturasDelPeriodo(periodo) {
    const { data, error } = await sb.from('lecturas')
      .select(`id, variable_id, periodo, fecha_lectura, valor, valor_display, valor_mwh, valor_kwh,
               sin_dato, es_reset, tipo_reset, consumo_manual, observacion, estado, obs_validacion,
               tomada_por, validada_por, validada_en, origen,
               fotos ( id, storage_path )`)
      .eq('periodo', periodo);
    if (error) throw error;
    await idb.guardar('catalogo', { clave: 'lecturas:' + periodo, datos: data });
    return data;
  }

  async function lecturasCache(periodo) {
    const r = await idb.leer('catalogo', 'lecturas:' + periodo);
    return r ? r.datos : [];
  }

  // Última lectura conocida de cada variable (para mostrar el valor anterior en terreno)
  async function ultimasLecturas() {
    const { data, error } = await sb.from('v_ultimas_lecturas').select('*');
    if (error) throw error;
    await idb.guardar('catalogo', { clave: 'ultimas', datos: data });
    return data;
  }
  async function ultimasCache() {
    const r = await idb.leer('catalogo', 'ultimas');
    return r ? r.datos : [];
  }

  // ---------------- Cola offline ----------------
  async function encolar(registro, blobFoto) {
    let fotoId = null;
    if (blobFoto) fotoId = await idb.agregar('fotos', { blob: blobFoto, creado: Date.now() });
    await idb.agregar('cola', { ...registro, fotoId, creado: Date.now(), intentos: 0 });
    return true;
  }

  async function pendientes() { return idb.todos('cola'); }

  async function sincronizar(alAvanzar) {
    if (!navigator.onLine) return { enviados: 0, fallidos: 0, sinRed: true };
    const cola = await idb.todos('cola');
    let enviados = 0, fallidos = 0;

    for (const item of cola) {
      try {
        const { fotoId, id: idLocal, creado, intentos, _foto, tipo, ...fila } = item;

        // La cola lleva dos clases de registro: lecturas del cierre de mes y
        // recargas de combustible de Casa de Fuerza. Las recargas no llevan foto.
        if (tipo === 'recarga') {
          const { error: e2 } = await sb.rpc('registrar_recarga', {
            p_generador_id: fila.generador_id,
            p_fecha_hora: fila.fecha_hora,
            p_litros: fila.litros,
            p_combustible: fila.combustible ?? 'Diesel',
            p_origen: fila.origen ?? null,
            p_guia: fila.guia ?? null,
            p_camion: fila.camion ?? null,
            p_horometro: fila.horometro ?? null,
            p_operador: fila.operador ?? null,
            p_obs: fila.observaciones ?? null,
            p_dispositivo: fila.dispositivo ?? null
          });
          if (e2) throw e2;
          await idb.borrar('cola', idLocal);
          enviados++;
          alAvanzar && alAvanzar(enviados, fallidos, cola.length);
          continue;
        }

        if (tipo === 'movimiento_generador') {
          const { error: e3 } = await sb.rpc('mover_generador', {
            p_generador_id: fila.generador_id,
            p_tipo: fila.movimiento,
            p_fecha: fila.fecha,
            p_horometro: fila.horometro ?? null,
            p_kwh: fila.kwh ?? null,
            p_ubicacion: fila.ubicacion ?? null,
            p_motivo: fila.motivo ?? null,
            p_obs: fila.observaciones ?? null,
            p_dispositivo: fila.dispositivo ?? null
          });
          if (e3) throw e3;
          await idb.borrar('cola', idLocal);
          enviados++;
          alAvanzar && alAvanzar(enviados, fallidos, cola.length);
          continue;
        }

        const { data: nuevoId, error } = await sb.rpc('guardar_lectura', {
          p_variable_id: fila.variable_id,
          p_periodo: fila.periodo,
          p_fecha_lectura: fila.fecha_lectura,
          p_valor_display: fila.valor_display ?? null,
          p_valor_mwh: fila.valor_mwh ?? null,
          p_valor_kwh: fila.valor_kwh ?? null,
          p_sin_dato: !!fila.sin_dato,
          p_observacion: fila.observacion ?? null,
          p_es_reset: !!fila.es_reset,
          p_tipo_reset: fila.tipo_reset ?? null,
          p_dispositivo: fila.dispositivo ?? null
        });
        if (error) throw error;
        const ins = { id: nuevoId };

        if (fotoId) {
          const f = await idb.leer('fotos', fotoId);
          if (f && f.blob) {
            const ruta = `${fila.periodo}/${fila.variable_id}/${crypto.randomUUID()}.jpg`;
            const up = await sb.storage.from(C.BUCKET)
              .upload(ruta, f.blob, { contentType: 'image/jpeg', upsert: false });
            if (up.error) throw up.error;
            const ft = await sb.from('fotos').insert({
              lectura_id: ins.id, storage_path: ruta, bytes: f.blob.size,
              tomada_en: new Date(f.creado).toISOString()
            });
            if (ft.error) throw ft.error;
            await idb.borrar('fotos', fotoId);
          }
        }

        await idb.borrar('cola', idLocal);
        enviados++;
      } catch (e) {
        console.warn('Falló el envío de un registro:', e);
        item.intentos = (item.intentos || 0) + 1;
        item.ultimoError = e.message || String(e);
        await idb.guardar('cola', item);
        fallidos++;
      }
      alAvanzar && alAvanzar(enviados, fallidos, cola.length);
    }
    return { enviados, fallidos };
  }

  window.__sb = sb; // ayuda de depuración
  // Si la cola no logra sincronizar, se saca del dispositivo a un archivo.
  // Nada queda dependiendo solo del navegador.
  async function exportarPendientes() {
    const cola = await idb.todos('cola');
    const fotos = await idb.todos('fotos');
    const aB64 = b => new Promise(r => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result).split(',')[1]);
      fr.readAsDataURL(b);
    });
    const conFotos = [];
    for (const f of fotos) conFotos.push({ id: f.id, creado: f.creado, jpeg_base64: await aB64(f.blob) });
    return {
      exportado_en: new Date().toISOString(),
      pendientes: cola.map(({ blob, ...r }) => r),
      fotos: conFotos
    };
  }

  async function estadoAlmacenamiento() {
    let persistido = false, cuota = null, usado = null;
    try { persistido = await navigator.storage?.persisted?.() ?? false; } catch {}
    try { const e = await navigator.storage?.estimate?.(); cuota = e?.quota; usado = e?.usage; } catch {}
    return { persistido, cuota, usado };
  }
  async function pedirPersistencia() {
    try { return await navigator.storage?.persist?.() ?? false; } catch { return false; }
  }

  window.DB = {
    sb, idb, comprimirFoto, catalogo, descargarCatalogo,
    lecturasDelPeriodo, lecturasCache, ultimasLecturas, ultimasCache,
    encolar, pendientes, sincronizar, exportarPendientes,
    estadoAlmacenamiento, pedirPersistencia
  };
})();

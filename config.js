// ---------------------------------------------------------------------------
// Configuración · Cierre de Mes
// Si algún día cambias de proyecto Supabase, este es el único archivo a tocar.
// ---------------------------------------------------------------------------
window.CONFIG = {
  VERSION: '2026-09-01.7',   // debe coincidir con version.json
  SUPABASE_URL: 'https://ofqnxkibomxibuhdxzvj.supabase.co',
  SUPABASE_KEY: 'sb_publishable_pmRoAg80tAuGNTfCrqvkjg_CHvmB60w',
  SCHEMA: 'cierre_mes',
  BUCKET: 'fotos-cierre',
  TZ: 'America/Santiago',
  FOTO_MAX_PX: 1280,       // calidad normal: ~250-350 KB por foto
  FOTO_CALIDAD: 0.72,
  FOTO_MAX_PX_ALTA: 1600,  // calidad alta: ~450-550 KB, para puntos de facturación
  FOTO_CALIDAD_ALTA: 0.82
};

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * CORS: en producción se definen los dominios del frontend en CORS_ORIGINS
 * (separados por coma, sin barra final). Ej: https://auryx.com,https://www.auryx.com
 * Si no está definida (desarrollo), se aceptan solo orígenes locales.
 * Desde un navegador solo se permite LEER: las escrituras se hacen con ADMIN_API_KEY
 * desde scripts/herramientas, que no pasan por CORS.
 */
export function corsOptions() {
  const allowed = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return {
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
      if (!origin) return cb(null, true); // curl, healthchecks, server-to-server
      const ok = allowed.length > 0 ? allowed.includes(origin) : LOCAL_ORIGIN.test(origin) || origin === 'null';
      cb(null, ok);
    },
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  };
}

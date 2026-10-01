const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Un "origen" es solo esquema + dominio (+ puerto), sin ruta: https://usuario.github.io
 * Si en CORS_ORIGINS se pega una URL con ruta (https://usuario.github.io/mi-sitio),
 * se queda solo con el origen, que es lo que manda el navegador.
 */
function toOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, '');
  }
}

/**
 * CORS: en producción se definen los dominios del frontend en CORS_ORIGINS
 * (separados por coma). Ej: https://auryx.com,https://usuario.github.io
 * Si no está definida (desarrollo), se aceptan solo orígenes locales.
 * Desde un navegador solo se permite LEER: las escrituras se hacen con ADMIN_API_KEY
 * desde scripts/herramientas, que no pasan por CORS.
 */
export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).map(toOrigin);
}

export function corsOptions() {
  const allowed = allowedOrigins();
  const warned = new Set<string>();
  return {
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
      if (!origin) return cb(null, true); // curl, healthchecks, server-to-server
      const ok = allowed.length > 0 ? allowed.includes(origin) : LOCAL_ORIGIN.test(origin) || origin === 'null';
      if (!ok && !warned.has(origin)) {
        warned.add(origin);
        // un origen rechazado se ve en el navegador como 404 "Cannot OPTIONS", así que se avisa acá
        console.warn(`⚠️  CORS: se rechazó el origen "${origin}". Permitidos: ${allowed.length ? allowed.join(', ') : 'solo localhost'}`);
      }
      cb(null, ok);
    },
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning'], // este último lo manda el frontend para saltar el aviso de ngrok
    maxAge: 86400,
  };
}

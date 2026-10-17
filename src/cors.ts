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
 * Desde un navegador se permite leer, los POST públicos (compatibilidad, calculadoras,
 * contacto), las cuentas de clientes (Authorization con la sesión del cliente) y el panel
 * de administración, que se publica en el mismo dominio que el sitio y llama directo con
 * su token de admin (por eso PUT y DELETE). La seguridad la pone el token, no el origen:
 * va en un header, no en cookies, así que otra página no puede usarlo por el usuario.
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
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'], // el último lo manda el frontend para saltar el aviso de ngrok
    maxAge: 86400,
  };
}

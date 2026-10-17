/**
 * Headers de seguridad para todas las respuestas, sin dependencias (lo básico de helmet).
 * La API solo devuelve JSON, así que se puede ser estricto:
 *  - nosniff: el navegador no adivina el tipo (un JSON no se interpreta como HTML o script).
 *  - X-Frame-Options DENY: ninguna respuesta se muestra dentro de un iframe.
 *  - Referrer-Policy no-referrer: no se filtran URLs con datos a otros sitios.
 *  - HSTS: solo HTTPS por un año (en http local el navegador lo ignora).
 *  - CORP same-origin: frena que otra página cargue las respuestas con <img>/<script> (pedidos no-cors).
 *    No afecta al sitio: sus fetch van en modo CORS, y a esos los controla CORS, no CORP.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function securityHeaders(_req: unknown, res: { setHeader(name: string, value: string): unknown }, next: () => void) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  next();
}

/**
 * Nombre para mostrar de un producto. Los nombres del catálogo siguen el patrón
 * "{Qué es} {Marca} {Tecnología} – {Línea o modelo} – {Dato clave}" (ej. "Panel Solar Jinko N-Type
 * TOPCon – Tiger Neo – 585 W") y ya llevan la marca; los que todavía no, la llevan adelante.
 * Mismo criterio que productTitle del sitio (src/utils/format.js): pedidos, Mercado Pago y el
 * dimensionador nombran igual que la tienda.
 */
export function productTitle(p: { brand?: string | null; name?: string | null }): string {
  const name = String(p?.name ?? '');
  const brandWord = String(p?.brand ?? '').trim().split(/\s+/)[0];
  if (!brandWord) return name;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${brandWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
  return re.test(name) ? name : `${p.brand} ${name}`;
}

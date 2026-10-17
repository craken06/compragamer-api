import { BadRequestException } from '@nestjs/common';

// Las 24 jurisdicciones; el sitio manda la etiqueta exacta de un desplegable.
export const PROVINCES: readonly string[] = [
  'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Ciudad Autónoma de Buenos Aires', 'Córdoba',
  'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

export interface ShippingAddress {
  street: string;
  floor: string | null;
  city: string;
  province: string;
  zip: string;
}

// El input llega crudo: puede faltar, no ser string o venir con espacios.
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizePhone(raw: unknown): string {
  const s = str(raw);
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw new BadRequestException('Revisá el teléfono: tiene que tener entre 8 y 15 números.');
  }
  return (s.startsWith('+') ? '+' : '') + digits;
}

export function normalizeAddress(raw: unknown): ShippingAddress {
  if (!isObj(raw)) throw new BadRequestException('Falta la dirección de entrega.');
  const street = str(raw.street);
  if (street.length < 3 || street.length > 120) {
    throw new BadRequestException('Falta la calle y el número.');
  }
  const floor = str(raw.floor);
  if (floor.length > 40) throw new BadRequestException('Revisá el piso o departamento: es demasiado largo.');
  const city = str(raw.city);
  if (city.length < 2 || city.length > 80) throw new BadRequestException('Falta la localidad.');
  const province = str(raw.province);
  if (!PROVINCES.includes(province)) throw new BadRequestException('Elegí una provincia de la lista.');
  const zip = str(raw.zip).toUpperCase();
  if (!/^\d{4}$/.test(zip) && !/^[A-Z]\d{4}[A-Z]{3}$/.test(zip)) {
    throw new BadRequestException('Revisá el código postal: son 4 números (o el formato CPA, ej. C1425ABC).');
  }
  return { street, floor: floor || null, city, province, zip };
}

// CUIT/CUIL: pesos 5,4,3,2,7,6,5,4,3,2; verificador = 11 - (suma % 11), 11 → 0, 10 → inválido.
export function isValidCuit(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((a, p, i) => a + p * Number(digits[i]), 0);
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(digits[10]);
}

export function normalizeBilling(raw: unknown): { doc: string; name: string } | null {
  if (!isObj(raw)) return null;
  const rawDoc = str(raw.doc);
  const name = str(raw.name);
  if (!rawDoc && !name) return null;
  if (!rawDoc) throw new BadRequestException('Falta el DNI o CUIT para la factura.');
  if (!name) throw new BadRequestException('Falta el nombre o razón social para la factura.');
  const doc = rawDoc.replace(/\D/g, '');
  if (doc.length === 11) {
    if (!isValidCuit(doc)) throw new BadRequestException('Revisá el CUIT: el número no es válido.');
  } else if (doc.length < 7 || doc.length > 8) {
    throw new BadRequestException('Revisá el documento: el DNI tiene 7 u 8 números y el CUIT 11.');
  }
  if (name.length < 2 || name.length > 120) {
    throw new BadRequestException('Revisá el nombre o razón social para la factura.');
  }
  return { doc, name };
}

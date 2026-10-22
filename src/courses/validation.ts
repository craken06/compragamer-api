import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/*
 * Lo que el admin puede escribir en cursos, módulos, lecciones y recursos. Como en productos, el body
 * nunca se esparce entero en Prisma: solo pasan los campos permitidos, con su tipo y largo.
 * En update (`partial`), lo que no viene no se toca.
 */

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const COURSE_LEVELS = ['inicial', 'intermedio', 'avanzado'] as const;
export const COURSE_STATUSES = ['borrador', 'publicado', 'archivado'] as const;
export const LESSON_KINDS = ['video', 'lectura', 'prueba', 'tarea'] as const;

const bad = (msg: string) => new BadRequestException(msg);

function text(v: unknown, field: string, max: number, required = false): string {
  if (v === null || v === undefined) {
    if (required) throw bad(`Falta ${field}.`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${field} tiene que ser texto.`);
  const s = v.trim();
  if (required && !s) throw bad(`Falta ${field}.`);
  if (s.length > max) throw bad(`${field} supera los ${max} caracteres.`);
  return s;
}

function int(v: unknown, field: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} tiene que ser un número entero entre ${min} y ${max}.`);
  return n;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw bad(`${field} tiene que ser verdadero o falso.`);
  return v;
}

/** URL http(s) (se muestra en el sitio: nada de javascript: ni data:). null/'' = sin URL. */
export function httpUrl(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (s.length > 1000 || !/^https?:\/\/[^\s"<>]+$/i.test(s)) throw bad(`${field} tiene que ser una URL http(s).`);
  return s;
}

function list(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw bad(`${field} tiene que ser una lista.`);
  if (v.length > 20) throw bad(`${field}: hasta 20 ítems.`);
  return v.map((x) => text(x, field, 300)).filter(Boolean);
}

const has = (o: any, k: string) => o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

export function courseData(b: any, partial: boolean): Prisma.CourseUncheckedUpdateInput & Record<string, any> {
  const d: Record<string, any> = {};
  if (!partial || has(b, 'title')) d.title = text(b?.title, 'el título', 160, true);
  if (!partial || has(b, 'slug')) {
    const slug = text(b?.slug, 'la dirección (slug)', 80, true).toLowerCase();
    if (!SLUG_RE.test(slug)) throw bad('La dirección (slug) solo puede tener minúsculas, números y guiones: ej. "instalaciones-on-grid".');
    d.slug = slug;
  }
  if (has(b, 'subtitle')) d.subtitle = text(b.subtitle, 'el subtítulo', 300);
  if (has(b, 'description')) d.description = text(b.description, 'la descripción', 20000);
  if (has(b, 'coverUrl')) d.coverUrl = httpUrl(b.coverUrl, 'La portada');
  if (has(b, 'level')) {
    if (!COURSE_LEVELS.includes(b.level)) throw bad('Nivel inválido (inicial, intermedio o avanzado).');
    d.level = b.level;
  }
  if (has(b, 'durationHours')) {
    const h = Number(b.durationHours);
    if (!Number.isFinite(h) || h < 0 || h > 999) throw bad('Las horas tienen que ser un número entre 0 y 999.');
    d.durationHours = new Prisma.Decimal(Math.round(h * 10) / 10);
  }
  if (has(b, 'priceArs')) {
    const p = Number(b.priceArs);
    if (!Number.isFinite(p) || p < 0 || p > 100_000_000) throw bad('El precio tiene que ser un número mayor o igual a 0 (0 = gratis).');
    d.priceArs = new Prisma.Decimal(Math.round(p * 100) / 100);
  }
  if (has(b, 'status')) {
    if (!COURSE_STATUSES.includes(b.status)) throw bad('Estado inválido (borrador, publicado o archivado).');
    d.status = b.status;
  }
  if (has(b, 'sequential')) d.sequential = bool(b.sequential, 'Orden obligatorio');
  if (has(b, 'instructorName')) d.instructorName = text(b.instructorName, 'el nombre del instructor', 120);
  if (has(b, 'instructorBio')) d.instructorBio = text(b.instructorBio, 'la bio del instructor', 2000);
  if (has(b, 'instructorPhotoUrl')) d.instructorPhotoUrl = httpUrl(b.instructorPhotoUrl, 'La foto del instructor');
  if (has(b, 'outcomes')) d.outcomes = list(b.outcomes, 'Qué vas a aprender');
  if (has(b, 'requirements')) d.requirements = list(b.requirements, 'Requisitos');
  if (has(b, 'position')) d.position = int(b.position, 'La posición', 0, 10000);
  return d;
}

export function moduleData(b: any, partial: boolean) {
  const d: Record<string, any> = {};
  if (!partial || has(b, 'title')) d.title = text(b?.title, 'el título del módulo', 160, true);
  if (has(b, 'description')) d.description = text(b.description, 'la descripción del módulo', 2000);
  return d;
}

/** Campos de la lección salvo el video (lo valida VideoService.normalize). */
export function lessonData(b: any, partial: boolean) {
  const d: Record<string, any> = {};
  if (!partial || has(b, 'title')) d.title = text(b?.title, 'el título de la lección', 160, true);
  if (!partial || has(b, 'kind')) {
    const kind = b?.kind ?? 'video';
    if (!LESSON_KINDS.includes(kind)) throw bad('Tipo de lección inválido (video, lectura, prueba o tarea).');
    d.kind = kind;
  }
  if (has(b, 'body')) d.body = text(b.body, 'el texto de la lección', 50000);
  if (has(b, 'durationMin')) d.durationMin = int(b.durationMin, 'La duración', 0, 1000);
  if (has(b, 'isPreview')) d.isPreview = bool(b.isPreview, 'Vista previa');
  if (has(b, 'isOptional')) d.isOptional = bool(b.isOptional, 'Opcional');
  if (has(b, 'passPct')) d.passPct = int(b.passPct, 'La nota mínima', 1, 100);
  if (has(b, 'maxAttempts')) d.maxAttempts = b.maxAttempts === null || b.maxAttempts === '' ? null : int(b.maxAttempts, 'Los intentos', 1, 100);
  if (has(b, 'instructions')) d.instructions = text(b.instructions, 'la consigna', 20000);
  return d;
}

export function resourceLinkData(b: any) {
  return { kind: 'link', title: text(b?.title, 'el nombre del recurso', 160, true), url: httpUrl(b?.url, 'El link') ?? (() => { throw bad('Falta el link.'); })() };
}

/** Lista de ids para reordenar: tienen que ser exactamente los existentes, sin repetir. */
export function orderIds(raw: unknown, existing: number[], what: string): number[] {
  const ids = Array.isArray(raw) ? raw.map(Number) : [];
  const set = new Set(ids);
  if (ids.length !== existing.length || set.size !== ids.length || !existing.every((id) => set.has(id))) {
    throw bad(`El orden de ${what} no coincide con los que hay: recargá la página.`);
  }
  return ids;
}

/** Nombre impreso en el certificado: letras, espacios, apóstrofo, punto y guion; 3 a 80 caracteres. */
export function certificateName(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (s.length < 3 || s.length > 80 || !/^[\p{L}][\p{L}\p{M} .'’-]*$/u.test(s)) {
    throw bad('Revisá el nombre para el certificado: solo letras y espacios, entre 3 y 80 caracteres.');
  }
  return s;
}

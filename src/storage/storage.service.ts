import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { presignUrl } from './sigv4';

/*
 * Archivos en Cloudflare R2 (S3 compatible). El navegador sube directo a R2 con una URL firmada:
 * la API valida tipo y tamaño ANTES de firmar, y la firma incluye Content-Type y Content-Length,
 * así que no sirve para otro archivo. Dos buckets:
 *  - privado (comprobantes, recursos de cursos, entregas): se descarga con URL firmada de 10 min.
 *  - público (portadas e imágenes): se ve por R2_PUBLIC_URL.
 * Variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PRIVATE_BUCKET,
 * R2_PUBLIC_BUCKET, R2_PUBLIC_URL. Sin ellas, firmar responde 503.
 */

export type Bucket = 'private' | 'public';

export interface UploadRule {
  /** extensión → Content-Type aceptado */
  types: Record<string, string>;
  maxBytes: number;
}

export interface UploadRequest { filename?: unknown; size?: unknown; contentType?: unknown }

export interface SignedUpload {
  key: string;
  url: string;
  /** encabezados que el navegador tiene que mandar en el PUT (Content-Length lo pone solo) */
  headers: Record<string, string>;
  /** URL pública final (solo bucket público) */
  publicUrl?: string;
}

const UPLOAD_TTL_S = 15 * 60;
const DOWNLOAD_TTL_S = 10 * 60;

export const RECEIPT_RULE: UploadRule = {
  types: { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' },
  maxBytes: 8 * 1024 * 1024,
};

/** Valida un pedido de subida y devuelve extensión, tipo, tamaño y nombre limpio. Lanza 400 con el motivo. */
export function checkUpload(req: UploadRequest, rule: UploadRule) {
  const filename = String(req?.filename ?? '').trim();
  const size = Number(req?.size);
  const ext = (filename.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toLowerCase();
  const contentType = rule.types[ext];
  if (!contentType) throw new BadRequestException(`Tipo de archivo no permitido. Aceptamos: ${[...new Set(Object.keys(rule.types))].join(', ').toUpperCase()}.`);
  // el tipo que manda el navegador puede venir vacío; si viene, tiene que coincidir con la extensión
  if (req?.contentType && String(req.contentType) !== contentType) throw new BadRequestException('El tipo del archivo no coincide con su extensión.');
  if (!Number.isInteger(size) || size <= 0) throw new BadRequestException('El archivo está vacío o no es válido.');
  if (size > rule.maxBytes) throw new BadRequestException(`El archivo supera el máximo de ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`);
  const clean = filename.replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_').slice(-120);
  return { ext, contentType, size, filename: clean };
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  get enabled() {
    const e = process.env;
    return !!(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_PRIVATE_BUCKET);
  }

  get publicEnabled() {
    return this.enabled && !!(process.env.R2_PUBLIC_BUCKET && process.env.R2_PUBLIC_URL);
  }

  private bucketName(bucket: Bucket) {
    const name = bucket === 'public' ? process.env.R2_PUBLIC_BUCKET : process.env.R2_PRIVATE_BUCKET;
    if (!this.enabled || !name || (bucket === 'public' && !process.env.R2_PUBLIC_URL)) {
      throw new ServiceUnavailableException('La subida de archivos todavía no está configurada (faltan las variables R2_*).');
    }
    return name;
  }

  private sign(method: 'GET' | 'PUT' | 'DELETE', bucket: Bucket, key: string, expires: number, headers?: Record<string, string>, query?: Record<string, string>) {
    const name = this.bucketName(bucket);
    return presignUrl({
      method, host: `${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, path: `/${name}/${key}`,
      region: 'auto', accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      expires, headers, query,
    });
  }

  /** Arma una clave nueva bajo `prefix` ("receipts/AX-123456") con un nombre al azar. */
  newKey(prefix: string, ext: string) {
    return `${prefix.replace(/\/+$/, '')}/${randomUUID()}.${ext}`;
  }

  /** URL firmada para que el navegador suba un archivo ya validado con checkUpload. */
  signUpload(bucket: Bucket, key: string, file: { contentType: string; size: number }): SignedUpload {
    const url = this.sign('PUT', bucket, key, UPLOAD_TTL_S, { 'content-type': file.contentType, 'content-length': String(file.size) });
    return {
      key, url, headers: { 'Content-Type': file.contentType },
      ...(bucket === 'public' ? { publicUrl: this.publicUrl(key) } : {}),
    };
  }

  /** Descarga de un archivo privado (10 min). Con `filename`, el navegador lo guarda con ese nombre. */
  signDownload(key: string, filename?: string) {
    const query = filename ? { 'response-content-disposition': `attachment; filename="${filename.replace(/["\\]/g, '_')}"` } : undefined;
    return this.sign('GET', 'private', key, DOWNLOAD_TTL_S, undefined, query);
  }

  publicUrl(key: string) {
    return `${String(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '')}/${key}`;
  }

  /** Borra un archivo. Nunca lanza: si falla, queda huérfano en el bucket (se avisa en el log). */
  async remove(bucket: Bucket, key: string | null | undefined) {
    if (!key || !this.enabled) return;
    try {
      const res = await fetch(this.sign('DELETE', bucket, key, 60), { method: 'DELETE', signal: AbortSignal.timeout(10000) });
      if (!res.ok && res.status !== 404) this.logger.warn(`R2 DELETE ${key} respondió ${res.status}`);
    } catch (err) {
      this.logger.warn(`No se pudo borrar ${key} de R2: ${(err as Error)?.message}`);
    }
  }
}
